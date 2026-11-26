// D3.4 wiring of the D3.3 components (trusted launcher, governors, recovery primitives) and the activation-gate register.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createD33Adapters, planSession } from '../orchestrator/d33-adapters.mjs'
import { Engine } from '../orchestrator/engine.mjs'
import { GATES, liveExecutionAllowed, renderRegister } from '../orchestrator/activation-gates.mjs'
import { buildTrustedLaunch, buildWorkerEnvironment, MANAGED_SETTINGS } from '../runtime/launcher.mjs'
import { normalizeAuthStatus, isSubscriptionStateRecord } from '../runtime/subscription-governor.mjs'
import { routeStage } from '../orchestrator/routing.mjs'
import { buildPolicy, NOW, trustedFor } from './helpers.mjs'

const AUTH = normalizeAuthStatus({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', planTier: 'max_5x', loginExpiresAt: '2026-12-22T08:46:11.014Z' }, { now: NOW })
const launch = (over = {}) => { const { env, origins } = buildWorkerEnvironment({ proxyUrl: 'http://127.0.0.1:3128', nodeHeapMb: 1024 }); return { ...buildTrustedLaunch({ env, origins, effectiveSettings: { ...MANAGED_SETTINGS }, authFacts: AUTH, extraUsage: { enabled: false, basis: 't' } }), ...over } }
const sonnetHigh = { ai: true, model: 'sonnet', effort: 'high', reason_codes: [] }

test('session invocation goes through the D3.3 launcher AND the D3.2 evaluator: dontAsk only, routed model + effort, never bypass, never a fallback model', () => {
  const p = buildPolicy(); const trusted = trustedFor('orchestrator', { launch: launch() })
  const r = planSession({ policy: p.policy, taskId: 'task-1', trusted, route: sonnetHigh, now: NOW, maxTurns: 20 })
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.permission_mode, 'dontAsk'); assert.ok(r.argv.includes('--permission-mode') && r.argv.includes('dontAsk')); assert.deepEqual(r.argv.slice(-2), ['--effort', 'high']); assert.equal(r.argv[r.argv.indexOf('--model') + 1], 'sonnet')
  assert.ok(!r.argv.includes('--dangerously-skip-permissions') && !r.argv.includes('--fallback-model')); assert.equal(r.decision.decision, 'allow'); assert.ok(r.argv.includes('--strict-mcp-config') && r.argv.includes('--safe-mode'))
  // even a policy that ACTIVATES bypass never produces a bypass launch from D3.4 code
  const active = buildPolicy({ activate: ['start_bypass_permissions_session'] }); const a = planSession({ policy: active.policy, taskId: 'task-1', trusted, route: sonnetHigh, now: NOW, maxTurns: 20 })
  assert.ok(a.ok && !a.argv.includes('--dangerously-skip-permissions'))
  assert.equal(planSession({ policy: p.policy, taskId: 'task-1', trusted, route: { ai: true, wait: true, code: 'X' }, now: NOW, maxTurns: 20 }).code, 'PLAN.NOT_A_SESSION_ROUTE'); assert.equal(planSession({ policy: p.policy, taskId: 'task-1', trusted, route: { ...sonnetHigh, effort: 'max' }, now: NOW, maxTurns: 20 }).code, 'ROUTE.UNSUPPORTED_COMBINATION')
  // unverified/billing facts are refused by the evaluator, so no session plan exists
  for (const bad of [{ launch: launch({ auth: null }) }, { launch: launch({ auth: { ...launch().auth, extra_usage_enabled: true } }) }, { launch: launch({ env_names: [...launch().env_names, 'ANTHROPIC_API_KEY'] }) }]) assert.equal(planSession({ policy: p.policy, taskId: 'task-1', trusted: trustedFor('orchestrator', bad), route: sonnetHigh, now: NOW, maxTurns: 20 }).ok, false)
  assert.equal(planSession({ policy: p.policy, taskId: 'task-1', trusted, route: { ...sonnetHigh, model: 'sonnet; rm -rf /' }, now: NOW, maxTurns: 20 }).ok, false)
})

test('D3.3 adapters wire the real components; everything that would run a live session refuses; an engine will not accept them', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dh34-glue-')); const calls = []; let stopped = false
  const A = createD33Adapters({ W: { dir }, cfg: { vm: { name: 'x' }, accel: 'whpx' }, stateDir: dir, sampleHost: async () => ({ available_mb: 5000 }), readVmRecord: () => ({ schema: 'patelrep.developer-harness-v3.vm-supervisor', supervisor_pid: 1, qemu_pid: 2, marker: 'm', state: 'running' }),
    liveness: () => ({ supervisor: !stopped, qemu: !stopped, qemuImage: 'qemu-system-x86_64.exe', reused: false }), killWorkerProcesses: () => { calls.push('kill'); return true }, stopVm: async () => { calls.push('stop'); stopped = true } })
  assert.equal(A.simulated, false); assert.equal((await A.resources.sample()).accel, 'whpx'); assert.equal(A.subscription.load(), null, 'absent governor state => null => the engine blocks, never "available"')
  const rec = { schema: 'patelrep.developer-harness-v3.subscription-governor', state: 'available', next_eligible_at: null, updated_at: 1, extra_usage: { enabled: false, basis: 'b', verified_at: 1 } }; assert.ok(isSubscriptionStateRecord(rec)); A.subscription.save(rec); assert.deepEqual(A.subscription.load(), rec)
  assert.equal((await A.worker.liveness()).liveness.qemu, true); assert.deepEqual(await A.worker.cleanupGuest(), { verified: true }); assert.deepEqual(await A.worker.stopWorker(), { verified: true }); assert.deepEqual(calls, ['kill', 'stop'])
  const bad = createD33Adapters({ W: {}, cfg: { vm: {} }, stateDir: dir, sampleHost: async () => ({}), readVmRecord: () => null, liveness: () => ({}), killWorkerProcesses: () => { throw new Error('ssh down') }, stopVm: async () => { throw new Error('x') } })
  assert.deepEqual(await bad.worker.cleanupGuest(), { verified: false }, 'a failed cleanup is NEVER reported verified'); assert.deepEqual(await bad.worker.stopWorker(), { verified: false }); assert.equal((await bad.worker.liveness()).record, null)
  for (const f of [() => A.session.runUnit(), () => A.git.deriveCandidate(), () => A.tests.run(), () => A.worker.terminateSession(), () => A.worker.ensure()]) await assert.rejects(Promise.resolve().then(f), /LIVE_ADAPTER_NOT_IMPLEMENTED|WORKER_START_REQUIRES_OWNER/)
  assert.throws(() => new Engine({ ledger: {}, policy: {}, adapters: A, snapshotRoot: dir }), /SIMULATED_MODE_REQUIRES_SIMULATED_ADAPTERS/)
})

test('activation-gate register: complete, unique, honest (nothing closed), every brief item present, and rendered for the docs', () => {
  assert.equal(new Set(GATES.map((g) => g.id)).size, GATES.length); assert.ok(GATES.every((g) => ['open', 'prepared', 'closed'].includes(g.status) && g.title && g.d34 && g.owner_step && g.source))
  assert.equal(GATES.filter((g) => g.status === 'closed').length, 0, 'D3.4 closes no gate'); assert.equal(liveExecutionAllowed().allowed, false)
  const required = ['WORKER-ACCOUNT', 'FULL-WORKER', 'CRED-ISOLATION', 'EGRESS-FIREWALL', 'PROVIDER-AUTH', 'OWNER-AUTH', 'EXTRA-USAGE', 'ISSUER-KEYS', 'ATTESTATION', 'V3-CI', 'NEIGHBOR-TEST', 'RESIDUALS', 'D33-FOLLOWUPS', 'V2-PROVENANCE-FETCH']
  for (const r of required) assert.ok(GATES.some((g) => g.id === `G-${r}`), `G-${r} present`)
  assert.ok(GATES.every((g) => g.status === 'open' || g.status === 'prepared')); assert.equal(renderRegister().split('\n').length, GATES.length + 2)
  assert.ok(GATES.find((g) => g.id === 'G-PROVIDER-AUTH').d34.includes('NOT a grant'))
})

test('the engine never grants itself authority: routing needs a subscription admit, and a stage that is not AI-routed has no model', () => {
  assert.equal(routeStage({ stage: 'planning', task: { requirements: { text: 'x' }, acceptance: {}, scope: {}, risk_class: 'routine' }, subscription: { admit: false, reason: 'AUTH.EXTRA_USAGE_UNVERIFIED' } }).wait, true)
  assert.ok(readFileSync(new URL('../orchestrator/engine.mjs', import.meta.url), 'utf8').includes("mode !== 'simulated'"))
})
