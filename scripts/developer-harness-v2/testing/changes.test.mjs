// Developer Harness V2 — Phase 6 changed-file collection tests. Disposable local git repositories only; no remote, no real worktree.
// Run: node --test scripts/developer-harness-v2/testing/changes.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LARGE_DIFF_FILES, buildRepoIndex, changeSetFromEntries, collectChanges, normalizeChangedPath } from './changes.mjs'

const tmp = []
test.after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }) })
const G = (root, ...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const put = (root, rel, text = 'x\n') => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text) }
function mkRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dhv2-p6c-')); tmp.push(root)
  G(root, 'init', '-q', '-b', 'main')
  for (const f of ['apps/web/lib/a.ts', 'apps/web/lib/old.ts', 'apps/api/routers/r.py', 'apps/api/tests/smoke/test_gone.py', 'docs/readme.txt']) put(root, f, `${f}\n`)
  G(root, 'add', '-A'); G(root, 'commit', '-q', '-m', 'base')
  const base = G(root, 'rev-parse', 'HEAD')
  G(root, 'checkout', '-q', '-b', 'task/x')
  return { root, base }
}

test('committed, staged, unstaged and untracked changes are all reported with their real status', () => {
  const { root, base } = mkRepo()
  put(root, 'apps/web/lib/committed.ts'); G(root, 'add', '-A'); G(root, 'commit', '-q', '-m', 'c1')
  put(root, 'apps/web/lib/staged.ts'); G(root, 'add', 'apps/web/lib/staged.ts')
  put(root, 'apps/api/routers/r.py', 'changed\n')
  put(root, 'apps/web/lib/untracked.ts')
  const c = collectChanges(root, { base })
  assert.equal(c.ok, true)
  const by = Object.fromEntries(c.entries.map((e) => [e.path, e]))
  assert.equal(by['apps/web/lib/committed.ts'].status, 'A'); assert.deepEqual(by['apps/web/lib/committed.ts'].sources, ['committed'])
  assert.equal(by['apps/web/lib/staged.ts'].status, 'A'); assert.ok(by['apps/web/lib/staged.ts'].sources.includes('staged'))
  assert.equal(by['apps/api/routers/r.py'].status, 'M'); assert.ok(by['apps/api/routers/r.py'].sources.includes('unstaged'))
  assert.equal(by['apps/web/lib/untracked.ts'].untracked, true)
  assert.equal(c.base_examined, true); assert.equal(c.head_sha, G(root, 'rev-parse', 'HEAD')); assert.equal(c.branch, 'task/x')
  assert.match(c.tree_digest, /^[0-9a-f]{64}$/); assert.equal(c.dirty, true)
})

test('a rename carries BOTH the old and the new path; a deletion stays a deletion', () => {
  const { root, base } = mkRepo()
  G(root, 'mv', 'apps/web/lib/old.ts', 'apps/web/lib/renamed.ts')
  unlinkSync(path.join(root, 'apps/api/tests/smoke/test_gone.py'))
  G(root, 'add', '-A'); G(root, 'commit', '-q', '-m', 'rename+delete')
  const c = collectChanges(root, { base })
  assert.equal(c.ok, true)
  const r = c.entries.find((e) => e.path === 'apps/web/lib/renamed.ts')
  assert.equal(r.status, 'R'); assert.equal(r.old_path, 'apps/web/lib/old.ts')
  assert.ok(c.all_paths.includes('apps/web/lib/old.ts') && c.all_paths.includes('apps/web/lib/renamed.ts'))
  assert.equal(c.entries.find((e) => e.path === 'apps/api/tests/smoke/test_gone.py').status, 'D')
})

test('unavailable git state, an invalid base and an unrelated base all fail closed (never "no changes")', () => {
  const notRepo = mkdtempSync(path.join(os.tmpdir(), 'dhv2-p6c-norepo-')); tmp.push(notRepo)
  assert.deepEqual(collectChanges(notRepo, { base: null }), { ok: false, code: 'GIT.STATE_UNAVAILABLE' })
  const { root } = mkRepo()
  for (const bad of ['--output=x', '-x', 'a b', 'x'.repeat(300), '$(id)']) assert.equal(collectChanges(root, { base: bad }).code, 'GIT.BASE_INVALID', bad)
  assert.equal(collectChanges(root, { base: 'does-not-exist' }).code, 'GIT.BASE_UNRESOLVED')
  G(root, 'checkout', '-q', '--orphan', 'other'); G(root, 'commit', '-q', '--allow-empty', '-m', 'orphan')
  const unrelated = G(root, 'rev-parse', 'HEAD'); G(root, 'checkout', '-q', 'task/x')
  assert.equal(collectChanges(root, { base: unrelated }).code, 'GIT.BASE_UNRESOLVED')
})

test('without a base only staged/unstaged/untracked work is visible and the result says so', () => {
  const { root } = mkRepo()
  put(root, 'apps/web/lib/new.ts')
  const c = collectChanges(root, { base: null })
  assert.equal(c.ok, true); assert.equal(c.base_examined, false); assert.equal(c.base_sha, null)
  assert.deepEqual(c.entries.map((e) => e.path), ['apps/web/lib/new.ts'])
})

test('a clean tree reports no entries but still carries identity digests', () => {
  const { root, base } = mkRepo()
  const c = collectChanges(root, { base })
  assert.equal(c.ok, true); assert.deepEqual(c.entries, []); assert.equal(c.dirty, false); assert.match(c.changed_file_digest, /^[0-9a-f]{64}$/)
})

test('collection is read-only: it leaves the index, HEAD and files untouched', () => {
  const { root, base } = mkRepo()
  put(root, 'apps/web/lib/u.ts'); G(root, 'add', 'apps/web/lib/u.ts'); put(root, 'apps/api/routers/r.py', 'edit\n')
  const before = [G(root, 'rev-parse', 'HEAD'), G(root, 'status', '--porcelain'), G(root, 'diff', '--cached')].join('|')
  collectChanges(root, { base })
  assert.equal([G(root, 'rev-parse', 'HEAD'), G(root, 'status', '--porcelain'), G(root, 'diff', '--cached')].join('|'), before)
})

test('path normalization rejects absolute, escaping, control-character and .git paths', () => {
  assert.deepEqual(normalizeChangedPath('apps\\web\\lib\\a.ts'), { ok: true, path: 'apps/web/lib/a.ts' })
  assert.deepEqual(normalizeChangedPath('./apps//web/a.ts'), { ok: true, path: 'apps/web/a.ts' })
  for (const [raw, code] of [['', 'PATH.EMPTY'], ['/etc/passwd', 'PATH.NOT_RELATIVE'], ['C:\\x', 'PATH.NOT_RELATIVE'], ['~/x', 'PATH.NOT_RELATIVE'], ['../x', 'PATH.ESCAPES_REPOSITORY'], ['a/../../x', 'PATH.ESCAPES_REPOSITORY'], ['a\0b', 'PATH.CONTROL_CHARACTER'], ['a\nb', 'PATH.CONTROL_CHARACTER'], ['.git/config', 'PATH.GIT_INTERNAL'], ['.git', 'PATH.GIT_INTERNAL'], [42, 'PATH.NOT_STRING'], [null, 'PATH.NOT_STRING']]) assert.equal(normalizeChangedPath(raw).code, code, JSON.stringify(raw))
})

test('invalid entries are kept visible (never silently dropped) and change the digest', () => {
  const ok = changeSetFromEntries(['apps/web/a.ts'])
  const bad = changeSetFromEntries(['apps/web/a.ts', '../escape', { path: 'x', status: 'Z' }, { path: 'a/b', old_path: '/abs' }])
  assert.equal(bad.invalid.length, 3); assert.deepEqual(bad.invalid.map((i) => i.code).sort(), ['PATH.ESCAPES_REPOSITORY', 'PATH.NOT_RELATIVE', 'STATUS.UNSUPPORTED'])
  assert.notEqual(bad.changed_file_digest, ok.changed_file_digest)
})

test('the changed-file digest ignores order and duplicates but reflects status and renames', () => {
  const a = changeSetFromEntries([{ path: 'b.ts', status: 'M' }, { path: 'a.ts', status: 'A' }])
  const b = changeSetFromEntries([{ path: 'a.ts', status: 'A' }, { path: 'b.ts', status: 'M' }, { path: 'a.ts', status: 'A' }])
  assert.equal(a.changed_file_digest, b.changed_file_digest)
  assert.notEqual(a.changed_file_digest, changeSetFromEntries([{ path: 'b.ts', status: 'D' }, { path: 'a.ts', status: 'A' }]).changed_file_digest)
  assert.notEqual(changeSetFromEntries([{ path: 'n.ts', status: 'R', old_path: 'o.ts' }]).changed_file_digest, changeSetFromEntries([{ path: 'n.ts', status: 'R', old_path: 'p.ts' }]).changed_file_digest)
  assert.deepEqual(changeSetFromEntries([{ path: 'n.ts', status: 'R', old_path: 'o.ts' }]).all_paths, ['n.ts', 'o.ts'])
})

test('a very large change set is flagged, not truncated', () => {
  const big = changeSetFromEntries(Array.from({ length: LARGE_DIFF_FILES + 1 }, (_, i) => `apps/web/lib/f${i}.ts`))
  assert.equal(big.too_large, true); assert.equal(big.entries.length, LARGE_DIFF_FILES + 1)
  assert.equal(changeSetFromEntries(['a.ts']).too_large, false)
})

test('the repository index records which tests read which repo paths (hidden couplings) and lists root API tests', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dhv2-p6c-idx-')); tmp.push(root)
  put(root, 'apps/mobile/lib/housekeeping/team.ts'); put(root, 'apps/api/tests/test_top.py', 'x'); put(root, '.github/workflows/ci.yml')
  put(root, 'apps/api/tests/smoke/test_a.py', 'p = REPO_ROOT / "apps/mobile/lib/housekeeping/team.ts"\nq = "apps/api/tests/smoke/test_a.py"\nz = "apps/missing/none.ts"\n')
  put(root, 'scripts/mobile-ci-workflow.test.mjs', "readFileSync('.github/workflows/ci.yml')")
  const idx = buildRepoIndex(root)
  assert.deepEqual(idx.api_root_tests, ['tests/test_top.py'])
  const find = (p) => idx.readers.find((r) => r.path === p)
  assert.deepEqual(find('apps/mobile/lib/housekeeping/team.ts').suites, ['api.smoke'])
  assert.ok(find('.github/workflows/ci.yml').suites.includes('repo.mobile_ci_workflow_contract'))
  assert.equal(find('apps/missing/none.ts'), undefined, 'paths that do not exist are not recorded')
  assert.equal(find('apps/api/tests/smoke/test_a.py'), undefined, 'a test does not read itself')
})
