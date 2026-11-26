// D3.4 remediation F1 — every new reasoning session, INCLUDING context renewal and every continued work unit, goes through FRESH resource and subscription admission.
// A denied admission preserves a verified checkpoint, terminates the session (verified), enters the right waiting state and resumes by itself. SIMULATED (no model/VM).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { T0 } from '../orchestrator/sim/harness.mjs'
import { renewalDecision, RENEWAL_DEFAULTS } from '../orchestrator/context-renewal.mjs'
import { H, drive, settle, spy, execs, owner, finalBytes, unitLines, onHook, govSet, afterImplementingUnit } from './d34-rem-helpers.mjs'

// 5 units of ~15k tokens each on a 200k window: far below the 70% threshold, so ONLY the unit boundary admission can stop the session.
const impl = (n = 5) => ({ stages: { implementing: [{ units: n }] } })
const slotFree = (h) => assert.equal(h.ledger.slotHolder(), null, 'no lease holds the reasoning slot')
const live = (h) => h.ledger.db.prepare("SELECT status FROM executions WHERE status IN ('starting','running')").all()

async function pressureBetweenUnits({ window = 10 * 60_000 } = {}) {
  const scenario = { ...impl(), pressure: [] }; let h
  h = H({ scenario }); afterImplementingUnit(h, 2, () => { scenario.pressure.push({ from: h.clock.now(), to: h.clock.now() + window, available_mb: 700 }) })
  return { h, scenario }
}

test('F1: memory pressure appearing BETWEEN work units stops the session at the boundary — checkpoint verified, session terminated, waiting_resources, then automatic resume with every byte of earlier work', async () => {
  const { h } = await pressureBetweenUnits(); const calls = spy(h); const id = h.submit()
  const r = await settle(h); const t = h.ledger.getTask(id)
  assert.equal(t.state, 'waiting_resources', 'admission was re-checked at the boundary'); assert.equal(h.ledger.getWait(id).reason, 'MEMORY_PRESSURE')
  assert.equal(calls.filter((c) => c.stage === 'implementing').length, 2, 'NO third unit ran under pressure'); assert.ok(r.next_wakeup > T0, 'a wake-up is scheduled')
  slotFree(h); assert.deepEqual(live(h), [], 'the session was terminated and verified'); assert.equal(execs(h, id).at(-1).status, 'terminated_verified')
  const cp = h.ledger.latestCheckpoint(id); assert.ok(cp && cp.verified === 1 && cp.snapshot_ref, 'a VERIFIED checkpoint holds the uncommitted work'); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  assert.equal(finalBytes(h, id), unitLines(5), 'the ACTUAL bytes: units 1-2 (before the wait) and 3-5 (after) are all present, in order'); h.close()
})

test('F1: expired extra-usage verification between units stops the session before the next unit (genuine billing-safety blocker), work preserved, never a silent continue', async () => {
  const scenario = impl(); let h
  h = H({ scenario }); afterImplementingUnit(h, 2, () => govSet(h, (g) => ({ ...g, extra_usage: { ...g.extra_usage, verified_at: T0 - 90 * 24 * 3600_000 } }))); const calls = spy(h); const id = h.submit()
  await settle(h); const t = h.ledger.getTask(id)
  assert.equal(calls.filter((c) => c.stage === 'implementing').length, 2, 'no unit ran with an unverified extra-usage fact'); assert.equal(t.state, 'blocked'); assert.equal(t.lifecycle.blocker_reason, 'OWNER_DECISION_REQUIRED')
  slotFree(h); assert.deepEqual(live(h), []); assert.ok(h.ledger.latestCheckpoint(id)?.verified === 1, 'work preserved before the stop')
  const pkg = JSON.parse(h.ledger.db.prepare("SELECT payload_json FROM outbox WHERE kind='genuine_blocker'").get().payload_json); assert.ok(pkg.codes.includes('AUTH.EXTRA_USAGE_UNVERIFIED'))
  govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'SIMULATED_VERIFIED_OFF', verified_at: h.clock.now() - 1000 } })); assert.equal(h.engine.ownerResolve(id, 'owner-reverified-1').ok, true)
  await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(finalBytes(h, id), unitLines(5)); h.close()
})

test('F1: subscription exhaustion appearing between units → waiting_subscription with the provider reset time, checkpoint + verified stop, automatic resume', async () => {
  const scenario = impl(); let h; const resetAt = T0 + 2 * 3600_000
  h = H({ scenario }); afterImplementingUnit(h, 2, () => govSet(h, (g) => ({ ...g, state: 'exhausted', reason_codes: ['SUBSCRIPTION.LIMIT'], next_eligible_at: resetAt, resets_at_ms: resetAt, windows: null }))); const calls = spy(h); const id = h.submit()
  const r = await settle(h); const t = h.ledger.getTask(id)
  assert.equal(calls.filter((c) => c.stage === 'implementing').length, 2); assert.equal(t.state, 'waiting_subscription'); assert.equal(h.ledger.getWait(id).eligible_at, resetAt); assert.equal(r.next_wakeup, resetAt)
  slotFree(h); assert.deepEqual(live(h), []); assert.ok(h.ledger.latestCheckpoint(id)?.verified === 1); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(finalBytes(h, id), unitLines(5)); h.close()
})

// ---- immediately before fresh-session renewal (old session stopped, no new lease yet)
const RENEW = { baseContext: 20_000, growthPerUnit: 40_000, contextWindow: 200_000, stages: { implementing: [{ units: 5 }] } }
async function renewalDenied(mutate) {
  const scenario = { ...RENEW, pressure: [] }; let h
  h = H({ scenario, hook: onHook('after_renewal_old_stopped', 1, () => mutate(h, scenario)) }); const id = h.submit(); const before = []
  const orig = h.ledger.acquireLease.bind(h.ledger); h.ledger.acquireLease = (a) => { before.push(h.ledger.getTask(id).state); return orig(a) }
  await settle(h); return { h, id, scenario, leaseStates: before }
}

for (const [label, mutate, state, reason] of [
  ['memory pressure', (h, sc) => sc.pressure.push({ from: h.clock.now(), to: h.clock.now() + 600_000, available_mb: 700 }), 'waiting_resources', 'MEMORY_PRESSURE'],
  ['subscription exhaustion', (h) => govSet(h, (g) => ({ ...g, state: 'exhausted', reason_codes: ['SUBSCRIPTION.LIMIT'], next_eligible_at: h.clock.now() + 3600_000, resets_at_ms: h.clock.now() + 3600_000 })), 'waiting_subscription', 'SUBSCRIPTION_LIMIT'],
]) {
  test(`F1: ${label} immediately BEFORE a fresh-session renewal — no new lease, no new session; verified checkpoint kept; ${state}; automatic resume restores exact bytes`, async () => {
    const { h, id } = await renewalDenied(mutate); const t = h.ledger.getTask(id)
    assert.equal(t.state, state, `waiting, not failed or blocked (was ${t.state})`); assert.equal(h.ledger.getWait(id).reason, reason)
    const ex = execs(h, id).filter((e) => e.role === 'implementer'); assert.equal(ex.length, 1, 'NO second execution was admitted while admission is denied'); assert.equal(ex[0].end_reason, 'CONTEXT_RENEWAL'); assert.equal(ex[0].status, 'terminated_verified')
    slotFree(h); const cp = h.ledger.latestCheckpoint(id); assert.ok(cp?.verified === 1 && cp.snapshot_ref, 'renewal checkpoint preserved'); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
    await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(finalBytes(h, id), unitLines(5)); assert.ok(execs(h, id).filter((e) => e.role === 'implementer').length >= 2); h.close()
  })
}

test('F1: expired extra-usage verification immediately before renewal blocks the new session (checkpoint + verified stop kept)', async () => {
  const { h, id } = await renewalDenied((hh) => govSet(hh, (g) => ({ ...g, extra_usage: { ...g.extra_usage, verified_at: T0 - 90 * 24 * 3600_000 } })))
  const t = h.ledger.getTask(id); assert.equal(t.state, 'blocked'); assert.equal(execs(h, id).filter((e) => e.role === 'implementer').length, 1); slotFree(h); assert.ok(h.ledger.latestCheckpoint(id)?.verified === 1); h.close()
})

test('F1: admission of an EXISTING lease is not "an unrelated occupied slot" — the holder itself is admitted; a different lease holder is busy', async () => {
  const h = H(); const id = h.submit(); await h.engine.tick(); await h.engine.tick() // queued → planning
  const got = h.ledger.acquireLease({ taskId: id, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'medium', ttlMs: 60_000 }); assert.ok(got.ok)
  const need = { stage: 'planning', ai: true, profile: 'reasoning' }
  assert.equal((await h.engine.checkAdmission(id, need)).kind, 'busy', 'a fresh stage start sees the slot as held')
  assert.equal((await h.engine.checkAdmission(id, need, { ownLease: got.lease })).ok, true, 'the lease holder re-admits itself')
  assert.equal((await h.engine.checkAdmission(id, need, { ownLease: { ...got.lease, lease_id: 'l-other' } })).kind, 'busy', 'a different lease is still an occupied slot')
  h.ledger.closeLease(got.lease, { terminationVerified: true, endReason: 'test' }); h.close()
})

test('F1: cancellation at a unit boundary stops the session with a verified checkpoint and no failure/backoff/escalation', async () => {
  const scenario = impl(); let h
  h = H({ scenario }); afterImplementingUnit(h, 2, () => h.ledger.cancel(h.ledger.listTasks()[0].task_id)); const calls = spy(h); const id = h.submit()
  await settle(h); const t = h.ledger.getTask(id)
  assert.equal(calls.filter((c) => c.stage === 'implementing').length, 2, 'no unit after the cancellation'); assert.equal(t.cancelled, 1); slotFree(h); assert.deepEqual(live(h), []); assert.ok(h.ledger.latestCheckpoint(id)?.verified === 1, 'work preserved')
  assert.equal(h.ledger.db.prepare('SELECT COUNT(*) c FROM retry_budgets WHERE task_id=?').get(id).c, 0, 'a cancellation is not a failure'); h.close()
})

// ---- telemetry validation and hard ceilings
const tel = (usage, over = {}) => ({ init: { claude_code_version: '2.1.331' }, last_usage: { model: 'claude-sonnet-5-5', ...usage }, context_window: { model: 'claude-sonnet-5-5', tokens: 200_000 }, compactions: 0, ...over })
const dec = (t, o = {}) => renewalDecision({ telemetry: t, family: 'sonnet', cliVersion: '2.1.331', now: 1_000_000, lastUsageAt: 999_000, turns: 3, startedAt: 900_000, cfg: RENEWAL_DEFAULTS, ...o })
const U = (i, r, c, o) => ({ input_tokens: i, cache_read_input_tokens: r, cache_creation_input_tokens: c, output_tokens: o })

test('F1: hostile token telemetry (negative, fractional, non-finite, inconsistent) is REJECTED — never a measured percentage — and falls back to bounded units', () => {
  const cases = [['negative', U(-500_000, 300_000, 10, 5)], ['negative sum to zero', U(-10, 10, 0, 0)], ['fractional', U(0.5, 100, 100, 100)], ['null part', U(1, null, 1, 1)], ['unsafe huge', U(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1, 1)],
    ['string', U('9', 100, 100, 100)], ['NaN (parser maps to null)', U(Number.NaN, 1, 1, 1)], ['exceeds window', U(150_000, 100_000, 0, 0)]]
  for (const [name, usage] of cases) {
    const d = dec(tel(usage)); assert.equal(d.measured, false, `${name}: not measured`); assert.equal(d.utilization, null, `${name}: no invented percentage`); assert.ok(d.rejected.length > 0, `${name}: rejected with a code`); assert.match(d.basis, /^bounded_work_unit/, name)
  }
  for (const w of [-1, 0, 7999, 200_000.5, Number.POSITIVE_INFINITY]) { const d = dec(tel(U(1, 1, 1, 1), { context_window: { model: 'claude-sonnet-5-5', tokens: w } })); assert.equal(d.measured, false, `window ${w}`) }
  const ok = dec(tel(U(10, 100_000, 10, 10))); assert.equal(ok.measured, true); assert.equal(ok.renew, false)
})

test('F1: HARD turn and duration ceilings cannot be bypassed by valid below-threshold telemetry', () => {
  const low = tel(U(10, 20_000, 10, 10)) // ~10% of the window: valid, measured, far below 70%
  assert.equal(dec(low).renew, false); assert.equal(dec(low).measured, true)
  const byTurns = dec(low, { turns: 61 }); assert.equal(byTurns.renew, true); assert.equal(byTurns.basis, 'hard_ceiling_turns'); assert.equal(byTurns.measured, false); assert.equal(byTurns.utilization, null)
  const byTime = dec(low, { now: 1_000_000 + 91 * 60_000, lastUsageAt: 1_000_000 + 91 * 60_000 - 1000, startedAt: 1_000_000 }); assert.equal(byTime.renew, true); assert.equal(byTime.basis, 'hard_ceiling_minutes')
  assert.equal(dec(low, { turns: Number.NaN }).renew, true, 'a non-finite turn count cannot silently disable the ceiling'); assert.equal(dec(low, { turns: -5 }).renew, true, 'nor can a negative one')
  assert.equal(dec(low, { startedAt: Number.NaN }).renew, true, 'nor a non-finite start time')
})

test('F1: end to end — a session whose context never nears 70% is still renewed at the HARD turn ceiling', async () => {
  const h = H({ scenario: { baseContext: 20_000, growthPerUnit: 100, contextWindow: 200_000, turnsPerUnit: 30, stages: { implementing: [{ units: 6 }] } } }); const id = h.submit(); await drive(h)
  const renewed = h.ledger.recoveryHistory(id).filter((x) => x.kind === 'context_renewed'); assert.ok(renewed.length >= 1, 'renewed although utilization stayed ~10%'); assert.ok(renewed.every((r) => r.detail.basis === 'hard_ceiling_turns' && r.detail.measured === false))
  assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(finalBytes(h, id), unitLines(6)); h.close()
})

test('F1: an authentication expiry between units is a genuine owner blocker (OWNER_AUTH_EXPIRED) — checkpoint kept, session terminated and verified, no further unit', async () => {
  const scenario = impl(); const h = H({ scenario }); afterImplementingUnit(h, 2, () => govSet(h, (g) => ({ ...g, state: 'auth_expired', reason_codes: ['AUTH.EXPIRED'] }))); const calls = spy(h); const id = h.submit()
  await settle(h); const t = h.ledger.getTask(id)
  assert.equal(calls.filter((c) => c.stage === 'implementing').length, 2); assert.equal(t.state, 'blocked'); assert.equal(t.lifecycle.blocker_reason, 'OWNER_AUTH_EXPIRED'); slotFree(h); assert.deepEqual(live(h), []); assert.ok(h.ledger.latestCheckpoint(id)?.verified === 1)
  assert.equal(owner(h).blockerRows, 1); h.close()
})
