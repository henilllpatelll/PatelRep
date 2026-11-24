// Developer Harness V2 — Phase 8 CI runner for every registered `harness.*` suite.
//
// Invoked by the `Release Workflow Contract` job in .github/workflows/ci.yml as
//   node scripts/developer-harness-v2/ci/run-ci-suites.mjs
// (no arguments are accepted). A non-zero exit fails that job, and CI Gate requires that job to succeed.
//
// Fail-closed rules (each one is covered by ci-integration.test.mjs):
//   * the suite list comes from the Phase 6 catalog, is checked with catalog.validateSuite, must equal rules.HARNESS_ALL and must
//     contain every baseline suite; every *.test.mjs under scripts/developer-harness-v2/ must belong to exactly one harness suite;
//   * commands come only from testing/runner.resolveSuite (argv arrays, shell:false). This file adds nothing but fixed reporter flags;
//   * suites run one at a time (`--test-concurrency=1`), the Node heap is capped by the catalog `node` env profile, the child
//     environment is the runner allowlist, and every suite has its catalog timeout;
//   * results come from structured node:test events (this module is also the reporter), not from scraping text. A non-zero exit, a
//     signal, a timeout, a missing or unparseable result, a file without its own summary (crash / no tests), a file with no passing
//     test, a todo, a count mismatch or any skip that is not EXACTLY in ALLOWED_SKIPS fails the run;
//   * allowed skips are reported separately and are never counted as passed. An allowed test that now passes is reported; an allowed
//     entry that is not observed exactly once fails the run (stale or ambiguous allowlist).
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SUITES, validateSuite } from '../testing/catalog.mjs'
import { HARNESS_ALL } from '../testing/rules.mjs'
import { RESULT, buildEnv, resolveSuite, sanitizeOutput, spawnStep } from '../testing/runner.mjs'

const SELF = fileURLToPath(import.meta.url)
export const HARNESS_DIR = 'scripts/developer-harness-v2'
/** The seven suites that existed when Phase 8 started (main eb597d55). Removing one can never pass silently. */
export const BASELINE_SUITE_IDS = Object.freeze(['harness.contract', 'harness.policy', 'harness.context', 'harness.routing', 'harness.coordination', 'harness.evaluation', 'harness.testing'])
export const MAX_ALLOWED_SKIPS = 5

const HISTORY_WHY = 'PR #247 was squash-merged into main as eb597d55; the Phase 2 / Phase 3 source commit these provenance checks compare against ' +
  '(8cccb11b944ef77b1f29897d0d7575f519f54e90) is not an ancestor of main and is absent from the CI checkout, so the historical comparison cannot execute.'
const f = (file, name, reason) => Object.freeze({ file: `${HARNESS_DIR}/${file}`, name, nesting: 0, reason, why: HISTORY_WHY })
/**
 * EXACT skips that are allowed: matched on repository-relative file, full test name, nesting level and full skip reason with `===`.
 * No patterns. Changing this list needs human approval; scripts/developer-harness-v2-ci-workflow.test.mjs pins it.
 */
export const ALLOWED_SKIPS = Object.freeze([
  f('context/archive.test.mjs', 'manifest entries match the source commit blobs (when history is available)', 'source commit not in local history'),
  f('context/archive.test.mjs', 'only approved paths were untracked relative to the source commit', 'source commit not in local history'),
  f('context/memory-curate.test.mjs', 'old-to-new mapping re-derived from the source blob (when available in local history)', 'source blob 8cccb11b944e not in local history (shallow clone)'),
  f('context/openwolf-hooks.test.mjs', 'simulated session: Phase 2 baseline hooks wrote tracked .wolf files; the Phase 3 hooks write nothing', 'Phase 2 settings not in local history'),
  f('context/openwolf-hooks.test.mjs', 'enforcement and hook source files are byte-identical to Phase 2; graphify auto_update untouched', 'Phase 2 commit not in local history'),
])
/** Exact diagnostics that mark a historical assertion skipped INSIDE a passing test. Reported only; they never count as a pass. */
export const KNOWN_PARTIAL_DIAGNOSTICS = Object.freeze([
  Object.freeze({ file: `${HARNESS_DIR}/context/openwolf-hooks.test.mjs`, message: 'SKIPPED deep-equal vs Phase 2: commit not in local history (shallow clone)' }),
])

// ── Reporter (loaded by `node --test --test-reporter=<this file>`) ──────────────────────────────────────────────────────────────
const line = (o) => `${JSON.stringify(o)}\n`
const opt = (v) => (v === undefined ? null : v)
/** node:test reporter: emits one JSON record per relevant event, then an end marker (its absence means the run was cut short). */
export default async function * ciEventReporter(source) {
  for await (const e of source) {
    const d = e?.data ?? {}
    if (e.type === 'test:pass' || e.type === 'test:fail') {
      yield line({ event: e.type, name: String(d.name), nesting: d.nesting, file: opt(d.file), skip: opt(d.skip), todo: opt(d.todo), type: opt(d.details?.type),
        failure: e.type === 'test:fail' ? String(d.details?.error?.failureType ?? 'unknown') : null })
    } else if (e.type === 'test:summary') yield line({ event: e.type, file: opt(d.file), counts: opt(d.counts), success: d.success === true })
    else if (e.type === 'test:diagnostic' && d.file) yield line({ event: e.type, file: d.file, nesting: d.nesting, message: String(d.message) })
  }
  yield line({ event: 'reporter:end' })
}

// ── Registry, allowlist and discovery checks ──────────────────────────────────────────────────────────────────────────────────
const toPosix = (p) => p.split(path.sep).join('/')
const SCRIPT_EXT = String.raw`\.[cm]?[jt]sx?$`
/** Node's default `--test` name patterns (`*.test.*`, `*-test.*`, `*_test.*`, `test-*.*`, `test.*`, anything under `test/`) plus `*.spec.*`. */
const TESTLIKE = new RegExp(String.raw`(^|[.\-_])(test|spec)${SCRIPT_EXT}|^test[.\-_]|^test${SCRIPT_EXT}`)
export const looksLikeTestFile = (relDirSegments, name) => new RegExp(SCRIPT_EXT).test(name) && (TESTLIKE.test(name) || relDirSegments.includes('test'))
/** Every file under scripts/developer-harness-v2 that looks like a test to node --test, plus any symlink (directories are not followed through links). */
export function discoverHarnessTestFiles(root) {
  const found = []
  const base = path.join(root, HARNESS_DIR)
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.isSymbolicLink() || looksLikeTestFile(toPosix(path.relative(base, dir)).split('/'), e.name)) found.push(toPosix(path.relative(root, abs)))
    }
  }
  walk(path.join(root, HARNESS_DIR))
  return found.sort()
}

/** Problems with the harness suite registry; an empty list means every discovered test file is run exactly once. */
export function checkRegistry({ suites = SUITES, harnessAll = HARNESS_ALL, discovered, baselineSuiteIds = BASELINE_SUITE_IDS } = {}) {
  const p = []
  const harness = suites.filter((s) => typeof s?.id === 'string' && s.id.startsWith('harness.'))
  const ids = harness.map((s) => s.id)
  if (new Set(ids).size !== ids.length) p.push('REGISTRY.DUPLICATE_SUITE_ID')
  if (ids.length === 0) p.push('REGISTRY.NO_HARNESS_SUITES')
  if ([...ids].sort().join('\n') !== [...harnessAll].sort().join('\n')) p.push('REGISTRY.HARNESS_ALL_MISMATCH')
  for (const id of baselineSuiteIds) if (!ids.includes(id)) p.push(`REGISTRY.BASELINE_SUITE_MISSING:${id}`)
  const owners = new Map()
  for (const s of harness) {
    for (const c of validateSuite(s)) p.push(`REGISTRY.INVALID_SUITE:${s.id}:${c}`)
    if (s.tier !== 'lightweight' || s.blocked || s.dynamic || s.cwd !== '.' || s.env !== 'node') p.push(`REGISTRY.NOT_RUNNABLE_IN_CI:${s.id}`)
    if (!Array.isArray(s.steps) || s.steps.length !== 1 || s.steps[0]?.kind !== 'node_test') { p.push(`REGISTRY.STEP_SHAPE:${s.id}`); continue }
    for (const file of s.steps[0].files) {
      if (!file.startsWith(`${HARNESS_DIR}/`) || !file.endsWith('.test.mjs')) p.push(`REGISTRY.FILE_OUTSIDE_HARNESS:${file}`)
      owners.set(file, [...(owners.get(file) ?? []), s.id])
    }
  }
  if (!Array.isArray(discovered) || discovered.length === 0) p.push('DISCOVERY.NO_TEST_FILES')
  for (const file of discovered ?? []) {
    if (!file.endsWith('.test.mjs')) p.push(`DISCOVERY.UNSUPPORTED_TEST_FILE:${file}`)
    else if (!owners.has(file)) p.push(`DISCOVERY.UNREGISTERED_TEST_FILE:${file}`)
  }
  for (const [file, by] of owners) {
    if (by.length !== 1) p.push(`REGISTRY.DUPLICATE_OWNER:${file}`)
    if (!(discovered ?? []).includes(file)) p.push(`REGISTRY.MISSING_TEST_FILE:${file}`)
  }
  return p
}

const ALLOW_KEYS = ['file', 'name', 'nesting', 'reason', 'why']
/** Problems with an allowlist: exact plain-string entries only, inside registered harness files, bounded in size. */
export function validateAllowlist(list, registeredFiles) {
  if (!Array.isArray(list)) return ['ALLOWLIST.NOT_ARRAY']
  const p = []
  if (list.length > MAX_ALLOWED_SKIPS) p.push('ALLOWLIST.TOO_MANY')
  const seen = new Set()
  for (const [i, e] of list.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) { p.push(`ALLOWLIST.NOT_OBJECT@${i}`); continue }
    const keys = Object.keys(e).sort()
    if (keys.join() !== [...ALLOW_KEYS].sort().join()) p.push(`ALLOWLIST.KEYS@${i}`)
    for (const k of ['file', 'name', 'reason', 'why']) if (typeof e[k] !== 'string' || e[k].trim().length < 10 || /[*\0\r\n]/.test(e[k])) p.push(`ALLOWLIST.FIELD:${k}@${i}`)
    if (e.nesting !== 0) p.push(`ALLOWLIST.NESTING@${i}`)
    if (typeof e.file === 'string' && !registeredFiles.includes(e.file)) p.push(`ALLOWLIST.UNREGISTERED_FILE@${i}`)
    const key = JSON.stringify([e.file, e.name, e.nesting])
    if (seen.has(key)) p.push(`ALLOWLIST.DUPLICATE@${i}`)
    seen.add(key)
  }
  return p
}

// ── Result evaluation ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Parse reporter output. Any malformed line or a missing end marker is a problem (result inconclusive => failure). */
export function parseEvents(text) {
  if (typeof text !== 'string' || text.length === 0) return { events: [], problems: ['RESULT.MISSING'] }
  const events = []; const problems = []
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    try { const o = JSON.parse(raw); if (!o || typeof o.event !== 'string') problems.push('RESULT.UNPARSEABLE'); else events.push(o) } catch { problems.push('RESULT.UNPARSEABLE') }
  }
  const ends = events.filter((e) => e.event === 'reporter:end').length
  if (ends !== 1 || events.at(-1)?.event !== 'reporter:end') problems.push('RESULT.TRUNCATED')
  return { events, problems: [...new Set(problems)] }
}

const COUNT_KEYS = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo']
const isNum = (n) => Number.isInteger(n) && n >= 0
const keyOf = (file, name, nesting) => JSON.stringify([file, name, nesting])

/**
 * Judge one suite run from the executor result and its parsed events. `files` are repository-relative; event paths are resolved
 * against `root`. Returns the per-suite report; `problems` non-empty means FAILED.
 */
export function evaluateRun({ suiteId, files, root, exec, parsed, allowlist = ALLOWED_SKIPS, partialDiagnostics = KNOWN_PARTIAL_DIAGNOSTICS }) {
  const problems = [...parsed.problems]
  if (!exec || exec.status !== RESULT.PASSED) problems.push(`EXEC.${exec?.status ?? 'NO_RESULT'}`)
  if (exec?.exit_code !== 0) problems.push(`EXEC.EXIT_CODE:${exec?.exit_code ?? 'none'}`)
  if (exec?.signal) problems.push(`EXEC.SIGNAL:${exec.signal}`)
  if (exec?.spawn_error) problems.push(`EXEC.SPAWN:${exec.spawn_error}`)
  const rel = (abs) => (typeof abs === 'string' ? toPosix(path.relative(root, abs)) : null)
  const expected = new Set(files)
  const allowByKey = new Map(allowlist.map((a) => [keyOf(a.file, a.name, a.nesting), a]))
  const summaries = new Map(); const globals = []
  const failures = []; const allowedSkips = []; const unexpectedSkips = []; const observed = []; const partial = []
  let skipEvents = 0
  for (const ev of parsed.events) {
    const file = rel(ev.file)
    if (file !== null && !expected.has(file)) problems.push(`RESULT.UNEXPECTED_FILE:${file}`)
    if (ev.event === 'test:pass' || ev.event === 'test:fail') {
      const k = keyOf(file, ev.name, ev.nesting)
      const allowed = allowByKey.get(k)
      if (ev.event === 'test:fail') failures.push({ file, name: ev.name, failure: ev.failure })
      if (ev.todo !== null && ev.todo !== false) problems.push(`RESULT.TODO:${file}:${ev.name}`)
      const skipped = ev.skip !== null && ev.skip !== false
      if (skipped) {
        skipEvents += 1
        if (allowed && ev.event === 'test:pass' && ev.skip === allowed.reason) allowedSkips.push({ file, name: ev.name, reason: ev.skip })
        else unexpectedSkips.push({ file, name: ev.name, nesting: ev.nesting, reason: ev.skip })
      }
      if (allowed) observed.push({ key: k, outcome: ev.event === 'test:fail' ? 'fail' : skipped ? (ev.skip === allowed.reason ? 'skip' : 'unexpected_skip') : 'pass' })
    } else if (ev.event === 'test:summary') {
      if (file === null) globals.push(ev)
      else if (summaries.has(file)) problems.push(`RESULT.DUPLICATE_SUMMARY:${file}`)
      else summaries.set(file, ev)
    } else if (ev.event === 'test:diagnostic') {
      if (partialDiagnostics.some((d) => d.file === file && d.message === ev.message)) partial.push({ file, message: ev.message })
    }
  }
  const totals = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]))
  for (const file of files) {
    const s = summaries.get(file)
    if (!s) { problems.push(`RESULT.FILE_NOT_EXECUTED:${file}`); continue }
    const c = s.counts ?? {}
    if (!COUNT_KEYS.every((k) => isNum(c[k]))) { problems.push(`RESULT.BAD_COUNTS:${file}`); continue }
    for (const k of COUNT_KEYS) totals[k] += c[k]
    if (s.success !== true || c.failed || c.cancelled) problems.push(`RESULT.FILE_FAILED:${file}`)
    if (c.todo) problems.push(`RESULT.TODO_COUNT:${file}`)
    if (c.tests < 1) problems.push(`RESULT.NO_TESTS:${file}`)
    if (c.passed < 1) problems.push(`RESULT.NO_PASSING_TEST:${file}`)
  }
  if (globals.length !== 1) problems.push('RESULT.GLOBAL_SUMMARY_MISSING')
  else {
    const g = globals[0]
    if (g.success !== true) problems.push('RESULT.GLOBAL_FAILED')
    if (!COUNT_KEYS.every((k) => isNum(g.counts?.[k]) && g.counts[k] === totals[k])) problems.push('RESULT.COUNT_MISMATCH')
  }
  if (skipEvents !== totals.skipped) problems.push('RESULT.SKIP_COUNT_MISMATCH')
  if (failures.length) problems.push('RESULT.TEST_FAILED')
  if (unexpectedSkips.length) problems.push('SKIP.UNEXPECTED')
  return { suite: suiteId, status: problems.length ? 'FAILED' : 'PASSED', files: files.length, counts: totals, failures, allowed_skips: allowedSkips,
    unexpected_skips: unexpectedSkips, observed, partial, problems: [...new Set(problems)], duration_ms: exec?.duration_ms ?? null }
}

/** Cross-suite checks: every allowlist entry observed exactly once; reports allowed tests that now pass. */
export function finalize(results, { allowlist = ALLOWED_SKIPS, preProblems = [] } = {}) {
  const problems = [...preProblems]
  const knownSkipNowPasses = []
  for (const a of allowlist) {
    const k = keyOf(a.file, a.name, a.nesting)
    const seen = results.flatMap((r) => r.observed ?? []).filter((o) => o.key === k)
    if (seen.length === 0) problems.push(`ALLOWLIST.ENTRY_NOT_OBSERVED:${a.file}:${a.name}`)
    else if (seen.length > 1) problems.push(`ALLOWLIST.ENTRY_AMBIGUOUS:${a.file}:${a.name}`)
    else if (seen[0].outcome === 'pass') knownSkipNowPasses.push({ file: a.file, name: a.name })
  }
  for (const r of results) if (r.status !== 'PASSED') problems.push(`SUITE.FAILED:${r.suite}`)
  if (results.length === 0) problems.push('RUN.NO_SUITES_EXECUTED')
  return { ok: problems.length === 0, problems: [...new Set(problems)], known_skip_now_passes: knownSkipNowPasses }
}

// ── Execution ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The one resolved step of a harness suite, checked to be exactly `<node> --test --test-concurrency=1 <catalog files>`. */
export function checkResolvedStep(resolved, suite) {
  if (!resolved?.ok) return { problems: [`SUITE.BLOCKED:${resolved?.blocked?.code ?? 'unknown'}`] }
  if (resolved.steps.length !== 1) return { problems: ['SUITE.STEP_COUNT'] }
  const s = resolved.steps[0]
  const files = suite.steps[0].files
  const want = [process.execPath, '--test', '--test-concurrency=1', ...files]
  if (s.kind !== 'node_test' || s.argv.length !== want.length || s.argv.some((a, i) => a !== want[i])) return { problems: ['SUITE.ARGV_SHAPE'] }
  if (!(Number.isInteger(s.timeout_ms) && s.timeout_ms > 0)) return { problems: ['SUITE.TIMEOUT'] }
  return { problems: [], step: s, files }
}

/** Fixed reporter flags inserted after `--test-concurrency=1`: human-readable spec output plus this module's structured records. */
export const withReporters = (argv, destination) => [...argv.slice(0, 3), '--test-reporter=spec', '--test-reporter-destination=stdout',
  `--test-reporter=${pathToFileURL(SELF).href}`, `--test-reporter-destination=${destination}`, ...argv.slice(3)]

/** Run every harness suite sequentially. All options exist for disposable-fixture tests; the CLI passes none. */
export async function runAll({ root, suites = SUITES, harnessAll = HARNESS_ALL, baselineSuiteIds = BASELINE_SUITE_IDS, allowlist = ALLOWED_SKIPS,
  discovered = null, resolve = resolveSuite, executor = spawnStep, parentEnv = process.env, log = () => {} } = {}) {
  const found = discovered ?? discoverHarnessTestFiles(root)
  const harness = suites.filter((s) => typeof s?.id === 'string' && s.id.startsWith('harness.'))
  const registered = harness.flatMap((s) => s.steps?.[0]?.files ?? [])
  const pre = [...checkRegistry({ suites, harnessAll, discovered: found, baselineSuiteIds }), ...validateAllowlist(allowlist, registered)]
  const env = buildEnv('node', parentEnv)
  if (env.leaked.length) pre.push('ENV.SENSITIVE_NAME_LEAKED')
  if (pre.length) return { results: [], summary: finalize([], { allowlist, preProblems: pre }) }
  const results = []
  for (const suite of harness) {
    const checked = checkResolvedStep(resolve(suite.id, { root }), suite)
    if (checked.problems.length) { results.push({ suite: suite.id, status: 'FAILED', files: 0, counts: null, failures: [], allowed_skips: [], unexpected_skips: [], observed: [], partial: [], problems: checked.problems }); continue }
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dhv2-ci-'))
    try {
      const destination = path.join(dir, 'events.jsonl')
      log(`\n::group::${suite.id} (${checked.files.length} file(s), timeout ${Math.round(checked.step.timeout_ms / 1000)}s)`)
      const exec = await executor({ argv: withReporters(checked.step.argv, destination), cwd: checked.step.cwd, env: env.env, timeout_ms: checked.step.timeout_ms }, { parentEnv })
      log(sanitizeOutput(exec?.output ?? '', parentEnv))
      log('::endgroup::')
      const parsed = parseEvents(existsSync(destination) ? readFileSync(destination, 'utf8') : '')
      results.push(evaluateRun({ suiteId: suite.id, files: checked.files, root, exec, parsed, allowlist }))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  return { results, summary: finalize(results, { allowlist }) }
}

/** Plain-text and Markdown report. Allowed skips are listed as NOT EXECUTED, never folded into the pass count. */
export function formatReport({ results, summary }) {
  const out = ['Developer Harness V2 — CI suite report (authoritative only as part of CI Gate)', '']
  for (const r of results) {
    const c = r.counts ?? {}
    out.push(`${r.status.padEnd(6)} ${r.suite.padEnd(22)} files=${r.files} tests=${c.tests ?? '-'} passed=${c.passed ?? '-'} failed=${c.failed ?? '-'} cancelled=${c.cancelled ?? '-'} allowed_skips=${r.allowed_skips.length} unexpected_skips=${r.unexpected_skips.length}${r.duration_ms !== null && r.duration_ms !== undefined ? ` duration=${Math.round(r.duration_ms / 1000)}s` : ''}`)
    for (const x of r.failures) out.push(`         FAILED TEST ${x.file} :: ${x.name} (${x.failure})`)
    for (const x of r.unexpected_skips) out.push(`         UNEXPECTED SKIP ${x.file} :: ${x.name} (nesting ${x.nesting}) — ${x.reason}`)
    for (const x of r.problems) out.push(`         problem: ${x}`)
  }
  const allowed = results.flatMap((r) => r.allowed_skips)
  out.push('', `Allowed historical-provenance skips (NOT EXECUTED, not counted as passed): ${allowed.length}`)
  for (const x of allowed) out.push(`  - ${x.file} :: ${x.name} — ${x.reason}`)
  const partial = results.flatMap((r) => r.partial)
  out.push(`Historical assertions skipped inside a passing test (reported, not counted): ${partial.length}`)
  for (const x of partial) out.push(`  - ${x.file} — ${x.message}`)
  out.push(`Allowed skips that now pass: ${summary.known_skip_now_passes.length}`)
  for (const x of summary.known_skip_now_passes) out.push(`  - ${x.file} :: ${x.name}`)
  for (const x of summary.problems) out.push(`problem: ${x}`)
  out.push('', summary.ok ? 'RESULT: PASS' : 'RESULT: FAIL')
  return out.join('\n')
}

/** CLI entry. Accepts no arguments (there is nothing to weaken). Returns the process exit code. */
export async function main(argv = process.argv.slice(2), { root = path.resolve(path.dirname(SELF), '..', '..', '..'), log = (s) => process.stdout.write(`${s}\n`), ...rest } = {}) {
  if (argv.length) { log(`run-ci-suites.mjs accepts no arguments (got ${argv.length}); refusing to run.`); return 2 }
  let report
  try { report = await runAll({ root, log, ...rest }) } catch (e) { log(`runner error: ${sanitizeOutput(String(e?.stack ?? e))}`); return 1 }
  const text = formatReport(report)
  log(text)
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (summaryFile && rest.writeSummary !== false) { try { appendFileSync(summaryFile, `\n\`\`\`\n${text}\n\`\`\`\n`) } catch { /* the summary is cosmetic; the exit code is authoritative */ } }
  return report.summary.ok ? 0 : 1
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : ''
const same = process.platform === 'win32' ? invokedAs.toLowerCase() === SELF.toLowerCase() : invokedAs === SELF
if (same) process.exitCode = await main()
