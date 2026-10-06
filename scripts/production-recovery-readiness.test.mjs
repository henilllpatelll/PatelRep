import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateProductionRecoveryReadiness } from './production-recovery-readiness.mjs'

const REPO = 'henilllpatelll/PatelRep'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const CONTROL = D

const rollbackWorkflow = [
  "run-name: Production Rollback ${{ inputs.target_version }}${{ inputs.automation_source_run_id && format(' (automated request from run {0})', inputs.automation_source_run_id) || '' }}",
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      automation_source_run_id:',
  '        description: "Automation only"',
  'jobs:',
  '  resolve:',
  '    steps:',
  '      - run: node scripts/production-auto-rollback-request.mjs rollback',
  '        env:',
  '          PRODUCTION_AUTO_ROLLBACK_ENABLED: ${{ vars.PRODUCTION_AUTO_ROLLBACK_ENABLED }}',
].join('\n')

const audit = (overrides = {}) => ({
  state: 'consistent_managed_release',
  consistent: true,
  reason_code: null,
  runtime: { proven: true, version: 'v1.8.1', sha: B },
  managed_release: { proven: true, tag: 'v1.8.1', sha: B },
  incident: {
    open: false,
    rollback_run_id: null,
    incident_run_id: null,
    quarantine_mode: null,
  },
  reentry: { state: 'not_required' },
  ...overrides,
})

function deps({
  mainSha = CONTROL,
  releases = [
    { tag_name: 'v1.8.1', draft: false, prerelease: false },
    { tag_name: 'v1.8.0', draft: false, prerelease: false },
  ],
  tags = { 'v1.8.1': B, 'v1.8.0': A },
  strictHealthy = true,
  rollbackSource = rollbackWorkflow,
} = {}) {
  return {
    getMainSha: async () => mainSha,
    listReleases: async () => releases,
    listTagNames: async () => Object.keys(tags),
    resolveTagCommit: async (tag) => tags[tag],
    isAncestorOfMain: async (sha) => Object.values(tags).includes(sha),
    isExactCandidateHealthy: async () => strictHealthy,
    readRollbackWorkflowAt: async () => rollbackSource,
  }
}

const helpers = (auditResult, open = null) => ({
  auditProductionReleaseState: async () => auditResult,
  findLatestOpenAutomatedRollback: async () => open,
})

test('live readiness is fully ready when current runtime is healthy and previous managed release is a proven rollback target', async () => {
  const result = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps(),
    helpers(audit()),
  )
  assert.equal(result.pass, true)
  assert.equal(result.state, 'ready')
  assert.equal(result.runtime.strict_smoke, true)
  assert.equal(result.control_plane.rollback_contract_proven, true)
  assert.deepEqual(result.rollback_target, {
    available: true,
    source: 'previous_managed_release',
    tag: 'v1.8.0',
    sha: A,
    main_ancestor: true,
  })
  assert.equal(result.database_compatibility, 'not_exercised_read_only_no_secret')
})

test('first managed production release is explicitly bootstrap-limited rather than falsely rollback-ready', async () => {
  const result = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps({
      releases: [{ tag_name: 'v1.8.0', draft: false, prerelease: false }],
      tags: { 'v1.8.0': A },
    }),
    helpers(audit({
      runtime: { proven: true, version: 'v1.8.0', sha: A },
      managed_release: { proven: true, tag: 'v1.8.0', sha: A },
    })),
  )
  assert.equal(result.pass, true)
  assert.equal(result.state, 'limited_bootstrap_no_previous_release')
  assert.equal(result.rollback_target.available, false)
  assert.deepEqual(result.limitations, ['no_previous_managed_release'])
})

test('valid automated rollback quarantine proves its exact incident target instead of selecting an unrelated prior release', async () => {
  const open = {
    run: { id: 37920000001 },
    evidence: {
      target: { version: 'v1.8.0', sha: A },
    },
  }
  const result = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps(),
    helpers(audit({
      state: 'quarantined_post_release_regression',
      incident: {
        open: true,
        rollback_run_id: '37920000001',
        incident_run_id: '37910000001',
        quarantine_mode: 'managed_release_mismatch',
      },
      reentry: { state: 'required' },
      runtime: { proven: true, version: 'v1.8.0', sha: A },
    }), open),
  )
  assert.equal(result.pass, true)
  assert.equal(result.state, 'ready_quarantined_post_release_regression')
  assert.equal(result.rollback_target.source, 'open_incident')
  assert.equal(result.rollback_target.tag, 'v1.8.0')
  assert.equal(result.audit.reentry_state, 'required')
})

test('active production operation defers and moving main during the drill also defers instead of producing false failure', async () => {
  const active = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps(),
    helpers(audit({
      state: 'deferred_active_production_operation',
      consistent: true,
      runtime: { proven: false, version: null, sha: null },
      managed_release: { proven: false, tag: null, sha: null },
      reentry: { state: 'unknown_during_active_operation' },
    })),
  )
  assert.equal(active.pass, true)
  assert.equal(active.state, 'deferred_active_production_operation')

  const moved = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps({ mainSha: C }),
    helpers(audit()),
  )
  assert.equal(moved.pass, true)
  assert.equal(moved.state, 'deferred_main_moved_during_drill')
  assert.deepEqual(moved.limitations, ['main_moved_during_drill'])
})

test('failed strict public smoke makes live recovery readiness fail even when identity is still exact', async () => {
  const result = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps({ strictHealthy: false }),
    helpers(audit()),
  )
  assert.equal(result.pass, false)
  assert.equal(result.state, 'failed')
  assert.equal(result.reason_code, 'strict_public_smoke_failed')
})

test('missing Phase 3D rollback execution contract fails readiness before claiming a target', async () => {
  const result = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps({ rollbackSource: 'name: Production Rollback\non:\n  workflow_dispatch:\n' }),
    helpers(audit()),
  )
  assert.equal(result.pass, false)
  assert.equal(result.reason_code, 'rollback_execution_contract_unproven')
  assert.equal(result.rollback_target.available, false)
})

test('unproven or inconsistent Phase 4D audit fails closed with categorical reason', async () => {
  const result = await evaluateProductionRecoveryReadiness(
    { repo: REPO, controlPlaneSha: CONTROL },
    deps(),
    helpers(audit({
      state: 'inconsistent',
      consistent: false,
      reason_code: 'runtime_managed_release_mismatch',
    })),
  )
  assert.equal(result.pass, false)
  assert.equal(result.reason_code, 'audit_runtime_managed_release_mismatch')
})
