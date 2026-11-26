// D3.4 V3 CI runner: registry exactness, result judgement (no vacuous pass, no skips), environment hygiene. The runner itself is NOT run here recursively.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXPECTED_FILES, checkRegistry, discover, judge, minimalEnv, parseCounts, runAll } from '../ci/run-v3-suites.mjs'

test('the pinned list equals the discovered list: a test file cannot silently drop out of (or sneak into) CI', () => {
  assert.deepEqual(checkRegistry(), []); assert.deepEqual(discover(), [...EXPECTED_FILES].sort())
  assert.deepEqual(checkRegistry([...discover(), 'evil.test.mjs']), ['REGISTRY.UNLISTED_TEST_FILE:evil.test.mjs']); assert.deepEqual(checkRegistry(discover().slice(1)), [`REGISTRY.MISSING_TEST_FILE:${discover()[0]}`])
})

test('result judgement fails closed: unparseable output, zero tests, any failure/cancel/skip, pass-count mismatch and a non-zero exit are all failures', () => {
  const ok = parseCounts('ℹ tests 5\nℹ pass 5\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\n'); assert.deepEqual(judge(ok, 0), [])
  assert.deepEqual(judge(parseCounts('garbage'), 0), ['RESULT.UNPARSEABLE']); assert.ok(judge(parseCounts('ℹ tests 0\nℹ pass 0\nℹ fail 0\nℹ skipped 0'), 0).includes('RESULT.ZERO_TESTS'))
  assert.ok(judge(parseCounts('ℹ tests 5\nℹ pass 4\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0'), 1).includes('RESULT.FAILURES')); assert.ok(judge(parseCounts('ℹ tests 5\nℹ pass 4\nℹ fail 0\nℹ cancelled 0\nℹ skipped 1'), 0).includes('RESULT.SKIPS_NOT_ALLOWED'))
  assert.ok(judge(parseCounts('ℹ tests 5\nℹ pass 3\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0'), 0).includes('RESULT.PASS_COUNT_MISMATCH')); assert.ok(judge(ok, 1).includes('RESULT.NONZERO_EXIT:1')); assert.ok(judge(parseCounts('ℹ tests 5\nℹ pass 5\nℹ fail 0\nℹ cancelled 1\nℹ skipped 0'), 0).includes('RESULT.FAILURES'))
})

test('the child environment is rebuilt: no secrets, proxies or tokens are inherited; heap is bounded; execution is sequential per file', () => {
  process.env.DH34_CANARY_TOKEN = 'must-not-leak'; process.env.HTTPS_PROXY = 'http://example.invalid'; process.env.ANTHROPIC_API_KEY = 'sk-test'
  try { const e = minimalEnv(); assert.ok(!Object.keys(e).some((k) => /TOKEN|KEY|PROXY|SECRET/i.test(k))); assert.equal(e.NODE_OPTIONS, '--max-old-space-size=1024'); assert.equal(e.CI, 'true') } finally { delete process.env.DH34_CANARY_TOKEN; delete process.env.HTTPS_PROXY; delete process.env.ANTHROPIC_API_KEY }
  const seen = []; const fake = (cmd, args) => { seen.push(args); return { status: 0, stdout: 'ℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\n' } }
  const w = process.stdout.write; process.stdout.write = () => true
  try { const r = runAll({ files: discover(), spawn: fake }); assert.ok(r.ok, r.problems.join()); assert.equal(seen.length, EXPECTED_FILES.length); assert.ok(seen.every((a) => a.includes('--test-concurrency=1') && a.includes('--test-reporter=spec') && a[0] === '--test')) } finally { process.stdout.write = w }
  const bad = (cmd, args) => ({ status: args.at(-1).includes('d34-glue') ? 1 : 0, stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\n' }); process.stdout.write = () => true
  try { assert.equal(runAll({ files: discover(), spawn: bad }).ok, false) } finally { process.stdout.write = w }
})

test('REAL spawn on tiny fixture files: the spec-reporter output is parsed, a passing file is judged ok, a failing and a skipping file are judged bad', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
  const root = mkdtempSync(path.join(os.tmpdir(), 'dh34-ci-')); const d = path.join(root, 'scripts/developer-harness-v3/tests'); mkdirSync(d, { recursive: true })
  writeFileSync(path.join(d, 'a-ok.test.mjs'), "import {test} from 'node:test'; test('x', () => {}); test('y', () => {})")
  writeFileSync(path.join(d, 'b-fail.test.mjs'), "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('x', () => assert.equal(1, 2))")
  writeFileSync(path.join(d, 'c-skip.test.mjs'), "import {test} from 'node:test'; test('x', { skip: true }, () => {}); test('y', () => {})")
  const w = process.stdout.write; process.stdout.write = () => true
  let r; try { r = runAll({ root, files: ['a-ok.test.mjs', 'b-fail.test.mjs', 'c-skip.test.mjs'] }) } finally { process.stdout.write = w }
  const by = Object.fromEntries(r.results.map((x) => [x.file, x]))
  assert.deepEqual([by['a-ok.test.mjs'].tests, by['a-ok.test.mjs'].pass, by['a-ok.test.mjs'].problems], [2, 2, []])
  assert.ok(by['b-fail.test.mjs'].problems.includes('RESULT.FAILURES')); assert.ok(by['c-skip.test.mjs'].problems.includes('RESULT.SKIPS_NOT_ALLOWED')); assert.equal(r.ok, false)
})