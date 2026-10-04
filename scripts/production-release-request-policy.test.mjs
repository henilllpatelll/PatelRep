import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AUTO_MERGE_RESULT_KEYS, buildAutoMergeResult, parseAutoMergeResult } from './auto-merge-result.mjs'
import { writeAutoMergeResult } from './merge-release-engineer-repair.mjs'
import { readNamedContextFrom } from './release-engineer-auto-merge-deps.mjs'
import { PUBLISHER_APP, RECOVERY_BRANCH_RULESET_PATTERN, TRUSTED_BOT } from './release-engineer-auto-merge-policy.mjs'
import { PUBLISHER_EMAIL, formatTrailers } from './recovery-lineage.mjs'
import {
  Ineligible,
  NO_BASELINE_MESSAGE,
  evaluateProductionRequest,
  requireAutomatedDispatch,
  validateProductionRequest,
} from './production-release-request-policy.mjs'
import { FIRST_MANAGED_VERSION, computeNextVersion, resolveProductionBaseline } from './release-version.mjs'

const REPO = 'henilllpatelll/PatelRep'
const ROOT = '37100000001'
const SOURCE_RUN = '37300000003'
const CI_RUN = '37200000001'
const STAGING_RUN = '37200000002'
const CANDIDATE = 'a'.repeat(40)
const BASE = 'e'.repeat(40)
const MERGE = 'd'.repeat(40)
const BRANCH = `claude/recovery-${ROOT}`

const RESULT = Object.freeze({
  attempt: '1',
  base_main_sha: BASE,
  candidate_branch: BRANCH,
  candidate_sha: CANDIDATE,
  ci_run_id: CI_RUN,
  merge_commit_sha: MERGE,
  pr_number: '77',
  root_run_id: ROOT,
  staging_run_id: STAGING_RUN,
})

const recoveryRuleset = (overrides = {}) => ({
  id: 24446750,
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: [RECOVERY_BRANCH_RULESET_PATTERN], exclude: [] } },
  rules: [{ type: 'creation' }, { type: 'update' }, { type: 'non_fast_forward' }],
  bypass_actors: [{ actor_id: PUBLISHER_APP.integrationId, actor_type: 'Integration', bypass_mode: 'always' }],
  ...overrides,
})

const mainRuleset = (overrides = {}) => ({
  id: 17358515,
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  rules: [
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'CI Gate' }, { context: 'Staging Gate' }] } },
    { type: 'pull_request', parameters: { required_review_thread_resolution: true } },
    { type: 'deletion' },
    { type: 'non_fast_forward' },
  ],
  bypass_actors: [],
  ...overrides,
})

const run = (id, name, extra = {}) => ({
  id: Number(id),
  name,
  status: 'completed',
  conclusion: 'success',
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...extra,
})

const publisherCommit = (sha = CANDIDATE) => ({
  sha,
  message: `fix: repair\n\n${formatTrailers({ root: ROOT, attempt: 1, sourceRun: ROOT })}\n`,
  authorEmail: PUBLISHER_EMAIL,
  committerEmail: PUBLISHER_EMAIL,
  authorLogin: null,
  authorType: null,
  committerLogin: null,
  committerType: null,
})

/** A fully eligible world; tests mutate one fact at a time. */
function world() {
  const state = {
    artifact: { ...RESULT },
    runs: {
      [SOURCE_RUN]: run(SOURCE_RUN, 'Claude Release Engineer Auto-Merge', { event: 'workflow_run' }),
      [ROOT]: run(ROOT, 'Deploy Health Check', { conclusion: 'failure', event: 'schedule', head_sha: BASE }),
      [CI_RUN]: run(CI_RUN, 'CI', { head_sha: CANDIDATE, event: 'pull_request' }),
      [STAGING_RUN]: run(STAGING_RUN, 'Staging Candidate'),
    },
    pr: {
      number: 77, merged: true, commits: 1, changed_files: 2, merge_commit_sha: MERGE,
      user: { login: TRUSTED_BOT.login, id: TRUSTED_BOT.id, type: TRUSTED_BOT.type },
      base: { ref: 'main' }, head: { ref: BRANCH, sha: CANDIDATE, repo: { full_name: REPO } },
    },
    commits: [publisherCommit()],
    files: [{ filename: 'apps/web/components/housekeeping/RoomCard.tsx' }, { filename: 'apps/api/routers/tasks.py' }],
    mergeCommit: { sha: MERGE, parents: [BASE, CANDIDATE] },
    rulesets: [recoveryRuleset(), mainRuleset()],
    mainSha: MERGE,
    releases: [{ tag_name: 'v1.8.0', draft: false, prerelease: false }],
    tagCommits: { 'v1.8.0': BASE },
    ancestor: true,
    active: [],
  }
  const deps = {
    getRun: async (id) => state.runs[String(id)] ?? null,
    readAutoMergeResult: async () => state.artifact,
    getMergedPr: async () => state.pr,
    listPrCommits: async () => state.commits,
    listPrFiles: async () => state.files,
    getCommit: async () => state.mergeCommit,
    listBranchRulesets: async () => {
      if (state.rulesets instanceof Error) throw state.rulesets
      return state.rulesets
    },
    getMainSha: async () => state.mainSha,
    listReleases: async () => state.releases,
    resolveTagCommit: async (tag) => {
      if (!(tag in state.tagCommits)) throw new Error('tag not found')
      return state.tagCommits[tag]
    },
    isAncestorOfMain: async () => state.ancestor,
    listActiveProductionRuns: async () => state.active,
  }
  return { state, deps }
}

const request = { repo: REPO, sourceRunId: SOURCE_RUN, enabled: 'true', mode: 'request' }

async function assertIneligible(mutate, pattern, input = request) {
  const { state, deps } = world()
  mutate(state)
  const result = await evaluateProductionRequest(input, deps)
  assert.equal(result.eligible, false, 'must be ineligible')
  if (pattern) assert.match(result.reason, pattern)
  // The release-time revalidation refuses for the same reason (fails the release instead of a clean no-op).
  await assert.rejects(validateProductionRequest({ ...input, mode: 'release' }, deps), (error) => error instanceof Ineligible)
}

// ---- auto-merge-result artifact ----------------------------------------------------------------------------------

test('the artifact schema is exact and identifier-only', () => {
  assert.deepEqual(AUTO_MERGE_RESULT_KEYS, Object.keys(RESULT).sort())
  assert.deepEqual(parseAutoMergeResult({ ...RESULT }), RESULT)
  const built = buildAutoMergeResult({ attempt: 1, baseMainSha: BASE, branch: BRANCH, sha: CANDIDATE, ciRunId: CI_RUN, mergeCommitSha: MERGE, prNumber: 77, root: ROOT, stagingRunId: STAGING_RUN })
  assert.deepEqual(built, RESULT)
})

test('malformed artifacts hard-fail', () => {
  const bad = [
    null, [], 'x', { ...RESULT, extra: '1' }, { ...RESULT, pr_number: 77 },
    { ...RESULT, merge_commit_sha: 'abc' }, { ...RESULT, base_main_sha: 'E'.repeat(40) }, { ...RESULT, root_run_id: 'manual-5', candidate_branch: 'claude/recovery-manual-5' },
    { ...RESULT, candidate_branch: 'claude/recovery-1' }, { ...RESULT, ci_run_id: '0' }, { ...RESULT, attempt: '0' }, { ...RESULT, pr_number: '0' },
    { ...RESULT, base_main_sha: MERGE }, { ...RESULT, candidate_sha: MERGE },
  ]
  for (const value of bad) assert.throws(() => parseAutoMergeResult(value), /auto-merge-result:/)
  const { pr_number: _omitted, ...missing } = RESULT
  assert.throws(() => parseAutoMergeResult(missing), /unexpected fields/)
})

test('the producer writes exactly one context.json with the verified facts and refuses an invalid result', () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'amr-')), 'auto-merge-result')
  const verified = { attempt: 1, baseMainSha: BASE, branch: BRANCH, sha: CANDIDATE, ciRunId: CI_RUN, mergeCommitSha: MERGE, prNumber: 77, root: ROOT, stagingRunId: STAGING_RUN }
  writeAutoMergeResult(dir, verified)
  assert.deepEqual(readdirSync(dir), ['context.json'])
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'context.json'), 'utf8')), RESULT)
  const empty = path.join(mkdtempSync(path.join(tmpdir(), 'amr-')), 'x')
  assert.throws(() => writeAutoMergeResult(empty, { ...verified, mergeCommitSha: '' }), /auto-merge-result/)
  assert.throws(() => readdirSync(empty), /ENOENT/, 'nothing is written for an unverified result')
})

const reader = (overrides) => readNamedContextFrom({
  name: 'auto-merge-result',
  runId: SOURCE_RUN,
  listArtifacts: async () => [{ name: 'auto-merge-result', expired: false }],
  download: async () => ({ files: ['context.json'], readFile: () => JSON.stringify(RESULT) }),
  ...overrides,
})

test('artifact reading: absent is a clean null; missing, duplicate, expired, unreadable are not', async () => {
  assert.equal(await reader({ listArtifacts: async () => [] }), null)
  assert.equal(await reader({ listArtifacts: async () => [{ name: 'production-release-context' }] }), null)
  assert.deepEqual(await reader({}), RESULT)
  await assert.rejects(reader({ listArtifacts: async () => [{ name: 'auto-merge-result' }, { name: 'auto-merge-result' }] }), /multiple auto-merge-result artifacts/)
  await assert.rejects(reader({ listArtifacts: async () => [{ name: 'auto-merge-result', expired: true }] }), /expired/)
  await assert.rejects(reader({ download: async () => { throw new Error('boom') } }), /could not be downloaded/)
  await assert.rejects(reader({ download: async () => ({ files: ['context.json'], readFile: () => '{x' }) }), /not valid JSON/)
})

// ---- request eligibility: accept -----------------------------------------------------------------------------------

test('the exact narrow recovery case is eligible and reports only identifiers', async () => {
  const { deps } = world()
  const result = await evaluateProductionRequest(request, deps)
  assert.deepEqual(result, { eligible: true, sourceRunId: SOURCE_RUN, mergeCommitSha: MERGE, baseMainSha: BASE, prNumber: 77, root: ROOT, attempt: 1, baselineTag: 'v1.8.0' })
})

test('a Deploy Health Check triggered by a push to main is an acceptable root', async () => {
  const { state, deps } = world()
  state.runs[ROOT].event = 'push'
  assert.equal((await evaluateProductionRequest(request, deps)).eligible, true)
})

// ---- request eligibility: reject -----------------------------------------------------------------------------------

test('activation switch: missing or anything other than "true" is a clean no-op that reads nothing', async () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', '1', 'true ']) {
    let reads = 0
    const { deps } = world()
    const counting = { ...deps, getRun: async (id) => { reads += 1; return deps.getRun(id) } }
    const result = await evaluateProductionRequest({ ...request, enabled }, counting)
    assert.equal(result.eligible, false)
    assert.match(result.reason, /PRODUCTION_AUTO_RELEASE_ENABLED/)
    assert.equal(reads, 0)
  }
})

test('missing artifact is a clean no-op; malformed, unreadable or duplicate artifacts hard-fail', async () => {
  await assertIneligible((s) => { s.artifact = null }, /no auto-merge-result artifact/)
  for (const artifact of [{ ...RESULT, extra: 'x' }, 'x', { ...RESULT, merge_commit_sha: 'zz' }]) {
    const { state, deps } = world()
    state.artifact = artifact
    await assert.rejects(evaluateProductionRequest(request, deps), /auto-merge-result:/)
  }
  const { deps } = world()
  deps.readAutoMergeResult = async () => { throw new Error('auto-merge: auto-merge-result of run 1 has expired') }
  await assert.rejects(evaluateProductionRequest(request, deps), /expired/)
})

test('the source run must be the exact successful Auto-Merge run of this repository', async () => {
  await assertIneligible((s) => { s.runs[SOURCE_RUN].conclusion = 'failure' }, /not success/)
  await assertIneligible((s) => { s.runs[SOURCE_RUN].name = 'Staging Candidate' }, /not Claude Release Engineer Auto-Merge/)
  await assertIneligible((s) => { s.runs[SOURCE_RUN].head_repository.full_name = 'evil/fork' }, /not from this repository/)
  const { deps } = world()
  await assert.rejects(evaluateProductionRequest({ ...request, sourceRunId: '999' }, deps), /could not be fetched/)
  await assert.rejects(evaluateProductionRequest({ ...request, sourceRunId: 'abc' }, deps), /invalid/)
})

test('only the trusted publisher bot, merged recovery PRs on main qualify (not human, dependabot, manual roots)', async () => {
  await assertIneligible((s) => { s.pr.user = { login: 'henilllpatelll', id: 1, type: 'User' } }, /not created by/)
  await assertIneligible((s) => { s.pr.user = { login: 'dependabot[bot]', id: 49699333, type: 'Bot' } }, /not created by/)
  await assertIneligible((s) => { s.pr.user = { ...s.pr.user, id: 1 } }, /not created by/)
  await assertIneligible((s) => { s.pr.head.ref = 'claude/recovery-manual-5' }, /manual/)
  await assertIneligible((s) => { s.pr.head.ref = 'feature/x' }, /not a dedicated recovery branch/)
  await assertIneligible((s) => { s.pr.merged = false }, /not merged/)
  await assertIneligible((s) => { s.pr.base.ref = 'develop' }, /did not target main/)
  await assertIneligible((s) => { s.pr.head.repo.full_name = 'evil/fork' }, /not from this repository/)
  await assertIneligible((s) => { s.pr.head.ref = 'claude/recovery-37100000009' }, /does not match the auto-merge result/)
})

test('candidate and merge SHAs must match the artifact exactly', async () => {
  await assertIneligible((s) => { s.pr.head.sha = 'b'.repeat(40) }, /candidate SHA/)
  await assertIneligible((s) => { s.pr.merge_commit_sha = 'b'.repeat(40) }, /merge commit SHA/)
  await assertIneligible((s) => { s.mergeCommit = { sha: MERGE, parents: [BASE] } }, /merge commit parents/)
  await assertIneligible((s) => { s.mergeCommit = { sha: MERGE, parents: ['b'.repeat(40), CANDIDATE] } }, /merge commit parents/)
  await assertIneligible((s) => { s.artifact.attempt = '2' }, /attempt does not match/)
})

test('recovery trailers and publisher history are required exactly as in Phase 2C', async () => {
  await assertIneligible((s) => { s.commits = [{ ...publisherCommit(), message: 'no trailers\n' }] }, /no recovery trailers/)
  await assertIneligible((s) => { s.commits = [{ ...publisherCommit(), authorEmail: 'someone@example.com' }] }, /trusted publisher/)
})

test('main must still be exactly the recovery merge commit', async () => {
  await assertIneligible((s) => { s.mainSha = 'c'.repeat(40) }, /main moved past the recovery merge/)
})

test('a managed production baseline must exist; the milestone tags never count', async () => {
  await assertIneligible((s) => { s.releases = [] }, new RegExp(NO_BASELINE_MESSAGE.replace(/[.*+?^${}()|[\]\\;]/g, '\\$&')))
  await assertIneligible((s) => { s.releases = ['v1.0', 'v1.7'].map((tag_name) => ({ tag_name, draft: false, prerelease: false })) }, /no managed production release baseline/)
  await assertIneligible((s) => { s.releases = [{ tag_name: 'v1.8.0', draft: true, prerelease: false }] }, /no managed production release baseline/)
  await assertIneligible((s) => { s.releases = [{ tag_name: 'v1.8.0', draft: false, prerelease: true }] }, /no managed production release baseline/)
})

test('a broken newest release (missing tag, non-ancestor tag) fails hard rather than falling back', async () => {
  let { state, deps } = world()
  state.tagCommits = {}
  await assert.rejects(evaluateProductionRequest(request, deps), /tag not found/)
  ;({ state, deps } = world())
  state.ancestor = false
  await assert.rejects(evaluateProductionRequest(request, deps), /not an ancestor of main/)
  ;({ state, deps } = world())
  state.tagCommits = { 'v1.8.0': 'nope' }
  await assert.rejects(evaluateProductionRequest(request, deps), /does not resolve to a commit/)
})

test('no unreleased-change piggybacking: the baseline must equal the recovery base', async () => {
  await assertIneligible((s) => { s.tagCommits = { 'v1.8.0': 'b'.repeat(40) } }, /main contains unreleased changes/)
})

test('an already released target is a clean no-op, never a second deployment', async () => {
  await assertIneligible((s) => { s.tagCommits = { 'v1.8.0': MERGE } }, /already released/)
})

test('the root must be a failed Deploy Health Check of the released baseline', async () => {
  for (const name of ['CI', 'Staging Candidate', 'Production Release', 'Production Migration Evidence Audit']) {
    await assertIneligible((s) => { s.runs[ROOT].name = name }, /not Deploy Health Check/)
  }
  await assertIneligible((s) => { s.runs[ROOT].conclusion = 'success' }, /not a failure/)
  await assertIneligible((s) => { s.runs[ROOT].status = 'in_progress'; s.runs[ROOT].conclusion = null }, /not a failure/)
  await assertIneligible((s) => { s.runs[ROOT].event = 'workflow_dispatch' }, /workflow_dispatch run/)
  await assertIneligible((s) => { s.runs[ROOT].head_sha = 'b'.repeat(40) }, /not the released baseline/)
  await assertIneligible((s) => { s.runs[ROOT].head_repository.full_name = 'evil/fork' }, /not from this repository/)
})

test('the recorded CI and Staging runs must still be exact successes for the candidate', async () => {
  await assertIneligible((s) => { s.runs[CI_RUN].conclusion = 'failure' }, /CI run/)
  await assertIneligible((s) => { s.runs[CI_RUN].head_sha = 'b'.repeat(40) }, /validated/)
  await assertIneligible((s) => { s.runs[STAGING_RUN].conclusion = 'cancelled' }, /Staging Candidate run/)
})

test('any Phase 2C high-risk path blocks the automatic request', async () => {
  for (const [filename, risk] of [
    ['.github/workflows/ci.yml', 'github-automation'],
    ['supabase/migrations/200_x.sql', 'database'],
    ['apps/api/routers/billing.py', 'billing'],
    ['apps/api/middleware/auth.py', 'auth-security'],
    ['scripts/production-release-request.mjs', 'production-release'],
    ['railway.toml', 'infrastructure'],
  ]) {
    await assertIneligible((s) => { s.files = [{ filename }, { filename: 'apps/web/a.tsx' }] }, new RegExp(`classified as ${risk}`))
  }
  await assertIneligible((s) => { s.files = [{ filename: 'apps/web/a.tsx', previous_filename: 'supabase/x.sql' }, { filename: 'apps/web/b.tsx' }] }, /database/)
  await assertIneligible((s) => { s.files = []; s.pr.changed_files = 0 }, /changes no files/)
  await assertIneligible((s) => { s.pr.changed_files = 5 }, /disagrees/)
})

test('weakened recovery or main rulesets fail closed', async () => {
  await assertIneligible((s) => { s.rulesets = [mainRuleset()] }, /not protected for publisher-only/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset({ enforcement: 'disabled' }), mainRuleset()] }, /not protected for publisher-only/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset({ bypass_actors: [{ actor_id: 1, actor_type: 'Integration', bypass_mode: 'always' }] }), mainRuleset()] }, /not protected for publisher-only/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset({ bypass_actors: [...recoveryRuleset().bypass_actors, { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] }), mainRuleset()] }, /not protected for publisher-only/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset({ rules: [{ type: 'creation' }, { type: 'update' }] }), mainRuleset()] }, /not protected for publisher-only/)
  await assertIneligible((s) => { s.rulesets = new Error('403') }, /rulesets could not be read/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset(), mainRuleset({ bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] })] }, /main branch ruleset/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset()] }, /main branch ruleset/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset(), mainRuleset({ enforcement: 'evaluate' })] }, /main branch ruleset/)
  const withoutStaging = mainRuleset()
  withoutStaging.rules[0].parameters.required_status_checks = [{ context: 'CI Gate' }]
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset(), withoutStaging] }, /main branch ruleset/)
  const notStrict = mainRuleset()
  notStrict.rules[0].parameters.strict_required_status_checks_policy = false
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset(), notStrict] }, /main branch ruleset/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset(), mainRuleset({ rules: mainRuleset().rules.filter((r) => r.type !== 'non_fast_forward') })] }, /main branch ruleset/)
  await assertIneligible((s) => { s.rulesets = [recoveryRuleset(), mainRuleset({ rules: mainRuleset().rules.filter((r) => r.type !== 'deletion') })] }, /main branch ruleset/)
})

// ---- idempotency ---------------------------------------------------------------------------------------------------

test('request mode never dispatches while any production release/rollback run is active; duplicates are named', async () => {
  const { state, deps } = world()
  state.active = [{ id: 1, status: 'waiting', workflow: 'production-release.yml', displayTitle: `Production Release ${MERGE} (automated request from run ${SOURCE_RUN})` }]
  let result = await evaluateProductionRequest(request, deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, /already active or awaiting approval/)
  state.active = [{ id: 2, status: 'in_progress', workflow: 'production-rollback.yml', displayTitle: 'Production Rollback' }]
  result = await evaluateProductionRequest(request, deps)
  assert.match(result.reason, /another Production Release or Rollback run is active/)
  state.active = [{ id: 3, status: 'queued', workflow: 'production-release.yml', displayTitle: 'Production Release main-tip' }]
  assert.match((await evaluateProductionRequest(request, deps)).reason, /another Production Release/)
  state.active = null
  await assert.rejects(evaluateProductionRequest(request, deps), /could not be proven/)
})

test('release mode does not count its own run as a duplicate', async () => {
  const { state, deps } = world()
  state.active = [{ id: 1, status: 'in_progress', workflow: 'production-release.yml', displayTitle: `Production Release ${MERGE}` }]
  const result = await validateProductionRequest({ ...request, mode: 'release' }, deps)
  assert.equal(result.mergeCommitSha, MERGE)
})

// ---- Production Release automated mode -----------------------------------------------------------------------------

const dispatch = { actor: TRUSTED_BOT.login, actorId: String(TRUSTED_BOT.id), ref: 'refs/heads/main', workflowSha: MERGE, releaseSha: MERGE, versionBump: 'patch' }
const verified = { mergeCommitSha: MERGE }

test('automated mode requires the trusted bot, main, the exact SHA at the workflow commit, and patch', () => {
  requireAutomatedDispatch(dispatch, verified)
  for (const [override, pattern] of [
    [{ actor: 'henilllpatelll' }, /not dispatched by/],
    [{ actor: 'github-actions[bot]' }, /not dispatched by/],
    [{ actorId: '1' }, /not dispatched by/],
    [{ ref: 'refs/heads/feature' }, /refs\/heads\/main/],
    [{ versionBump: 'minor' }, /version_bump=patch/],
    [{ versionBump: 'major' }, /version_bump=patch/],
    [{ releaseSha: 'b'.repeat(40) }, /release_sha/],
    [{ releaseSha: '' }, /release_sha/],
    [{ workflowSha: 'b'.repeat(40) }, /workflow definition/],
  ]) {
    assert.throws(() => requireAutomatedDispatch({ ...dispatch, ...override }, verified), pattern)
  }
})

test('release-time revalidation fails if anything changed between request and approval', async () => {
  const mutations = [
    [(s) => { s.mainSha = 'c'.repeat(40) }, /main moved/],
    [(s) => { s.tagCommits = { 'v1.8.0': 'b'.repeat(40) } }, /unreleased changes/],
    [(s) => { s.runs[ROOT].conclusion = 'success' }, /not a failure/],
    [(s) => { s.rulesets = [mainRuleset()] }, /publisher-only/],
    [(s) => { s.files = [{ filename: 'supabase/migrations/1.sql' }, { filename: 'a.ts' }] }, /database/],
    [(s) => { s.artifact = null }, /no auto-merge-result/],
  ]
  for (const [mutate, pattern] of mutations) {
    const { state, deps } = world()
    mutate(state)
    await assert.rejects(validateProductionRequest({ ...request, mode: 'release' }, deps), pattern)
  }
  const { deps } = world()
  await assert.rejects(validateProductionRequest({ ...request, mode: 'release', enabled: 'false' }, deps), /PRODUCTION_AUTO_RELEASE_ENABLED/)
  await assert.rejects(validateProductionRequest({ ...request, mode: 'release', enabled: undefined }, deps), /PRODUCTION_AUTO_RELEASE_ENABLED/)
})

// ---- versioning ----------------------------------------------------------------------------------------------------

const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: false, ...extra })
const MILESTONES = ['v1.0', 'v1.1', 'v1.2', 'v1.3', 'v1.4', 'v1.5', 'v1.6', 'v1.7']

test('no completed production release bootstraps the managed line at v1.8.0 for every bump', () => {
  assert.deepEqual(FIRST_MANAGED_VERSION, { major: 1, minor: 8, patch: 0 })
  for (const bump of ['patch', 'minor', 'major']) {
    assert.deepEqual(computeNextVersion({ bump, releases: [], tagNames: MILESTONES }), { previous: '', next: 'v1.8.0' })
    // Two-segment milestone releases are not production releases and are never read as vX.Y.0.
    assert.deepEqual(computeNextVersion({ bump, releases: MILESTONES.map((tag) => release(tag)), tagNames: MILESTONES }), { previous: '', next: 'v1.8.0' })
  }
})

test('subsequent releases bump from the newest completed GitHub Release', () => {
  const at = (tags, bump) => computeNextVersion({ bump, releases: tags.map((tag) => release(tag)), tagNames: [...MILESTONES, ...tags] })
  assert.deepEqual(at(['v1.8.0'], 'patch'), { previous: 'v1.8.0', next: 'v1.8.1' })
  assert.deepEqual(at(['v1.8.0', 'v1.8.1'], 'minor'), { previous: 'v1.8.1', next: 'v1.9.0' })
  assert.deepEqual(at(['v1.9.0', 'v1.8.1', 'v1.8.0'], 'major'), { previous: 'v1.9.0', next: 'v2.0.0' })
  assert.deepEqual(at(['v1.9.0', 'v1.10.0'], 'patch'), { previous: 'v1.10.0', next: 'v1.10.1' }, 'semantic, not lexical, ordering')
})

test('drafts, prereleases and non-strict tags are not completed production releases', () => {
  const releases = [release('v1.8.0'), release('v2.5.0', { draft: true }), release('v3.0.0', { prerelease: true }), release('v1.9'), release('v01.9.0'), release('v1.9.0-rc1'), release('1.9.0')]
  assert.deepEqual(computeNextVersion({ bump: 'patch', releases, tagNames: ['v1.8.0'] }), { previous: 'v1.8.0', next: 'v1.8.1' })
})

test('an orphan or draft three-segment tag at or above the next version fails closed', () => {
  const base = { bump: 'patch', releases: [release('v1.8.0')] }
  assert.throws(() => computeNextVersion({ ...base, tagNames: ['v1.8.0', 'v1.8.1'] }), /exists without a completed production GitHub Release/)
  assert.throws(() => computeNextVersion({ ...base, tagNames: ['v1.8.0', 'v2.0.0'] }), /exists without a completed/)
  assert.throws(() => computeNextVersion({ bump: 'patch', releases: [], tagNames: ['v1.8.0'] }), /exists without a completed/)
  assert.throws(() => computeNextVersion({ ...base, releases: [release('v1.8.0'), release('v1.8.1', { draft: true })], tagNames: ['v1.8.0'] }), /draft or prerelease/)
  // Old, lower orphans never block and nothing is skipped silently.
  assert.equal(computeNextVersion({ ...base, tagNames: ['v1.8.0', 'v0.0.1'] }).next, 'v1.8.1')
  assert.throws(() => computeNextVersion({ bump: 'huge', releases: [], tagNames: [] }), /invalid bump/)
})

test('the production baseline is the newest completed release whose tag is a commit on main', async () => {
  const deps = (overrides = {}) => ({
    listReleases: async () => [release('v1.8.0'), release('v1.8.1'), ...MILESTONES.map((tag) => release(tag)), release('v1.9.0', { draft: true })],
    resolveTagCommit: async (tag) => (tag === 'v1.8.1' ? BASE : 'f'.repeat(40)),
    isAncestorOfMain: async () => true,
    ...overrides,
  })
  const baseline = await resolveProductionBaseline(deps())
  assert.equal(baseline.tag, 'v1.8.1')
  assert.equal(baseline.sha, BASE)
  assert.equal(await resolveProductionBaseline(deps({ listReleases: async () => MILESTONES.map((tag) => release(tag)) })), null)
  await assert.rejects(resolveProductionBaseline(deps({ isAncestorOfMain: async () => false })), /not an ancestor of main/)
  await assert.rejects(resolveProductionBaseline(deps({ resolveTagCommit: async () => '' })), /does not resolve to a commit/)
})
