import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRepairContext } from './resolve-release-engineer-context.mjs'

const REPO = 'acme/patelrep'
const MAIN_SHA = 'a'.repeat(40)
const PR_SHA = 'b'.repeat(40)
const RELEASE_SHA = 'c'.repeat(40)
const OTHER_SHA = 'd'.repeat(40)

const prHead = (overrides = {}) => ({ sha: PR_SHA, ref: 'feature/x', repo: { full_name: REPO }, ...overrides })
const openPr = (overrides = {}) => ({ number: 12, state: 'open', base: { ref: 'main' }, head: prHead(), ...overrides })

const stagingContext = (overrides = {}) => ({
  pr_number: '12',
  candidate_sha: PR_SHA,
  candidate_branch: 'feature/x',
  ci_run_id: '77',
  ...overrides,
})

// Staging workflow_run payloads report main, not the PR candidate.
const stagingRun = { id: 500, name: 'Staging Candidate', head_sha: MAIN_SHA, head_branch: 'main', head_repository: { full_name: REPO } }

const makeDeps = ({ pr = openPr(), artifact, openPrs = [], commitKnown = true } = {}) => ({
  getPr: async () => pr,
  listOpenPrsForBranch: async () => openPrs,
  readArtifactJson: async (_runId, name) => {
    if (artifact === undefined) throw new Error(`release-engineer context: artifact ${name} is missing`)
    return artifact
  },
  commitExists: async () => commitKnown,
})

const resolve = (run, deps, eventName = 'workflow_run') =>
  resolveRepairContext({ eventName, run, repo: REPO, fallbackSha: MAIN_SHA, currentRunId: '9' }, deps)

test('staging failure resolves the candidate from the artifact, not the run head_sha', async () => {
  const result = await resolve(stagingRun, makeDeps({ artifact: stagingContext() }))
  assert.equal(result.repairSha, PR_SHA)
  assert.notEqual(result.repairSha, stagingRun.head_sha)
  assert.equal(result.repairBranch, 'feature/x')
  assert.equal(result.repairPrNumber, '12')
  assert.equal(result.rootFailedRunId, '500')
  assert.equal(result.skip, false)
})

test('staging failure fails closed when the artifact is missing', async () => {
  await assert.rejects(resolve(stagingRun, makeDeps()), /missing/)
})

test('staging failure fails closed on malformed or extra artifact fields', async () => {
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact: stagingContext({ candidate_sha: 'abc123' }) })), /40-character/)
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact: stagingContext({ pr_number: 'x' }) })), /PR number/)
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact: { ...stagingContext(), token: 'secret' } })), /unexpected fields/)
})

test('staging failure fails closed for stale SHA, changed head branch, closed PR, fork PR, and wrong base', async () => {
  const artifact = stagingContext()
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact, pr: openPr({ head: prHead({ sha: OTHER_SHA }) }) })), /no longer matches/)
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact, pr: openPr({ head: prHead({ ref: 'feature/other' }) }) })), /head branch/)
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact, pr: openPr({ state: 'closed' }) })), /not open/)
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact, pr: openPr({ head: prHead({ repo: { full_name: 'evil/fork' } }) }) })), /not from this repository/)
  await assert.rejects(resolve(stagingRun, makeDeps({ artifact, pr: openPr({ base: { ref: 'develop' } }) })), /does not target main/)
})

test('staging failure on a recovery PR is skipped automatically but allowed manually', async () => {
  const deps = makeDeps({
    artifact: stagingContext({ candidate_branch: 'claude/recovery-31' }),
    pr: openPr({ head: prHead({ ref: 'claude/recovery-31' }) }),
  })
  assert.equal((await resolve(stagingRun, deps)).skip, true)
  const manual = await resolve({ ...stagingRun, status: 'completed', conclusion: 'failure' }, deps, 'workflow_dispatch')
  assert.equal(manual.skip, false)
})

test('CI failure resolves from its exact failed SHA and revalidates its PR', async () => {
  const run = { id: 600, name: 'CI', head_sha: PR_SHA, head_branch: 'feature/x', head_repository: { full_name: REPO }, pull_requests: [{ number: 12 }] }
  const result = await resolve(run, makeDeps())
  assert.deepEqual([result.repairSha, result.repairBranch, result.repairPrNumber], [PR_SHA, 'feature/x', '12'])
  await assert.rejects(resolve(run, makeDeps({ pr: openPr({ head: prHead({ sha: OTHER_SHA }) }) })), /no longer matches/)
  await assert.rejects(resolve(run, makeDeps({ pr: openPr({ state: 'closed' }) })), /not open/)
})

test('CI failure finds the open PR by branch and uses a recovery branch on main', async () => {
  const branchRun = { id: 601, name: 'CI', head_sha: PR_SHA, head_branch: 'feature/x', head_repository: { full_name: REPO }, pull_requests: [] }
  assert.equal((await resolve(branchRun, makeDeps({ openPrs: [openPr()] }))).repairPrNumber, '12')
  const mainRun = { id: 602, name: 'CI', head_sha: MAIN_SHA, head_branch: 'main', head_repository: { full_name: REPO }, pull_requests: [] }
  const result = await resolve(mainRun, makeDeps({ openPrs: [openPr()] }))
  assert.deepEqual([result.repairSha, result.repairBranch, result.repairPrNumber], [MAIN_SHA, 'claude/recovery-602', ''])
})

test('evidence audit failure resolves from its exact failed SHA on a recovery branch', async () => {
  const run = { id: 700, name: 'Production Migration Evidence Audit', head_sha: RELEASE_SHA, head_branch: 'main', head_repository: { full_name: REPO } }
  const result = await resolve(run, makeDeps())
  assert.deepEqual([result.repairSha, result.repairBranch, result.repairPrNumber], [RELEASE_SHA, 'claude/recovery-700', ''])
})

test('production release failure resolves the exact release target, not run head_sha', async () => {
  const run = { id: 800, name: 'Production Release', head_sha: MAIN_SHA, head_branch: 'main', head_repository: { full_name: REPO } }
  const result = await resolve(run, makeDeps({ artifact: { release_sha: RELEASE_SHA, pr_number: '12' } }))
  assert.equal(result.repairSha, RELEASE_SHA)
  assert.notEqual(result.repairSha, run.head_sha)
  assert.equal(result.repairBranch, 'claude/recovery-800')
  await assert.rejects(resolve(run, makeDeps()), /missing/)
  await assert.rejects(resolve(run, makeDeps({ artifact: { release_sha: 'main', pr_number: '' } })), /40-character/)
  await assert.rejects(resolve(run, makeDeps({ artifact: { release_sha: RELEASE_SHA, pr_number: '' }, commitKnown: false })), /known commit/)
})

test('fork runs, unknown workflows, and successful manual targets are rejected', async () => {
  const fork = { id: 900, name: 'CI', head_sha: PR_SHA, head_branch: 'x', head_repository: { full_name: 'evil/fork' } }
  await assert.rejects(resolve(fork, makeDeps()), /not from this repository/)
  await assert.rejects(resolve({ ...stagingRun, name: 'Other' }, makeDeps()), /unsupported/)
  const succeeded = { ...stagingRun, status: 'completed', conclusion: 'success' }
  await assert.rejects(resolve(succeeded, makeDeps({ artifact: stagingContext() }), 'workflow_dispatch'), /did not fail/)
})

test('manual dispatch without a run id repairs from a recovery branch at the dispatched SHA', async () => {
  const result = await resolve(undefined, makeDeps(), 'workflow_dispatch')
  assert.deepEqual([result.repairSha, result.repairBranch, result.upstreamWorkflow], [MAIN_SHA, 'claude/recovery-manual-9', 'manual'])
})
