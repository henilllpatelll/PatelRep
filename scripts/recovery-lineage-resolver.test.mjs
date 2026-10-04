import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_AUTOMATIC_REPAIR_ATTEMPTS,
  PUBLISHER_EMAIL,
  formatTrailers,
  parseTrailers,
} from './recovery-lineage.mjs'
import { resolveRepairContext } from './resolve-release-engineer-context.mjs'

// Phase 2B: deterministic recovery lineage and bounded automatic retries.
const REPO = 'acme/patelrep'
const MAIN_SHA = 'a'.repeat(40)
const PR_SHA = 'b'.repeat(40)
const OTHER_SHA = 'd'.repeat(40)
const RELEASE_SHA = 'c'.repeat(40)
const ROOT = '37170000001'

const prHead = (overrides = {}) => ({ sha: PR_SHA, ref: 'feature/x', repo: { full_name: REPO }, ...overrides })
const openPr = (overrides = {}) => ({ number: 12, state: 'open', base: { ref: 'main' }, head: prHead(), ...overrides })
const recoveryPr = (root) => openPr({ number: 40, head: prHead({ ref: `claude/recovery-${root}` }) })
const managedCommit = (root, attempt, { authorEmail = PUBLISHER_EMAIL } = {}) => ({
  message: `fix: automated repair\n\nbody\n\n${formatTrailers({ root, attempt, sourceRun: '37170000009' })}\n`,
  authorEmail,
})
const humanCommit = { message: 'human change\n', authorEmail: 'dev@example.com' }

const makeDeps = ({ pr = openPr(), artifact, commit = humanCommit } = {}) => ({
  getPr: async () => pr,
  listOpenPrsForBranch: async () => [],
  readArtifactJson: async () => {
    if (artifact === undefined) throw new Error('release-engineer context: artifact is missing')
    return artifact
  },
  commitExists: async () => true,
  getCommit: async () => commit,
})

const resolve = (run, deps, eventName = 'workflow_run') =>
  resolveRepairContext({ eventName, run, repo: REPO, fallbackSha: MAIN_SHA, currentRunId: '9' }, deps)

const ciOn = (id, branch, pullRequests = [{ number: 40 }]) => ({
  id, name: 'CI', head_sha: PR_SHA, head_branch: branch, head_repository: { full_name: REPO }, pull_requests: pullRequests,
})
const stagingRun = (id) => ({ id, name: 'Staging Candidate', head_sha: MAIN_SHA, head_branch: 'main', head_repository: { full_name: REPO } })
const stagingArtifact = (branch, number = '40') => ({ pr_number: number, candidate_sha: PR_SHA, candidate_branch: branch, ci_run_id: '77' })
const recoveryBranch = `claude/recovery-${ROOT}`

test('an initial main failure is attempt 1 with a new root and recovery branch', async () => {
  const run = { id: 37170000001, name: 'CI', head_sha: MAIN_SHA, head_branch: 'main', head_repository: { full_name: REPO }, pull_requests: [] }
  const result = await resolve(run, makeDeps())
  assert.deepEqual(
    [result.rootFailedRunId, result.repairAttempt, result.repairBranch, result.skip, result.automaticRetryAllowed],
    [ROOT, 1, recoveryBranch, false, true],
  )
})

test('managed CI failure of attempt 1 becomes attempt 2 on the same root, branch and PR', async () => {
  const result = await resolve(ciOn(37170000002, recoveryBranch), makeDeps({ pr: recoveryPr(ROOT), commit: managedCommit(ROOT, 1) }))
  assert.deepEqual(
    [result.rootFailedRunId, result.failedRunId, result.repairAttempt, result.repairBranch, result.repairPrNumber, result.skip],
    [ROOT, '37170000002', 2, recoveryBranch, '40', false],
  )
})

test('managed staging failure of attempt 1 becomes attempt 2; root survives CI then Staging failures', async () => {
  const pr = recoveryPr(ROOT)
  const staging = await resolve(stagingRun(37170000003), makeDeps({ pr, artifact: stagingArtifact(recoveryBranch), commit: managedCommit(ROOT, 1) }))
  assert.deepEqual([staging.rootFailedRunId, staging.repairAttempt, staging.repairBranch], [ROOT, 2, recoveryBranch])
  const next = await resolve(ciOn(37170000004, recoveryBranch), makeDeps({ pr, commit: managedCommit(ROOT, 2) }))
  assert.deepEqual([next.rootFailedRunId, next.repairAttempt, next.skip], [ROOT, 3, false])
})

test('the third attempt is the last automatic one and attempt 4 is denied', async () => {
  assert.equal(MAX_AUTOMATIC_REPAIR_ATTEMPTS, 3)
  const pr = recoveryPr(ROOT)
  const third = await resolve(ciOn(37170000005, recoveryBranch), makeDeps({ pr, commit: managedCommit(ROOT, 2) }))
  assert.deepEqual([third.repairAttempt, third.skip, third.automaticRetryAllowed, third.retryExhausted], [3, false, true, false])
  const fourth = await resolve(ciOn(37170000006, recoveryBranch), makeDeps({ pr, commit: managedCommit(ROOT, 3) }))
  assert.deepEqual([fourth.repairAttempt, fourth.skip, fourth.automaticRetryAllowed, fourth.retryExhausted], [4, true, false, true])
  const stagingFourth = await resolve(stagingRun(37170000007), makeDeps({ pr, artifact: stagingArtifact(recoveryBranch), commit: managedCommit(ROOT, 3) }))
  assert.equal(stagingFourth.skip, true)
})

test('manual dispatch may continue past the automatic limit and is marked manual', async () => {
  const run = { ...ciOn(37170000008, recoveryBranch), status: 'completed', conclusion: 'failure' }
  const result = await resolve(run, makeDeps({ pr: recoveryPr(ROOT), commit: managedCommit(ROOT, 3) }), 'workflow_dispatch')
  assert.deepEqual([result.repairAttempt, result.skip, result.manual, result.automaticRetryAllowed, result.rootFailedRunId], [4, false, true, true, ROOT])
})

test('a recovery branch whose name root disagrees with the commit root fails closed', async () => {
  const deps = makeDeps({ pr: recoveryPr(ROOT), commit: managedCommit('37179999999', 1) })
  await assert.rejects(resolve(ciOn(37170000010, recoveryBranch), deps), /disagrees/)
})

test('malformed, partial, forged, or missing trailers on managed branches fail closed', async () => {
  const run = ciOn(37170000011, recoveryBranch)
  const withCommit = (commit) => makeDeps({ pr: recoveryPr(ROOT), commit })
  const trailers = (attempt) => `x\n\nPatelRep-Recovery-Root: ${ROOT}\nPatelRep-Recovery-Attempt: ${attempt}\nPatelRep-Recovery-Source-Run: 1\n`
  await assert.rejects(resolve(run, withCommit({ message: trailers('two'), authorEmail: PUBLISHER_EMAIL })), /malformed attempt/)
  await assert.rejects(resolve(run, withCommit({ message: `x\n\nPatelRep-Recovery-Root: ${ROOT}\n`, authorEmail: PUBLISHER_EMAIL })), /incomplete/)
  await assert.rejects(resolve(run, withCommit(humanCommit)), /no trusted recovery lineage/)
  await assert.rejects(resolve(run, withCommit(managedCommit(ROOT, 1, { authorEmail: 'attacker@example.com' }))), /not on a trusted-publisher commit/)
})

test('an existing non-recovery PR is repaired in place and keeps its root across CI and Staging retries', async () => {
  const first = await resolve(ciOn(37170000020, 'feature/x', [{ number: 12 }]), makeDeps())
  assert.deepEqual([first.rootFailedRunId, first.repairAttempt, first.repairBranch, first.repairPrNumber], ['37170000020', 1, 'feature/x', '12'])
  const retried = await resolve(ciOn(37170000021, 'feature/x', [{ number: 12 }]), makeDeps({ commit: managedCommit('37170000020', 1) }))
  assert.deepEqual([retried.rootFailedRunId, retried.repairAttempt, retried.repairBranch, retried.repairPrNumber], ['37170000020', 2, 'feature/x', '12'])
  const stagingRetry = await resolve(stagingRun(37170000022), makeDeps({ artifact: stagingArtifact('feature/x', '12'), commit: managedCommit('37170000020', 1) }))
  assert.deepEqual([stagingRetry.rootFailedRunId, stagingRetry.repairAttempt, stagingRetry.repairBranch], ['37170000020', 2, 'feature/x'])
})

test('a human commit on a normal branch starts a fresh root; a stale PR head fails closed', async () => {
  const fresh = await resolve(ciOn(37170000030, 'feature/x', [{ number: 12 }]), makeDeps())
  assert.deepEqual([fresh.rootFailedRunId, fresh.repairAttempt], ['37170000030', 1])
  const moved = openPr({ head: prHead({ sha: OTHER_SHA }) })
  await assert.rejects(resolve(ciOn(37170000031, 'feature/x', [{ number: 12 }]), makeDeps({ pr: moved, commit: managedCommit('37170000020', 1) })), /no longer matches/)
})

test('main-based failures always start a NEW root and never read commit trailers', async () => {
  const deps = {
    ...makeDeps({ artifact: { release_sha: RELEASE_SHA, pr_number: '' } }),
    getCommit: async () => { throw new Error('must not read main commit trailers') },
  }
  const mainRun = (id, name, extra = {}) => ({ id, name, head_sha: MAIN_SHA, head_branch: 'main', head_repository: { full_name: REPO }, ...extra })
  const runs = [
    mainRun(37170000040, 'Deploy Health Check'),
    mainRun(37170000041, 'Production Migration Evidence Audit'),
    mainRun(37170000042, 'Production Release'),
    mainRun(37170000043, 'CI', { pull_requests: [] }),
  ]
  for (const run of runs) {
    const result = await resolve(run, deps)
    assert.deepEqual([result.rootFailedRunId, result.repairAttempt, result.skip, result.repairBranch], [String(run.id), 1, false, `claude/recovery-${run.id}`])
  }
  await assert.rejects(resolve(mainRun(37170000044, 'Deploy Health Check', { head_branch: recoveryBranch }), deps), /recovery branch without an open PR/)
})

test('trailers round-trip strictly and reject duplicates or misplacement', () => {
  const block = formatTrailers({ root: ROOT, attempt: 2, sourceRun: '37170000009' })
  assert.deepEqual(parseTrailers(`subject\n\nbody\n\n${block}\n`), { root: ROOT, attempt: 2, sourceRun: '37170000009' })
  assert.equal(parseTrailers('subject\n\nno trailers\n'), null)
  assert.throws(() => parseTrailers(`subject\n\n${block}\nPatelRep-Recovery-Attempt: 3\n`), /duplicate/)
  assert.throws(() => parseTrailers(`subject\n${block}\n\ntrailing prose\n`), /incomplete or misplaced/)
  assert.throws(() => formatTrailers({ root: 'main', attempt: 1, sourceRun: '1' }), /invalid root/)
  assert.throws(() => formatTrailers({ root: ROOT, attempt: 0, sourceRun: '1' }), /invalid attempt/)
})
