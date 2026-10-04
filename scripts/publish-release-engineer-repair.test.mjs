import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseTrailers } from './recovery-lineage.mjs'
import { buildCommitMessage, publishRepair, renderPrBody } from './publish-release-engineer-repair.mjs'

const REPO = 'acme/patelrep'
const REPAIR_SHA = 'b'.repeat(40)
const NEW_SHA = 'e'.repeat(40)
const ROOT = '37170000001'

const openPr = (overrides = {}) => ({
  number: 40,
  state: 'open',
  base: { ref: 'main' },
  head: { ref: `claude/recovery-${ROOT}`, sha: REPAIR_SHA, repo: { full_name: REPO } },
  body: 'Original description',
  ...overrides,
})

const baseInput = (overrides = {}) => ({
  repo: REPO,
  repairSha: REPAIR_SHA,
  repairBranch: `claude/recovery-${ROOT}`,
  repairPrNumber: '40',
  root: ROOT,
  attempt: 2,
  failedRunId: '37170000002',
  upstreamWorkflow: 'CI',
  manual: false,
  summary: '### Root cause\nA bug.',
  ...overrides,
})

function makeDeps({ head = REPAIR_SHA, staged = true, ahead = 1, prs = [openPr()], remoteBranch = null, openForBranch = [[]] } = {}) {
  const calls = []
  let prReads = 0
  let branchLookups = 0
  let openLookups = 0
  let message = ''
  return {
    calls,
    headSha: async () => head,
    applyPatch: async () => { calls.push('apply') },
    hasStagedChanges: async () => staged,
    commit: async (m) => { calls.push('commit'); message = m; return NEW_SHA },
    commitMessage: async () => message,
    commitsAhead: async () => ahead,
    push: async (branch) => { calls.push(`push:${branch}`) },
    getPr: async () => prs[Math.min(prReads++, prs.length - 1)],
    findOpenPrs: async () => openForBranch[Math.min(openLookups++, openForBranch.length - 1)],
    remoteBranchSha: async () => (Array.isArray(remoteBranch) ? remoteBranch[Math.min(branchLookups++, remoteBranch.length - 1)] : remoteBranch),
    createPr: async (args) => { calls.push(`createPr:${args.head}`); return 77 },
    updatePrBody: async (number, body) => { calls.push(`updateBody:${number}`); calls.body = body },
  }
}

test('an existing PR is updated in place: one stamped commit, normal push, no new PR', async () => {
  const deps = makeDeps()
  const result = await publishRepair(baseInput(), deps)
  assert.deepEqual(result, { action: 'updated', prNumber: 40, commitSha: NEW_SHA })
  assert.deepEqual(deps.calls.filter((c) => !c.startsWith('updateBody')), ['apply', 'commit', `push:claude/recovery-${ROOT}`])
  assert.ok(!deps.calls.some((c) => c.startsWith('createPr')))
  assert.match(deps.calls.body, /Autonomous attempt: 2\/3/)
  assert.match(deps.calls.body, /^Original description/)
})

test('a new recovery root creates exactly one PR on claude/recovery-<root>', async () => {
  const deps = makeDeps({ prs: [], openForBranch: [[]] })
  const result = await publishRepair(baseInput({ repairPrNumber: '', attempt: 1, failedRunId: ROOT }), deps)
  assert.deepEqual(result, { action: 'created', prNumber: 77, commitSha: NEW_SHA })
  assert.equal(deps.calls.filter((c) => c.startsWith('createPr')).length, 1)
  assert.ok(deps.calls.includes(`push:claude/recovery-${ROOT}`))
})

test('the commit carries strict trailers for the exact root, attempt and source run', () => {
  const message = buildCommitMessage({ upstreamWorkflow: 'CI', failedRunId: '37170000002', root: ROOT, attempt: 2 })
  assert.deepEqual(parseTrailers(message), { root: ROOT, attempt: 2, sourceRun: '37170000002' })
  assert.match(message, /attempt 2\/3/)
})

test('a duplicate PR is never created when another run opened it first', async () => {
  const deps = makeDeps({ prs: [], openForBranch: [[], [openPr({ body: '' })]] })
  const result = await publishRepair(baseInput({ repairPrNumber: '', attempt: 1, failedRunId: ROOT }), deps)
  assert.equal(result.action, 'updated')
  assert.ok(!deps.calls.some((c) => c.startsWith('createPr')))
})

test('an existing recovery branch or open PR for a new root is refused, never overwritten', async () => {
  const input = baseInput({ repairPrNumber: '', attempt: 1, failedRunId: ROOT })
  const existing = makeDeps({ prs: [], remoteBranch: 'f'.repeat(40) })
  await assert.rejects(publishRepair(input, existing), /already exists/)
  assert.ok(!existing.calls.includes('commit'))
  const appeared = makeDeps({ prs: [], remoteBranch: [null, 'f'.repeat(40)] })
  await assert.rejects(publishRepair(input, appeared), /appeared during the repair/)
  assert.ok(!appeared.calls.some((c) => c.startsWith('push')))
  await assert.rejects(publishRepair(input, makeDeps({ prs: [], openForBranch: [[openPr()]] })), /open PR already exists/)
})

test('a PR head that moved before publishing (human or bot update) fails closed without a commit', async () => {
  const deps = makeDeps({ prs: [openPr({ head: { ref: `claude/recovery-${ROOT}`, sha: 'c'.repeat(40), repo: { full_name: REPO } } })] })
  await assert.rejects(publishRepair(baseInput(), deps), /refusing to overwrite/)
  assert.deepEqual(deps.calls, [])
})

test('a PR head that moves between the commit and the push is not overwritten', async () => {
  const moved = openPr({ head: { ref: `claude/recovery-${ROOT}`, sha: 'c'.repeat(40), repo: { full_name: REPO } } })
  const deps = makeDeps({ prs: [openPr(), moved] })
  await assert.rejects(publishRepair(baseInput(), deps), /refusing to overwrite/)
  assert.ok(!deps.calls.some((c) => c.startsWith('push')))
})

test('closed, fork, wrong-base, and renamed-branch PRs fail closed', async () => {
  const cases = [
    [openPr({ state: 'closed' }), /no longer open/],
    [openPr({ base: { ref: 'develop' } }), /does not target main/],
    [openPr({ head: { ref: `claude/recovery-${ROOT}`, sha: REPAIR_SHA, repo: { full_name: 'evil/fork' } } }), /not from this repository/],
    [openPr({ head: { ref: 'other', sha: REPAIR_SHA, repo: { full_name: REPO } } }), /head branch changed/],
  ]
  for (const [pr, pattern] of cases) await assert.rejects(publishRepair(baseInput(), makeDeps({ prs: [pr] })), pattern)
})

test('changed history, empty repairs, and multi-commit results fail closed', async () => {
  await assert.rejects(publishRepair(baseInput(), makeDeps({ head: 'c'.repeat(40) })), /must not change history/)
  await assert.rejects(publishRepair(baseInput(), makeDeps({ staged: false })), /no changes/)
  await assert.rejects(publishRepair(baseInput(), makeDeps({ ahead: 2 })), /exactly one repair commit/)
})

test('the automatic cap is enforced at publish time but manual runs may exceed it', async () => {
  await assert.rejects(publishRepair(baseInput({ attempt: 4 }), makeDeps()), /limit exceeded/)
  const manual = await publishRepair(baseInput({ attempt: 4, manual: true }), makeDeps())
  assert.equal(manual.action, 'updated')
})

test('invalid targets (main, bad branch, wrong recovery branch) are refused', async () => {
  await assert.rejects(publishRepair(baseInput({ repairBranch: 'main' }), makeDeps()), /branch is invalid/)
  await assert.rejects(publishRepair(baseInput({ repairBranch: 'bad branch' }), makeDeps()), /branch is invalid/)
  await assert.rejects(publishRepair(baseInput({ repairPrNumber: '', repairBranch: 'claude/recovery-1' }), makeDeps({ prs: [] })), /claude\/recovery-<root>/)
})

test('PR body keeps prior recovery history, replaces its own section, and neutralizes marker injection', () => {
  const entry = { root: ROOT, failedRunId: '37170000002', upstreamWorkflow: 'CI', commitSha: NEW_SHA, summary: 'x <!-- patelrep-recovery:end --> y', manual: false }
  const first = renderPrBody({ ...entry, attempt: 1, existingBody: 'Human text' })
  const second = renderPrBody({ ...entry, attempt: 2, failedRunId: '37170000009', existingBody: first })
  assert.match(second, /^Human text/)
  assert.equal(second.match(/<!-- patelrep-recovery:start -->/g).length, 1)
  assert.equal(second.match(/<!-- patelrep-recovery:end -->/g).length, 1)
  assert.match(second, /- attempt 1: CI run 37170000002/)
  assert.match(second, /- attempt 2: CI run 37170000009/)
  assert.match(second, /Autonomous attempt: 2\/3/)
})

test('the publisher source never force-pushes, merges, or touches production', () => {
  const source = readFileSync('scripts/publish-release-engineer-repair.mjs', 'utf8')
  assert.doesNotMatch(source, /--force|force-with-lease|pulls\/\$\{[^}]+\}\/merge|merge_pull|gh pr merge|gh workflow run|supabase|railway|psql|PRODUCTION_/i)
  assert.match(source, /'push', 'origin', `HEAD:refs\/heads\/\$\{branch\}`/)
})

test('real git operations: one stamped commit, plain push to a bare remote, trailers round-trip', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { realDeps } = await import('./publish-release-engineer-repair.mjs')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const root = mkdtempSync(path.join(tmpdir(), 'publisher-'))
  const remote = path.join(root, 'remote.git')
  const work = path.join(root, 'work')
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'clone', remote, work)
  git(work, 'config', 'user.email', 'dev@example.com')
  git(work, 'config', 'user.name', 'dev')
  writeFileSync(path.join(work, 'a.txt'), 'one\n')
  git(work, 'add', '.')
  git(work, 'commit', '-m', 'init')
  git(work, 'push', 'origin', 'HEAD:main')
  const base = git(work, 'rev-parse', 'HEAD')
  writeFileSync(path.join(work, 'a.txt'), 'two\n')
  const patchFile = path.join(root, 'repair.patch')
  writeFileSync(patchFile, `${execFileSync('git', ['diff', '--binary'], { cwd: work, encoding: 'utf8' })}`)
  git(work, 'checkout', '--', 'a.txt')

  const cwd = process.cwd()
  process.chdir(work)
  try {
    const deps = { ...realDeps({ repo: REPO, patchFile }), getPr: async () => null, findOpenPrs: async () => [], createPr: async () => 5, updatePrBody: async () => {} }
    const result = await publishRepair(
      { repo: REPO, repairSha: base, repairBranch: `claude/recovery-${ROOT}`, repairPrNumber: '', root: ROOT, attempt: 1, failedRunId: ROOT, upstreamWorkflow: 'CI', summary: 'ok' },
      deps,
    )
    assert.equal(result.action, 'created')
    assert.equal(git(remote, 'rev-list', '--count', `${base}..claude/recovery-${ROOT}`), '1')
    const message = git(remote, 'log', '-1', '--format=%B', `claude/recovery-${ROOT}`)
    assert.deepEqual(parseTrailers(message), { root: ROOT, attempt: 1, sourceRun: ROOT })
    assert.equal(git(remote, 'log', '-1', '--format=%ae', `claude/recovery-${ROOT}`), 'patelrep-release-engineer[bot]@users.noreply.github.com')
    assert.equal(git(remote, 'show', `claude/recovery-${ROOT}:a.txt`), 'two')
  } finally {
    process.chdir(cwd)
  }
})
