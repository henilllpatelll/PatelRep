import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyProductionRelease,
  classifyReleaseEvidence,
  stabilizeExactRelease,
  validateReleaseEvidence,
} from './production-release-stabilization.mjs'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const sourceRun = (overrides = {}) => ({
  id: 37410000001,
  run_attempt: 1,
  name: 'Production Release',
  path: '.github/workflows/production-release.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'failure',
  head_branch: 'main',
  head_sha: C,
  repository: { full_name: 'henilllpatelll/PatelRep' },
  head_repository: { full_name: 'henilllpatelll/PatelRep' },
  ...overrides,
})

const evidence = (overrides = {}) => ({
  schema: 'patelrep.production-release-evidence.v1',
  workflow: 'Production Release',
  run: { id: '37410000001', attempt: 1, control_plane_sha: C },
  source: { mode: 'manual', automation_source_run_id: null, version_bump: 'patch' },
  candidate: { eligible: true, release_sha: B, pr_number: 104, version: 'v1.8.1' },
  previous_release: { tag: 'v1.8.0', sha: A },
  jobs: {},
  database_pending: false,
  mutations: {
    database: 'no_change',
    api: 'not_started',
    web: 'not_started',
    release_record: 'not_created',
  },
  production_verified: false,
  disposition: 'failed_or_partial',
  ...overrides,
})

const deps = (overrides = {}) => ({
  resolveTagCommit: async (tag) => ({ 'v1.8.0': A, 'v1.8.1': B }[tag]),
  listReleases: async () => [{ tag_name: 'v1.8.1', draft: false, prerelease: false }],
  ...overrides,
})

const classifier = { run_id: '37420000001', run_attempt: 1, control_plane_sha: C }

test('failed release before any production mutation is not an incident', async () => {
  const { result, incident } = await classifyProductionRelease({
    sourceRun: sourceRun(),
    evidence: evidence(),
    classifier,
    deps: deps(),
  })
  assert.equal(result.classification, 'pre_production_failure_no_incident')
  assert.equal(incident, null)
})

test('database apply, failed API, or failed Web attempt makes an unverified failed release a partial-release incident', async () => {
  for (const mutations of [
    { database: 'verified_applied', api: 'not_started', web: 'not_started', release_record: 'not_created' },
    { database: 'unknown_after_attempt', api: 'not_started', web: 'not_started', release_record: 'not_created' },
    { database: 'no_change', api: 'unknown_after_attempt', web: 'not_started', release_record: 'not_created' },
    { database: 'no_change', api: 'deployed_and_verified', web: 'unknown_after_attempt', release_record: 'not_created' },
  ]) {
    const { result, incident } = await classifyProductionRelease({
      sourceRun: sourceRun(),
      evidence: evidence({ mutations }),
      classifier,
      deps: deps(),
    })
    assert.equal(result.classification, 'partial_release_failure')
    assert.equal(incident.classification, 'partial_release_failure')
  }
})

test('verified runtime plus release-record failure is not misclassified as a rollback incident', async () => {
  const e = validateReleaseEvidence(
    evidence({
      production_verified: true,
      mutations: {
        database: 'no_change',
        api: 'deployed_and_verified',
        web: 'deployed_and_verified',
        release_record: 'unknown_after_attempt',
      },
    }),
    sourceRun(),
  )
  assert.equal(classifyReleaseEvidence(e), 'release_record_failure_no_runtime_incident')
})

test('successful release gets exact-release stabilization and two consecutive failures confirm a regression', async () => {
  let calls = 0
  const stabilize = async ({ releaseSha, releaseVersion }) => {
    assert.equal(releaseSha, B)
    assert.equal(releaseVersion, 'v1.8.1')
    calls += 1
    return { outcome: 'post_release_regression', probes: [{ attempt: 1, ok: false }, { attempt: 2, ok: false }] }
  }
  const released = evidence({
    disposition: 'released',
    production_verified: true,
    mutations: {
      database: 'no_change',
      api: 'deployed_and_verified',
      web: 'deployed_and_verified',
      release_record: 'created',
    },
  })
  const { result, incident } = await classifyProductionRelease({
    sourceRun: sourceRun({ conclusion: 'success' }),
    evidence: released,
    classifier,
    deps: deps(),
    stabilize,
  })
  assert.equal(calls, 1)
  assert.equal(result.classification, 'post_release_regression')
  assert.equal(incident.classification, 'post_release_regression')
  assert.deepEqual(incident.stabilization.probes.map((p) => p.ok), [false, false])
})

test('single transient failure is not enough to confirm an incident', async () => {
  const outcomes = [false, true, false]
  let index = 0
  const sleeps = []
  const result = await stabilizeExactRelease({
    releaseSha: B,
    releaseVersion: 'v1.8.1',
    probe: async () => {
      const ok = outcomes[index++]
      if (!ok) throw new Error('transient')
    },
    sleep: async (ms) => sleeps.push(ms),
    initialDelayMs: 1,
    betweenProbesMs: 2,
  })
  assert.equal(result.outcome, 'transient_unconfirmed')
  assert.deepEqual(result.probes.map((p) => p.ok), outcomes)
  assert.deepEqual(sleeps, [1, 2, 2])
})

test('two consecutive failures confirm and stop the stabilization window early', async () => {
  let calls = 0
  const result = await stabilizeExactRelease({
    releaseSha: B,
    releaseVersion: 'v1.8.1',
    probe: async () => {
      calls += 1
      throw new Error('still bad')
    },
    sleep: async () => {},
    initialDelayMs: 0,
    betweenProbesMs: 0,
  })
  assert.equal(result.outcome, 'post_release_regression')
  assert.equal(calls, 2)
  assert.deepEqual(result.probes.map((p) => p.ok), [false, false])
})

test('successful release must have a real completed Release whose tag resolves to the exact candidate SHA', async () => {
  const released = evidence({
    disposition: 'released',
    production_verified: true,
    mutations: {
      database: 'no_change',
      api: 'deployed_and_verified',
      web: 'deployed_and_verified',
      release_record: 'created',
    },
  })
  await assert.rejects(
    classifyProductionRelease({
      sourceRun: sourceRun({ conclusion: 'success' }),
      evidence: released,
      classifier,
      deps: deps({ listReleases: async () => [] }),
      stabilize: async () => ({ outcome: 'stable', probes: [] }),
    }),
    /completed GitHub Release is missing/,
  )
  await assert.rejects(
    classifyProductionRelease({
      sourceRun: sourceRun({ conclusion: 'success' }),
      evidence: released,
      classifier,
      deps: deps({ resolveTagCommit: async (tag) => tag === 'v1.8.0' ? A : 'd'.repeat(40) }),
      stabilize: async () => ({ outcome: 'stable', probes: [] }),
    }),
    /candidate release tag does not resolve/,
  )
})

test('evidence provenance mismatches and malformed states fail closed', () => {
  assert.throws(() => validateReleaseEvidence(evidence(), sourceRun({ head_sha: 'd'.repeat(40) })), /control-plane SHA mismatch/)
  assert.throws(() => validateReleaseEvidence(evidence({ mutations: { ...evidence().mutations, api: 'maybe' } }), sourceRun()), /invalid api mutation state/)
  assert.throws(() => validateReleaseEvidence(evidence({ disposition: 'released' }), sourceRun()), /released evidence came from a non-successful source run/)
})
