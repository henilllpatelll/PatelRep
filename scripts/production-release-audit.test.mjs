import assert from 'node:assert/strict'
import test from 'node:test'
import { auditProductionReleaseState } from './production-release-audit.mjs'

const REPO = 'henilllpatelll/PatelRep'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const ROLLBACK = '37710000001'
const INCIDENT = '37700000001'
const REENTRY = '37720000001'

function baseDeps({
  releases = [{ tag_name: 'v1.8.1', draft: false, prerelease: false }],
  tagNames = ['v1.8.1'],
  runtime = { version: 'v1.8.1', sha: B },
  active = [],
  mainSha = D,
  reentryRuns = [],
  authByRun = {},
} = {}) {
  return {
    listActiveProductionRuns: async () => active,
    listReleases: async () => releases,
    listTagNames: async () => tagNames,
    resolveTagCommit: async (tag) => ({ 'v1.8.0': A, 'v1.8.1': B }[tag] ?? null),
    isAncestorOfMain: async () => true,
    readRuntimeIdentity: async () => runtime,
    getMainSha: async () => mainSha,
    listReentryRuns: async () => reentryRuns,
    readReentryAuthorization: async (runId) => authByRun[String(runId)] ?? null,
  }
}

const noOpen = {
  findLatestOpenAutomatedRollback: async () => null,
  verifyAutoRollbackCircuitBreaker: async () => { throw new Error('must not verify') },
}

const open = {
  run: {
    id: Number(ROLLBACK),
    repository: { full_name: REPO },
  },
  evidence: {
    incident_run_id: INCIDENT,
    target: { version: 'v1.8.0', sha: A },
  },
}

test('normal exact runtime and managed Release baseline is consistent', async () => {
  const result = await auditProductionReleaseState({ repo: REPO }, baseDeps(), noOpen)
  assert.equal(result.state, 'consistent_managed_release')
  assert.equal(result.consistent, true)
  assert.deepEqual(result.runtime, { proven: true, version: 'v1.8.1', sha: B })
  assert.deepEqual(result.managed_release, { proven: true, tag: 'v1.8.1', sha: B })
  assert.equal(result.incident.open, false)
  assert.equal(result.reentry.state, 'not_required')
})

test('active Production Release or Rollback defers without producing false drift', async () => {
  const result = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({ active: [{ id: 1, workflow: 'production-release.yml' }] }),
    noOpen,
  )
  assert.equal(result.state, 'deferred_active_production_operation')
  assert.equal(result.consistent, true)
  assert.equal(result.active_production_operations, 1)
  assert.equal(result.runtime.proven, false)
})

test('runtime/managed Release mismatch without an open rollback is inconsistent', async () => {
  const result = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({ runtime: { version: 'v1.8.0', sha: A } }),
    noOpen,
  )
  assert.equal(result.state, 'inconsistent')
  assert.equal(result.consistent, false)
  assert.equal(result.reason_code, 'runtime_managed_release_mismatch')
})

test('strict managed-looking tag without a completed Release is an integrity conflict', async () => {
  const result = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({ tagNames: ['v1.8.1', 'v1.8.2'] }),
    noOpen,
  )
  assert.equal(result.state, 'inconsistent')
  assert.equal(result.reason_code, 'unmanaged_release_tag_conflict')
  assert.deepEqual(result.ledger.unmanaged_strict_tags, ['v1.8.2'])
})

test('post-release regression quarantine is a valid intentional managed-release mismatch', async () => {
  const helpers = {
    findLatestOpenAutomatedRollback: async () => open,
    verifyAutoRollbackCircuitBreaker: async () => ({
      mode: 'managed_release_mismatch',
      runtime: { version: 'v1.8.0', sha: A },
      managed_release: { tag: 'v1.8.1', sha: B },
      failed_candidate: { version: 'v1.8.1', sha: B },
    }),
  }
  const result = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({ runtime: { version: 'v1.8.0', sha: A } }),
    helpers,
  )
  assert.equal(result.state, 'quarantined_post_release_regression')
  assert.equal(result.consistent, true)
  assert.equal(result.incident.open, true)
  assert.equal(result.incident.quarantine_mode, 'managed_release_mismatch')
  assert.equal(result.reentry.state, 'required')
})

test('partial-release rollback is a valid quarantine even though runtime equals managed baseline', async () => {
  const helpers = {
    findLatestOpenAutomatedRollback: async () => open,
    verifyAutoRollbackCircuitBreaker: async () => ({
      mode: 'failed_candidate_unmanaged',
      runtime: { version: 'v1.8.1', sha: B },
      managed_release: { tag: 'v1.8.1', sha: B },
      failed_candidate: { version: 'v1.8.2', sha: C },
    }),
  }
  const result = await auditProductionReleaseState({ repo: REPO }, baseDeps(), helpers)
  assert.equal(result.state, 'quarantined_partial_release_failure')
  assert.equal(result.consistent, true)
  assert.equal(result.incident.failed_candidate_version, 'v1.8.2')
})

test('matching successful re-entry authorization is reported as pending release, not incident closeout', async () => {
  const run = {
    id: Number(REENTRY),
    run_attempt: 1,
    name: 'Production Incident Re-entry',
    path: '.github/workflows/production-incident-reentry.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: C,
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  }
  const auth = {
    schema: 'patelrep.production-incident-reentry.v1',
    workflow: 'Production Incident Re-entry',
    run: { id: REENTRY, attempt: 1, control_plane_sha: C },
    rollback: {
      run_id: ROLLBACK,
      incident_run_id: INCIDENT,
      target: { version: 'v1.8.0', sha: A },
      quarantine_mode: 'managed_release_mismatch',
    },
    failed_candidate: { version: 'v1.8.1', sha: B },
    authorized_release: { sha: D, pr_number: 112, pr_head_sha: D, version_bump: 'patch' },
  }
  const helpers = {
    findLatestOpenAutomatedRollback: async () => open,
    verifyAutoRollbackCircuitBreaker: async () => ({
      mode: 'managed_release_mismatch',
      runtime: { version: 'v1.8.0', sha: A },
      managed_release: { tag: 'v1.8.1', sha: B },
      failed_candidate: { version: 'v1.8.1', sha: B },
    }),
  }
  const result = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({
      runtime: { version: 'v1.8.0', sha: A },
      reentryRuns: [run],
      authByRun: { [REENTRY]: auth },
      mainSha: D,
    }),
    helpers,
  )
  assert.equal(result.state, 'quarantined_post_release_regression')
  assert.equal(result.reentry.state, 'authorized_current_main')
  assert.equal(result.reentry.authorization_run_id, REENTRY)
  assert.equal(result.reentry.release_sha, D)
  assert.equal(result.reentry.version_bump, 'patch')
})

test('authorization against an older main is reported stale but quarantine remains safe', async () => {
  const run = {
    id: Number(REENTRY),
    run_attempt: 1,
    name: 'Production Incident Re-entry',
    path: '.github/workflows/production-incident-reentry.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: C,
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  }
  const auth = {
    schema: 'patelrep.production-incident-reentry.v1',
    workflow: 'Production Incident Re-entry',
    run: { id: REENTRY, attempt: 1, control_plane_sha: C },
    rollback: { run_id: ROLLBACK, incident_run_id: INCIDENT, target: { version: 'v1.8.0', sha: A } },
    failed_candidate: { version: 'v1.8.1', sha: B },
    authorized_release: { sha: C, pr_number: 112, pr_head_sha: C, version_bump: 'patch' },
  }
  const helpers = {
    findLatestOpenAutomatedRollback: async () => open,
    verifyAutoRollbackCircuitBreaker: async () => ({
      mode: 'managed_release_mismatch',
      runtime: { version: 'v1.8.0', sha: A },
      managed_release: { tag: 'v1.8.1', sha: B },
      failed_candidate: { version: 'v1.8.1', sha: B },
    }),
  }
  const result = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({
      runtime: { version: 'v1.8.0', sha: A },
      reentryRuns: [run],
      authByRun: { [REENTRY]: auth },
      mainSha: D,
    }),
    helpers,
  )
  assert.equal(result.consistent, true)
  assert.equal(result.reentry.state, 'authorization_stale_main')
})

test('unprovable rollback quarantine is a critical integrity failure', async () => {
  const result = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({ runtime: { version: 'v1.8.0', sha: A } }),
    {
      findLatestOpenAutomatedRollback: async () => open,
      verifyAutoRollbackCircuitBreaker: async () => { throw new Error('drift') },
    },
  )
  assert.equal(result.state, 'inconsistent')
  assert.equal(result.reason_code, 'rollback_quarantine_unproven')
})

test('missing baseline and unprovable runtime fail closed with stable reason codes', async () => {
  const missing = await auditProductionReleaseState(
    { repo: REPO },
    baseDeps({ releases: [], tagNames: [] }),
    noOpen,
  )
  assert.equal(missing.reason_code, 'managed_release_missing')

  const d = baseDeps()
  d.readRuntimeIdentity = async () => { throw new Error('endpoint unreachable') }
  const runtime = await auditProductionReleaseState({ repo: REPO }, d, noOpen)
  assert.equal(runtime.reason_code, 'runtime_identity_unproven')
})
