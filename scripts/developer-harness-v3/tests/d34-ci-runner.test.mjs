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
  try { const r = runAll({ files: discover(), spawn: fake }); assert.ok(r.ok, r.problems.join()); assert.equal(seen.length, EXPECTED_FILES.length); assert.ok(seen.every((a) => a.includes('--test-concurrency=1') && a[0] === '--test')) } finally { process.stdout.write = w }
  const bad = (cmd, args) => ({ status: args[2].includes('d34-glue') ? 1 : 0, stdout: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\n' }); process.stdout.write = () => true
  try { assert.equal(runAll({ files: discover(), spawn: bad }).ok, false) } finally { process.stdout.write = w }
})
