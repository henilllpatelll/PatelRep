import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeRepair } from './merge-release-engineer-repair.mjs'
import { PUBLISHER_EMAIL, formatTrailers } from './recovery-lineage.mjs'
import {
  GATE_APP,
  Ineligible,
  PUBLISHER_APP_SLUG,
  RECOVERY_BRANCH_RULESET_PATTERN,
  TRUSTED_BOT,
  classifyChangedFile,
  evaluateAutoMerge,
  validateAutoMergeCandidate,
} from './release-engineer-auto-merge-policy.mjs'
import { readStagingContextFrom } from './release-engineer-auto-merge-deps.mjs'

const REPO = 'henilllpatelll/PatelRep'
const ROOT = '37100000001'
const SHA1 = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const SHA3 = 'c'.repeat(40)
const STAGING_RUN = '37200000002'
const CI_RUN = '37200000001'
const BRANCH = `claude/recovery-${ROOT}`
const APP_ID = 424242

const protectedRuleset = (overrides = {}) => ({
  id: 9,
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: [RECOVERY_BRANCH_RULESET_PATTERN], exclude: [] } },
  rules: [{ type: 'creation' }, { type: 'update' }],
  bypass_actors: [{ actor_id: APP_ID, actor_type: 'Integration', bypass_mode: 'always' }],
  ...overrides,
})

const commit = (sha, attempt, overrides = {}) => ({
  sha,
  message: `fix: repair\n\n${formatTrailers({ root: ROOT, attempt, sourceRun: attempt === 1 ? ROOT : '37100000009' })}\n`,
  authorEmail: PUBLISHER_EMAIL,
  committerEmail: PUBLISHER_EMAIL,
  authorLogin: null,
  authorType: null,
  committerLogin: null,
  committerType: null,
  ...overrides,
})

const gate = (name, overrides = {}) => ({
  id: name === 'CI Gate' ? 1 : 2,
  name,
  status: 'completed',
  conclusion: 'success',
  app: { slug: GATE_APP.slug, id: GATE_APP.id },
  details_url: name === 'Staging Gate' ? `https://github.com/${REPO}/actions/runs/${STAGING_RUN}` : `https://github.com/${REPO}/actions/runs/${CI_RUN}`,
  ...overrides,
})

/** A fully eligible world; tests mutate one fact at a time. */
function world() {
  const state = {
    stagingRun: { id: Number(STAGING_RUN), name: 'Staging Candidate', status: 'completed', conclusion: 'success', repository: { full_name: REPO }, head_repository: { full_name: REPO } },
    ciRun: { id: Number(CI_RUN), name: 'CI', status: 'completed', conclusion: 'success', head_sha: SHA1, head_branch: BRANCH, event: 'pull_request', repository: { full_name: REPO }, head_repository: { full_name: REPO } },
    context: { candidate_branch: BRANCH, candidate_sha: SHA1, ci_run_id: CI_RUN, pr_number: '77' },
    pr: {
      number: 77, state: 'open', draft: false, merged: false, commits: 1, changed_files: 2, mergeable: true, mergeable_state: 'clean',
      user: { login: TRUSTED_BOT.login, id: TRUSTED_BOT.id, type: TRUSTED_BOT.type },
      base: { ref: 'main' }, head: { ref: BRANCH, sha: SHA1, repo: { full_name: REPO } }, labels: [],
    },
    commits: [commit(SHA1, 1)],
    files: [{ filename: 'apps/web/components/housekeeping/RoomCard.tsx' }, { filename: 'apps/api/routers/tasks.py' }],
    checks: { 'CI Gate': [gate('CI Gate')], 'Staging Gate': [gate('Staging Gate')] },
    reviews: [],
    unresolvedThreads: 0,
    app: { id: APP_ID, slug: PUBLISHER_APP_SLUG },
    rulesets: [protectedRuleset()],
    mergeCalls: [],
    mergeResponse: { merged: true, sha: 'd'.repeat(40) },
    afterMerge: null,
    beforeMerge: null,
  }
  const deps = {
    getApp: async () => {
      if (state.app instanceof Error) throw state.app
      return state.app
    },
    listBranchRulesets: async () => {
      if (state.rulesets instanceof Error) throw state.rulesets
      return state.rulesets
    },
    getRun: async (id) => (String(id) === STAGING_RUN ? state.stagingRun : String(id) === CI_RUN ? state.ciRun : null),
    readStagingContext: async () => state.context,
    getPr: async () => state.pr,
    getMergedPr: async () => state.afterMerge ?? { ...state.pr, merged: true },
    listPrCommits: async () => state.commits,
    listPrFiles: async () => state.files,
    listCheckRuns: async (_sha, name) => state.checks[name] ?? [],
    listReviews: async () => state.reviews,
    countUnresolvedThreads: async () => state.unresolvedThreads,
    merge: async (number, sha) => {
      state.mergeCalls.push({ number, sha })
      return state.mergeResponse
    },
  }
  return { state, deps }
}

const input = { repo: REPO, stagingRunId: STAGING_RUN }
const expected = { prNumber: '77', sha: SHA1, branch: BRANCH, ciRunId: CI_RUN }

async function assertIneligible(mutate, pattern) {
  const { state, deps } = world()
  mutate(state)
  const result = await evaluateAutoMerge(input, deps)
  assert.equal(result.eligible, false, 'must be ineligible')
  if (pattern) assert.match(result.reason, pattern)
  // The privileged path refuses too and never calls the merge API.
  // Resolver expectations mirror the (possibly mutated) artifact so the policy itself is what refuses.
  const mirrored = { prNumber: state.context.pr_number, sha: state.context.candidate_sha, branch: state.context.candidate_branch, ciRunId: state.context.ci_run_id }
  await assert.rejects(mergeRepair({ ...input, expected: mirrored }, deps), (error) => error instanceof Ineligible)
  assert.deepEqual(state.mergeCalls, [])
}

// ---- happy path ----------------------------------------------------------------------------------------

test('a publisher-created numeric-root recovery PR with green exact gates is eligible and merges once, exact SHA', async () => {
  const { state, deps } = world()
  const result = await evaluateAutoMerge(input, deps)
  assert.deepEqual({ ...result, reason: undefined }, { eligible: true, prNumber: 77, sha: SHA1, branch: BRANCH, root: ROOT, attempt: 1, ciRunId: CI_RUN, stagingRunId: STAGING_RUN, reason: undefined })
  const merged = await mergeRepair({ ...input, expected }, deps)
  assert.deepEqual(state.mergeCalls, [{ number: 77, sha: SHA1 }])
  assert.equal(merged.mergeCommitSha, 'd'.repeat(40))
})

test('a three-attempt recovery history with monotonic attempts is eligible', async () => {
  const { state, deps } = world()
  state.commits = [commit(SHA1, 1), commit(SHA2, 2), commit(SHA3, 3)]
  state.pr.commits = 3
  state.pr.head.sha = SHA3
  state.context.candidate_sha = SHA3
  state.ciRun.head_sha = SHA3
  const result = await evaluateAutoMerge(input, deps)
  assert.equal(result.eligible, true)
  assert.equal(result.attempt, 3)
})

// ---- identity: manual roots, ordinary PRs, creators ------------------------------------------------------

test('manual roots never auto-merge, even with every check green', async () => {
  for (const branch of ['claude/recovery-manual-37173917161', 'claude/recovery-manual-1']) {
    await assertIneligible((s) => { s.pr.head.ref = branch; s.context.candidate_branch = branch; s.ciRun.head_branch = branch }, /manual/)
  }
})

test('non-recovery branches (ordinary feature, dependabot) never auto-merge even if Claude repaired them', async () => {
  for (const branch of ['feature/room-board', 'dependabot/npm_and_yarn/next-16', 'claude/fix-something', 'claude/recovery-', 'claude/recovery-abc', 'claude/recovery-0123', 'claude/recovery-12/extra']) {
    await assertIneligible((s) => { s.pr.head.ref = branch; s.context.candidate_branch = branch; s.ciRun.head_branch = branch })
  }
})

test('only the exact trusted publisher bot account may have created the PR', async () => {
  const creators = [
    { login: 'dependabot[bot]', id: 49699333, type: 'Bot' },
    { login: 'henilllpatelll', id: 1, type: 'User' },
    { login: TRUSTED_BOT.login, id: 999, type: 'Bot' },
    { login: TRUSTED_BOT.login, id: TRUSTED_BOT.id, type: 'User' },
    { login: 'other-app[bot]', id: TRUSTED_BOT.id, type: 'Bot' },
    null,
  ]
  for (const user of creators) await assertIneligible((s) => { s.pr.user = user }, /not created by/)
})

// ---- lineage -------------------------------------------------------------------------------------------

test('lineage must be complete, authoritative and publisher-only', async () => {
  const bad = {
    'no trailers': (s) => { s.commits = [{ ...commit(SHA1, 1), message: 'fix: no trailers\n' }] },
    'partial trailers': (s) => { s.commits = [{ ...commit(SHA1, 1), message: `fix\n\nPatelRep-Recovery-Root: ${ROOT}\n` }] },
    'duplicate trailers': (s) => {
      const t = formatTrailers({ root: ROOT, attempt: 1, sourceRun: ROOT })
      s.commits = [{ ...commit(SHA1, 1), message: `fix\n\n${t}\nPatelRep-Recovery-Attempt: 2\n` }]
    },
    'malformed trailers': (s) => { s.commits = [{ ...commit(SHA1, 1), message: `fix\n\nPatelRep-Recovery-Root: ${ROOT}\nPatelRep-Recovery-Attempt: x\nPatelRep-Recovery-Source-Run: ${ROOT}\n` }] },
    'branch/root mismatch': (s) => { s.commits = [{ ...commit(SHA1, 1), message: `fix\n\n${formatTrailers({ root: '999', attempt: 1, sourceRun: '999' })}\n` }] },
    'attempt above three': (s) => {
      s.commits = [commit(SHA1, 1), commit(SHA2, 2), commit(SHA3, 3), commit('d'.repeat(40), 4)]
      s.pr.commits = 4
    },
    'unrelated extra commit': (s) => { s.commits = [commit(SHA1, 1), { ...commit(SHA2, 2), message: 'chore: sneaky\n' }]; s.pr.commits = 2; s.pr.head.sha = SHA2; s.context.candidate_sha = SHA2; s.ciRun.head_sha = SHA2 },
    'non-monotonic attempts': (s) => { s.commits = [commit(SHA1, 2)]; },
    'skipped attempt': (s) => { s.commits = [commit(SHA1, 1), commit(SHA2, 3)]; s.pr.commits = 2; s.pr.head.sha = SHA2; s.context.candidate_sha = SHA2; s.ciRun.head_sha = SHA2 },
    'different roots in one PR': (s) => {
      s.commits = [commit(SHA1, 1), { ...commit(SHA2, 2), message: `fix\n\n${formatTrailers({ root: '555', attempt: 2, sourceRun: '556' })}\n` }]
      s.pr.commits = 2; s.pr.head.sha = SHA2; s.context.candidate_sha = SHA2; s.ciRun.head_sha = SHA2
    },
    'attempt 1 source is not the root': (s) => { s.commits = [{ ...commit(SHA1, 1), message: `fix\n\n${formatTrailers({ root: ROOT, attempt: 1, sourceRun: '12345' })}\n` }] },
    'head is not the last recovery commit': (s) => { s.commits = [commit(SHA2, 1)] },
    'commit count disagrees': (s) => { s.pr.commits = 2 },
    'wrong author email': (s) => { s.commits = [commit(SHA1, 1, { authorEmail: 'human@example.com' })] },
    'wrong committer email': (s) => { s.commits = [commit(SHA1, 1, { committerEmail: 'human@example.com' })] },
    'resolved to a human account': (s) => { s.commits = [commit(SHA1, 1, { authorLogin: 'someone', authorType: 'User' })] },
    'resolved to a different bot': (s) => { s.commits = [commit(SHA1, 1, { committerLogin: 'dependabot[bot]', committerType: 'Bot' })] },
  }
  for (const [label, mutate] of Object.entries(bad)) {
    await assertIneligible(mutate).catch((error) => { error.message = `${label}: ${error.message}`; throw error })
  }
})

test('commits that GitHub resolves to the trusted bot account are accepted', async () => {
  const { state, deps } = world()
  state.commits = [commit(SHA1, 1, { authorLogin: TRUSTED_BOT.login, authorType: 'Bot', committerLogin: TRUSTED_BOT.login, committerType: 'Bot' })]
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true)
})

// ---- stale / race behavior ---------------------------------------------------------------------------

test('merge is refused when the PR changed after resolution', async () => {
  await assertIneligible((s) => { s.pr.state = 'closed' }, /not open/)
  await assertIneligible((s) => { s.pr.base.ref = 'release' }, /does not target main/)
  await assertIneligible((s) => { s.pr.head.ref = 'claude/recovery-77' }, /head branch changed/)
  await assertIneligible((s) => { s.pr.head.sha = 'e'.repeat(40) }, /head moved/)
  await assertIneligible((s) => { s.pr.draft = true }, /draft/)
  await assertIneligible((s) => { s.pr.head.repo.full_name = 'fork/PatelRep' }, /not from this repository/)
  await assertIneligible((s) => { s.pr.mergeable_state = 'behind' }, /not cleanly mergeable/)
  await assertIneligible((s) => { s.pr.mergeable_state = 'blocked' }, /not cleanly mergeable/)
  await assertIneligible((s) => { s.pr.mergeable = false; s.pr.mergeable_state = 'dirty' }, /not cleanly mergeable/)
  await assertIneligible((s) => { s.reviews = [{ user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED' }] }, /changes requested/)
  await assertIneligible((s) => { s.unresolvedThreads = 1 }, /unresolved review threads/)
})

test('a dismissed or superseded change request no longer blocks, but a later one does', async () => {
  const { state, deps } = world()
  state.reviews = [{ user: { login: 'r' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'r' }, state: 'APPROVED' }]
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true)
  state.reviews.push({ user: { login: 'r' }, state: 'CHANGES_REQUESTED' })
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, false)
})

test('human-hold labels block merge case-insensitively', async () => {
  for (const name of ['do-not-merge', 'Do Not Merge', 'HOLD', 'manual-review', 'Needs-Human']) {
    await assertIneligible((s) => { s.pr.labels = [{ name }] }, /human-gate label/)
  }
  const { state, deps } = world()
  state.pr.labels = [{ name: 'bug' }, { name: 'holdout-feature' }]
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true)
})

test('the head moving between validation and the merge call is rejected by GitHub via the expected SHA', async () => {
  const { state, deps } = world()
  deps.merge = async (number, sha) => {
    state.mergeCalls.push({ number, sha })
    throw new Error('Head branch was modified. Review and try the merge again.')
  }
  await assert.rejects(mergeRepair({ ...input, expected }, deps), /Head branch was modified/)
  assert.deepEqual(state.mergeCalls, [{ number: 77, sha: SHA1 }])
})

test('the privileged revalidation does not trust resolver expectations', async () => {
  const { state, deps } = world()
  for (const stale of [{ sha: 'f'.repeat(40) }, { branch: 'claude/recovery-1' }, { ciRunId: '1' }, { prNumber: '78' }]) {
    await assert.rejects(mergeRepair({ ...input, expected: { ...expected, ...stale } }, deps), /does not match the resolver expectation/)
  }
  await assert.rejects(mergeRepair({ ...input }, deps), /expectations are required/)
  assert.deepEqual(state.mergeCalls, [])
})

test('merge success requires merged:true from the API and the exact authorized head afterwards', async () => {
  let world1 = world()
  world1.state.mergeResponse = { merged: false, message: 'nope' }
  await assert.rejects(mergeRepair({ ...input, expected }, world1.deps), /did not merge/)

  world1 = world()
  world1.state.afterMerge = { ...world1.state.pr, merged: false }
  await assert.rejects(mergeRepair({ ...input, expected }, world1.deps), /not merged after the API call/)

  world1 = world()
  world1.state.afterMerge = { ...world1.state.pr, merged: true, head: { ...world1.state.pr.head, sha: SHA2 } }
  await assert.rejects(mergeRepair({ ...input, expected }, world1.deps), /not the authorized candidate SHA/)
})

// ---- gate validation ------------------------------------------------------------------------------------

test('CI and Staging runs must be exact, successful and for this candidate', async () => {
  await assertIneligible((s) => { s.ciRun.conclusion = 'failure' }, /CI run/)
  await assertIneligible((s) => { s.ciRun.status = 'in_progress'; s.ciRun.conclusion = null }, /CI run/)
  await assertIneligible((s) => { s.ciRun.head_sha = 'e'.repeat(40) }, /not the candidate/)
  await assertIneligible((s) => { s.ciRun.head_branch = 'main' }, /ran for branch/)
  await assertIneligible((s) => { s.ciRun.event = 'push' }, /not a pull_request run/)
  await assertIneligible((s) => { s.ciRun.name = 'Lint' }, /not CI/)
  await assertIneligible((s) => { s.ciRun.head_repository.full_name = 'fork/PatelRep' }, /not from this repository/)
  await assertIneligible((s) => { s.stagingRun.conclusion = 'failure' }, /Staging Candidate run/)
  await assertIneligible((s) => { s.stagingRun.name = 'CI' }, /not Staging Candidate/)
})

test('a staging artifact pointing at another SHA or PR cannot authorize the merge', async () => {
  const { state, deps } = world()
  state.context.candidate_sha = 'e'.repeat(40)
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, false)
  state.context.candidate_sha = SHA1
  state.context.extra = 'x'
  await assert.rejects(evaluateAutoMerge(input, deps), /unexpected fields/)
  delete state.context.extra
  state.context.candidate_sha = 'zzz'
  await assert.rejects(evaluateAutoMerge(input, deps), /not a 40-character SHA/)
  state.context.candidate_sha = SHA1
  state.context.pr_number = '0'
  await assert.rejects(evaluateAutoMerge(input, deps), /PR number is invalid/)
})

test('CI Gate and Staging Gate must exist, complete successfully and come from GitHub Actions', async () => {
  for (const name of ['CI Gate', 'Staging Gate']) {
    await assertIneligible((s) => { s.checks[name] = [] }, new RegExp(`no ${name}`))
    for (const [status, conclusion] of [['completed', 'failure'], ['completed', 'skipped'], ['completed', 'cancelled'], ['in_progress', null], ['queued', null]]) {
      await assertIneligible((s) => { s.checks[name] = [gate(name, { status, conclusion })] }, new RegExp(name))
    }
    await assertIneligible((s) => { s.checks[name] = [gate(name, { app: { slug: 'github-actions', id: 1 } })] }, new RegExp(`no ${name}`))
    await assertIneligible((s) => { s.checks[name] = [gate(name, { app: { slug: 'evil-app', id: GATE_APP.id } })] }, new RegExp(`no ${name}`))
    await assertIneligible((s) => { s.checks[name] = [gate(name, { app: { slug: 'evil-app', id: 4242 } })] }, new RegExp(`no ${name}`))
    await assertIneligible((s) => { s.checks[name] = [gate(name, { app: null })] }, new RegExp(`no ${name}`))
  }
})

test('a third-party success cannot mask a newer failing GitHub Actions gate', async () => {
  const { state, deps } = world()
  state.checks['Staging Gate'] = [gate('Staging Gate', { id: 10 }), gate('Staging Gate', { id: 11, conclusion: 'failure' }), gate('Staging Gate', { id: 12, app: { slug: 'evil-app', id: 4242 } })]
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, false)
})

test('the Staging Gate must have been reported by this exact Staging Candidate run', async () => {
  await assertIneligible((s) => { s.checks['Staging Gate'] = [gate('Staging Gate', { details_url: `https://github.com/${REPO}/actions/runs/1` })] }, /exact Staging Candidate run/)
})

// ---- high-risk policy -------------------------------------------------------------------------------------

test('high-risk changed files always require a human merge, with a clear reason', async () => {
  const risky = {
    database: ['supabase/migrations/210_x.sql', 'supabase/config.toml', 'apps/api/core/database.py', 'apps/api/db/schema_history.py', 'scripts/check-db-drift.mjs', 'apps/api/services/reconciliation.py', 'apps/web/lib/supabase/server.ts', 'docs/migrations/notes.md'],
    billing: ['apps/api/routers/billing.py', 'apps/api/routers/webhooks.py', 'apps/api/middleware/credits.py', 'apps/web/lib/api/billing.ts', 'apps/web/app/(dashboard)/billing/page.tsx', 'apps/web/app/(dashboard)/settings/billing/Plan.tsx', 'apps/web/components/StripeBadge.tsx', 'apps/web/lib/checkout.ts', 'apps/web/lib/invoices.ts'],
    'auth-security': ['apps/api/routers/auth.py', 'apps/api/middleware/auth.py', 'apps/api/services/opera/auth.py', 'apps/web/stores/authStore.ts', 'apps/web/lib/hooks/useAuth.ts', 'apps/web/app/auth/callback/route.ts', 'apps/web/app/(auth)/login/page.tsx', 'apps/mobile/app/(auth)/login.tsx', 'apps/web/proxy.ts', 'apps/web/lib/rbac.ts', 'apps/web/lib/oauthClient.ts', 'apps/api/security_headers.py', 'apps/web/lib/permissions.ts', 'apps/web/lib/sessionStore.ts'],
    'github-automation': ['.github/workflows/claude-release-engineer-auto-merge.yml', '.github/workflows/ci.yml', '.github/CODEOWNERS', '.github/actions/x/action.yml'],
    'production-release': ['.github/../scripts/production-release-guard.mjs', 'scripts/anything.mjs', 'docs/PRODUCTION_RUNBOOK.md', 'apps/api/routers/rollback.py', 'apps/web/lib/deploymentInfo.ts'],
    infrastructure: ['apps/api/Dockerfile', 'railway.toml', 'package.json', 'apps/web/package-lock.json', 'apps/api/requirements.txt', '.claude/settings.json', 'CLAUDE.md', 'apps/api/routers/internal.py'],
  }
  for (const [family, paths] of Object.entries(risky)) {
    for (const file of paths) {
      assert.ok(classifyChangedFile(file), `${file} must be high-risk (${family})`)
      await assertIneligible((s) => { s.files = [{ filename: 'apps/web/components/RoomCard.tsx' }, { filename: file }] }, new RegExp(`human review required because changed file ${file.replace(/[()./]/g, '\\$&')} is classified as`))
    }
  }
  assert.equal(classifyChangedFile('supabase/migrations/1.sql').risk, 'database')
  assert.equal(classifyChangedFile('.github/workflows/x.yml').risk, 'github-automation')
  assert.equal(classifyChangedFile('apps/api/routers/billing.py').risk, 'billing')
  assert.equal(classifyChangedFile('apps/api/routers/auth.py').risk, 'auth-security')
})

test('renames cannot launder a high-risk path: the previous filename is classified too', async () => {
  await assertIneligible((s) => { s.files = [{ filename: 'apps/web/lib/ok.ts', previous_filename: 'apps/api/routers/billing.py' }]; s.pr.changed_files = 1 }, /billing/)
})

test('representative low-risk application repairs remain eligible', async () => {
  const low = [
    'apps/web/components/housekeeping/RoomCard.tsx',
    'apps/web/components/dashboard/HousekeeperDashboard.tsx',
    'apps/web/lib/utils/avatar.ts',
    'apps/web/app/(dashboard)/tasks/page.tsx',
    'apps/web/lib/hooks/useCountUp.ts',
    'apps/web/stores/housekeepingStore.ts',
    'apps/api/routers/tasks.py',
    'apps/api/routers/housekeeping.py',
    'apps/api/models/task.py',
    'apps/api/tests/test_tasks.py',
    'apps/web/__tests__/RoomCard.test.tsx',
    'README.md',
  ]
  for (const file of low) assert.equal(classifyChangedFile(file), null, `${file} should be low-risk`)
  const { state, deps } = world()
  state.files = low.slice(0, 2).map((filename) => ({ filename }))
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true)
})

test('empty or miscounted file lists fail closed', async () => {
  await assertIneligible((s) => { s.files = []; s.pr.changed_files = 0 }, /changes no files/)
  await assertIneligible((s) => { s.pr.changed_files = 3000 }, /disagrees/)
})

test('malformed data throws instead of being treated as ineligible or eligible', async () => {
  const { state, deps } = world()
  state.stagingRun = null
  await assert.rejects(validateAutoMergeCandidate(input, deps), /could not be fetched/)
  await assert.rejects(validateAutoMergeCandidate({ repo: REPO, stagingRunId: 'abc' }, deps), /invalid/)
})

// ---- publisher-only recovery-branch protection (provenance anchor) ---------------------------------------

const PROTECTION = /dedicated recovery branches are not protected for publisher-only creation and updates/

test('a correctly configured recovery-branch ruleset with exactly the PatelRep App is accepted', async () => {
  const { deps } = world()
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true)
})

test('missing or weakened recovery-branch protection makes auto-merge ineligible, never an error', async () => {
  const bypass = (...actors) => [protectedRuleset({ bypass_actors: actors })]
  const app = { actor_id: APP_ID, actor_type: 'Integration', bypass_mode: 'always' }
  const cases = {
    'no ruleset': [],
    'only an unrelated ruleset': [protectedRuleset({ conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } } })],
    'disabled ruleset': [protectedRuleset({ enforcement: 'disabled' })],
    'evaluate-only ruleset': [protectedRuleset({ enforcement: 'evaluate' })],
    'tag ruleset': [protectedRuleset({ target: 'tag' })],
    'wrong target pattern': [protectedRuleset({ conditions: { ref_name: { include: ['refs/heads/claude/*'], exclude: [] } } })],
    'pattern excluded': [protectedRuleset({ conditions: { ref_name: { include: [RECOVERY_BRANCH_RULESET_PATTERN], exclude: ['refs/heads/claude/recovery-1*'] } } })],
    'missing creation': [protectedRuleset({ rules: [{ type: 'update' }] })],
    'missing update': [protectedRuleset({ rules: [{ type: 'creation' }] })],
    'only deletion rule': [protectedRuleset({ rules: [{ type: 'deletion' }] })],
    'no bypass actor': bypass(),
    'user bypass': bypass({ actor_id: 1, actor_type: 'User', bypass_mode: 'always' }),
    'repository role (admin) bypass': bypass({ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }),
    'organization admin bypass': bypass({ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }),
    'team bypass': bypass({ actor_id: 7, actor_type: 'Team', bypass_mode: 'always' }),
    'dependabot bypass': bypass({ actor_id: 29110, actor_type: 'Integration', bypass_mode: 'always' }),
    'unrelated app bypass': bypass({ actor_id: 99, actor_type: 'Integration', bypass_mode: 'always' }),
    'PatelRep app plus a second actor': bypass(app, { actor_id: 1, actor_type: 'User', bypass_mode: 'always' }),
    'PatelRep app plus another app': bypass(app, { actor_id: 99, actor_type: 'Integration', bypass_mode: 'always' }),
    'right id wrong actor type': bypass({ actor_id: APP_ID, actor_type: 'Team', bypass_mode: 'always' }),
    'pull-request-only bypass mode': bypass({ actor_id: APP_ID, actor_type: 'Integration', bypass_mode: 'pull_request' }),
    'ruleset without bypass_actors field': [protectedRuleset({ bypass_actors: undefined })],
    'malformed rules': [protectedRuleset({ rules: 'creation,update' })],
    'malformed ruleset entries': [null, 'x', 42, {}],
    'malformed ruleset response': { message: 'nope' },
  }
  for (const [label, rulesets] of Object.entries(cases)) {
    await assertIneligible((s) => { s.rulesets = rulesets }, PROTECTION).catch((error) => {
      error.message = `${label}: ${error.message}`
      throw error
    })
  }
})

test('a qualifying ruleset is enough even when other rulesets exist, but another ruleset cannot rescue a weak one', async () => {
  const { state, deps } = world()
  state.rulesets = [protectedRuleset({ id: 1, conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, bypass_actors: [] }), protectedRuleset({ id: 2 })]
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true)
  state.rulesets = [protectedRuleset({ id: 2, bypass_actors: [] })]
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, false)
})

test('the PatelRep App id is resolved from its exact slug, never assumed', async () => {
  const apps = [null, undefined, {}, { slug: PUBLISHER_APP_SLUG }, { id: APP_ID }, { id: APP_ID, slug: 'other-app' }, { id: '424242', slug: PUBLISHER_APP_SLUG }, { id: 0, slug: PUBLISHER_APP_SLUG }, new Error('HTTP 404')]
  for (const app of apps) await assertIneligible((s) => { s.app = app }, PROTECTION)
  // The ruleset actor id must equal the resolved id: a different resolved id invalidates the same ruleset.
  await assertIneligible((s) => { s.app = { id: APP_ID + 1, slug: PUBLISHER_APP_SLUG } }, PROTECTION)
  await assertIneligible((s) => { s.rulesets = new Error('HTTP 403: Resource not accessible by integration') }, PROTECTION)
})

test('ordinary non-recovery PRs are rejected on identity before any ruleset read', async () => {
  const { state, deps } = world()
  let reads = 0
  deps.getApp = async () => { reads += 1; return state.app }
  state.pr.head.ref = 'feature/x'
  state.context.candidate_branch = 'feature/x'
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, false)
  assert.equal(reads, 0)
})

test('the privileged merge revalidates recovery-branch protection immediately before merging', async () => {
  const { state, deps } = world()
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true) // the resolver said yes ...
  state.rulesets = [protectedRuleset({ bypass_actors: [...protectedRuleset().bypass_actors, { actor_id: 1, actor_type: 'User', bypass_mode: 'always' }] })]
  // ... but protection changed before the privileged job ran
  await assert.rejects(mergeRepair({ ...input, expected }, deps), (error) => error instanceof Ineligible && PROTECTION.test(error.message))
  assert.deepEqual(state.mergeCalls, [])
  state.rulesets = [protectedRuleset()]
  await mergeRepair({ ...input, expected }, deps)
  assert.deepEqual(state.mergeCalls, [{ number: 77, sha: SHA1 }])
})

test('unsigned publisher commits and matching email/trailers are not sufficient provenance without the ruleset', async () => {
  const { state, deps } = world()
  assert.equal(state.commits[0].authorEmail, PUBLISHER_EMAIL)
  state.rulesets = []
  const result = await evaluateAutoMerge(input, deps)
  assert.equal(result.eligible, false)
  assert.match(result.reason, PROTECTION)
})

// ---- missing staging-candidate-context (CI on main has no PR candidate) ------------------------------------

test('a successful Staging Candidate run with no candidate artifact is a clean no-op: ineligible, no merge, no error', async () => {
  const { state, deps } = world()
  state.context = null
  const calls = []
  for (const name of ['getPr', 'getApp', 'listBranchRulesets', 'listPrCommits', 'listPrFiles', 'listCheckRuns', 'merge']) {
    const original = deps[name]
    deps[name] = async (...args) => { calls.push(name); return original(...args) }
  }
  const result = await evaluateAutoMerge(input, deps)
  assert.deepEqual(result, { eligible: false, reason: 'Auto-merge ineligible: Staging Candidate run has no PR candidate context.' })
  assert.deepEqual(calls, [], 'nothing else is read or written when there is no candidate')
  // The privileged path also refuses cleanly and never merges.
  await assert.rejects(mergeRepair({ ...input, expected }, deps), (error) => error instanceof Ineligible && /no PR candidate context/.test(error.message))
  assert.deepEqual(state.mergeCalls, [])
})

test('only an explicit null means "no candidate": undefined and non-object content still hard-fail', async () => {
  for (const bad of [undefined, 0, '', false, 'x', [], {}, { pr_number: '77' }, { ...world().state.context, extra: 1 }]) {
    const { state, deps } = world()
    state.context = bad
    await assert.rejects(evaluateAutoMerge(input, deps), (error) => !(error instanceof Ineligible) && /unexpected fields/.test(error.message), JSON.stringify(bad))
  }
})

test('candidate contexts with invalid fields still hard-fail', async () => {
  const bad = [
    [{ candidate_sha: 'zz' }, /40-character SHA/],
    [{ candidate_sha: 'A'.repeat(40) }, /40-character SHA/],
    [{ pr_number: '0' }, /PR number is invalid/],
    [{ pr_number: '12abc' }, /PR number is invalid/],
    [{ ci_run_id: '0' }, /CI run id is invalid/],
    [{ ci_run_id: 'x' }, /CI run id is invalid/],
    [{ candidate_branch: 'bad branch!' }, /branch is invalid/],
  ]
  for (const [patch, pattern] of bad) {
    const { state, deps } = world()
    state.context = { ...state.context, ...patch }
    await assert.rejects(evaluateAutoMerge(input, deps), (error) => !(error instanceof Ineligible) && pattern.test(error.message), JSON.stringify(patch))
  }
})

test('a missing artifact weakens nothing: with a real candidate every other Phase 2C refusal still applies', async () => {
  const { deps } = world()
  assert.equal((await evaluateAutoMerge(input, deps)).eligible, true) // the happy path is unchanged
  await assertIneligible((s) => { s.rulesets = [] }, PROTECTION)
  await assertIneligible((s) => { s.pr.head.ref = 'claude/recovery-manual-5'; s.context.candidate_branch = 'claude/recovery-manual-5'; s.ciRun.head_branch = 'claude/recovery-manual-5' }, /manual/)
  await assertIneligible((s) => { s.commits = [{ ...commit(SHA1, 1), message: 'no trailers\n' }] }, /no recovery trailers/)
  await assertIneligible((s) => { s.files = [{ filename: '.github/workflows/ci.yml' }, { filename: 'a.ts' }] }, /classified as github-automation/)
  await assertIneligible((s) => { s.ciRun.conclusion = 'failure' }, /CI run/)
  await assertIneligible((s) => { s.checks['Staging Gate'] = [] }, /no Staging Gate/)
  const { state, deps: fresh } = world()
  await mergeRepair({ ...input, expected }, fresh)
  assert.deepEqual(state.mergeCalls, [{ number: 77, sha: SHA1 }])
})

// ---- staging context reader: absence is proven by listing, never inferred from an error ------------------------

const reader = (overrides) => readStagingContextFrom({
  runId: STAGING_RUN,
  listArtifacts: async () => [{ name: 'staging-candidate-context', expired: false }],
  download: async () => ({ files: ['context.json'], readFile: () => JSON.stringify({ ok: true }) }),
  ...overrides,
})

test('reader returns null only when the exact artifact is absent from the run', async () => {
  assert.equal(await reader({ listArtifacts: async () => [] }), null)
  assert.equal(await reader({ listArtifacts: async () => [{ name: 'staging-playwright-abc' }, { name: 'repair-output' }] }), null)
  let downloads = 0
  await reader({ listArtifacts: async () => [], download: async () => { downloads += 1 } })
  assert.equal(downloads, 0, 'no download is attempted when the artifact is absent')
})

test('reader returns the parsed content of a present, well-formed artifact', async () => {
  assert.deepEqual(await reader({}), { ok: true })
})

test('reader hard-fails once the artifact exists and anything is wrong', async () => {
  await assert.rejects(reader({ download: async () => { throw new Error('HTTP 500: boom') } }), /could not be downloaded/)
  await assert.rejects(reader({ listArtifacts: async () => { throw new Error('HTTP 403') } }), /HTTP 403/)
  await assert.rejects(reader({ listArtifacts: async () => [{ name: 'staging-candidate-context' }, { name: 'staging-candidate-context' }] }), /multiple/)
  await assert.rejects(reader({ listArtifacts: async () => [{ name: 'staging-candidate-context', expired: true }] }), /expired/)
  await assert.rejects(reader({ download: async () => ({ files: [], readFile: () => '' }) }), /unexpected files/)
  await assert.rejects(reader({ download: async () => ({ files: ['context.json', 'extra.txt'], readFile: () => '{}' }) }), /unexpected files/)
  await assert.rejects(reader({ download: async () => ({ files: ['other.json'], readFile: () => '{}' }) }), /unexpected files/)
  await assert.rejects(reader({ download: async () => ({ files: ['context.json'], readFile: () => '{not json' }) }), /not valid JSON/)
})
