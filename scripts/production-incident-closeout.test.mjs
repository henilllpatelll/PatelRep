import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createIncidentCloseout,
  resolveActiveAutomatedRollbackQuarantine,
  validateProductionReentry,
} from './production-incident-closeout.mjs'

const A = 'a'.repeat(40) // rollback target / prior release
const B = 'b'.repeat(40) // failed candidate
const C = 'c'.repeat(40) // fixed re-entry main
const D = 'd'.repeat(40)
const OWNER = 'henilllpatelll'
const REPO = `${OWNER}/PatelRep`

const rollbackRun = (overrides = {}) => ({
  id: 500,
  name: 'Production Rollback',
  path: '.github/workflows/production-rollback.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: B,
  run_attempt: 1,
  display_title: 'Production Rollback v1.8.0 (automated request from run 400)',
  created_at: '2026-10-06T05:00:00Z',
  actor: { login: 'patelrep-release-engineer[bot]', id: 337493489 },
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const releaseRun = (overrides = {}) => ({
  id: 600,
  name: 'Production Release',
  path: '.github/workflows/production-release.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: C,
  run_attempt: 1,
  display_title: `Production Release ${C}`,
  created_at: '2026-10-06T06:00:00Z',
  actor: { login: OWNER, id: 108131852 },
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const incidentRun = (overrides = {}) => ({
  id: 400,
  name: 'Production Release Stabilization',
  path: '.github/workflows/production-release-stabilization.yml',
  event: 'workflow_run',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: B,
  run_attempt: 1,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const rollbackEvidence = (overrides = {}) => ({
  schema: 'patelrep.production-rollback-evidence.v1',
  workflow: 'Production Rollback',
  run: { id: '500', attempt: 1, control_plane_sha: B },
  source: {
    mode: 'automated_incident',
    automation_source_present: true,
    automation_source_valid: true,
    automation_source_run_id: '400',
  },
  target: {
    requested_version: 'v1.8.0',
    requested_version_valid: true,
    resolved: true,
    version: 'v1.8.0',
    sha: A,
  },
  jobs: {
    automation_provenance: 'success',
    pre_runtime_capture: 'success',
    target_resolution: 'success',
    database_compatibility: 'success',
    api_deploy: 'success',
    web_deploy: 'success',
    rollback_verification: 'success',
    circuit_breaker: 'success',
  },
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
  ...overrides,
})

const incident = (overrides = {}) => ({
  schema: 'patelrep.production-incident.v1',
  workflow: 'Production Release Stabilization',
  classifier: { run_id: '400', run_attempt: 1, control_plane_sha: B },
  source_release: { run_id: '350', run_attempt: 1, control_plane_sha: B, conclusion: 'success' },
  classification: 'post_release_regression',
  candidate: { eligible: true, release_sha: B, pr_number: 107, version: 'v1.8.1' },
  previous_release: { tag: 'v1.8.0', sha: A },
  release_state: {
    disposition: 'released',
    production_verified: true,
    mutations: { database: 'no_change', api: 'deployed_and_verified', web: 'deployed_and_verified', release_record: 'created' },
  },
  stabilization: { outcome: 'post_release_regression', probes: [{ attempt: 1, ok: false }, { attempt: 2, ok: false }] },
  ...overrides,
})

const closeoutRun = (overrides = {}) => ({
  id: 550,
  name: 'Production Incident Closeout',
  path: '.github/workflows/production-incident-closeout.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: C,
  run_attempt: 1,
  actor: { login: OWNER, id: 108131852 },
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const closeoutArtifact = (overrides = {}) => ({
  schema: 'patelrep.production-incident-closeout.v1',
  workflow: 'Production Incident Closeout',
  run: { id: '550', attempt: 1, control_plane_sha: C, actor: OWNER },
  rollback: {
    run_id: '500',
    run_attempt: 1,
    control_plane_sha: B,
    target: { version: 'v1.8.0', sha: A },
  },
  incident: { run_id: '400', classification: 'post_release_regression' },
  failed_candidate: { version: 'v1.8.1', sha: B, pr_number: 107 },
  reentry: { sha: C, main_sha_at_closeout: C, ci_gate: 'success' },
  production_runtime_at_closeout: { version: 'v1.8.0', sha: A },
  decision: 'approved_for_exact_sha',
  ...overrides,
})

function deps(overrides = {}) {
  return {
    listCompletedRollbackRuns: async () => [rollbackRun()],
    listSuccessfulReleaseRuns: async () => [],
    isAutomatedRollbackRun: (run) => /\(automated request from run [1-9][0-9]*\)$/.test(run.display_title ?? ''),
    readRollbackEvidence: async () => rollbackEvidence(),
    getRun: async (id) => {
      if (String(id) === '400') return incidentRun()
      if (String(id) === '550') return closeoutRun()
      if (String(id) === '500') return rollbackRun()
      return null
    },
    readIncident: async () => incident(),
    readIncidentCloseout: async () => closeoutArtifact(),
    getMainSha: async () => C,
    readRuntimeIdentity: async () => ({ sha: A, version: 'v1.8.0' }),
    isAncestorOfMain: async (sha) => sha === B || sha === A,
    listCheckRuns: async (sha, name) => sha === C && name === 'CI Gate'
      ? [{ name: 'CI Gate', conclusion: 'success' }]
      : [],
    listActiveProductionRuns: async () => [],
    ...overrides,
  }
}

test('latest successful automated rollback opens quarantine until a newer successful release exists', async () => {
  const q = await resolveActiveAutomatedRollbackQuarantine({ repo: REPO }, deps())
  assert.equal(q.run.id, '500')
  assert.deepEqual(q.target, { version: 'v1.8.0', sha: A })
  assert.equal(q.incident.runId, '400')
  assert.equal(q.incident.candidate.sha, B)

  const closed = await resolveActiveAutomatedRollbackQuarantine(
    { repo: REPO },
    deps({ listSuccessfulReleaseRuns: async () => [releaseRun()] }),
  )
  assert.equal(closed, null)
})

test('manual rollback history does not open the Phase 4B quarantine', async () => {
  const q = await resolveActiveAutomatedRollbackQuarantine(
    { repo: REPO },
    deps({
      listCompletedRollbackRuns: async () => [rollbackRun({ display_title: 'Production Rollback v1.8.0' })],
    }),
  )
  assert.equal(q, null)
})

test('missing or contradictory rollback evidence fails closed', async () => {
  await assert.rejects(
    resolveActiveAutomatedRollbackQuarantine({ repo: REPO }, deps({ readRollbackEvidence: async () => null })),
    /successful automated rollback has no Phase 4A evidence/,
  )
  await assert.rejects(
    resolveActiveAutomatedRollbackQuarantine(
      { repo: REPO },
      deps({ readRollbackEvidence: async () => rollbackEvidence({
        quarantine: 'bogus',
        disposition: 'restored_quarantine_unproven',
        jobs: { ...rollbackEvidence().jobs, circuit_breaker: 'failure' },
      }) }),
    ),
    /invalid post-restore quarantine state/,
  )
})

test('restored runtime stays quarantined even when the circuit-breaker proof failed', async () => {
  const q = await resolveActiveAutomatedRollbackQuarantine(
    { repo: REPO },
    deps({
      listCompletedRollbackRuns: async () => [rollbackRun({ conclusion: 'failure' })],
      readRollbackEvidence: async () => rollbackEvidence({
        quarantine: 'unproven',
        disposition: 'restored_quarantine_unproven',
        jobs: { ...rollbackEvidence().jobs, circuit_breaker: 'failure' },
      }),
    }),
  )
  assert.equal(q.run.id, '500')
  assert.equal(q.quarantine, 'unproven')
  assert.deepEqual(q.target, { version: 'v1.8.0', sha: A })
})

test('owner closeout binds the active incident to the exact fixed current main SHA', async () => {
  const result = await createIncidentCloseout({
    repo: REPO,
    repositoryOwner: OWNER,
    actor: OWNER,
    runId: '550',
    runAttempt: '1',
    controlPlaneSha: C,
    rollbackRunId: '500',
    reentrySha: C,
  }, deps())

  assert.equal(result.schema, 'patelrep.production-incident-closeout.v1')
  assert.equal(result.run.actor, OWNER)
  assert.equal(result.rollback.run_id, '500')
  assert.deepEqual(result.rollback.target, { version: 'v1.8.0', sha: A })
  assert.equal(result.incident.run_id, '400')
  assert.equal(result.failed_candidate.sha, B)
  assert.equal(result.reentry.sha, C)
  assert.equal(result.reentry.ci_gate, 'success')
  assert.equal(result.decision, 'approved_for_exact_sha')
})

test('closeout refuses non-owner stale unsafe or busy decisions', async () => {
  const base = {
    repo: REPO,
    repositoryOwner: OWNER,
    actor: OWNER,
    runId: '550',
    runAttempt: '1',
    controlPlaneSha: C,
    rollbackRunId: '500',
    reentrySha: C,
  }
  await assert.rejects(createIncidentCloseout({ ...base, actor: 'someone-else' }, deps()), /only the repository owner/)
  await assert.rejects(createIncidentCloseout({ ...base, reentrySha: D }, deps()), /bind the exact current main SHA/)
  await assert.rejects(
    createIncidentCloseout(base, deps({ listCheckRuns: async () => [] })),
    /successful CI Gate/,
  )
  await assert.rejects(
    createIncidentCloseout(base, deps({ listActiveProductionRuns: async () => [{ id: 999, workflow: 'production-release.yml' }] })),
    /quiet production lane/,
  )
  await assert.rejects(
    createIncidentCloseout(
      { ...base, reentrySha: B, controlPlaneSha: B },
      deps({ getMainSha: async () => B, listCheckRuns: async () => [{ name: 'CI Gate', conclusion: 'success' }] }),
    ),
    /new fixed commit/,
  )
})

test('ordinary Production Release remains unchanged when no automatic rollback quarantine is active', async () => {
  const ordinary = deps({ listCompletedRollbackRuns: async () => [] })
  const result = await validateProductionReentry({
    repo: REPO,
    repositoryOwner: OWNER,
    runId: '700',
    releaseSha: '',
    automationSourceRunId: '',
    closeoutRunId: '',
  }, ordinary)
  assert.deepEqual(result, { status: 'not_required', targetSha: C })

  await assert.rejects(
    validateProductionReentry({
      repo: REPO,
      repositoryOwner: OWNER,
      runId: '700',
      releaseSha: C,
      automationSourceRunId: '',
      closeoutRunId: '550',
    }, ordinary),
    /supplied but no active/,
  )
})

test('active quarantine categorically refuses automated release and requires explicit SHA plus closeout', async () => {
  await assert.rejects(
    validateProductionReentry({
      repo: REPO,
      repositoryOwner: OWNER,
      runId: '700',
      releaseSha: C,
      automationSourceRunId: '650',
      closeoutRunId: '550',
    }, deps()),
    /automated Production Release cannot re-enter/,
  )
  await assert.rejects(
    validateProductionReentry({
      repo: REPO,
      repositoryOwner: OWNER,
      runId: '700',
      releaseSha: '',
      automationSourceRunId: '',
      closeoutRunId: '550',
    }, deps()),
    /requires an explicit release_sha/,
  )
  await assert.rejects(
    validateProductionReentry({
      repo: REPO,
      repositoryOwner: OWNER,
      runId: '700',
      releaseSha: C,
      automationSourceRunId: '',
      closeoutRunId: '',
    }, deps()),
    /requires incident_closeout_run_id/,
  )
})

test('valid owner closeout authorizes exactly one SHA for a later manual release', async () => {
  const result = await validateProductionReentry({
    repo: REPO,
    repositoryOwner: OWNER,
    runId: '700',
    releaseSha: C,
    automationSourceRunId: '',
    closeoutRunId: '550',
  }, deps())
  assert.deepEqual(result, {
    status: 'authorized_exact_sha',
    targetSha: C,
    closeoutRunId: '550',
    rollbackRunId: '500',
    incidentRunId: '400',
  })

  await assert.rejects(
    validateProductionReentry({
      repo: REPO,
      repositoryOwner: OWNER,
      runId: '700',
      releaseSha: D,
      automationSourceRunId: '',
      closeoutRunId: '550',
    }, deps()),
    /does not authorize this exact release SHA/,
  )
})

test('release re-entry rechecks owner provenance runtime quarantine and closeout ordering', async () => {
  const input = {
    repo: REPO,
    repositoryOwner: OWNER,
    runId: '700',
    releaseSha: C,
    automationSourceRunId: '',
    closeoutRunId: '550',
  }
  await assert.rejects(
    validateProductionReentry(input, deps({ readRuntimeIdentity: async () => ({ sha: D, version: 'v1.8.2' }) })),
    /production changed after rollback/,
  )
  await assert.rejects(
    validateProductionReentry(input, deps({
      getRun: async (id) => String(id) === '550' ? closeoutRun({ actor: { login: 'someone-else' } }) : incidentRun(),
    })),
    /not dispatched by the repository owner/,
  )
  await assert.rejects(
    validateProductionReentry({ ...input, runId: '540' }, deps()),
    /ordering is invalid/,
  )
})
