// Developer Harness V2 — Phase 6 safe local runner.
//
// Default is a PREVIEW: nothing executes until a plan with every command and its safety class has been produced.
// Execution rules (all enforced in code and tested):
//   * only commands re-derived from (suite id, validated path params) via catalog.validateStep; argv arrays, shell:false;
//   * strictly sequential (one process at a time); Jest is pinned to --maxWorkers=2; Node heap capped via NODE_OPTIONS;
//   * the child environment is built from an allowlist — no tokens, no SUPABASE_*/STRIPE_* from the parent;
//   * output is bounded and secret-scrubbed; exit codes are never rewritten; "no tests discovered" is a FAILURE;
//   * dependencies are NEVER installed; Docker / Supabase stacks are NEVER started (those suites stay BLOCKED);
//   * a suite that cannot run stays visible as BLOCKED / NOT_RUN with a reason code.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { sha256 } from '../coordination/evidence.mjs'
import { gatherFacts } from '../coordination/resume.mjs'
import { BASE_ENV_ALLOW, ENV_PROFILES, FORBIDDEN_EXECUTABLES, LIMITS, NODE_BINS, SUITE_BY_ID, isSafeRepoPath, validateStep, validateSuite } from './catalog.mjs'

export const RESULT = Object.freeze({ PASSED: 'PASSED', FAILED: 'FAILED', TIMED_OUT: 'TIMED_OUT', INTERRUPTED: 'INTERRUPTED', NO_TESTS: 'NO_TESTS_DISCOVERED', INVALID: 'INVALID_TREE_CHANGED', BLOCKED: 'BLOCKED', NOT_RUN: 'NOT_RUN', DEDUPED: 'DEDUPED' })
const TIER_ORDER = { lightweight: 0, prereq: 1, expensive: 2, ci_only: 3 }
const PYTEST_BASE = ['-v', '--tb=short', '-p', 'no:cacheprovider']
const SENSITIVE_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API[_-]?KEY|SERVICE[_-]?ROLE|ANON|AUTH|COOKIE|SESSION)/i
const SECRET_PATTERNS = [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g, /\bnpm_[A-Za-z0-9]{30,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, /\b[sr]k[-_](live|test)?[-_]?[A-Za-z0-9_-]{16,}/g, /\bwhsec_[A-Za-z0-9]{16,}/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bsbp_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bAIza[0-9A-Za-z_-]{30,}/g, /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^\s:@/]+:[^\s@/]+@/gi, /(authorization:\s*bearer\s+)[^\s]+/gi, /\b([A-Z][A-Z0-9_]{0,80}?(?:SERVICE_ROLE|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|TOKEN)[A-Z0-9_]{0,40}\s*[=:]\s*)\S{6,}/g]

/** Resource-rule violations in a run request. Concurrency is always 1, Jest never exceeds 2 workers, no stack is ever started here. */
export function resourceProblems(o = {}) {
  const p = []
  if (o.concurrency !== undefined && o.concurrency !== 1) p.push('CONCURRENCY.OVER_LIMIT')
  if (o.jestWorkers !== undefined && o.jestWorkers > LIMITS.jestMaxWorkers) p.push('JEST.WORKERS_OVER_LIMIT')
  if (Array.isArray(o.stacks) && o.stacks.length > LIMITS.maxDbStacks) p.push('STACK.TOO_MANY')
  if (o.stacks && o.stacks.length && !o.stackApproval) p.push('STACK.UNAPPROVED')
  if (o.startStack || o.docker) p.push('STACK.START_NOT_SUPPORTED')
  if (o.install) p.push('DEPENDENCY.INSTALL_NOT_AUTOMATIC')
  return p
}

/** Child environment: allowlisted names from the parent plus the suite's fixed profile. Values are never logged. */
export function buildEnv(profile, parent = process.env) {
  const allow = new Set(BASE_ENV_ALLOW.map((n) => n.toUpperCase()))
  const env = {}
  for (const [k, v] of Object.entries(parent)) if (allow.has(k.toUpperCase()) && typeof v === 'string') env[k] = v
  Object.assign(env, ENV_PROFILES[profile] ?? {})
  const fixed = new Set(Object.keys(ENV_PROFILES[profile] ?? {}))
  const leaked = Object.keys(env).filter((k) => SENSITIVE_NAME.test(k) && !fixed.has(k))
  return { env, names: Object.keys(env).sort(), leaked }
}

/** Redact secret-looking text and the literal values of sensitive parent variables; strip control characters; bound the size. */
export function sanitizeOutput(text, parent = process.env, max = LIMITS.maxOutputBytes) {
  let t = String(text).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f]/g, '')
  for (const [k, v] of Object.entries(parent)) if (SENSITIVE_NAME.test(k) && typeof v === 'string' && v.length >= 8) t = t.split(v).join('[REDACTED:env]')
  for (const re of SECRET_PATTERNS) t = t.replace(re, (m, g1) => (typeof g1 === 'string' && g1 && !g1.startsWith('-') ? `${g1}[REDACTED]` : '[REDACTED]'))
  if (Buffer.byteLength(t) > max) { const h = t.slice(0, Math.floor(max / 4)); const tl = t.slice(-Math.floor((max * 3) / 4)); t = `${h}\n…[output truncated: ${Buffer.byteLength(t)} bytes]…\n${tl}` }
  return t
}

const CUT_WINDOW = 512 // longer than any partial secret prefix a redaction pattern could miss; bounded so one huge unbroken line is not erased
/** Remove the word fragment a capture cut left at the `end` of a head or the `start` of a tail (at most CUT_WINDOW characters; never scans the whole text). */
function trimPartialWord(text, where) {
  if (where === 'end') { const m = /\S+$/.exec(text.slice(-CUT_WINDOW)); return m ? text.slice(0, text.length - m[0].length) : text }
  const m = /^\S+/.exec(text.slice(0, CUT_WINDOW)); return m ? text.slice(m[0].length) : text
}

/**
 * The sanitized view of captured output: `head` / `tail` are Buffer chunks, `total` the bytes the child really wrote.
 * Nothing dropped: the retained chunks are contiguous, so they are sanitized as ONE text (a secret straddling a chunk boundary is
 * still redacted) and no "omitted" marker is shown. Middle dropped: head and tail are sanitized separately, the partial word at each
 * cut is removed (a cut can leave a secret's prefix shorter than any redaction pattern) and the omission is stated with its size.
 */
export function assembleOutput({ head, tail, total }, parentEnv = process.env) {
  const kept = Buffer.concat([...head, ...tail])
  const raw = kept.toString('utf8')
  if (total <= kept.length) return { raw, output: sanitizeOutput(raw, parentEnv), dropped_bytes: 0 }
  const h = trimPartialWord(Buffer.concat(head).toString('utf8'), 'end')
  let t = trimPartialWord(Buffer.concat(tail).toString('utf8'), 'start').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  // A PEM key whose BEGIN line is in the (dropped-middle) head leaves an END line with no BEGIN in the tail: redact the body up to and including it.
  const end = /-----END [A-Z ]*PRIVATE KEY-----/.exec(t)
  if (end && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t.slice(0, end.index))) t = `[REDACTED]${t.slice(end.index + end[0].length)}`
  else if (h.lastIndexOf('-----BEGIN') > h.lastIndexOf('-----END')) t = t.replace(/^\s*(?:[A-Za-z0-9+/=]{16,}\r?\n?)+/, '[REDACTED]\n') // key still open at the cut and never closed: drop its base64 body lines
  return { raw, output: `${sanitizeOutput(h, parentEnv)}\n…[middle of output omitted: ${total - kept.length} bytes]…\n${sanitizeOutput(t, parentEnv)}`, dropped_bytes: total - kept.length }
}

function killTree(child) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGKILL')
  } catch { try { child.kill('SIGKILL') } catch { /* already gone */ } }
}

/**
 * INTERNAL low-level executor for an ALREADY VALIDATED step. It performs no allowlisting itself and is exported only so the
 * timeout / interruption / output-bound behaviour can be tested with real child processes; runPlan never passes it anything
 * but argv produced by resolveSuite.
 */
export function spawnStep({ argv, cwd, env, timeout_ms }, { signal = null, parentEnv = process.env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const head = []; let headBytes = 0; const tail = []; let tailBytes = 0; let total = 0
    const keep = LIMITS.maxOutputBytes
    const onData = (b) => {
      total += b.length
      if (headBytes < keep / 4) { head.push(b); headBytes += b.length } else { tail.push(b); tailBytes += b.length; while (tailBytes > (keep * 3) / 4 && tail.length > 1) tailBytes -= tail.shift().length }
    }
    let child
    try { child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }) } catch (e) { return resolve({ status: RESULT.FAILED, exit_code: null, signal: null, spawn_error: String(e.code ?? 'SPAWN_FAILED'), duration_ms: 0, output: '', output_bytes: 0 }) }
    child.stdout.on('data', onData); child.stderr.on('data', onData)
    let state = null; let done = false
    const finish = (code, sig, extra = {}) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort)
      const { raw, output: safe } = assembleOutput({ head, tail, total }, parentEnv)
      const status = state === 'timeout' ? RESULT.TIMED_OUT : state === 'abort' ? RESULT.INTERRUPTED : code === 0 ? RESULT.PASSED : RESULT.FAILED
      resolve({ status, exit_code: code, signal: sig, duration_ms: Date.now() - started, output_bytes: total, raw_for_discovery: raw, output: safe, ...extra })
    }
    const stop = (why) => { state = state ?? why; killTree(child); setTimeout(() => finish(null, 'SIGKILL', { cleanup_uncertain: true }), 5000).unref?.() }
    const timer = setTimeout(() => stop('timeout'), timeout_ms)
    const onAbort = () => stop('abort')
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }) }
    child.on('error', (e) => finish(null, null, { spawn_error: String(e.code ?? 'SPAWN_ERROR') }))
    child.on('close', (code, sig) => finish(code, sig))
  })
}

/** Test counts printed by the runners. Unknown format returns null — which a discovery-checked suite treats as "not proven". */
export function parseDiscovery(kind, text) {
  const n = (re) => { const m = re.exec(text); return m ? Number(m[1]) : null }
  if (kind === 'node_test') { const m = [...text.matchAll(/(?:ℹ|^#) pass (\d+)/gm)]; return m.length ? Number(m.at(-1)[1]) : null }
  if (kind === 'jest') return n(/Tests:\s+(?:\d+ (?:failed|skipped|todo),\s+)*(\d+) passed/) ?? (/Tests:\s+\d+ failed/.test(text) ? 1 : null)
  if (kind === 'pytest') return /no tests ran/i.test(text) ? 0 : n(/(\d+) passed/) ?? (/\d+ failed/.test(text) ? 1 : null)
  return null
}

const nodeModule = (root, cwd, rel, fsx) => [path.join(root, cwd, rel), path.join(root, rel)].find((c) => fsx.exists(c)) ?? null
const underDir = (dir, p) => { const r = path.relative(path.resolve(dir), path.resolve(p)); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r) }
/**
 * The interpreter is NEVER taken from a plan, selection, checkpoint or report: only from the human's own `--python` option (passed to
 * `resolveSuite`/`runPlan` by the CLI) or the repository's API virtualenv. An explicit path must be absolute, non-UNC, python-named and
 * must not sit inside the repository (an untrusted worktree can plant a `python.exe`) unless it is the API virtualenv itself.
 */
export function pythonCandidates(root, explicit) {
  const venv = [path.join(root, 'apps/api/.venv/Scripts/python.exe'), path.join(root, 'apps/api/.venv/bin/python')]
  if (explicit === null || explicit === undefined) return venv
  if (typeof explicit !== 'string' || !explicit) return []
  const named = /^python(3(\.\d+)?)?(\.exe)?$/i.test(path.basename(explicit)) && path.isAbsolute(explicit) && !/^[\\/]{2}/.test(explicit)
  if (!named || /[\0\r\n]/.test(explicit)) return []
  if (explicit.split(/[\\/]/).some((c) => c !== '.' && c !== '..' && /[. ]$/.test(c))) return [] // Win32 strips trailing dots/spaces: a different spelling of another directory
  const real = (p) => { try { return realpathSync.native(p) } catch { return path.resolve(p) } } // follows symlinks/junctions and 8.3 names where the path exists
  const rRoot = real(root); const rExp = real(explicit)
  if ((underDir(root, explicit) || underDir(rRoot, rExp)) && !underDir(path.join(rRoot, 'apps/api/.venv'), rExp) && !underDir(path.join(root, 'apps/api/.venv'), explicit)) return []
  return [explicit]
}

/** Turn a suite plus validated params into argv steps, or a BLOCKED reason. Never installs, starts or reads anything beyond existence checks. */
export function resolveSuite(suiteId, { root, params = null, python = null, fsx = { exists: existsSync } } = {}) {
  const suite = SUITE_BY_ID[suiteId]
  const blocked = (code, reason) => ({ ok: false, blocked: { code, reason } })
  if (!suite) return blocked('SUITE.UNKNOWN', `no suite ${String(suiteId).slice(0, 60)}`)
  const sp = validateSuite(suite)
  if (sp.length) return blocked('SUITE.INVALID', sp.join(','))
  if (suite.tier === 'ci_only') return blocked('CI.ONLY', suite.blocked.reason)
  if (suite.blocked) return blocked(suite.blocked.code, suite.blocked.reason)
  let steps = suite.steps
  if (suite.dynamic === 'jest_related') {
    const given = params?.related_files ?? []
    const files = given.filter((f) => isSafeRepoPath(f) && fsx.exists(path.join(root, suite.cwd, f)))
    if (!files.length) return blocked('PARAMS.NONE', 'no existing related files')
    if (files.length !== given.length) return blocked('PARAMS.UNSAFE_DROPPED', `${given.length - files.length} changed file(s) cannot be passed safely (${given.filter((f) => !files.includes(f)).slice(0, 3).map((x) => JSON.stringify(String(x).slice(0, 60))).join(', ')}); the full suite covers them`)
    steps = [{ kind: 'node_bin', bin: 'jest', args: ['--ci', `--maxWorkers=${LIMITS.jestMaxWorkers}`, '--findRelatedTests', ...files] }]
  } else if (suite.dynamic === 'pytest_files') {
    const given = params?.test_files ?? []
    const files = given.filter((f) => isSafeRepoPath(f) && fsx.exists(path.join(root, suite.cwd, f)))
    if (!files.length) return blocked('PARAMS.NONE', 'no existing test files')
    if (files.length !== given.length) return blocked('PARAMS.UNSAFE_DROPPED', `${given.length - files.length} test file(s) cannot be passed safely; the full suite covers them`)
    steps = [{ kind: 'python', module: 'pytest', args: [...files, ...PYTEST_BASE] }]
  } else if (suite.dynamic) return blocked('SUITE.INVALID', 'unknown dynamic kind')
  const cwd = path.join(root, suite.cwd)
  if (!fsx.exists(cwd)) return blocked('PREREQ.CWD_MISSING', suite.cwd)
  if ((suite.requires.deps === 'web' || suite.requires.deps === 'mobile') && !nodeModule(root, suite.cwd, 'node_modules', fsx)) return blocked('PREREQ.NODE_MODULES', `${suite.cwd}/node_modules missing; dependencies are never installed automatically (run npm ci yourself, with approval)`)
  if (suite.env === 'api_test' && fsx.exists(path.join(root, 'apps/api/.env'))) return blocked('ENV.LOCAL_DOTENV_PRESENT', 'apps/api/.env exists and the API settings loader would read it; it can point at production. Move it aside (it is never read here)')
  const out = []
  for (const [i, step] of steps.entries()) {
    const problems = validateStep(step)
    if (problems.length) return blocked('COMMAND.REJECTED', problems.join(','))
    let argv
    if (step.kind === 'node_bin' || step.kind === 'tsx_test') {
      const bin = step.kind === 'tsx_test' ? 'tsx' : step.bin
      const script = nodeModule(root, suite.cwd, NODE_BINS[bin], fsx)
      if (!script) return blocked('PREREQ.NODE_MODULES', `${bin} not found under ${suite.cwd}/node_modules; dependencies are never installed automatically (run npm ci yourself, with approval)`)
      argv = step.kind === 'tsx_test' ? [process.execPath, script, '--test', '--test-concurrency=1', ...step.files] : [process.execPath, script, ...step.args]
    } else if (step.kind === 'node_script') {
      const abs = path.join(cwd, step.script)
      if (!fsx.exists(abs)) return blocked('PREREQ.SCRIPT_MISSING', `${suite.cwd}/${step.script}`)
      if (suite.requires.deps && !nodeModule(root, suite.cwd, 'node_modules', fsx)) return blocked('PREREQ.NODE_MODULES', `${suite.cwd}/node_modules missing; not installed automatically`)
      argv = [process.execPath, abs]
    } else if (step.kind === 'node_test') argv = [process.execPath, '--test', '--test-concurrency=1', ...step.files]
    else {
      const py = pythonCandidates(root, python).find((c) => fsx.exists(c))
      if (!py) return blocked('PREREQ.PYTHON_ENV', 'no Python environment with the API dependencies was found (expected apps/api/.venv or --python <abs path>); installation is never automatic')
      argv = [py, '-m', step.module, ...step.args]
    }
    if (step.kind === 'node_test' || step.kind === 'tsx_test') for (const f of step.files) if (!fsx.exists(path.join(cwd, f))) return blocked('PREREQ.TEST_FILE_MISSING', `${suite.cwd}/${f}`)
    if (FORBIDDEN_EXECUTABLES.includes(path.basename(argv[0]).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase())) return blocked('COMMAND.REJECTED', 'forbidden executable')
    const discovery = step.kind === 'node_test' || step.kind === 'tsx_test' ? 'node_test' : step.kind === 'node_bin' && step.bin === 'jest' ? 'jest' : step.kind === 'python' && step.module === 'pytest' ? 'pytest' : null
    out.push({ label: step.label ?? `${suite.id}#${i + 1}`, kind: step.kind, argv, cwd, env_profile: suite.env, timeout_ms: suite.timeout_ms, discovery })
  }
  return { ok: true, steps: out }
}

const display = (argv, root) => argv.map((a, i) => (i === 0 ? path.basename(a) : a.split(root).join('<repo>').split(root.replace(/\\/g, '/')).join('<repo>'))).join(' ')

/** The preview: what WOULD run, in what order, and everything that will not run with the reason. Executes nothing. */
export function previewPlan(selection, { root, approve = [], python = null, fsx, request = {} } = {}) {
  const rp = resourceProblems(request)
  const entries = []
  const seen = new Map()
  const ordered = [...selection.suites].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
  for (const s of ordered) {
    const base = { suite_id: s.id, tier: s.tier, title: s.title, ci_jobs: s.ci_jobs }
    const r = resolveSuite(s.id, { root, params: s.params ?? null, python, fsx })
    if (!r.ok) { entries.push({ ...base, action: r.blocked.code === 'CI.ONLY' ? 'NOT_RUN' : 'BLOCKED', code: r.blocked.code, reason: r.blocked.reason }); continue }
    if (s.tier === 'expensive' && !approve.includes(s.id)) { entries.push({ ...base, action: 'NOT_RUN', code: 'APPROVAL.REQUIRED', reason: 'expensive suite: run only with explicit per-suite approval', commands: r.steps.map((x) => display(x.argv, root)) }); continue }
    const key = sha256(JSON.stringify(r.steps.map((x) => [x.argv, x.cwd])))
    if (seen.has(key)) { entries.push({ ...base, action: 'DEDUPED', code: 'DUPLICATE_COMMAND', reason: `identical to ${seen.get(key)}` }); continue }
    seen.set(key, s.id)
    entries.push({ ...base, params: s.params ?? null, action: 'WILL_RUN', commands: r.steps.map((x) => display(x.argv, root)), env_profile: r.steps[0].env_profile, env_names: buildEnv(r.steps[0].env_profile).names, timeout_ms: r.steps[0].timeout_ms, resolved: r })
  }
  return { entries, request_problems: rp, will_run: entries.filter((e) => e.action === 'WILL_RUN').map((e) => e.suite_id), executes_nothing: true }
}

const withoutResolved = ({ resolved, ...rest }) => rest

/**
 * Execute a previewed plan, sequentially. `executor` is injectable for tests. Completed results are kept even if a later suite
 * is interrupted; remaining suites are reported NOT_RUN. A changed working tree during the run invalidates the evidence.
 */
export async function runPlan(plan, { root, python = null, approve = [], fsx = { exists: existsSync }, executor = spawnStep, signal = null, getTreeDigest = (r) => gatherFacts(r, {}).tree_digest, onResult = () => {}, parentEnv = process.env } = {}) {
  const problems = [...plan.request_problems]
  const results = []
  if (problems.length) return { results: plan.entries.map((e) => ({ suite_id: e.suite_id, status: RESULT.NOT_RUN, code: problems[0], reason: 'run request rejected' })), request_problems: problems, tree_digest_start: null, tree_digest_end: null, stopped: 'REQUEST_REJECTED' }
  let start = null; try { start = getTreeDigest(root) } catch { start = null }
  let stopped = null
  for (const e of plan.entries) {
    if (e.action !== 'WILL_RUN') { const r = { suite_id: e.suite_id, tier: e.tier, status: e.action === 'BLOCKED' ? RESULT.BLOCKED : e.action === 'DEDUPED' ? RESULT.DEDUPED : RESULT.NOT_RUN, code: e.code, reason: e.reason }; results.push(r); onResult(r); continue }
    if (stopped || signal?.aborted) { const r = { suite_id: e.suite_id, tier: e.tier, status: RESULT.NOT_RUN, code: stopped ?? 'INTERRUPTED', reason: 'run stopped before this suite' }; stopped = stopped ?? 'INTERRUPTED'; results.push(r); onResult(r); continue }
    // Nothing a plan carries is executed: the command is re-derived from (suite id, params) and re-checked now (allowlist, approval, apps/api/.env).
    const fresh = resolveSuite(e.suite_id, { root, params: e.params ?? null, python, fsx })
    const withheld = !fresh.ok ? { status: RESULT.BLOCKED, code: fresh.blocked.code, reason: fresh.blocked.reason } : SUITE_BY_ID[e.suite_id].tier === 'expensive' && !approve.includes(e.suite_id) ? { status: RESULT.NOT_RUN, code: 'APPROVAL.REQUIRED', reason: 'expensive suite without approval at run time' } : null
    if (withheld) { const r = { suite_id: e.suite_id, tier: e.tier, ...withheld }; results.push(r); onResult(r); continue }
    const steps = []; let status = RESULT.PASSED
    for (const st of fresh.steps) {
      if (status !== RESULT.PASSED || signal?.aborted) { steps.push({ label: st.label, status: RESULT.NOT_RUN, reason: 'earlier step did not pass' }); if (signal?.aborted && status === RESULT.PASSED) status = RESULT.INTERRUPTED; continue }
      const { env, leaked } = buildEnv(st.env_profile, parentEnv)
      if (leaked.length) { steps.push({ label: st.label, status: RESULT.BLOCKED, code: 'ENV.SENSITIVE_NAME_LEAK' }); status = RESULT.BLOCKED; continue }
      const r = await executor({ argv: st.argv, cwd: st.cwd, env, timeout_ms: st.timeout_ms }, { signal, parentEnv })
      let s = r.status
      let discovery = null
      if (s === RESULT.PASSED && st.discovery) { discovery = parseDiscovery(st.discovery, r.raw_for_discovery ?? r.output ?? ''); if (!(discovery > 0)) s = RESULT.NO_TESTS }
      steps.push({ label: st.label, status: s, exit_code: r.exit_code, signal: r.signal ?? null, duration_ms: r.duration_ms, tests_discovered: discovery, output_bytes: r.output_bytes, output_digest: sha256(r.output ?? ''), output: r.output, ...(r.spawn_error ? { spawn_error: r.spawn_error } : {}), ...(r.cleanup_uncertain ? { cleanup_uncertain: true } : {}) })
      status = s
    }
    let tree = null; try { tree = getTreeDigest(root) } catch { tree = null }
    if (status === RESULT.PASSED && (tree === null || start === null || tree !== start)) status = RESULT.INVALID
    const res = { suite_id: e.suite_id, tier: e.tier, ci_jobs: e.ci_jobs, status, steps, tree_digest_after: tree }
    results.push(res); onResult(res)
    if (status === RESULT.INTERRUPTED) stopped = 'INTERRUPTED'
    if (status === RESULT.INVALID) stopped = 'TREE_CHANGED'
  }
  let end = null; try { end = getTreeDigest(root) } catch { end = null }
  return { results, request_problems: [], tree_digest_start: start, tree_digest_end: end, stopped }
}

export const publicEntries = (plan) => plan.entries.map(withoutResolved)
