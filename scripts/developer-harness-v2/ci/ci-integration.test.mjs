// Developer Harness V2 — Phase 8 tests for the CI runner (run-ci-suites.mjs).
// Every negative case runs REAL `node --test` child processes against disposable fixture files in a temp directory, or feeds a
// stub executor; nothing touches the repository, GitHub or any environment. Run:
//   node --test scripts/developer-harness-v2/ci/ci-integration.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { SUITES } from '../testing/catalog.mjs'
import { HARNESS_ALL } from '../testing/rules.mjs'
import { RESULT } from '../testing/runner.mjs'
import { ALLOWED_SKIPS, BASELINE_SUITE_IDS, HARNESS_DIR, KNOWN_PARTIAL_DIAGNOSTICS, MAX_ALLOWED_SKIPS, checkRegistry, discoverHarnessTestFiles, evaluateRun,
  finalize, formatReport, looksLikeTestFile, main, parseEvents, runAll, validateAllowlist, withReporters } from './run-ci-suites.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const RUNNER = path.join(HERE, 'run-ci-suites.mjs')
const harnessSuites = SUITES.filter((s) => s.id.startsWith('harness.'))
const registeredFiles = harnessSuites.flatMap((s) => s.steps[0].files)

// ── Fixture harness: a temp "repository" with fixture test files and catalog-shaped suites ─────────────────────────────────────
function fixtureRepo(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dhv2-ci-fixture-'))
  for (const [rel, src] of Object.entries(files)) { const abs = path.join(root, HARNESS_DIR, rel); mkdirSync(path.dirname(abs), { recursive: true }); writeFileSync(abs, src) }
  return root
}
const suite = (id, files, timeout_ms = 60_000) => Object.freeze({ id, title: id, tier: 'lightweight', cwd: '.', areas: ['harness'], ci_jobs: [], env: 'node', timeout_ms,
  dynamic: null, requires: {}, blocked: null, discovery: 'node_test', note: '', steps: [{ kind: 'node_test', files: files.map((x) => `${HARNESS_DIR}/${x}`) }] })
/** Same shape resolveSuite returns for a harness suite, built for the fixture suites. */
const fixtureResolve = (suites, root) => (id) => {
  const s = suites.find((x) => x.id === id)
  return { ok: true, steps: [{ kind: 'node_test', argv: [process.execPath, '--test', '--test-concurrency=1', ...s.steps[0].files], cwd: root, timeout_ms: s.timeout_ms }] }
}
async function runFixture(files, { suites = null, allowlist = [], executor, timeout_ms } = {}) {
  const root = fixtureRepo(files)
  try {
    const ss = suites ?? [suite('harness.fixture', Object.keys(files), timeout_ms)]
    const ids = ss.map((s) => s.id)
    const rep = await runAll({ root, suites: ss, harnessAll: ids, baselineSuiteIds: ids, allowlist, resolve: fixtureResolve(ss, root), ...(executor ? { executor } : {}), log: () => {} })
    return rep
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const PASS = "import test from 'node:test'\ntest('a passes', () => {})\ntest('b passes', () => {})\n"
const allowEntry = (file, name, reason, extra = {}) => ({ file: `${HARNESS_DIR}/${file}`, name, nesting: 0, reason, why: 'fixture: historical evidence unavailable', ...extra })
const problemsOf = (rep) => [...rep.summary.problems, ...rep.results.flatMap((r) => r.problems)]
const hasProblem = (rep, prefix) => problemsOf(rep).some((p) => p.startsWith(prefix))

// ── The real registry and allowlist ───────────────────────────────────────────────────────────────────────────────────────────
test('the real registry is complete: every harness test file is run by exactly one suite, and every baseline suite is present', () => {
  const discovered = discoverHarnessTestFiles(ROOT)
  assert.deepEqual(checkRegistry({ discovered }), [])
  assert.ok(discovered.includes(`${HARNESS_DIR}/ci/ci-integration.test.mjs`), 'this file is itself registered')
  for (const id of BASELINE_SUITE_IDS) assert.ok(HARNESS_ALL.includes(id))
})

test('the real allowlist is exactly five plain entries inside registered files, and each named test exists verbatim', () => {
  assert.equal(ALLOWED_SKIPS.length, 5); assert.equal(MAX_ALLOWED_SKIPS, 5)
  assert.deepEqual(validateAllowlist(ALLOWED_SKIPS, registeredFiles), [])
  assert.ok(Object.isFrozen(ALLOWED_SKIPS) && ALLOWED_SKIPS.every(Object.isFrozen))
  for (const a of ALLOWED_SKIPS) {
    const src = readFileSync(path.join(ROOT, a.file), 'utf8')
    assert.ok(src.includes(`test('${a.name}'`), `${a.file} declares "${a.name}"`)
    assert.match(a.why, /squash-merged/)
  }
  for (const d of KNOWN_PARTIAL_DIAGNOSTICS) assert.ok(readFileSync(path.join(ROOT, d.file), 'utf8').includes(`t.diagnostic('${d.message}')`))
})

test('a tampered or broadened allowlist is rejected before anything runs', () => {
  const base = ALLOWED_SKIPS[0]
  const cases = {
    wildcard_name: [{ ...base, name: '*' }],
    wildcard_reason: [{ ...base, reason: 'not in local history*' }],
    regex_value: [{ ...base, name: /manifest/ }],
    extra_key: [{ ...base, match: 'substring' }],
    missing_key: [{ file: base.file, name: base.name, nesting: 0, reason: base.reason }],
    nested_level: [{ ...base, nesting: 1 }],
    unregistered_file: [{ ...base, file: 'scripts/other.test.mjs' }],
    whole_suite: [{ ...base, name: '' }],
    duplicate: [base, base],
    too_many: [...ALLOWED_SKIPS, { ...base, name: `${base.name} (copy)` }],
    not_array: 'everything',
  }
  for (const [label, list] of Object.entries(cases)) assert.notDeepEqual(validateAllowlist(list, registeredFiles), [], label)
})

test('registry drift fails closed: unregistered, missing, duplicated, unsupported or removed tests and suites', () => {
  const discovered = discoverHarnessTestFiles(ROOT)
  const expectProblem = (args, code) => assert.ok(checkRegistry(args).some((p) => p.startsWith(code)), code)
  expectProblem({ discovered: [...discovered, `${HARNESS_DIR}/new-thing.test.mjs`] }, 'DISCOVERY.UNREGISTERED_TEST_FILE')
  expectProblem({ discovered: [...discovered, `${HARNESS_DIR}/new-thing.test.js`] }, 'DISCOVERY.UNSUPPORTED_TEST_FILE')
  // Independent review L2: every name node --test would treat as a test is discovered (and so must be registered or fail).
  for (const name of ['foo-test.mjs', 'foo_test.mjs', 'test-foo.mjs', 'test.mjs', 'foo.spec.mjs', 'foo.test.cjs']) assert.ok(looksLikeTestFile([''], name), name)
  assert.ok(looksLikeTestFile(['context', 'test'], 'helpers.mjs'), 'anything under a test/ directory')
  for (const name of ['policy-engine.mjs', 'testing.mjs', 'latest.mjs', 'contest.mjs', 'fixtures-baseline-pre-m1.json', 'corpus.json']) assert.ok(!looksLikeTestFile(['testing'], name), name)
  expectProblem({ discovered: [...discovered, `${HARNESS_DIR}/foo-test.mjs`] }, 'DISCOVERY.UNSUPPORTED_TEST_FILE')
  expectProblem({ discovered: discovered.filter((x) => !x.endsWith('policy-engine.test.mjs')) }, 'REGISTRY.MISSING_TEST_FILE')
  expectProblem({ discovered: [] }, 'DISCOVERY.NO_TEST_FILES')
  const dup = SUITES.map((s) => (s.id === 'harness.routing' ? { ...s, steps: [{ kind: 'node_test', files: [...s.steps[0].files, `${HARNESS_DIR}/contract.test.mjs`] }] } : s))
  expectProblem({ suites: dup, discovered }, 'REGISTRY.DUPLICATE_OWNER')
  // Deleting a whole suite together with its files and its HARNESS_ALL entry is still caught by the baseline suite list.
  const policyFiles = SUITES.find((s) => s.id === 'harness.policy').steps[0].files
  expectProblem({ suites: SUITES.filter((s) => s.id !== 'harness.policy'), harnessAll: HARNESS_ALL.filter((x) => x !== 'harness.policy'), discovered: discovered.filter((x) => !policyFiles.includes(x)) }, 'REGISTRY.BASELINE_SUITE_MISSING:harness.policy')
  expectProblem({ discovered, harnessAll: HARNESS_ALL.filter((x) => x !== 'harness.testing') }, 'REGISTRY.HARNESS_ALL_MISMATCH')
  const blocked = SUITES.map((s) => (s.id === 'harness.context' ? { ...s, blocked: { code: 'X', reason: 'skip it in CI' } } : s))
  expectProblem({ suites: blocked, discovered }, 'REGISTRY.NOT_RUNNABLE_IN_CI:harness.context')
  const twoSteps = SUITES.map((s) => (s.id === 'harness.context' ? { ...s, steps: [...s.steps, s.steps[0]] } : s))
  expectProblem({ suites: twoSteps, discovered }, 'REGISTRY.STEP_SHAPE:harness.context')
})

// ── End-to-end through real node --test child processes ───────────────────────────────────────────────────────────────────────
test('all-passing fixture suites pass, run strictly one suite at a time, with fixed reporter flags added to the resolved argv', async () => {
  const seen = []
  const files = { 'one.test.mjs': PASS, 'two.test.mjs': PASS }
  const suites = [suite('harness.one', ['one.test.mjs']), suite('harness.two', ['two.test.mjs'])]
  let running = 0
  const { spawnStep } = await import('../testing/runner.mjs')
  const executor = async (step, o) => { running += 1; assert.equal(running, 1, 'never concurrent'); seen.push(step); try { return await spawnStep(step, o) } finally { running -= 1 } }
  const rep = await runFixture(files, { suites, executor })
  assert.equal(rep.summary.ok, true, formatReport(rep))
  assert.deepEqual(rep.results.map((r) => [r.suite, r.status, r.counts.passed]), [['harness.one', 'PASSED', 2], ['harness.two', 'PASSED', 2]])
  for (const s of seen) {
    assert.deepEqual(s.argv.slice(0, 5), [process.execPath, '--test', '--test-concurrency=1', '--test-reporter=spec', '--test-reporter-destination=stdout'])
    assert.ok(!s.argv.some((a) => /shell|--eval|-e$|\|\|/.test(a)))
    assert.match(s.env.NODE_OPTIONS, /--max-old-space-size=2048/)
    assert.ok(!Object.keys(s.env).some((k) => /TOKEN|SECRET|GITHUB_|SUPABASE/i.test(k)), 'allowlisted environment only')
  }
})

test('a deliberately failing harness test fails the run (and the CLI exit code)', async () => {
  const rep = await runFixture({ 'bad.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert'\ntest('ok', () => {})\ntest('broken', () => assert.equal(1, 2))\n" })
  assert.equal(rep.summary.ok, false)
  assert.ok(hasProblem(rep, 'RESULT.TEST_FAILED') && hasProblem(rep, 'EXEC.EXIT_CODE:1'))
  assert.deepEqual(rep.results[0].failures.map((x) => x.name), ['broken'])
  assert.match(formatReport(rep), /RESULT: FAIL/)
})

test('crash, top-level throw, empty file, skip-only file and todo all fail closed', async () => {
  const cases = {
    crash: ['process.exit(3)\n', 'RESULT.FILE_NOT_EXECUTED'],
    zero_exit_without_tests: ['process.exit(0)\n', 'RESULT.FILE_NOT_EXECUTED'],
    throw: ["throw new Error('boom at import')\n", 'RESULT.FILE_NOT_EXECUTED'],
    empty: ['// no tests here\n', 'RESULT.FILE_NOT_EXECUTED'],
    skip_only: ["import test from 'node:test'\ntest('s', (t) => t.skip('nothing ran'))\n", 'RESULT.NO_PASSING_TEST'],
    todo: ["import test from 'node:test'\ntest('a', () => {})\ntest('later', { todo: 'not written' }, () => {})\n", 'RESULT.TODO'],
  }
  for (const [label, [src, code]] of Object.entries(cases)) {
    const rep = await runFixture({ 'x.test.mjs': src })
    assert.equal(rep.summary.ok, false, label)
    assert.ok(hasProblem(rep, code), `${label}: ${problemsOf(rep).join(', ')}`)
  }
})

test('a hanging suite is killed at its timeout and fails', async () => {
  const rep = await runFixture({ 'hang.test.mjs': "import test from 'node:test'\ntest('a', () => {})\ntest('hangs', () => new Promise(() => { setInterval(() => {}, 1000) }))\n" }, { timeout_ms: 4000 })
  assert.equal(rep.summary.ok, false)
  assert.ok(hasProblem(rep, `EXEC.${RESULT.TIMED_OUT}`), problemsOf(rep).join(', '))
})

test('skips: unexpected ones fail; exact allowlisted ones pass but are reported as NOT EXECUTED and never counted as passed', async () => {
  const src = "import test from 'node:test'\ntest('real', () => {})\ntest('history check', (t) => { t.skip('source commit not in local history') })\n"
  const unexpected = await runFixture({ 'h.test.mjs': src })
  assert.equal(unexpected.summary.ok, false)
  assert.ok(hasProblem(unexpected, 'SKIP.UNEXPECTED'))

  const allowlist = [allowEntry('h.test.mjs', 'history check', 'source commit not in local history')]
  const ok = await runFixture({ 'h.test.mjs': src }, { allowlist })
  assert.equal(ok.summary.ok, true, formatReport(ok))
  assert.equal(ok.results[0].counts.passed, 1, 'the skipped test is not a pass')
  assert.equal(ok.results[0].counts.skipped, 1)
  assert.deepEqual(ok.results[0].allowed_skips.map((x) => x.name), ['history check'])
  assert.match(formatReport(ok), /NOT EXECUTED, not counted as passed\): 1\n {2}- .*history check/)

  for (const [label, entry] of Object.entries({
    other_reason: allowEntry('h.test.mjs', 'history check', 'some other reason entirely'),
    other_name: allowEntry('h.test.mjs', 'history check (renamed)', 'source commit not in local history'),
    other_file: allowEntry('g.test.mjs', 'history check', 'source commit not in local history'),
  })) {
    const rep = await runFixture({ 'h.test.mjs': src, 'g.test.mjs': PASS }, { allowlist: [entry] })
    assert.equal(rep.summary.ok, false, label)
  }
  const extra = await runFixture({ 'h.test.mjs': `${src}test('second', (t) => { t.skip('source commit not in local history') })\n` }, { allowlist })
  assert.equal(extra.summary.ok, false, 'an additional skip with the same reason is still unexpected')
  const nested = await runFixture({ 'h.test.mjs': "import test from 'node:test'\ntest('real', () => {})\ntest('p', async (t) => { await t.test('history check', (c) => c.skip('source commit not in local history')) })\n" }, { allowlist })
  assert.equal(nested.summary.ok, false, 'same name and reason at a different nesting level is not allowed')
})

test('an allowlisted test that now passes is reported; one that disappears or fails fails the run', async () => {
  const allowlist = [allowEntry('h.test.mjs', 'history check', 'source commit not in local history')]
  const passes = await runFixture({ 'h.test.mjs': "import test from 'node:test'\ntest('history check', () => {})\n" }, { allowlist })
  assert.equal(passes.summary.ok, true)
  assert.deepEqual(passes.summary.known_skip_now_passes.map((x) => x.name), ['history check'])
  assert.match(formatReport(passes), /Allowed skips that now pass: 1/)
  const gone = await runFixture({ 'h.test.mjs': PASS }, { allowlist })
  assert.ok(hasProblem(gone, 'ALLOWLIST.ENTRY_NOT_OBSERVED'))
  const fails = await runFixture({ 'h.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert'\ntest('ok', () => {})\ntest('history check', () => assert.fail('x'))\n" }, { allowlist })
  assert.equal(fails.summary.ok, false)
})

test('the known partial-execution diagnostic is reported by exact file and message only', () => {
  const d = KNOWN_PARTIAL_DIAGNOSTICS[0]
  const abs = path.join(ROOT, d.file)
  const ev = (message, file = abs) => ({ event: 'test:diagnostic', file, nesting: 1, message })
  const summary = { event: 'test:summary', file: abs, counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 }, success: true }
  const run = (events) => evaluateRun({ suiteId: 's', files: [d.file], root: ROOT, exec: { status: RESULT.PASSED, exit_code: 0, signal: null }, parsed: { events: [{ event: 'test:pass', name: 't', nesting: 0, file: abs, skip: null, todo: null }, ...events, summary, { event: 'test:summary', file: null, counts: summary.counts, success: true }, { event: 'reporter:end' }], problems: [] } })
  assert.equal(run([ev(d.message)]).partial.length, 1)
  assert.equal(run([ev(`${d.message} (extra)`)]).partial.length, 0)
  assert.equal(run([ev(d.message.slice(0, 20))]).partial.length, 0)
})

// ── Inconclusive results (stub executor: no real process) ─────────────────────────────────────────────────────────────────────
test('missing, truncated or unparseable results and masked exit statuses fail closed', async () => {
  const ok = { status: RESULT.PASSED, exit_code: 0, signal: null, output: '', duration_ms: 1 }
  const writeEvents = (text) => async (step) => { const dest = step.argv.find((a) => a.startsWith('--test-reporter-destination=') && !a.endsWith('=stdout')).split('=').slice(1).join('='); if (text !== null) writeFileSync(dest, text); return ok }
  const missing = await runFixture({ 'a.test.mjs': PASS }, { executor: writeEvents(null) })
  assert.ok(hasProblem(missing, 'RESULT.MISSING'))
  const truncated = await runFixture({ 'a.test.mjs': PASS }, { executor: writeEvents('{"event":"test:pass","name":"a","nesting":0,"file":null,"skip":null,"todo":null}\n') })
  assert.ok(hasProblem(truncated, 'RESULT.TRUNCATED'))
  const garbage = await runFixture({ 'a.test.mjs': PASS }, { executor: writeEvents('not json\n{"event":"reporter:end"}\n') })
  assert.ok(hasProblem(garbage, 'RESULT.UNPARSEABLE'))
  // A real, fully passing result whose exit status says failure (or a signal) is still a failure.
  const { spawnStep } = await import('../testing/runner.mjs')
  for (const [label, patch, code] of [['exit', { exit_code: 1, status: RESULT.FAILED }, 'EXEC.EXIT_CODE:1'], ['signal', { signal: 'SIGKILL', exit_code: null, status: RESULT.FAILED }, 'EXEC.SIGNAL'], ['interrupted', { status: RESULT.INTERRUPTED }, 'EXEC.INTERRUPTED']]) {
    const rep = await runFixture({ 'a.test.mjs': PASS }, { executor: async (s, o) => ({ ...(await spawnStep(s, o)), ...patch }) })
    assert.equal(rep.summary.ok, false, label)
    assert.ok(hasProblem(rep, code), `${label}: ${problemsOf(rep).join(', ')}`)
  }
  assert.ok(parseEvents('').problems.includes('RESULT.MISSING'))
})

test('a count mismatch or a result for an unexpected file fails closed', () => {
  const file = `${HARNESS_DIR}/a.test.mjs`; const abs = path.join(ROOT, file)
  const counts = { tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0 }
  const base = [{ event: 'test:pass', name: 'a', nesting: 0, file: abs, skip: null, todo: null }, { event: 'test:summary', file: abs, counts, success: true }]
  const exec = { status: RESULT.PASSED, exit_code: 0, signal: null }
  const judge = (events) => evaluateRun({ suiteId: 's', files: [file], root: ROOT, exec, parsed: parseEvents(events.map((e) => JSON.stringify(e)).join('\n') + '\n{"event":"reporter:end"}\n') })
  assert.deepEqual(judge([...base, { event: 'test:summary', file: null, counts, success: true }]).problems, [])
  assert.ok(judge([...base, { event: 'test:summary', file: null, counts: { ...counts, tests: 3 }, success: true }]).problems.includes('RESULT.COUNT_MISMATCH'))
  assert.ok(judge(base).problems.includes('RESULT.GLOBAL_SUMMARY_MISSING'))
  assert.ok(judge([...base, { event: 'test:pass', name: 'x', nesting: 0, file: path.join(ROOT, 'elsewhere.test.mjs'), skip: null, todo: null }, { event: 'test:summary', file: null, counts, success: true }]).problems.some((p) => p.startsWith('RESULT.UNEXPECTED_FILE')))
  assert.equal(finalize([]).ok, false, 'running nothing is never a pass')
})

test('the CLI accepts no arguments and the reporter flags point at this runner', async () => {
  const r = spawnSync(process.execPath, [RUNNER, '--skip', 'harness.policy'], { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '' } })
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stdout, /accepts no arguments/)
  assert.equal(await main(['--anything'], { log: () => {} }), 2)
  const argv = withReporters([process.execPath, '--test', '--test-concurrency=1', 'a.test.mjs'], '/tmp/x.jsonl')
  assert.equal(argv.at(-1), 'a.test.mjs')
  assert.equal(argv.at(-2), '--test-reporter-destination=/tmp/x.jsonl')
  assert.match(argv.at(-3), /^--test-reporter=file:.*run-ci-suites\.mjs$/)
})
