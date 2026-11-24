// Developer Harness V3 (D3.3) — trusted Claude launcher (controller side, Z2).
//
// Lives in the trusted controller checkout, never in the candidate worktree, and treats everything from the worker as data.
//  * Environment: constructed from scratch from an explicit allow-list; nothing is inherited from the owner's shell. Every name gets an exact-name
//    origin label (`trusted_launcher`) for D3.2's checkLauncherControlled. No credential-shaped name can be produced.
//  * Settings: user/project/local setting sources are NOT loaded (`--setting-sources ""`; effect inside the VM is NOT VERIFIED until the owner logs
//    in — 14 §5); only the root-owned managed settings (digest-pinned) and launcher `--settings` apply, so a repository- or worker-written settings
//    file, hook, plugin or MCP server cannot acquire authority, before OR after preflight. `--strict-mcp-config` without `--mcp-config` → no MCP.
//  * Binary: absolute root-owned path + pinned version + pinned sha512, re-verified before every launch.
//  * Authority: the D3.2 evaluator decides (dry-run in D3.3). `--dangerously-skip-permissions` is constructed ONLY for an evaluator `allow` of
//    `start_bypass_permissions_session`, bound to the same task, in an `isolated_vm` environment — which the shipped contract can never produce.
//  * Runtime: one reasoning session (exclusive lock), bounded wall time, cancellation, kill switches on init mismatch or any overage signal; a kill
//    terminates the REMOTE process tree too, and the lock is released only after termination is verified.
// NOTE on `verified_by: 'launcher'`: the auth and rate-limit facts are produced by the official CLI running INSIDE the untrusted VM and relayed as
// data. The launcher normalizes them strictly, but a fully compromised guest could forge them. Provider-side enforcement (usage credits OFF in the
// owner's account) remains the real spending control; the launcher's checks are defence in depth.
import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import path from 'node:path'
import { DECISION_SCHEMA, evaluate } from '../authority/evaluator.mjs'
import { acquireLock, atomicWriteJson, releaseLock } from '../lib/atomic.mjs'
import { contextUtilization, createTelemetry, feedLine, verifyInit } from './session-telemetry.mjs'
import { classifyObservation, extraUsageFromRateLimits } from './subscription-governor.mjs'

export const WORKER_PATH = '/usr/local/bin:/usr/bin:/bin'
export const CLAUDE_INSTALL_PATH = '/opt/patelrep-claude/bin/claude'
export const LAUNCH_ACTIONS = Object.freeze(['launch_claude_session', 'start_bypass_permissions_session'])

/** Values are ALWAYS produced here. `opts` carries launcher configuration, never the owner's environment. */
export function buildWorkerEnvironment({ user = 'worker', home = '/home/worker', proxyUrl = null, nodeHeapMb = null, tz = 'America/Chicago', lang = 'C.UTF-8', ci = true } = {}) {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) throw new Error('LAUNCH.BAD_USER')
  if (!/^\/home\/[a-z_][a-z0-9_-]{0,31}$/.test(home)) throw new Error('LAUNCH.BAD_HOME')
  const env = { PATH: WORKER_PATH, HOME: home, USER: user, LOGNAME: user, SHELL: '/bin/bash', LANG: lang, TERM: 'dumb', TZ: tz, TMPDIR: `${home}/.tmp` }
  if (ci) env.CI = '1'
  if (proxyUrl !== null) {
    // The only egress path: guest loopback :3128, carried by the controller's SSH remote forward to the host allow-list proxy.
    if (proxyUrl !== 'http://127.0.0.1:3128') throw new Error('LAUNCH.PROXY_NOT_THE_EGRESS_ENDPOINT')
    env.HTTPS_PROXY = proxyUrl; env.HTTP_PROXY = proxyUrl; env.NO_PROXY = ''
  }
  if (nodeHeapMb !== null) { if (!Number.isInteger(nodeHeapMb) || nodeHeapMb < 256 || nodeHeapMb > 8192) throw new Error('LAUNCH.BAD_HEAP'); env.NODE_OPTIONS = `--max-old-space-size=${nodeHeapMb}` }
  for (const [k, v] of Object.entries(env)) if (typeof v !== 'string' || /[\0\n\r]/.test(v)) throw new Error(`LAUNCH.BAD_VALUE:${k}`)
  const origins = Object.fromEntries(Object.keys(env).map((k) => [k, 'trusted_launcher']))
  return { env: Object.freeze(env), origins: Object.freeze(origins) }
}

/** Managed settings written root-owned into the worker at provisioning. Pinned by digest; any drift fails preflight. */
export const MANAGED_SETTINGS = Object.freeze({
  disableAllHooks: true,
  allowManagedHooksOnly: true,
  allowManagedPermissionRulesOnly: true,
  allowManagedMcpServersOnly: true,
  strictKnownMarketplaces: [],
  enableAllProjectMcpServers: false,
  cleanupPeriodDays: 7,
  // Until D3.9 activation (an owner root-of-trust ceremony that must change this pinned file), the official CLI itself rejects
  // --dangerously-skip-permissions inside the worker — an enforcement layer independent of the launcher and evaluator.
  permissions: Object.freeze({ disableBypassPermissionsMode: 'disable' }),
})
export const digestJson = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

/** POSIX single-quote quoting for the remote command line (argv elements, env values). The only quoting helper used for guest commands. */
export const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`
export const shellCommand = (argv) => argv.map(shellQuote).join(' ')

/** Guest command that runs the session as `worker` with EXACTLY `env`, under a guest-side wall-time bound (the guest itself enforces it too). */
export function guestSessionCommand({ argv, env, timeoutS }) {
  if (!Number.isInteger(timeoutS) || timeoutS < 10 || timeoutS > 86400) throw new Error('LAUNCH.BAD_TIMEOUT')
  return `cd /tmp && sudo -n -u worker -H /usr/bin/env -i ${Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ')} /usr/bin/timeout --kill-after=15s ${timeoutS}s ${shellCommand(argv)}`
}

/**
 * Effective settings as the launcher will make Claude load them. `managedText` is what the VM reports for the root-owned file; it must equal the pin.
 * Repository/user/local files are excluded by `--setting-sources ""`; their presence is reported (data) but cannot change the result.
 */
export function verifyEffectiveSettings({ managedText, managedOwner, cliSettings = {} }) {
  const codes = []
  let managed = null
  try { managed = JSON.parse(managedText) } catch { codes.push('SETTINGS.MANAGED_UNPARSABLE') }
  if (managed && digestJson(managed) !== digestJson(MANAGED_SETTINGS)) codes.push('SETTINGS.MANAGED_DRIFT')
  if (managedOwner !== 'root:root 644') codes.push('SETTINGS.MANAGED_NOT_ROOT_OWNED')
  for (const k of Object.keys(cliSettings)) if (!['model'].includes(k)) codes.push(`SETTINGS.CLI_KEY_NOT_ALLOWED:${k}`)
  return { codes, effective: { ...(managed ?? {}), ...cliSettings } }
}

/** The binary facts the VM reports must match the pin recorded at provisioning (installed 0555 root:root). */
export function verifyBinary(reported, pin) {
  const codes = []
  if (reported?.path !== CLAUDE_INSTALL_PATH) codes.push('BINARY.PATH_MISMATCH')
  if (reported?.owner !== 'root:root' || reported?.mode !== '-r-xr-xr-x') codes.push('BINARY.NOT_ROOT_OWNED_READONLY')
  if (!pin || !/^[0-9a-f]{128}$/.test(pin.sha512 ?? '') || reported?.sha512 !== pin.sha512) codes.push('BINARY.DIGEST_MISMATCH')
  if (!pin || reported?.version !== pin.version) codes.push('BINARY.VERSION_MISMATCH')
  return codes
}

/** Guest shell snippet whose output `parseBinaryFacts` reads. */
export const BINARY_FACTS_SCRIPT = `stat -c '%U:%G %A' ${CLAUDE_INSTALL_PATH}; sha512sum ${CLAUDE_INSTALL_PATH} | cut -d' ' -f1; ${CLAUDE_INSTALL_PATH} --version | head -1; readlink -f /usr/local/bin/claude; stat -c '%U:%G %a' /etc/claude-code/managed-settings.json; cat /etc/claude-code/managed-settings.json`
export function parseBinaryFacts(text) {
  const l = String(text).split(/\r?\n/)
  const [owner, mode] = (l[0] ?? '').split(' ')
  return { binary: { path: l[3] === CLAUDE_INSTALL_PATH ? CLAUDE_INSTALL_PATH : l[3] ?? null, owner, mode, sha512: l[1] ?? null, version: (/^([0-9]+\.[0-9]+\.[0-9]+)/.exec(l[2] ?? '') ?? [])[1] ?? null },
    managedOwner: l[4] ?? null, managedText: l.slice(5).join('\n') }
}

/** The `trusted.launch` block for D3.2's evaluator. auth/extra-usage come from the governor's normalized, basis-labelled facts. */
export function buildTrustedLaunch({ env, origins, effectiveSettings, authFacts, extraUsage }) {
  return {
    env_names: Object.keys(env), settings: { ...effectiveSettings, env: {} }, env_value_origins: { ...origins },
    auth: authFacts ? { verified: authFacts.verified === true, verified_by: 'launcher', source: authFacts.source, plan: authFacts.plan,
      extra_usage_enabled: extraUsage?.enabled === false ? false : extraUsage?.enabled === true ? true : null } : null,
  }
}

/**
 * Fixed argv. Prompt goes over stdin (never argv, never logged). Security review S3: the launcher EVALUATES the request itself with the D3.2
 * evaluator and takes the environment from the SAME trusted block it evaluated — no caller-supplied decision object or environment can produce
 * `--dangerously-skip-permissions`. Returns the decision alongside the argv for the execution record.
 */
export function buildInvocation({ policy, action, taskId, trusted, now, evidence = [], model, maxTurns, safeMode = true }) {
  if (!LAUNCH_ACTIONS.includes(action)) return { ok: false, code: 'LAUNCH.NOT_A_LAUNCH_ACTION' }
  const decision = evaluateLaunch({ policy, action, taskId, trusted, now, evidence })
  const r = invocationFor({ model, maxTurns, decision, environment: trusted?.environment, taskId, safeMode })
  return { ...r, decision }
}

function invocationFor({ model, maxTurns, decision, environment, taskId, safeMode }) {
  if (!/^[a-z0-9.-]{2,64}$/.test(model ?? '')) return { ok: false, code: 'LAUNCH.BAD_MODEL' }
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 400) return { ok: false, code: 'LAUNCH.BAD_MAX_TURNS' }
  if (decision?.schema !== DECISION_SCHEMA || !LAUNCH_ACTIONS.includes(decision?.request_action) || typeof taskId !== 'string' || decision.task_id !== taskId) return { ok: false, code: 'LAUNCH.DECISION_NOT_BOUND' }
  const argv = [CLAUDE_INSTALL_PATH, '-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--strict-mcp-config', '--model', model, '--max-turns', String(maxTurns)]
  if (safeMode) argv.push('--safe-mode')
  const wantsBypass = decision.request_action === 'start_bypass_permissions_session'
  if (decision.decision !== 'allow') return { ok: false, code: wantsBypass ? 'LAUNCH.BYPASS_NOT_AUTHORIZED' : 'LAUNCH.NOT_AUTHORIZED', reason_codes: decision.reason_codes ?? [] }
  if (wantsBypass) {
    if (environment?.kind !== 'isolated_vm') return { ok: false, code: 'LAUNCH.BYPASS_OUTSIDE_ISOLATION' }
    argv.push('--dangerously-skip-permissions')
  } else argv.push('--permission-mode', 'dontAsk')
  return { ok: true, argv, permission_mode: wantsBypass ? 'bypassPermissions' : 'dontAsk' }
}

/** Dry-run evaluation: returns the D3.2 decision bound to the action and task; the caller may never execute anything on `deny`. */
export function evaluateLaunch({ policy, action, taskId, trusted, now, evidence = [] }) {
  const d = evaluate({ policy, request: { action, task_id: taskId, params: action === 'start_bypass_permissions_session' ? { permission_mode: 'bypass', incremental_usd: 0 } : { incremental_usd: 0 } }, trusted, evidence, now })
  return { ...d, request_action: action, task_id: taskId }
}

/** Sanitized, atomically written execution record. Never contains prompts, outputs, env VALUES or credentials. */
export function writeExecutionRecord(dir, rec) {
  const file = path.join(dir, `${rec.execution_id}.json`)
  atomicWriteJson(file, { schema: 'patelrep.developer-harness-v3.execution-record', ...rec })
  return file
}

export const isPidAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

/**
 * Run one session.
 *  - `spawnSession({argv, env, stdin})` returns a child-like object (stdout, kill(), on('close'|'error')). For the VM this is an SSH channel.
 *  - `terminateRemote()` kills the session's process tree where it really runs (VM: every process of the guest `worker` user, all task-owned);
 *    `verifyStopped()` returns true only when nothing of the session is left. The lock is released ONLY after verified termination; otherwise the
 *    record says `termination_unverified` and the lock stays held (no second session can start on top of a survivor).
 */
export async function runSession({ spawnSession, terminateRemote = async () => {}, verifyStopped = async () => true, argv, env, prompt, expectInit, timeoutMs, signal, lockFile, executionsDir, taskId, fencingToken, now = Date.now, closeGraceMs = 20000 }) {
  if (!expectInit || typeof expectInit !== 'object') return { ok: false, code: 'LAUNCH.EXPECT_INIT_REQUIRED' }
  const execution_id = randomUUID()
  if (lockFile) {
    const l = acquireLock(lockFile, { execution_id, task_id: taskId, acquired_at: new Date(now()).toISOString() }, { isHolderAlive: (h) => (Number.isInteger(h.pid) ? isPidAlive(h.pid) : null) })
    if (!l.ok) return { ok: false, code: 'LAUNCH.REASONING_SESSION_ACTIVE', holder: l.holder?.execution_id ?? null }
  }
  const t = createTelemetry()
  const started = now()
  const base = { execution_id, task_id: taskId, fencing_token: fencingToken, started_at: new Date(started).toISOString(), argv_digest: createHash('sha256').update(JSON.stringify(argv)).digest('hex'), env_names: Object.keys(env), state: 'running' }
  let killedReason = null; let releaseOk = true; let timer = null; let onAbort = null
  try {
    if (executionsDir) writeExecutionRecord(executionsDir, base)
    const child = spawnSession({ argv, env, stdin: prompt })
    const closed = new Promise((resolve) => { child.on('close', (code, sig) => resolve({ code, signal: sig ?? null })); child.on('error', () => resolve({ code: null, signal: 'SPAWN_ERROR' })) })
    const kill = (why) => { if (!killedReason) { killedReason = why; try { child.kill() } catch { /* already gone */ } Promise.resolve().then(terminateRemote).catch(() => {}) } }
    timer = setTimeout(() => kill('LAUNCH.WALL_TIME_EXCEEDED'), timeoutMs)
    onAbort = () => kill('LAUNCH.CANCELLED')
    signal?.addEventListener('abort', onAbort, { once: true })
    const decoder = new StringDecoder('utf8') // chunks may split a multi-byte character
    let pending = ''
    const onLine = (line) => {
      if (!line.trim()) return
      const type = feedLine(t, line)
      if (type === 'system' && t.init && !t.init_checked) { t.init_checked = true; const c = verifyInit(t.init, expectInit); if (c.length) kill(`LAUNCH.INIT_MISMATCH:${c[0]}`) }
      if (type !== 'system' && !t.init && type) kill('LAUNCH.INIT_MISSING') // the first structured event must be init; nothing runs unverified
      if (type === 'rate_limit_event' && extraUsageFromRateLimits(t.rate_limits).enabled === true) kill('LAUNCH.OVERAGE_SIGNAL')
    }
    child.stdout.on('data', (d) => {
      pending += typeof d === 'string' ? d : decoder.write(d)
      let i
      while ((i = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, i); pending = pending.slice(i + 1); onLine(line) }
      if (pending.length > 4 * 1024 * 1024) { pending = ''; kill('LAUNCH.STREAM_LINE_TOO_LARGE') }
    })
    let exit = await Promise.race([closed, new Promise((r) => { const w = setInterval(() => { if (killedReason) { clearInterval(w); setTimeout(() => r(null), closeGraceMs) } }, 100); closed.then(() => clearInterval(w)) })])
    if (!exit) exit = { code: null, signal: 'CLOSE_TIMEOUT' }
    pending += decoder.end(); if (pending.trim()) onLine(pending)
    if (!t.init && !killedReason) killedReason = 'LAUNCH.INIT_MISSING'
    if (killedReason) { await terminateRemote().catch(() => {}); releaseOk = await verifyStopped().catch(() => false) }
    const observation = classifyObservation({ telemetry: t, exit, killedReason }, { now: now() })
    const summary = { exit, killed_reason: killedReason, termination_verified: releaseOk, duration_ms: now() - started, init: t.init, result: t.result && { ...t.result, errors: t.result.errors.length },
      rate_limits: t.rate_limits.slice(-3), context: contextUtilization(t), compactions: t.compactions, malformed_lines: t.malformed, models: [...t.models],
      observation: { state: observation.state, reason_codes: observation.reason_codes, extra_usage: observation.extra_usage } }
    if (executionsDir) writeExecutionRecord(executionsDir, { ...base, state: !releaseOk ? 'termination_unverified' : killedReason ? 'killed' : 'exited', finished_at: new Date(now()).toISOString(), ...summary })
    return { ok: !killedReason && exit.code === 0 && t.result?.is_error === false, execution_id, telemetry: t, observation, ...summary }
  } catch (e) {
    killedReason = killedReason ?? 'LAUNCH.SPAWN_FAILED'
    await terminateRemote().catch(() => {}); releaseOk = await verifyStopped().catch(() => false)
    try { if (executionsDir) writeExecutionRecord(executionsDir, { ...base, state: releaseOk ? 'failed' : 'termination_unverified', error: String(e.message).slice(0, 200), finished_at: new Date(now()).toISOString() }) } catch { /* recording failure must not hide the original */ }
    return { ok: false, code: killedReason, execution_id, termination_verified: releaseOk }
  } finally {
    clearTimeout(timer); if (onAbort) signal?.removeEventListener?.('abort', onAbort)
    if (lockFile && releaseOk) releaseLock(lockFile, { execution_id })
  }
}
