import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorizeProductionIncidentReentry,
  findLatestOpenAutomatedRollback,
  validateReentryAuthorization,
  validateReentryAuthorizationRun,
  verifyProductionReleaseReentry,
} from './production-incident-reentry.mjs'

const REPO = 'henilllpatelll/PatelRep'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const D = 'd'.repeat(40)
const E = 'e'.repeat(40)
const T = 'f'.repeat(40)
const ROLLBACK_RUN = '37510000001'
const INCIDENT_RUN = '37500000001'
const AUTH_RUN = '37520000001'

const rollbackRun = (overrides = {}) => ({
  id: Number(ROLLBACK_RUN),
  run_attempt: 1,
  name: 'Production Rollback',
  path: '.github/workflows/production-rollback.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: C,
  created_at: '2026-10-06T01:00:00Z',
  display_title: `Production Rollback v1.8.0 (automated request from run ${INCIDENT_RUN})`,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

const rollbackEvidence = (overrides = {}) => ({
  schema: 'patelrep.production-rollback-evidence.v1',
  workflow: 'Production Rollback',
  run: { id: ROLLBACK_RUN, attempt: 1, control_plane_sha: C },
  source: {
    mode: 'automated_incident',
    automation_source_present: true,
    automation_source_valid: true,
    automation_source_run_id: INCIDENT_RUN,
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
  ...overrides,
})

const incidentRun = {
  id: Number(INCIDENT_RUN),
  run_attempt: 1,
  name: 'Production Release Stabilization',
  path: '.github/workflows/production-release-stabilization.yml',
  event: 'workflow_run',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  head_sha: C,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
}

const incident = (classification = 'post_release_regression') => ({
  schema: 'patelrep.production-incident.v1',
  workflow: 'Production Release Stabilization',
  classifier: { run_id: INCIDENT_RUN, run_attempt: 1, control_plane_sha: C },
  source_release: { run_id: '37490000001', run_attempt: 1, control_plane_sha: C, conclusion: classification === 'post_release_regression' ? 'success' : 'failure' },
  classification,
  candidate: { eligible: true, release_sha: B, pr_number: 108, version: 'v1.8.1' },
  previous_release: { tag: 'v1.8.0', sha: A },
  release_state: { disposition: classification === 'post_release_regression' ? 'released' : 'failed_or_partial', production_verified: classification === 'post_release_regression', mutations: { database: 'no_change', api: 'deployed_and_verified', web: 'deployed_and_verified', release_record: classification === 'post_release_regression' ? 'created' : 'not_created' } },
  stabilization: classification === 'post_release_regression' ? { outcome: 'post_release_regression', probes: [] } : null,
})

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
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
}

function deps({ classification = 'post_release_regression', releaseRuns = [], mainSha = D, active = [], auth = null } = {}) {
  const releases = classification === 'post_release_regression'
    ? [
        { tag_name: 'v1.8.1', draft: false, prerelease: false },
        { tag_name: 'v1.8.0', draft: false, prerelease: false },
      ]
    : [{ tag_name: 'v1.8.0', draft: false, prerelease: false }]

  return {
    listRollbackRuns: async () => [rollbackRun()],
    readRollbackEvidence: async () => rollbackEvidence(),
    listReleaseRuns: async () => releaseRuns,
    readReleaseEvidence: async (id) => releaseRuns.find((run) => String(run.id) === String(id))?.evidence ?? null,
    getRun: async (id) => {
      if (String(id) === INCIDENT_RUN) return incidentRun
      if (String(id) === AUTH_RUN) return authRun
      const closing = releaseRuns.find((run) => String(run.id) === String(id))
      return closing ?? null
    },
    readIncident: async () => incident(classification),
    resolveTagCommit: async (tag) => ({ 'v1.8.0': A, 'v1.8.1': B }[tag]),
    readRuntimeIdentity: async () => ({ sha: A, version: 'v1.8.0' }),
    listReleases: async () => releases,
    isAncestorOfMain: async () => true,
    getMainSha: async () => mainSha,
    isAncestor: async (base, head) => base === B && head === D,
    listCheckRuns: async (sha, name) => [{ name, conclusion: 'success', head_sha: sha }],
    listAssociatedPullRequests: async () => [{
      number: 109,
      merged_at: '2026-10-06T02:00:00Z',
      base: { ref: 'main' },
      head: { sha: E, repo: { full_name: REPO } },
    }],
    getCommitTree: async (sha) => [D, E].includes(sha) ? T : '0'.repeat(40),
    listActiveProductionRuns: async () => active,
    readReentryAuthorization: async () => auth,
  }
}

test('post-release automated rollback is open while runtime is intentionally behind the managed Release', async () => {
  const open = await findLatestOpenAutomatedRollback({ repo: REPO, deps: deps() })
  assert.equal(String(open.run.id), ROLLBACK_RUN)
  assert.equal(open.evidence.incident_run_id, INCIDENT_RUN)
  assert.deepEqual(open.evidence.target, { version: 'v1.8.0', sha: A })
})

test('partial-release rollback is still open even though runtime equals the managed baseline', async () => {
  const open = await findLatestOpenAutomatedRollback({ repo: REPO, deps: deps({ classification: 'partial_release_failure' }) })
  assert.equal(String(open.run.id), ROLLBACK_RUN)
  assert.equal(open.evidence.target.sha, A)
})

test('human authorization pins exact rollback, fix-forward main SHA, staged tree, and version bump', async () => {
  const result = await authorizeProductionIncidentReentry({
    repo: REPO,
    runId: AUTH_RUN,
    runAttempt: '1',
    controlPlaneSha: C,
    rollbackRunId: ROLLBACK_RUN,
    releaseSha: D,
    versionBump: 'patch',
  }, deps())

  assert.equal(result.schema, 'patelrep.production-incident-reentry.v1')
  assert.equal(result.rollback.run_id, ROLLBACK_RUN)
  assert.equal(result.rollback.incident_run_id, INCIDENT_RUN)
  assert.deepEqual(result.failed_candidate, { version: 'v1.8.1', sha: B })
  assert.deepEqual(result.authorized_release, { sha: D, pr_number: 109, pr_head_sha: E, version_bump: 'patch' })
  assert.equal(result.rollback.quarantine_mode, 'managed_release_mismatch')
})

test('release consumes only the exact successful human authorization and re-proves quarantine', async () => {
  const authorization = await authorizeProductionIncidentReentry({
    repo: REPO,
    runId: AUTH_RUN,
    runAttempt: '1',
    controlPlaneSha: C,
    rollbackRunId: ROLLBACK_RUN,
    releaseSha: D,
    versionBump: 'patch',
  }, deps())
  const result = await verifyProductionReleaseReentry({
    repo: REPO,
    releaseSha: D,
    versionBump: 'patch',
    reentrySourceRunId: AUTH_RUN,
    automationSourceRunId: '',
  }, deps({ auth: authorization }))
  assert.deepEqual(result, { required: true, rollback_run_id: ROLLBACK_RUN, authorization_run_id: AUTH_RUN })
})

test('automatic release cannot re-enter an unresolved rollback incident', async () => {
  await assert.rejects(
    verifyProductionReleaseReentry({
      repo: REPO,
      releaseSha: D,
      versionBump: 'patch',
      reentrySourceRunId: '',
      automationSourceRunId: '37530000001',
    }, deps()),
    /automatic Production Release requests cannot re-enter/,
  )
})

test('failed candidate cannot authorize itself and moving main invalidates prior authorization', async () => {
  await assert.rejects(
    authorizeProductionIncidentReentry({
      repo: REPO,
      runId: AUTH_RUN,
      runAttempt: '1',
      controlPlaneSha: C,
      rollbackRunId: ROLLBACK_RUN,
      releaseSha: B,
      versionBump: 'patch',
    }, deps({ mainSha: B })),
    /failed production candidate cannot authorize itself/,
  )

  const authorization = await authorizeProductionIncidentReentry({
    repo: REPO,
    runId: AUTH_RUN,
    runAttempt: '1',
    controlPlaneSha: C,
    rollbackRunId: ROLLBACK_RUN,
    releaseSha: D,
    versionBump: 'patch',
  }, deps())
  await assert.rejects(
    verifyProductionReleaseReentry({
      repo: REPO,
      releaseSha: D,
      versionBump: 'patch',
      reentrySourceRunId: AUTH_RUN,
      automationSourceRunId: '',
    }, deps({ mainSha: '1'.repeat(40), auth: authorization })),
    /main moved after re-entry authorization/,
  )
})

test('stale rollback id, active production operation, missing CI or Staging proof all fail closed', async () => {
  await assert.rejects(
    authorizeProductionIncidentReentry({
      repo: REPO, runId: AUTH_RUN, runAttempt: '1', controlPlaneSha: C,
      rollbackRunId: '37510000002', releaseSha: D, versionBump: 'patch',
    }, deps()),
    /not the latest unresolved/,
  )
  await assert.rejects(
    authorizeProductionIncidentReentry({
      repo: REPO, runId: AUTH_RUN, runAttempt: '1', controlPlaneSha: C,
      rollbackRunId: ROLLBACK_RUN, releaseSha: D, versionBump: 'patch',
    }, { ...deps(), listActiveProductionRuns: async () => [{ id: 1 }] }),
    /currently active/,
  )
  await assert.rejects(
    authorizeProductionIncidentReentry({
      repo: REPO, runId: AUTH_RUN, runAttempt: '1', controlPlaneSha: C,
      rollbackRunId: ROLLBACK_RUN, releaseSha: D, versionBump: 'patch',
    }, { ...deps(), listCheckRuns: async (sha, name) => name === 'CI Gate' ? [] : [{ name, conclusion: 'success' }] }),
    /no successful CI Gate/,
  )
  await assert.rejects(
    authorizeProductionIncidentReentry({
      repo: REPO, runId: AUTH_RUN, runAttempt: '1', controlPlaneSha: C,
      rollbackRunId: ROLLBACK_RUN, releaseSha: D, versionBump: 'patch',
    }, { ...deps(), listCheckRuns: async (sha, name) => name === 'Staging Gate' ? [] : [{ name, conclusion: 'success' }] }),
    /no successful Staging Gate/,
  )
})

test('successful authorized release closes the rollback incident for later releases', async () => {
  const closingRun = {
    id: 37530000001,
    run_attempt: 1,
    name: 'Production Release',
    path: '.github/workflows/production-release.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: D,
    created_at: '2026-10-06T03:00:00Z',
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
  }
  closingRun.evidence = {
    schema: 'patelrep.production-release-evidence.v1',
    workflow: 'Production Release',
    run: { id: String(closingRun.id), attempt: 1, control_plane_sha: D },
    source: {
      mode: 'manual',
      automation_source_run_id: null,
      version_bump: 'patch',
      reentry: { present: true, valid: true, authorization_run_id: AUTH_RUN, rollback_run_id: ROLLBACK_RUN },
    },
    candidate: { eligible: true, release_sha: D, pr_number: 109, version: 'v1.8.2' },
    production_verified: true,
    disposition: 'released',
  }
  const open = await findLatestOpenAutomatedRollback({ repo: REPO, deps: deps({ releaseRuns: [closingRun] }) })
  assert.equal(open, null)

  const result = await verifyProductionReleaseReentry({
    repo: REPO,
    releaseSha: '',
    versionBump: 'patch',
    reentrySourceRunId: '',
    automationSourceRunId: '',
  }, deps({ releaseRuns: [closingRun] }))
  assert.deepEqual(result, { required: false, rollback_run_id: null, authorization_run_id: null })
})

test('authorization provenance and contents fail closed when malformed', () => {
  assert.throws(
    () => validateReentryAuthorizationRun({ ...authRun, event: 'push' }, { repo: REPO, runId: AUTH_RUN }),
    /not a completed workflow_dispatch/,
  )
  assert.throws(
    () => validateReentryAuthorization({
      schema: 'patelrep.production-incident-reentry.v1',
      workflow: 'Production Incident Re-entry',
      run: { id: AUTH_RUN, attempt: 1, control_plane_sha: C },
      rollback: { run_id: ROLLBACK_RUN, incident_run_id: INCIDENT_RUN, target: { version: 'latest', sha: A } },
      failed_candidate: { version: 'v1.8.1', sha: B },
      authorized_release: { sha: D, pr_number: 109, pr_head_sha: E, version_bump: 'patch' },
    }, authRun),
    /invalid authorized rollback target version/,
  )
})
