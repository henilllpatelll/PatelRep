// Developer Harness V3 (D3.4) — CI runner for the V3 test suites. NOT wired into any workflow by this PR (activation gate G-V3-CI): wiring it needs the human-approved
// control-plane change in docs/developer-harness-v3/proposals/ (the protected ci.yml pin). It exists so that change can be a one-line step.
//
//   node scripts/developer-harness-v3/ci/run-v3-suites.mjs
// Every test file runs in its OWN `node --test` process, sequentially (`--test-concurrency=1`), with a bounded heap and a REBUILT minimal environment (no inherited secrets,
// proxies or tokens). Exit status is non-zero when ANY file fails, runs zero tests, skips anything (no skip is allowed), is missing from the pinned list, or is unlisted.
// Network independence: V3 tests are hermetic by construction (temp dirs, loopback-free IPC over named pipes / unix sockets, injected clocks). They must not fetch.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const TEST_DIR = 'scripts/developer-harness-v3/tests'
export const HEAP_MB = 1024
export const FILE_TIMEOUT_MS = 15 * 60_000

/** The pinned test-file list. Adding or removing a V3 test file is a deliberate edit here (so a test cannot silently drop out of CI). */
export const EXPECTED_FILES = Object.freeze(['d33-acceptance-review', 'd33-acceptance', 'd33-egress', 'd33-infra', 'd33-launcher', 'd33-lifecycle', 'd33-resource', 'd33-sampler-retry', 'd33-state-readers', 'd33-subscription',
  'd34-ci-runner', 'd34-context', 'd34-crash', 'd34-engine', 'd34-evidence', 'd34-glue', 'd34-issuer', 'd34-ledger', 'd34-proposals', 'evaluator', 'final-review', 'foundation', 'git-facts', 'hardening', 'lifecycle', 'promotion', 'security', 'subscription'].map((n) => `${n}.test.mjs`))

export const discover = (root = ROOT) => readdirSync(path.join(root, TEST_DIR)).filter((f) => f.endsWith('.test.mjs')).sort()

/** @returns {string[]} problems; empty when the discovered list equals the pinned list exactly. */
export function checkRegistry(found = discover(), expected = EXPECTED_FILES) {
  const p = []
  for (const f of found) if (!expected.includes(f)) p.push(`REGISTRY.UNLISTED_TEST_FILE:${f}`)
  for (const f of expected) if (!found.includes(f)) p.push(`REGISTRY.MISSING_TEST_FILE:${f}`)
  return p
}

export const parseCounts = (text) => { const n = (k) => Number((new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(text) ?? [])[1] ?? NaN); return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), cancelled: n('cancelled') } }
export const judge = (counts, status) => {
  const p = []
  if (![counts.tests, counts.pass, counts.fail, counts.skipped].every(Number.isFinite)) p.push('RESULT.UNPARSEABLE')
  else {
    if (counts.tests === 0) p.push('RESULT.ZERO_TESTS')
    if (counts.fail !== 0 || counts.cancelled > 0) p.push('RESULT.FAILURES')
    if (counts.skipped !== 0) p.push('RESULT.SKIPS_NOT_ALLOWED')
    if (counts.pass !== counts.tests) p.push('RESULT.PASS_COUNT_MISMATCH')
  }
  if (status !== 0) p.push(`RESULT.NONZERO_EXIT:${status}`)
  return p
}

export function minimalEnv() {
  const keep = ['PATH', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG']
  return { ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), CI: 'true', NODE_NO_WARNINGS: '1', NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}` }
}

export function runAll({ root = ROOT, files = discover(root), spawn = spawnSync } = {}) {
  const problems = checkRegistry(files); const results = []
  for (const f of files) {
    const r = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=1', path.join(TEST_DIR, f)], { cwd: root, env: minimalEnv(), encoding: 'utf8', timeout: FILE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
    const counts = parseCounts(`${r.stdout ?? ''}\n${r.stderr ?? ''}`); const why = judge(counts, r.status ?? -1)
    results.push({ file: f, ...counts, status: r.status, problems: why }); if (why.length) problems.push(...why.map((x) => `${f}:${x}`))
    process.stdout.write(`${why.length ? 'FAIL' : 'ok  '} ${f} tests=${counts.tests} pass=${counts.pass} fail=${counts.fail} skipped=${counts.skipped}\n`)
  }
  return { ok: problems.length === 0, problems, results, total: results.reduce((s, r) => s + (Number.isFinite(r.tests) ? r.tests : 0), 0) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = runAll()
  process.stdout.write(`${JSON.stringify({ ok: r.ok, total_tests: r.total, files: r.results.length, problems: r.problems })}\n`)
  process.exit(r.ok ? 0 : 1)
}
