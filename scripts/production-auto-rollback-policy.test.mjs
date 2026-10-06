import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateAutoRollbackRequest,
  requireAutomatedRollbackDispatch,
  validateAutoRollbackRequest,
} from './production-auto-rollback-policy.mjs'

const REPO = 'henilllpatelll/PatelRep'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const STAB_RUN = '37430000001'
const RELEASE_RUN = '37420000001'

const executionContract = [
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
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...overrides,
})

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

const candidate = { eligible: true, release_sha: B, pr_number: 105, version: 'v1.8.1' }
const previous = { tag: 'v1.8.0', sha: A }

const releasedEvidence = (overrides = {}) => ({
  schema: 'patelrep.production-release-evidence.v1',
  workflow: 'Production Release',
  run: { id: RELEASE_RUN, attempt: 1, control_plane_sha: C },
  source: { mode: 'manual', automation_source_run_id: null, version_bump: 'patch' },
  candidate,
  previous_release: previous,
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

const regressionIncident = (overrides = {}) => ({
  schema: 'patelrep.production-incident.v1',
  workflow: 'Production Release Stabilization',
  classifier: { run_id: STAB_RUN, run_attempt: 1, control_plane_sha: C },
  source_release: { run_id: RELEASE_RUN, run_attempt: 1, control_plane_sha: C, conclusion: 'success' },
  classification: 'post_release_regression',
  candidate,
  previous_release: previous,
  release_state: {
    disposition: 'released',
    production_verified: true,
    mutations: releasedEvidence().mutations,
  },
  stabilization: {
    outcome: 'post_release_regression',
    probes: [{ attempt: 1, ok: false }, { attempt: 2, ok: false }],
  },
  ...overrides,
})

function world(overrides = {}) {
  const state = {
    stabRun: stabilizationRun(),
    releaseRun: releaseRun(),
    incident: regressionIncident(),
    evidence: releasedEvidence(),
    releases: [
      { tag_name: 'v1.8.1', draft: false, prerelease: false },
      { tag_name: 'v1.8.0', draft: false, prerelease: false },
    ],
    tags: { 'v1.8.1': B, 'v1.8.0': A },
    pr: {
      number: 105,
      merged_at: '2026-10-06T03:00:00Z',
      base: { ref: 'main' },
      head: { repo: { full_name: REPO } },
      merge_commit_sha: B,
      changed_files: 1,
    },
    files: [{ filename: 'apps/web/app/dashboard/page.tsx', status: 'modified' }],
    runtime: { sha: B, version: 'v1.8.1' },
    healthy: false,
    mainSha: C,
    rollbackWorkflow: executionContract,
    active: [],
    ...overrides,
  }
  return {
    state,
    deps: {
      getRun: async (id) => String(id) === STAB_RUN ? state.stabRun : String(id) === RELEASE_RUN ? state.releaseRun : null,
      readIncident: async () => state.incident,
      readReleaseEvidence: async () => state.evidence,
      isAncestorOfMain: async (sha) => [A, B, C].includes(sha),
      listReleases: async () => state.releases,
      resolveTagCommit: async (tag) => state.tags[tag],
      getPr: async () => state.pr,
      listPrFiles: async () => state.files,
      readRuntimeIdentity: async () => state.runtime,
      isExactCandidateHealthy: async () => state.healthy,
      getMainSha: async () => state.mainSha,
      readRollbackWorkflowAt: async () => state.rollbackWorkflow,
      listActiveProductionRuns: async () => state.active,
    },
  }
}

const input = (mode = 'resolve') => ({ repo: REPO, sourceRunId: STAB_RUN, enabled: 'true', mode })

test('confirmed low-risk no-migration regression is eligible only when rollback-side Phase 3D contract exists', async () => {
  const { deps } = world()
  const result = await validateAutoRollbackRequest(input(), deps)
  assert.equal(result.sourceRunId, STAB_RUN)
  assert.equal(result.candidateSha, B)
  assert.equal(result.targetVersion, 'v1.8.0')
  assert.equal(result.targetSha, A)
  assert.equal(result.controlPlaneSha, C)

  const missing = world({ rollbackWorkflow: 'name: Production Rollback\non:\n  workflow_dispatch:\n' })
  const evaluated = await evaluateAutoRollbackRequest(input(), missing.deps)
  assert.equal(evaluated.eligible, false)
  assert.match(evaluated.reason, /Phase 3D must land/)
})

test('activation switch is owner-controlled and defaults fail-closed', async () => {
  const { deps } = world()
  for (const enabled of ['', 'false', 'TRUE', '1']) {
    const result = await evaluateAutoRollbackRequest({ ...input(), enabled }, deps)
    assert.equal(result.eligible, false)
    assert.match(result.reason, /PRODUCTION_AUTO_ROLLBACK_ENABLED/)
  }
})

test('any database change or uncertainty blocks automatic rollback', async () => {
  for (const database of ['verified_applied', 'unknown_after_attempt', 'not_proven']) {
    const base = regressionIncident()
    const incident = {
      ...base,
      release_state: { ...base.release_state, mutations: { ...base.release_state.mutations, database } },
    }
    const evidenceBase = releasedEvidence()
    const evidence = { ...evidenceBase, mutations: { ...evidenceBase.mutations, database } }
    const { deps } = world({ incident, evidence })
    const result = await evaluateAutoRollbackRequest(input(), deps)
    assert.equal(result.eligible, false, database)
    assert.match(result.reason, /zero production migrations/, database)
  }
})

test('high-risk release paths remain human-only', async () => {
  for (const filename of ['supabase/migrations/999_test.sql', '.github/workflows/x.yml', 'apps/api/auth/security.py', 'scripts/foo.mjs']) {
    const { deps } = world({ files: [{ filename, status: 'modified' }] })
    const result = await evaluateAutoRollbackRequest(input(), deps)
    assert.equal(result.eligible, false, filename)
    assert.match(result.reason, /classified as/, filename)
  }
})

test('runtime must still be the exact failing release and a fresh strict smoke must still fail', async () => {
  let w = world({ runtime: { sha: A, version: 'v1.8.0' } })
  let result = await evaluateAutoRollbackRequest(input(), w.deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, /no longer runs the exact failing release/)

  w = world({ healthy: true })
  result = await evaluateAutoRollbackRequest(input(), w.deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, /now passes strict production smoke/)

  w = world()
  w.deps.readRuntimeIdentity = async () => { throw new Error('unreachable') }
  result = await evaluateAutoRollbackRequest(input(), w.deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, /identity cannot be proven/)
})

test('previous release must remain an exact completed reachable tag', async () => {
  let w = world({ tags: { 'v1.8.1': B, 'v1.8.0': 'd'.repeat(40) } })
  let result = await evaluateAutoRollbackRequest(input(), w.deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, /no longer resolves/)

  w = world({ releases: [{ tag_name: 'v1.8.1', draft: false, prerelease: false }] })
  result = await evaluateAutoRollbackRequest(input(), w.deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, /missing or ambiguous/)
})

test('active production release or rollback blocks a request', async () => {
  const { deps } = world({ active: [{ id: 1, workflow: 'production-rollback.yml', status: 'in_progress' }] })
  const result = await evaluateAutoRollbackRequest(input('request'), deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, /another Production Release or Rollback run is active/)
})

test('post-release incident must contain two consecutive failed stabilization probes', async () => {
  const bad = regressionIncident({
    stabilization: {
      outcome: 'post_release_regression',
      probes: [{ attempt: 1, ok: false }, { attempt: 2, ok: true }, { attempt: 3, ok: false }],
    },
  })
  const { deps } = world({ incident: bad })
  await assert.rejects(validateAutoRollbackRequest(input(), deps), /two consecutive failed probes/)
})

test('partial-release incidents can qualify only when independent evidence agrees, DB is unchanged, and exact runtime is provable', async () => {
  const mutations = {
    database: 'no_change',
    api: 'deployed_and_verified',
    web: 'unknown_after_attempt',
    release_record: 'not_created',
  }
  const evidence = releasedEvidence({
    mutations,
    production_verified: false,
    disposition: 'failed_or_partial',
  })
  const incident = regressionIncident({
    source_release: { run_id: RELEASE_RUN, run_attempt: 1, control_plane_sha: C, conclusion: 'failure' },
    classification: 'partial_release_failure',
    release_state: { disposition: 'failed_or_partial', production_verified: false, mutations },
    stabilization: null,
  })
  const { deps } = world({
    incident,
    evidence,
    releaseRun: releaseRun({ conclusion: 'failure' }),
    releases: [{ tag_name: 'v1.8.0', draft: false, prerelease: false }],
  })
  const result = await validateAutoRollbackRequest(input(), deps)
  assert.equal(result.incidentClassification, 'partial_release_failure')
  assert.equal(result.targetVersion, 'v1.8.0')
})

test('incident and original Production Release evidence are independently cross-checked', async () => {
  const changed = regressionIncident({ candidate: { ...candidate, release_sha: 'd'.repeat(40) } })
  const { deps } = world({ incident: changed })
  await assert.rejects(validateAutoRollbackRequest(input(), deps), /incident candidate disagrees/)
})

test('rollback mode reuses the same policy but skips active-run self-blocking', async () => {
  const { deps } = world({ active: [{ id: 9, workflow: 'production-rollback.yml', status: 'in_progress' }] })
  const result = await validateAutoRollbackRequest(input('rollback'), deps)
  assert.equal(result.targetVersion, 'v1.8.0')
})

test('automated rollback dispatch identity is exact and trusted', async () => {
  const { deps } = world()
  const result = await validateAutoRollbackRequest(input('rollback'), deps)
  assert.doesNotThrow(() => requireAutomatedRollbackDispatch({
    actor: 'patelrep-release-engineer[bot]',
    actorId: '337493489',
    ref: 'refs/heads/main',
    workflowSha: C,
    targetVersion: 'v1.8.0',
    automationSourceRunId: STAB_RUN,
  }, result))

  for (const bad of [
    { actor: 'henilllpatelll' },
    { actorId: '1' },
    { ref: 'refs/heads/feature' },
    { workflowSha: 'd'.repeat(40) },
    { targetVersion: 'v1.8.1' },
    { automationSourceRunId: '1' },
  ]) {
    assert.throws(() => requireAutomatedRollbackDispatch({
      actor: 'patelrep-release-engineer[bot]',
      actorId: '337493489',
      ref: 'refs/heads/main',
      workflowSha: C,
      targetVersion: 'v1.8.0',
      automationSourceRunId: STAB_RUN,
      ...bad,
    }, result))
  }
})
