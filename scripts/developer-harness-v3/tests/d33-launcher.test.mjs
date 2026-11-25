// D3.3 trusted launcher: environment construction, D3.2 evaluator integration (dry-run), invocation boundary, kill switches, locks, records.
// Synthetic processes only. No real Claude session and no Bypass Permissions run here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildInvocation, buildTrustedLaunch, buildWorkerEnvironment, CLAUDE_INSTALL_PATH, evaluateLaunch, guestSessionCommand, MANAGED_SETTINGS, parseBinaryFacts, runSession, shellQuote, verifyBinary, verifyEffectiveSettings } from '../runtime/launcher.mjs'
import { checkCredentialEnvironment, checkLauncherControlled } from '../authority/spend.mjs'
import { buildPolicy, evidence, ISOLATED_ENV, NOW, trustedFor } from './helpers.mjs'
import { normalizeAuthStatus } from '../runtime/subscription-governor.mjs'

const AUTH = normalizeAuthStatus({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', planTier: 'max_5x', loginExpiresAt: '2026-12-22T08:46:11.014Z' }, { now: NOW })
const OFF = { enabled: false, basis: 'test' }
const launchFor = (over = {}) => { const { env, origins } = buildWorkerEnvironment({ proxyUrl: 'http://127.0.0.1:3128', nodeHeapMb: 1024 }); return { ...buildTrustedLaunch({ env, origins, effectiveSettings: { ...MANAGED_SETTINGS }, authFacts: AUTH, extraUsage: OFF }), ...over } }

test('worker environment is constructed, never inherited, and passes the D3.2 allow-list and origin checks', () => {
  process.env.DH3_CANARY_SECRET_TOKEN = 'must-not-leak'
  try {
    const { env, origins } = buildWorkerEnvironment({ proxyUrl: 'http://127.0.0.1:3128', nodeHeapMb: 1024 })
    assert.ok(!Object.values(env).includes('must-not-leak') && !('DH3_CANARY_SECRET_TOKEN' in env))
    const { policy } = buildPolicy()
    assert.deepEqual(checkCredentialEnvironment(Object.keys(env), policy.contract), [])
    assert.deepEqual(checkLauncherControlled(Object.keys(env), origins, [], policy.contract), [])
    assert.equal(env.PATH, '/usr/local/bin:/usr/bin:/bin'); assert.equal(env.NODE_OPTIONS, '--max-old-space-size=1024')
  } finally { delete process.env.DH3_CANARY_SECRET_TOKEN }
  assert.throws(() => buildWorkerEnvironment({ proxyUrl: 'http://10.0.2.2:3128' }), /PROXY_NOT_THE_EGRESS_ENDPOINT/)
  assert.throws(() => buildWorkerEnvironment({ user: 'root;rm' }), /BAD_USER/)
  assert.throws(() => buildWorkerEnvironment({ nodeHeapMb: 99999 }), /BAD_HEAP/)
  assert.throws(() => buildWorkerEnvironment({ tz: 'UTC\nEVIL=1' }), /BAD_VALUE/)
})

test('evaluator (dry-run): verified Max 5x subscription launch is allowed; every unverified or paid path is denied', () => {
  const { policy } = buildPolicy()
  const ev = (launch, env = ISOLATED_ENV) => evaluateLaunch({ policy, action: 'launch_claude_session', taskId: 'task-1', trusted: trustedFor('orchestrator', { launch, environment: env }), now: NOW })
  assert.equal(ev(launchFor()).decision, 'allow')
  const deny = (launch, code) => { const d = ev(launch); assert.equal(d.decision, 'deny'); assert.ok(d.reason_codes.some((c) => c.startsWith(code)), `${code} in ${d.reason_codes}`) }
  deny(launchFor({ auth: { ...launchFor().auth, extra_usage_enabled: null } }), 'AUTH.EXTRA_USAGE_UNVERIFIED')
  deny(launchFor({ auth: { ...launchFor().auth, extra_usage_enabled: true } }), 'AUTH.EXTRA_USAGE_ENABLED')
  deny(launchFor({ auth: { ...launchFor().auth, plan: 'claude_pro' } }), 'AUTH.PLAN_NOT_AUTHORIZED')
  deny(launchFor({ auth: { ...launchFor().auth, plan: 'claude_max_20x' } }), 'AUTH.PLAN_NOT_AUTHORIZED')
  deny(launchFor({ auth: null }), 'AUTH.UNVERIFIED')
  deny(launchFor({ env_names: [...launchFor().env_names, 'ANTHROPIC_API_KEY'] }), 'AUTH.FORBIDDEN_ENVIRONMENT')
  deny(launchFor({ env_names: [...launchFor().env_names, 'CLAUDE_CODE_OAUTH_TOKEN'] }), 'AUTH.FORBIDDEN_ENVIRONMENT')
  deny(launchFor({ settings: { ...MANAGED_SETTINGS, apiKeyHelper: '/bin/x' } }), 'AUTH.FORBIDDEN_SETTING')
})

test('environment value-origin spoofing and repository-controlled settings env are refused', () => {
  const { policy } = buildPolicy()
  const ev = (launch) => evaluateLaunch({ policy, action: 'launch_claude_session', taskId: 'task-1', trusted: trustedFor('orchestrator', { launch }), now: NOW })
  const l = launchFor()
  for (const origins of [{ ...l.env_value_origins, HTTPS_PROXY: 'inherited' }, { ...l.env_value_origins, NODE_OPTIONS: undefined }, { ...l.env_value_origins, https_proxy: 'trusted_launcher' }])
    assert.ok(ev({ ...l, env_value_origins: JSON.parse(JSON.stringify(origins)) }).reason_codes.some((c) => c.startsWith('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER')))
  assert.ok(ev({ ...l, env_names: [...l.env_names, 'https_proxy'] }).reason_codes.some((c) => c.startsWith('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER')), 'two spellings')
  assert.ok(ev({ ...l, settings: { ...l.settings, env: { PATH: '/evil' } } }).reason_codes.some((c) => c.startsWith('ENV.SETTINGS_ENV_NOT_ALLOWED')))
  assert.ok(ev({ ...l, settings: { ...l.settings, env: { NODE_OPTIONS: '--require /evil.js' } } }).reason_codes.some((c) => c.startsWith('ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER')))
})

test('managed settings drift, non-root ownership, or extra CLI settings fail preflight; binary pin is enforced', () => {
  assert.deepEqual(verifyEffectiveSettings({ managedText: JSON.stringify(MANAGED_SETTINGS), managedOwner: 'root:root 644' }).codes, [])
  assert.deepEqual(verifyEffectiveSettings({ managedText: JSON.stringify({ ...MANAGED_SETTINGS, disableAllHooks: false }), managedOwner: 'root:root 644' }).codes, ['SETTINGS.MANAGED_DRIFT'])
  assert.deepEqual(verifyEffectiveSettings({ managedText: JSON.stringify(MANAGED_SETTINGS), managedOwner: 'worker:worker 644' }).codes, ['SETTINGS.MANAGED_NOT_ROOT_OWNED'])
  assert.deepEqual(verifyEffectiveSettings({ managedText: '{', managedOwner: 'root:root 644' }).codes, ['SETTINGS.MANAGED_UNPARSABLE'])
  assert.deepEqual(verifyEffectiveSettings({ managedText: JSON.stringify(MANAGED_SETTINGS), managedOwner: 'root:root 644', cliSettings: { hooks: {} } }).codes, ['SETTINGS.CLI_KEY_NOT_ALLOWED:hooks'])
  const pin = { sha512: 'a'.repeat(128), version: '2.1.331' }
  assert.deepEqual(verifyBinary({ path: CLAUDE_INSTALL_PATH, owner: 'root:root', mode: '-r-xr-xr-x', sha512: 'a'.repeat(128), version: '2.1.331' }, pin), [])
  assert.deepEqual(verifyBinary({ path: '/home/worker/.local/bin/claude', owner: 'worker:worker', mode: '-rwxrwxrwx', sha512: 'b'.repeat(128), version: '2.1.400' }, pin).sort(), ['BINARY.DIGEST_MISMATCH', 'BINARY.NOT_ROOT_OWNED_READONLY', 'BINARY.PATH_MISMATCH', 'BINARY.VERSION_MISMATCH'])
})

test('bypass flag: constructed ONLY when the launcher OWN evaluation allows it in an isolated_vm; the shipped (inactive) contract never produces it', () => {
  const inactive = buildPolicy()
  const trusted = trustedFor('orchestrator', { launch: launchFor() })
  const B = (o) => buildInvocation({ action: 'start_bypass_permissions_session', taskId: 'task-1', now: NOW, model: 'sonnet', maxTurns: 10, ...o })
  const i0 = B({ policy: inactive.policy, trusted, evidence: [evidence('isolation_attestation', inactive)] })
  assert.equal(i0.ok, false); assert.equal(i0.code, 'LAUNCH.BYPASS_NOT_AUTHORIZED'); assert.ok(i0.decision.reason_codes.includes('ACTIVATION.NOT_ACTIVE:start_bypass_permissions_session'))
  // Test-only in-memory policy that activates the action (never written anywhere): proves the construction path works when legitimately allowed.
  const active = buildPolicy({ activate: ['start_bypass_permissions_session'] })
  const i1 = B({ policy: active.policy, trusted, evidence: [evidence('isolation_attestation', active)] })
  assert.ok(i1.ok, JSON.stringify(i1.decision?.reason_codes)); assert.ok(i1.argv.includes('--dangerously-skip-permissions') && i1.argv[0] === CLAUDE_INSTALL_PATH)
  assert.deepEqual(i1.argv.slice(i1.argv.indexOf('--setting-sources'), i1.argv.indexOf('--setting-sources') + 2), ['--setting-sources', ''])
  assert.ok(i1.argv.includes('--strict-mcp-config') && !i1.argv.includes('--mcp-config'))
  // The environment is taken from the evaluated trusted block: a host environment is refused by the evaluator itself.
  const iHost = B({ policy: active.policy, trusted: { ...trusted, environment: { ...trusted.environment, kind: 'windows_host' } }, evidence: [evidence('isolation_attestation', active)] })
  assert.equal(iHost.ok, false); assert.ok(iHost.decision.reason_codes.includes('ENV.BYPASS_OUTSIDE_ISOLATION'))
  const iProp = B({ policy: active.policy, trusted: { ...trusted, environment: { ...trusted.environment, egress_restricted: false } }, evidence: [evidence('isolation_attestation', active)] })
  assert.equal(iProp.ok, false); assert.ok(iProp.decision.reason_codes.includes('ENV.ISOLATION_PROPERTY_UNPROVEN:egress_restricted'))
  const iOther = B({ policy: active.policy, trusted, taskId: 'task-2', evidence: [evidence('isolation_attestation', active)] })
  assert.equal(iOther.ok, false, 'the request task must match the trusted task')
  const plain = buildInvocation({ policy: inactive.policy, action: 'launch_claude_session', taskId: 'task-1', trusted, now: NOW, model: 'haiku', maxTurns: 1 })
  assert.ok(plain.ok && !plain.argv.includes('--dangerously-skip-permissions') && plain.argv.includes('dontAsk'))
  assert.equal(buildInvocation({ policy: inactive.policy, action: 'cleanup_task_owned_resources', taskId: 'task-1', trusted, now: NOW, model: 'haiku', maxTurns: 1 }).code, 'LAUNCH.NOT_A_LAUNCH_ACTION')
  assert.equal(buildInvocation({ policy: { forged: true }, action: 'launch_claude_session', taskId: 'task-1', trusted, now: NOW, model: 'haiku', maxTurns: 1 }).ok, false, 'an unloaded policy object is denied (POLICY.NOT_LOADED)')
  assert.equal(buildInvocation({ policy: inactive.policy, action: 'launch_claude_session', taskId: 'task-1', trusted: { ...trusted, launch: { ...trusted.launch, auth: null } }, now: NOW, model: 'haiku', maxTurns: 1 }).code, 'LAUNCH.NOT_AUTHORIZED')
  assert.equal(buildInvocation({ policy: inactive.policy, action: 'launch_claude_session', taskId: 'task-1', trusted, now: NOW, model: 'haiku; rm -rf /', maxTurns: 1 }).code, 'LAUNCH.BAD_MODEL')
  assert.equal(MANAGED_SETTINGS.permissions.disableBypassPermissionsMode, 'disable', 'until activation the CLI itself also refuses the flag inside the worker')
})

test('guest command: exact env via env -i, guest-side timeout, every argv element single-quoted (incl. the empty setting source)', () => {
  const { env } = buildWorkerEnvironment({ proxyUrl: 'http://127.0.0.1:3128' })
  const c = guestSessionCommand({ argv: [CLAUDE_INSTALL_PATH, '--setting-sources', '', "it's"], env, timeoutS: 60 })
  assert.match(c, /sudo -n -u worker -H \/usr\/bin\/env -i PATH='\/usr\/local\/bin:\/usr\/bin:\/bin' /)
  assert.match(c, /\/usr\/bin\/timeout --kill-after=15s 60s '\/opt\/patelrep-claude\/bin\/claude' '--setting-sources' '' 'it'\\''s'$/)
  assert.equal(shellQuote(''), "''")
  assert.throws(() => guestSessionCommand({ argv: ['x'], env, timeoutS: 1 }), /BAD_TIMEOUT/)
  const f = parseBinaryFacts(`root:root -r-xr-xr-x\n${'a'.repeat(128)}\n2.1.331 (Claude Code)\n${CLAUDE_INSTALL_PATH}\nroot:root 644\n${JSON.stringify(MANAGED_SETTINGS)}`)
  assert.deepEqual(verifyBinary(f.binary, { sha512: 'a'.repeat(128), version: '2.1.331' }), [])
  assert.deepEqual(verifyEffectiveSettings({ managedText: f.managedText, managedOwner: f.managedOwner }).codes, [])
  assert.deepEqual(verifyBinary({ ...f.binary, mode: '-r-xr-xr-xT' }, { sha512: 'a'.repeat(128), version: '2.1.331' }), ['BINARY.NOT_ROOT_OWNED_READONLY'], 'mode match is exact')
})

function fakeChild(lines, { closeAfterMs = 20, hang = false } = {}) {
  const c = new EventEmitter(); c.stdout = new EventEmitter(); c.killed = false
  c.kill = () => { if (!c.killed) { c.killed = true; setTimeout(() => c.emit('close', null, 'SIGTERM'), 5) } }
  setTimeout(() => { for (const l of lines) c.stdout.emit('data', `${l}\n`); if (!hang) setTimeout(() => { if (!c.killed) c.emit('close', 0, null) }, closeAfterMs) }, 5)
  return c
}
const FIX = readFileSync(new URL('./fixtures/stream-observed-shape.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean)
const EXPECT = { permissionMode: 'dontAsk', version: '2.1.331', mcpServers: [], pluginSources: [], tools: [] }
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'dh3-launch-'))
const base = (dir, over = {}) => ({ argv: ['x'], env: { PATH: '/bin' }, prompt: 'PROMPT-SYNTHETIC-SECRET', expectInit: EXPECT, timeoutMs: 2000, lockFile: path.join(dir, 'lock'), executionsDir: path.join(dir, 'ex'), taskId: 'task-1', fencingToken: 3, ...over })

test('runSession: success path, sanitized record (no prompt, no output, no credential-shaped content), lock released', async () => {
  const dir = tmp()
  try {
    const r = await runSession({ ...base(dir), spawnSession: () => fakeChild(FIX) })
    assert.equal(r.ok, true); assert.equal(r.observation.state, 'available'); assert.equal(r.observation.extra_usage.enabled, false)
    const files = readdirSync(path.join(dir, 'ex')); assert.equal(files.length, 1)
    const text = readFileSync(path.join(dir, 'ex', files[0]), 'utf8')
    for (const s of ['PROMPT-SYNTHETIC-SECRET', 'SYNTHETIC-NOT-A-REAL-CREDENTIAL', '/bin']) assert.ok(!text.includes(s), s)
    assert.equal(JSON.parse(text).fencing_token, 3)
    const again = await runSession({ ...base(dir), spawnSession: () => fakeChild(FIX) }); assert.equal(again.ok, true, 'lock was released')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('runSession kill switches: init mismatch, overage signal, wall time, cancellation', async () => {
  const dir = tmp()
  try {
    const apiKey = FIX.map((l, i) => (i === 0 ? l.replace('"apiKeySource":"none"', '"apiKeySource":"ANTHROPIC_API_KEY"') : l))
    assert.match((await runSession({ ...base(dir), spawnSession: () => fakeChild(apiKey, { hang: true }) })).killed_reason, /INIT_MISMATCH:AUTH.API_KEY_SOURCE_ACTIVE/)
    const over = [FIX[0], JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: true } })]
    const o = await runSession({ ...base(dir), spawnSession: () => fakeChild(over, { hang: true }) })
    assert.equal(o.killed_reason, 'LAUNCH.OVERAGE_SIGNAL'); assert.equal(o.observation.state, 'unauthorized_billing')
    assert.equal((await runSession({ ...base(dir, { timeoutMs: 100 }), spawnSession: () => fakeChild([FIX[0]], { hang: true }) })).killed_reason, 'LAUNCH.WALL_TIME_EXCEEDED')
    const ac = new AbortController(); setTimeout(() => ac.abort(), 50)
    assert.equal((await runSession({ ...base(dir, { signal: ac.signal }), spawnSession: () => fakeChild([FIX[0]], { hang: true }) })).killed_reason, 'LAUNCH.CANCELLED')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('duplicate launch prevention: a second reasoning session cannot start while one holds the lock', async () => {
  const dir = tmp()
  try {
    const first = runSession({ ...base(dir), spawnSession: () => fakeChild(FIX, { closeAfterMs: 300 }) })
    await new Promise((r) => setTimeout(r, 50))
    const second = await runSession({ ...base(dir), spawnSession: () => { throw new Error('must not spawn') } })
    assert.equal(second.ok, false); assert.equal(second.code, 'LAUNCH.REASONING_SESSION_ACTIVE')
    assert.equal((await first).ok, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('kill terminates the REMOTE tree; the lock is released only after verified termination, otherwise it stays held', async () => {
  const dir = tmp()
  try {
    let remoteKills = 0
    const r = await runSession({ ...base(dir, { timeoutMs: 80, closeGraceMs: 50 }), spawnSession: () => fakeChild([FIX[0]], { hang: true }), terminateRemote: async () => { remoteKills += 1 }, verifyStopped: async () => true })
    assert.equal(r.killed_reason, 'LAUNCH.WALL_TIME_EXCEEDED'); assert.ok(remoteKills >= 1); assert.equal(r.termination_verified, true)
    const u = await runSession({ ...base(dir, { timeoutMs: 80, closeGraceMs: 50 }), spawnSession: () => fakeChild([FIX[0]], { hang: true }), verifyStopped: async () => false })
    assert.equal(u.termination_verified, false)
    const blocked = await runSession({ ...base(dir), spawnSession: () => { throw new Error('must not spawn') } })
    assert.equal(blocked.code, 'LAUNCH.REASONING_SESSION_ACTIVE', 'a possibly-surviving session keeps the single reasoning slot')
    const files = readdirSync(path.join(dir, 'ex')).map((f) => JSON.parse(readFileSync(path.join(dir, 'ex', f), 'utf8')))
    assert.ok(files.some((x) => x.state === 'termination_unverified'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('runSession fails closed: expectation required, missing init, spawn failure; UTF-8 split across chunks is decoded', async () => {
  const dir = tmp()
  try {
    assert.equal((await runSession({ ...base(dir, { expectInit: undefined }), spawnSession: () => fakeChild(FIX) })).code, 'LAUNCH.EXPECT_INIT_REQUIRED')
    const noInit = await runSession({ ...base(dir), spawnSession: () => fakeChild(FIX.slice(1)) })
    assert.equal(noInit.ok, false); assert.equal(noInit.killed_reason, 'LAUNCH.INIT_MISSING'); assert.notEqual(noInit.observation.state, 'available')
    const sp = await runSession({ ...base(dir), spawnSession: () => { throw new Error('boom') } })
    assert.equal(sp.ok, false); assert.equal(sp.code, 'LAUNCH.SPAWN_FAILED')
    assert.equal((await runSession({ ...base(dir), spawnSession: () => fakeChild(FIX) })).ok, true, 'lock released after a verified spawn failure')
    // A multi-byte character split across two Buffer chunks.
    const text = FIX.join('\n').replace('"OK ', '"OK \u00e9 ') + '\n'
    const buf = Buffer.from(text, 'utf8'); const cut = buf.indexOf(Buffer.from('\u00e9', 'utf8')) + 1
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.kill = () => {}
    setTimeout(() => { c.stdout.emit('data', buf.subarray(0, cut)); c.stdout.emit('data', buf.subarray(cut)); setTimeout(() => c.emit('close', 0, null), 10) }, 5)
    const u8 = await runSession({ ...base(dir), spawnSession: () => c })
    assert.equal(u8.ok, true); assert.equal(u8.malformed_lines, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})