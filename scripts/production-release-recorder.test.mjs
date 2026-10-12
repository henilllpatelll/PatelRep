import assert from 'node:assert/strict'
import test from 'node:test'
import { EVIDENCE_SCHEMA, REQUIRED_SUCCESS_JOBS, TAG_JOB_NAME, assertExistingTagExact, assertVersionIntegrity, preflightRecorder, recordRelease, verifyRecoveryEvidence } from './production-release-recorder.mjs'

const REPO = 'henilllpatelll/PatelRep'
const SHA = '8e4ee88b354360754d1134d62d81b8af370b0434'
const OTHER = 'a'.repeat(40)
const VERSION = 'v1.9.2'
const RUN = '38189513925'

function fakeDeps(overrides = {}) {
  const calls = []
  const state = { tag: null, releases: [{ tag_name: 'v1.9.1', draft: false, prerelease: false }], tagNames: ['v1.9.1'] }
  const deps = {
    calls,
    state,
    isAncestorOfMain: async () => true,
    checkConclusion: async () => 'success',
    listReleases: async () => state.releases,
    listTagNames: async () => state.tagNames,
    getTag: async () => state.tag,
    createAnnotatedTag: async ({ version, sha }) => {
      calls.push(['createAnnotatedTag', version, sha])
      state.tag = { type: 'tag', commit: sha }
    },
    createRelease: async ({ version }) => {
      calls.push(['createRelease', version])
      state.releases = [...state.releases, { tag_name: version, draft: false, prerelease: false }]
    },
    getRun: async () => ({ id: RUN, path: '.github/workflows/production-release.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: OTHER, repository: REPO, head_repository: REPO }),
    getRunJobs: async () => [...REQUIRED_SUCCESS_JOBS.map((name) => ({ name, conclusion: 'success' })), { name: TAG_JOB_NAME, conclusion: 'failure' }],
    getEvidence: async () => ({
      schema: EVIDENCE_SCHEMA,
      run: { id: RUN },
      candidate: { eligible: true, release_sha: SHA, version: VERSION },
      jobs: { eligibility: 'success', version: 'success', api_deploy: 'success', web_deploy: 'success', production_verification: 'success', tag_and_release: 'failure' },
      mutations: { release_record: 'unknown_after_attempt' },
      production_verified: true,
    }),
    readRuntimeIdentity: async () => ({ sha: SHA, version: VERSION }),
    readRecorderRepo: async () => ({ full_name: REPO }),
    ...overrides,
  }
  return deps
}

const input = (extra = {}) => ({ mode: 'pipeline', version: VERSION, sha: SHA, repo: REPO, ...extra })
const recover = { sourceRunId: RUN }

test('pipeline mode creates the annotated tag then the Release, in that order', async () => {
  const deps = fakeDeps()
  const result = await recordRelease(input(), deps)
  assert.deepEqual(result, { outcome: 'recorded', tagCreated: true, releaseCreated: true })
  assert.deepEqual(deps.calls.map((call) => call[0]), ['createAnnotatedTag', 'createRelease'])
})

test('rejects malformed versions and SHAs before any read or write', async () => {
  for (const bad of ['1.9.2', 'v1.9', 'v01.9.2', 'v1.9.2-rc1', 'v1.9.2; rm -rf', '']) {
    const deps = fakeDeps()
    await assert.rejects(recordRelease(input({ version: bad }), deps), /non-release tag name/)
    assert.equal(deps.calls.length, 0)
  }
  for (const bad of ['main', SHA.toUpperCase(), SHA.slice(0, 39), `${SHA}0`]) {
    await assert.rejects(recordRelease(input({ sha: bad }), fakeDeps()), /non-exact target SHA/)
  }
  await assert.rejects(recordRelease(input({ mode: 'force' }), fakeDeps()), /unknown mode/)
})

test('refuses a SHA that is not on main or lacks a successful CI Gate', async () => {
  let deps = fakeDeps({ isAncestorOfMain: async () => false })
  await assert.rejects(recordRelease(input(), deps), /not reachable from main/)
  assert.equal(deps.calls.length, 0)
  deps = fakeDeps({ checkConclusion: async () => 'failure' })
  await assert.rejects(recordRelease(input(), deps), /successful CI Gate/)
  assert.equal(deps.calls.length, 0)
})

test('NEVER moves an existing tag: a different commit, a lightweight tag, or a read failure all throw before any write', async () => {
  let deps = fakeDeps()
  deps.state.tag = { type: 'tag', commit: OTHER }
  await assert.rejects(recordRelease(input(), deps), /refusing to move or reuse it/)
  assert.equal(deps.calls.length, 0)

  deps = fakeDeps()
  deps.state.tag = { type: 'commit', commit: SHA }
  await assert.rejects(recordRelease(input(), deps), /lightweight/)
  assert.equal(deps.calls.length, 0)

  deps = fakeDeps({ getTag: async () => { throw new Error('HTTP 500') } })
  await assert.rejects(recordRelease(input(), deps), /HTTP 500/)
  assert.equal(deps.calls.length, 0)
})

test('an existing annotated tag at exactly the verified commit is resumed (Release only), never recreated', async () => {
  const deps = fakeDeps()
  deps.state.tag = { type: 'tag', commit: SHA }
  const result = await recordRelease(input(), deps)
  assert.deepEqual(result, { outcome: 'recorded', tagCreated: false, releaseCreated: true })
  assert.deepEqual(deps.calls.map((call) => call[0]), ['createRelease'])
})

test('an already completed Release is an idempotent no-op only when its tag is exact', async () => {
  let deps = fakeDeps()
  deps.state.tag = { type: 'tag', commit: SHA }
  deps.state.releases.push({ tag_name: VERSION, draft: false, prerelease: false })
  assert.deepEqual(await recordRelease(input(), deps), { outcome: 'already_recorded', tagCreated: false, releaseCreated: false })
  assert.equal(deps.calls.length, 0)

  deps = fakeDeps()
  deps.state.releases.push({ tag_name: VERSION, draft: false, prerelease: false })
  await assert.rejects(recordRelease(input(), deps), /completed Release but no tag/)

  deps = fakeDeps()
  deps.state.tag = { type: 'tag', commit: OTHER }
  deps.state.releases.push({ tag_name: VERSION, draft: false, prerelease: false })
  await assert.rejects(recordRelease(input(), deps), /refusing to move or reuse it/)
  assert.equal(deps.calls.length, 0)
})

test('release version integrity: only the exact successor of the newest completed release', () => {
  const releases = [{ tag_name: 'v1.9.1', draft: false, prerelease: false }, { tag_name: 'v1.8.0', draft: false, prerelease: false }]
  for (const ok of ['v1.9.2', 'v1.10.0', 'v2.0.0']) assert.deepEqual(assertVersionIntegrity({ version: ok, releases, tagNames: ['v1.9.1', 'v1.8.0'] }), { alreadyReleased: false })
  for (const bad of ['v1.9.3', 'v1.9.1x', 'v1.11.0', 'v3.0.0', 'v1.9.0']) assert.throws(() => assertVersionIntegrity({ version: bad, releases, tagNames: [] }), /release recorder/)
  assert.throws(() => assertVersionIntegrity({ version: 'v1.9.2', releases: [...releases, { tag_name: 'v1.9.2', draft: true, prerelease: false }], tagNames: [] }), /draft or prerelease/)
  assert.throws(() => assertVersionIntegrity({ version: 'v1.9.2', releases, tagNames: ['v1.9.1', 'v1.9.4'] }), /without a completed Release/)
  assert.throws(() => assertVersionIntegrity({ version: 'v1.9.2', releases: [], tagNames: [] }), /empty release line/)
  assert.deepEqual(assertVersionIntegrity({ version: 'v1.8.0', releases: [], tagNames: [] }), { alreadyReleased: false })
  assert.throws(() => assertExistingTagExact({ version: 'v1.9.2', sha: SHA, ref: { type: 'tag', commit: OTHER } }))
})

test('the Release is never attempted if the created tag does not read back as the exact commit', async () => {
  const deps = fakeDeps()
  deps.createAnnotatedTag = async () => {
    deps.calls.push(['createAnnotatedTag'])
    deps.state.tag = { type: 'tag', commit: OTHER }
  }
  await assert.rejects(recordRelease(input(), deps), /refusing to move or reuse it/)
  assert.deepEqual(deps.calls.map((call) => call[0]), ['createAnnotatedTag'])
})

test('record-only recovery succeeds only with full evidence and the exact live production identity', async () => {
  const deps = fakeDeps()
  const result = await recordRelease(input({ mode: 'recover', recovery: recover }), deps)
  assert.equal(result.outcome, 'recorded')
  assert.deepEqual(deps.calls.map((call) => call[0]), ['createAnnotatedTag', 'createRelease'])
})

test('record-only recovery refuses every unproven condition before any write', async () => {
  const mutate = async (name, patch, pattern) => {
    const base = fakeDeps()
    const deps = fakeDeps(await patch(base))
    await assert.rejects(recordRelease(input({ mode: 'recover', recovery: recover }), deps), pattern, name)
    assert.equal(deps.calls.length, 0, `${name}: nothing written`)
  }
  const run = (base) => base.getRun()
  await mutate('production moved on', () => ({ readRuntimeIdentity: async () => ({ sha: OTHER, version: 'v1.9.3' }) }), /record-only recovery refused/)
  await mutate('production rolled back', () => ({ readRuntimeIdentity: async () => ({ sha: OTHER, version: 'v1.9.1' }) }), /record-only recovery refused/)
  await mutate('identity unreadable', () => ({ readRuntimeIdentity: async () => { throw new Error('production runtime identity: API unreachable') } }), /unreachable/)
  await mutate('wrong workflow', async () => ({ getRun: async () => ({ ...(await run(fakeDeps())), path: '.github/workflows/production-rollback.yml' }) }), /not the Production Release workflow/)
  await mutate('fork run', async () => ({ getRun: async () => ({ ...(await run(fakeDeps())), head_repository: 'evil/PatelRep' }) }), /not from this repository/)
  await mutate('non-main run', async () => ({ getRun: async () => ({ ...(await run(fakeDeps())), head_branch: 'feature/x' }) }), /dispatch on main/)
  await mutate('push-triggered run', async () => ({ getRun: async () => ({ ...(await run(fakeDeps())), event: 'push' }) }), /dispatch on main/)
  await mutate('still running', async () => ({ getRun: async () => ({ ...(await run(fakeDeps())), status: 'in_progress', conclusion: null }) }), /not completed/)
  await mutate('run succeeded', async () => ({ getRun: async () => ({ ...(await run(fakeDeps())), conclusion: 'success' }) }), /nothing to recover/)
  await mutate('control plane off main', () => ({ isAncestorOfMain: async (sha) => sha === SHA }), /not an ancestor of main/)
  await mutate('verification job failed', () => ({ getRunJobs: async () => [...REQUIRED_SUCCESS_JOBS.slice(0, 3).map((name) => ({ name, conclusion: 'success' })), { name: REQUIRED_SUCCESS_JOBS[3], conclusion: 'failure' }, { name: TAG_JOB_NAME, conclusion: 'failure' }] }), /production verification is unproven/)
  await mutate('deploy job missing', () => ({ getRunJobs: async () => [{ name: TAG_JOB_NAME, conclusion: 'failure' }] }), /missing/)
  await mutate('tag job did not fail', () => ({ getRunJobs: async () => [...REQUIRED_SUCCESS_JOBS.map((name) => ({ name, conclusion: 'success' })), { name: TAG_JOB_NAME, conclusion: 'success' }] }), /not a record failure/)
  const ev = async () => fakeDeps().getEvidence()
  await mutate('evidence missing schema', async () => ({ getEvidence: async () => ({ ...(await ev()), schema: 'x' }) }), /no valid production release evidence/)
  await mutate('evidence other run', async () => ({ getEvidence: async () => ({ ...(await ev()), run: { id: '1' } }) }), /different run/)
  await mutate('evidence other sha', async () => ({ getEvidence: async () => ({ ...(await ev()), candidate: { eligible: true, release_sha: OTHER, version: VERSION } }) }), /do not match/)
  await mutate('evidence other version', async () => ({ getEvidence: async () => ({ ...(await ev()), candidate: { eligible: true, release_sha: SHA, version: 'v1.9.3' } }) }), /do not match/)
  await mutate('evidence unverified', async () => ({ getEvidence: async () => ({ ...(await ev()), production_verified: false }) }), /does not prove/)
  await mutate('evidence ineligible', async () => ({ getEvidence: async () => ({ ...(await ev()), candidate: { eligible: false, release_sha: SHA, version: VERSION } }) }), /does not prove/)
  await mutate('evidence api deploy not success', async () => ({ getEvidence: async () => { const e = await ev(); return { ...e, jobs: { ...e.jobs, api_deploy: 'failure' } } } }), /api_deploy/)
  await mutate('evidence already created', async () => ({ getEvidence: async () => { const e = await ev(); return { ...e, mutations: { release_record: 'created' } } } }), /already recorded/)
})

test('recovery with an invalid source run id is refused before reading anything', async () => {
  for (const bad of ['', '0', 'abc', '12 34', '1; x']) {
    const deps = fakeDeps({ getRun: async () => { throw new Error('must not be called') } })
    await assert.rejects(verifyRecoveryEvidence({ version: VERSION, sha: SHA, repo: REPO, sourceRunId: bad }, deps), /source run id is invalid|must not be called/)
  }
  await assert.rejects(recordRelease(input({ mode: 'recover' }), fakeDeps()), /source run id is invalid/)
})

test('recovery verification is strictly read-only (no tag or release call)', async () => {
  const deps = fakeDeps()
  await verifyRecoveryEvidence({ version: VERSION, sha: SHA, repo: REPO, sourceRunId: RUN }, deps)
  assert.equal(deps.calls.length, 0)
})

test('preflight performs no write and rejects a token for another repository', async () => {
  const deps = fakeDeps()
  assert.deepEqual(await preflightRecorder({ repo: REPO }, deps), { ok: true })
  assert.equal(deps.calls.length, 0)
  await assert.rejects(preflightRecorder({ repo: REPO }, fakeDeps({ readRecorderRepo: async () => ({ full_name: 'other/repo' }) })), /not henilllpatelll/)
  await assert.rejects(preflightRecorder({ repo: '' }, deps), /repository is required/)
})
