import assert from 'node:assert/strict'
import test from 'node:test'
import { EVIDENCE_SCHEMA, REQUIRED_SUCCESS_JOBS, TAG_JOB_NAME, VISIBILITY_ATTEMPTS, assertExistingTagExact, assertVersionIntegrity, preflightRecorder, recordRelease, verifyRecoveryEvidence } from './production-release-recorder.mjs'

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
    getRelease: async (version) => {
      deps.releaseReads += 1
      if (deps.releaseReads <= deps.hiddenReads) return null
      return state.releases.find((release) => release.tag_name === version) ?? null
    },
    sleep: async () => {
      calls.push(['sleep'])
    },
    releaseReads: 0,
    hiddenReads: 0,
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

const writes = (deps) => deps.calls.filter((call) => call[0] !== 'sleep').map((call) => call[0])
const sleeps = (deps) => deps.calls.filter((call) => call[0] === 'sleep').length
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

// --- Post-creation verification (run 38329516211: "Release v1.9.2 is not complete after creation") ---

test('immediate publication is verified with a single authoritative read and no waiting', async () => {
  const deps = fakeDeps()
  assert.equal((await recordRelease(input(), deps)).outcome, 'recorded')
  assert.equal(sleeps(deps), 0)
})

test('a Release that is briefly invisible after creation is awaited with bounded retries, never recreated', async () => {
  const deps = fakeDeps()
  const realCreate = deps.createRelease
  deps.createRelease = async (args) => {
    await realCreate(args)
    deps.releaseReads = 0
    deps.hiddenReads = 3
  }
  assert.deepEqual(await recordRelease(input(), deps), { outcome: 'recorded', tagCreated: true, releaseCreated: true })
  assert.equal(sleeps(deps), 3)
  assert.deepEqual(writes(deps), ['createAnnotatedTag', 'createRelease'])
})

test('a lagging collection listing does not matter: the direct lookup is authoritative after creation', async () => {
  const deps = fakeDeps()
  deps.createRelease = async ({ version }) => {
    deps.calls.push(['createRelease', version])
    deps.state.published = { tag_name: version, draft: false, prerelease: false }
  }
  deps.getRelease = async () => deps.state.published ?? null
  assert.equal((await recordRelease(input(), deps)).outcome, 'recorded')
  assert.equal(
    deps.state.releases.some((release) => release.tag_name === VERSION),
    false,
  )
})

test('a Release that never becomes visible fails closed at the strict bound, with no further writes', async () => {
  const deps = fakeDeps()
  deps.getRelease = async () => {
    deps.releaseReads += 1
    return null
  }
  await assert.rejects(recordRelease(input(), deps), /not visible after \d+ checks/)
  assert.equal(deps.releaseReads, VISIBILITY_ATTEMPTS + 1) // one pre-create read + the bounded window
  assert.equal(sleeps(deps), VISIBILITY_ATTEMPTS - 1)
  assert.deepEqual(writes(deps), ['createAnnotatedTag', 'createRelease'])
})

test('a Release missing from the listing but present on direct lookup is recognized (idempotent, no writes)', async () => {
  const deps = fakeDeps()
  deps.state.tag = { type: 'tag', commit: SHA }
  deps.getRelease = async () => ({ tag_name: VERSION, draft: false, prerelease: false }) // listReleases does not include it
  assert.deepEqual(await recordRelease(input(), deps), { outcome: 'already_recorded', tagCreated: false, releaseCreated: false })
  assert.deepEqual(writes(deps), [])
})

test('repeated invocation after success creates no second tag or Release (pipeline and recover)', async () => {
  for (const extra of [{}, { mode: 'recover', recovery: recover }]) {
    const deps = fakeDeps()
    await recordRelease(input(extra), deps)
    assert.deepEqual(await recordRelease(input(extra), deps), { outcome: 'already_recorded', tagCreated: false, releaseCreated: false })
    assert.deepEqual(writes(deps), ['createAnnotatedTag', 'createRelease'])
  }
})

test('a draft or prerelease is never accepted as a completed Release, before or after creation', async () => {
  for (const flags of [{ draft: true, prerelease: false }, { draft: false, prerelease: true }]) {
    const deps = fakeDeps()
    deps.createRelease = async ({ version }) => {
      deps.calls.push(['createRelease', version])
    }
    deps.getRelease = async (version) => (deps.calls.some((call) => call[0] === 'createRelease') ? { tag_name: version, ...flags } : null)
    await assert.rejects(recordRelease(input(), deps), /draft or prerelease/)
    assert.equal(writes(deps).filter((name) => name === 'createRelease').length, 1)

    const existing = fakeDeps()
    existing.state.tag = { type: 'tag', commit: SHA }
    existing.getRelease = async (version) => ({ tag_name: version, ...flags })
    await assert.rejects(recordRelease(input(), existing), /draft or prerelease/)
    assert.deepEqual(writes(existing), [])
  }
})

test('a lookup that returns a different tag is refused', async () => {
  const deps = fakeDeps()
  deps.getRelease = async () => (deps.calls.some((call) => call[0] === 'createRelease') ? { tag_name: 'v1.9.3', draft: false, prerelease: false } : null)
  await assert.rejects(recordRelease(input(), deps), /returned tag v1\.9\.3/)
})

test('the tag is re-verified after the Release exists: a moved, lightweight or vanished tag fails closed', async () => {
  for (const moved of [{ type: 'tag', commit: OTHER }, { type: 'commit', commit: SHA }, null]) {
    const deps = fakeDeps()
    const realCreate = deps.createRelease
    deps.createRelease = async (args) => {
      await realCreate(args)
      deps.state.tag = moved
    }
    await assert.rejects(recordRelease(input(), deps), /refusing to move or reuse it|lightweight|cannot be read back/)
    assert.deepEqual(writes(deps), ['createAnnotatedTag', 'createRelease'])
  }
})

test('permanent GitHub API failures are not retried: errors abort immediately', async () => {
  for (const message of ['HTTP 401: Bad credentials', 'HTTP 403: Resource not accessible', 'HTTP 500']) {
    const deps = fakeDeps()
    const realCreate = deps.createRelease
    let afterCreate = false
    deps.createRelease = async (args) => {
      await realCreate(args)
      afterCreate = true
    }
    deps.getRelease = async () => {
      if (afterCreate) throw new Error(message)
      return null
    }
    await assert.rejects(recordRelease(input(), deps), new RegExp(message.slice(0, 8)))
    assert.equal(sleeps(deps), 0)
  }
  const deps = fakeDeps({ getRelease: async () => { throw new Error('HTTP 403') } })
  await assert.rejects(recordRelease(input(), deps), /HTTP 403/)
  assert.deepEqual(writes(deps), [])
})

test('a failing createRelease is never retried', async () => {
  const deps = fakeDeps()
  deps.createRelease = async () => {
    deps.calls.push(['createRelease'])
    throw new Error('HTTP 422')
  }
  await assert.rejects(recordRelease(input(), deps), /HTTP 422/)
  assert.equal(writes(deps).filter((name) => name === 'createRelease').length, 1)
})
