#!/usr/bin/env node
// Phase 5A: synthetic end-to-end resilience drills for the trusted release/recovery control plane.
// This file uses in-memory fixtures only. It never reads or mutates live production/GitHub state.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyProductionRelease } from './production-release-stabilization.mjs'
import { evaluateAutoRollbackRequest } from './production-auto-rollback-policy.mjs'
import { verifyAutoRollbackCircuitBreaker } from './production-auto-rollback-circuit-breaker.mjs'
import {
  authorizeProductionIncidentReentry,
  verifyProductionReleaseReentry,
} from './production-incident-reentry.mjs'
import { auditProductionReleaseState } from './production-release-audit.mjs'
import { buildNotificationIntent } from './production-operations-notify.mjs'

export const DRILL_SCHEMA = 'patelrep.release-resilience-drill.v1'
export const DRILL_CASES = Object.freeze([
  'post_release_regression_full_cycle',
  'database_change_blocks_auto_rollback',
  'partial_release_quarantine',
  'runtime_drift_is_detected_and_notified',
  'stale_reentry_authorization_is_refused',
  'active_production_operation_defers_audit',
])

const REPO = 'henilllpatelll/PatelRep'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const E = 'e'.repeat(40)
const T = 'f'.repeat(40)

const RELEASE_RUN = '37800000001'
const STAB_RUN = '37810000001'
const ROLLBACK_RUN = '37820000001'
const AUTH_RUN = '37830000001'
const AUDIT_RUN = '37840000001'

const rollbackWorkflowContract = [
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

const releaseRun = (overrides = {}) => ({
  id: Number(RELEASE_RUN),
  run_attempt: 1,
  name: 'Production Release',
  path: '.github/workflows/production-release.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: C,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const stabilizationRun = (overrides = {}) => ({
  id: Number(STAB_RUN),
  run_attempt: 1,
  name: 'Production Release Stabilization',
  path: '.github/workflows/production-release-stabilization.yml',
  event: 'workflow_run',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: C,
  created_at: '2026-10-06T12:00:00Z',
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const releasedEvidence = (overrides = {}) => ({
  schema: 'patelrep.production-release-evidence.v1',
  workflow: 'Production Release',
  run: { id: RELEASE_RUN, attempt: 1, control_plane_sha: C },
  source: {
    mode: 'manual',
    automation_source_run_id: null,
    version_bump: 'patch',
    reentry: { present: false, valid: true, authorization_run_id: null, rollback_run_id: null },
  },
  candidate: { eligible: true, release_sha: B, pr_number: 120, version: 'v1.8.1' },
  previous_release: { tag: 'v1.8.0', sha: A },
  jobs: {},
  database_pending: false,
  mutations: {
    database: 'no_change',
    api: 'deployed_and_verified',
    web: 'deployed_and_verified',
    release_record: 'created',
  },
  production_verified: true,
  disposition: 'released',
  ...overrides,
})

const releaseDeps = () => ({
  resolveTagCommit: async (tag) => ({ 'v1.8.0': A, 'v1.8.1': B, 'v1.8.2': D }[tag]),
  listReleases: async () => [
    { tag_name: 'v1.8.1', draft: false, prerelease: false },
    { tag_name: 'v1.8.0', draft: false, prerelease: false },
  ],
})

function autoRollbackDeps({ incident, evidence = releasedEvidence(), runtime = { sha: B, version: 'v1.8.1' }, healthy = false } = {}) {
  return {
    getRun: async (id) => String(id) === STAB_RUN ? stabilizationRun() : String(id) === RELEASE_RUN ? releaseRun() : null,
    readIncident: async () => incident,
    readReleaseEvidence: async () => evidence,
    isAncestorOfMain: async (sha) => [A, B, C].includes(sha),
    listReleases: async () => [
      { tag_name: 'v1.8.1', draft: false, prerelease: false },
      { tag_name: 'v1.8.0', draft: false, prerelease: false },
    ],
    resolveTagCommit: async (tag) => ({ 'v1.8.1': B, 'v1.8.0': A }[tag]),
    getPr: async () => ({
      number: 120,
      merged_at: '2026-10-06T11:50:00Z',
      base: { ref: 'main' },
      head: { repo: { full_name: REPO } },
      merge_commit_sha: B,
      changed_files: 1,
    }),
    listPrFiles: async () => [{ filename: 'apps/web/app/dashboard/page.tsx', status: 'modified' }],
    readRuntimeIdentity: async () => runtime,
    isExactCandidateHealthy: async () => healthy,
    getMainSha: async () => C,
    readRollbackWorkflowAt: async () => rollbackWorkflowContract,
    listActiveProductionRuns: async () => [],
  }
}

function circuitBreakerDeps({ incident, runtime = { sha: A, version: 'v1.8.0' }, partial = false } = {}) {
  const releases = partial
    ? [{ tag_name: 'v1.8.0', draft: false, prerelease: false }]
    : [
        { tag_name: 'v1.8.1', draft: false, prerelease: false },
        { tag_name: 'v1.8.0', draft: false, prerelease: false },
      ]
  const tags = partial ? { 'v1.8.0': A } : { 'v1.8.1': B, 'v1.8.0': A }
  return {
    getRun: async () => stabilizationRun(),
    readIncident: async () => incident,
    resolveTagCommit: async (tag) => tags[tag],
    readRuntimeIdentity: async () => runtime,
    listReleases: async () => releases,
    listTagNames: async () => Object.keys(tags),
    isAncestorOfMain: async (sha) => [A, B, C].includes(sha),
  }
}

function rollbackRun() {
  return {
    id: Number(ROLLBACK_RUN),
    run_attempt: 1,
    name: 'Production Rollback',
    path: '.github/workflows/production-rollback.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: C,
    created_at: '2026-10-06T12:05:00Z',
    display_title: `Production Rollback v1.8.0 (automated request from run ${STAB_RUN})`,
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  }
}

function rollbackEvidence() {
  return {
    schema: 'patelrep.production-rollback-evidence.v1',
    workflow: 'Production Rollback',
    run: { id: ROLLBACK_RUN, attempt: 1, control_plane_sha: C },
    source: {
      mode: 'automated_incident',
      automation_source_present: true,
      automation_source_valid: true,
      automation_source_run_id: STAB_RUN,
    },
    target: { requested_version: 'v1.8.0', requested_version_valid: true, resolved: true, version: 'v1.8.0', sha: A },
    mutations: {
      database: 'not_mutated_by_workflow',
      api: 'deployed_and_verified',
      web: 'deployed_and_verified',
      release_record: 'not_created_by_workflow',
    },
    after_runtime: { state: 'verified_target', sha: A, version: 'v1.8.0' },
    production_verified: true,
    quarantine: 'verified',
    disposition: 'restored',
  }
}

function reentryDeps({ incident, auth = null, mainSha = D } = {}) {
  const authRun = {
    id: Number(AUTH_RUN),
    run_attempt: 1,
    name: 'Production Incident Re-entry',
    path: '.github/workflows/production-incident-reentry.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: C,
    created_at: '2026-10-06T12:10:00Z',
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  }
  return {
    listRollbackRuns: async () => [rollbackRun()],
    readRollbackEvidence: async () => rollbackEvidence(),
    listReleaseRuns: async () => [],
    listStabilizationRuns: async () => [],
    readReleaseEvidence: async () => null,
    readCloseout: async () => null,
    getRun: async (id) => {
      if (String(id) === STAB_RUN) return stabilizationRun()
      if (String(id) === AUTH_RUN) return authRun
      return null
    },
    readIncident: async () => incident,
    resolveTagCommit: async (tag) => ({ 'v1.8.0': A, 'v1.8.1': B }[tag]),
    readRuntimeIdentity: async () => ({ sha: A, version: 'v1.8.0' }),
    listReleases: async () => [
      { tag_name: 'v1.8.1', draft: false, prerelease: false },
      { tag_name: 'v1.8.0', draft: false, prerelease: false },
    ],
    listTagNames: async () => ['v1.8.1', 'v1.8.0'],
    isAncestorOfMain: async () => true,
    getMainSha: async () => mainSha,
    isAncestor: async (base, head) => base === B && head === D,
    listCheckRuns: async (sha, name) => [{ name, conclusion: 'success', head_sha: sha }],
    listAssociatedPullRequests: async () => [{
      number: 121,
      merged_at: '2026-10-06T12:08:00Z',
      base: { ref: 'main' },
      head: { sha: E, repo: { full_name: REPO } },
    }],
    getCommitTree: async (sha) => [D, E].includes(sha) ? T : '0'.repeat(40),
    listActiveProductionRuns: async () => [],
    readReentryAuthorization: async () => auth,
  }
}

async function classifyRegression() {
  const classified = await classifyProductionRelease({
    sourceRun: releaseRun(),
    evidence: releasedEvidence(),
    classifier: { run_id: STAB_RUN, run_attempt: 1, control_plane_sha: C },
    deps: releaseDeps(),
    stabilize: async () => ({
      outcome: 'post_release_regression',
      probes: [{ attempt: 1, ok: false }, { attempt: 2, ok: false }],
    }),
  })
  assert.equal(classified.result.classification, 'post_release_regression')
  assert.equal(classified.incident.classification, 'post_release_regression')
  return classified
}

function auditDeps({ runtime, releases, tags, mainSha = D, reentryRuns = [], authByRun = {}, active = [] }) {
  return {
    listActiveProductionRuns: async () => active,
    listReleases: async () => releases,
    listTagNames: async () => Object.keys(tags),
    resolveTagCommit: async (tag) => tags[tag],
    isAncestorOfMain: async () => true,
    readRuntimeIdentity: async () => runtime,
    getMainSha: async () => mainSha,
    listReentryRuns: async () => reentryRuns,
    readReentryAuthorization: async (runId) => authByRun[String(runId)] ?? null,
  }
}

async function drillPostReleaseRegressionFullCycle() {
  const classified = await classifyRegression()
  const incident = classified.incident

  const rollbackDecision = await evaluateAutoRollbackRequest(
    { repo: REPO, sourceRunId: STAB_RUN, enabled: 'true', mode: 'resolve' },
    autoRollbackDeps({ incident }),
  )
  assert.equal(rollbackDecision.eligible, true)
  assert.equal(rollbackDecision.targetVersion, 'v1.8.0')
  assert.equal(rollbackDecision.targetSha, A)

  const breaker = await verifyAutoRollbackCircuitBreaker(
    { repo: REPO, sourceRunId: STAB_RUN, targetVersion: rollbackDecision.targetVersion, targetSha: rollbackDecision.targetSha },
    circuitBreakerDeps({ incident }),
  )
  assert.equal(breaker.mode, 'managed_release_mismatch')

  const authorization = await authorizeProductionIncidentReentry({
    repo: REPO,
    runId: AUTH_RUN,
    runAttempt: '1',
    controlPlaneSha: C,
    rollbackRunId: ROLLBACK_RUN,
    releaseSha: D,
    versionBump: 'patch',
  }, reentryDeps({ incident }))
  assert.equal(authorization.rollback.run_id, ROLLBACK_RUN)
  assert.equal(authorization.authorized_release.sha, D)

  const releaseReentry = await verifyProductionReleaseReentry({
    repo: REPO,
    releaseSha: D,
    versionBump: 'patch',
    reentrySourceRunId: AUTH_RUN,
    automationSourceRunId: '',
  }, reentryDeps({ incident, auth: authorization }))
  assert.deepEqual(releaseReentry, {
    required: true,
    rollback_run_id: ROLLBACK_RUN,
    authorization_run_id: AUTH_RUN,
  })

  const auditRun = {
    id: Number(AUTH_RUN),
    run_attempt: 1,
    name: 'Production Incident Re-entry',
    path: '.github/workflows/production-incident-reentry.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: C,
    created_at: '2026-10-06T12:10:00Z',
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  }
  const audit = await auditProductionReleaseState(
    { repo: REPO },
    auditDeps({
      runtime: { version: 'v1.8.0', sha: A },
      releases: [
        { tag_name: 'v1.8.1', draft: false, prerelease: false },
        { tag_name: 'v1.8.0', draft: false, prerelease: false },
      ],
      tags: { 'v1.8.1': B, 'v1.8.0': A },
      reentryRuns: [auditRun],
      authByRun: { [AUTH_RUN]: authorization },
    }),
    {
      findLatestOpenAutomatedRollback: async () => ({
        run: rollbackRun(),
        evidence: { incident_run_id: STAB_RUN, target: { version: 'v1.8.0', sha: A } },
      }),
      verifyAutoRollbackCircuitBreaker: async () => breaker,
    },
  )
  assert.equal(audit.state, 'quarantined_post_release_regression')
  assert.equal(audit.reentry.state, 'authorized_current_main')

  const notify = await buildNotificationIntent({ repo: REPO, sourceRunId: STAB_RUN }, {
    getRun: async () => stabilizationRun(),
    readNamedContext: async (runId, name) =>
      String(runId) === STAB_RUN && name === 'production-release-stabilization' ? classified.result : null,
  })
  assert.equal(notify.kind, 'incident_opened')
  assert.equal(notify.severity, 'critical')

  const reentryReleasedEvidence = {
    ...releasedEvidence(),
    run: { id: RELEASE_RUN, attempt: 1, control_plane_sha: C },
    source: {
      mode: 'manual',
      automation_source_run_id: null,
      version_bump: 'patch',
      reentry: {
        present: true,
        valid: true,
        authorization_run_id: AUTH_RUN,
        rollback_run_id: ROLLBACK_RUN,
      },
    },
    candidate: { eligible: true, release_sha: D, pr_number: 121, version: 'v1.8.2' },
    previous_release: { tag: 'v1.8.1', sha: B },
  }
  const closed = await classifyProductionRelease({
    sourceRun: releaseRun(),
    evidence: reentryReleasedEvidence,
    classifier: { run_id: '37850000001', run_attempt: 1, control_plane_sha: C },
    deps: {
      resolveTagCommit: async (tag) => ({ 'v1.8.1': B, 'v1.8.2': D }[tag]),
      listReleases: async () => [{ tag_name: 'v1.8.2', draft: false, prerelease: false }],
    },
    stabilize: async () => ({ outcome: 'stable', probes: [{ attempt: 1, ok: true }] }),
  })
  assert.equal(closed.result.classification, 'stable')
  assert.equal(closed.closeout.closed, true)

  const recovered = await auditProductionReleaseState(
    { repo: REPO },
    auditDeps({
      runtime: { version: 'v1.8.2', sha: D },
      releases: [{ tag_name: 'v1.8.2', draft: false, prerelease: false }],
      tags: { 'v1.8.2': D },
    }),
    {
      findLatestOpenAutomatedRollback: async () => null,
      verifyAutoRollbackCircuitBreaker: async () => { throw new Error('must not run') },
    },
  )
  assert.equal(recovered.state, 'consistent_managed_release')

  return {
    classification: classified.result.classification,
    rollback_eligible: rollbackDecision.eligible,
    quarantine_mode: breaker.mode,
    reentry_authorized: releaseReentry.required,
    quarantined_audit: audit.state,
    closeout: closed.closeout.closed,
    recovered_audit: recovered.state,
  }
}

async function drillDatabaseChangeBlocksAutoRollback() {
  const classified = await classifyRegression()
  const incident = {
    ...classified.incident,
    release_state: {
      ...classified.incident.release_state,
      mutations: { ...classified.incident.release_state.mutations, database: 'verified_applied' },
    },
  }
  const evidence = {
    ...releasedEvidence(),
    mutations: { ...releasedEvidence().mutations, database: 'verified_applied' },
  }
  const decision = await evaluateAutoRollbackRequest(
    { repo: REPO, sourceRunId: STAB_RUN, enabled: 'true', mode: 'resolve' },
    autoRollbackDeps({ incident, evidence }),
  )
  assert.equal(decision.eligible, false)
  assert.match(decision.reason, /zero production migrations/)
  return { rollback_eligible: false, reason_class: 'database_changed' }
}

async function drillPartialReleaseQuarantine() {
  const failedEvidence = releasedEvidence({
    disposition: 'failed_or_partial',
    production_verified: false,
    mutations: {
      database: 'no_change',
      api: 'deployed_and_verified',
      web: 'unknown_after_attempt',
      release_record: 'not_created',
    },
  })
  const classified = await classifyProductionRelease({
    sourceRun: releaseRun({ conclusion: 'failure' }),
    evidence: failedEvidence,
    classifier: { run_id: STAB_RUN, run_attempt: 1, control_plane_sha: C },
    deps: releaseDeps(),
  })
  assert.equal(classified.result.classification, 'partial_release_failure')

  const breaker = await verifyAutoRollbackCircuitBreaker(
    { repo: REPO, sourceRunId: STAB_RUN, targetVersion: 'v1.8.0', targetSha: A },
    circuitBreakerDeps({ incident: classified.incident, partial: true }),
  )
  assert.equal(breaker.mode, 'failed_candidate_unmanaged')

  const audit = await auditProductionReleaseState(
    { repo: REPO },
    auditDeps({
      runtime: { version: 'v1.8.0', sha: A },
      releases: [{ tag_name: 'v1.8.0', draft: false, prerelease: false }],
      tags: { 'v1.8.0': A },
    }),
    {
      findLatestOpenAutomatedRollback: async () => ({
        run: rollbackRun(),
        evidence: { incident_run_id: STAB_RUN, target: { version: 'v1.8.0', sha: A } },
      }),
      verifyAutoRollbackCircuitBreaker: async () => breaker,
    },
  )
  assert.equal(audit.state, 'quarantined_partial_release_failure')
  return { classification: classified.result.classification, quarantine_mode: breaker.mode, audit_state: audit.state }
}

async function drillRuntimeDriftDetectedAndNotified() {
  const audit = await auditProductionReleaseState(
    { repo: REPO },
    auditDeps({
      runtime: { version: 'v1.8.0', sha: A },
      releases: [{ tag_name: 'v1.8.1', draft: false, prerelease: false }],
      tags: { 'v1.8.1': B },
    }),
    {
      findLatestOpenAutomatedRollback: async () => null,
      verifyAutoRollbackCircuitBreaker: async () => { throw new Error('must not run') },
    },
  )
  assert.equal(audit.consistent, false)
  assert.equal(audit.reason_code, 'runtime_managed_release_mismatch')

  const sourceRun = {
    id: Number(AUDIT_RUN),
    run_attempt: 1,
    name: 'Production Release Audit',
    path: '.github/workflows/production-release-audit.yml',
    event: 'schedule',
    status: 'completed',
    conclusion: 'failure',
    head_branch: 'main',
    head_sha: C,
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  }
  const artifact = {
    ...audit,
    run: { id: AUDIT_RUN, attempt: 1, control_plane_sha: C },
  }
  const intent = await buildNotificationIntent({ repo: REPO, sourceRunId: AUDIT_RUN }, {
    getRun: async () => sourceRun,
    readNamedContext: async (runId, name) =>
      String(runId) === AUDIT_RUN && name === 'production-release-audit' ? artifact : null,
  })
  assert.equal(intent.key, 'audit:production-integrity')
  assert.equal(intent.kind, 'audit_inconsistent')
  assert.equal(intent.severity, 'critical')
  return { audit_reason: audit.reason_code, notification_kind: intent.kind, severity: intent.severity }
}

async function drillStaleReentryAuthorizationIsRefused() {
  const classified = await classifyRegression()
  const authorization = await authorizeProductionIncidentReentry({
    repo: REPO,
    runId: AUTH_RUN,
    runAttempt: '1',
    controlPlaneSha: C,
    rollbackRunId: ROLLBACK_RUN,
    releaseSha: D,
    versionBump: 'patch',
  }, reentryDeps({ incident: classified.incident }))

  await assert.rejects(
    verifyProductionReleaseReentry({
      repo: REPO,
      releaseSha: D,
      versionBump: 'patch',
      reentrySourceRunId: AUTH_RUN,
      automationSourceRunId: '',
    }, reentryDeps({ incident: classified.incident, auth: authorization, mainSha: '1'.repeat(40) })),
    /main moved after re-entry authorization/,
  )
  return { stale_authorization_refused: true }
}

async function drillActiveProductionOperationDefersAudit() {
  const audit = await auditProductionReleaseState(
    { repo: REPO },
    auditDeps({
      runtime: { version: 'v1.8.1', sha: B },
      releases: [{ tag_name: 'v1.8.1', draft: false, prerelease: false }],
      tags: { 'v1.8.1': B },
      active: [{ id: 1, workflow: 'production-release.yml', status: 'in_progress' }],
    }),
    {
      findLatestOpenAutomatedRollback: async () => { throw new Error('must not inspect during active operation') },
      verifyAutoRollbackCircuitBreaker: async () => { throw new Error('must not inspect during active operation') },
    },
  )
  assert.equal(audit.state, 'deferred_active_production_operation')
  assert.equal(audit.consistent, true)
  return { audit_state: audit.state, false_positive_avoided: true }
}

const drillFunctions = Object.freeze({
  post_release_regression_full_cycle: drillPostReleaseRegressionFullCycle,
  database_change_blocks_auto_rollback: drillDatabaseChangeBlocksAutoRollback,
  partial_release_quarantine: drillPartialReleaseQuarantine,
  runtime_drift_is_detected_and_notified: drillRuntimeDriftDetectedAndNotified,
  stale_reentry_authorization_is_refused: drillStaleReentryAuthorizationIsRefused,
  active_production_operation_defers_audit: drillActiveProductionOperationDefersAudit,
})

export async function runReleaseResilienceDrills() {
  const cases = []
  for (const name of DRILL_CASES) {
    try {
      const evidence = await drillFunctions[name]()
      cases.push({ name, passed: true, evidence })
    } catch (error) {
      cases.push({
        name,
        passed: false,
        error_class: error?.constructor?.name ?? 'Error',
        error_message: String(error?.message ?? error).split('\n')[0].slice(0, 240),
      })
    }
  }
  return Object.freeze({
    schema: DRILL_SCHEMA,
    synthetic_only: true,
    authority_added: false,
    total: cases.length,
    passed: cases.filter((item) => item.passed).length,
    failed: cases.filter((item) => !item.passed).length,
    cases,
  })
}

async function main() {
  const result = await runReleaseResilienceDrills()
  const dir = String(process.env.RESULT_DIR ?? '').trim()
  if (!dir) throw new Error('release resilience drill: RESULT_DIR is required')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  console.log(`Release resilience drill: ${result.passed}/${result.total} passed`)
  for (const item of result.cases) {
    console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}${item.passed ? '' : `: ${item.error_message}`}`)
  }
  if (result.failed > 0) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
