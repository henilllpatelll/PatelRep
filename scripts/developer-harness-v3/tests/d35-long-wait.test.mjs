// D3.5-I — long unattended subscription waits (G-UNATTENDED-LONG-WAIT). SIMULATED provider and governor; real engine, ledger and admission code.
// A weekly quota reset outlives the 6 h extra-usage fact. The billing-safety check is NOT removed or extended: no AI work starts on a stale fact. What changes is the shape of the
// owner involvement: ONE consolidated re-verification package for the whole controller (not one block + one owner resolve PER TASK), with every task resuming by itself once the
// fact is fresh. A supported, non-billable re-verification source would make it zero — none exists for the pinned CLI (doc 28); it is exercised here only as a SIMULATED adapter.
import test from 'node:test'
import assert from 'node:assert/strict'
import { GOVERNOR_DEFAULTS } from '../runtime/subscription-governor.mjs'
import { T0 } from '../orchestrator/sim/harness.mjs'
import { H, drive, govSet, owner } from './d34-rem-helpers.mjs'

const WEEK = 7 * 24 * 3600_000
const spec = (x) => ({ requirements: { text: `long wait ${x}`, sim_path: `apps/mobile/${x}/f.txt` }, scope: { allowed_paths: [`apps/mobile/${x}/**`], denied_paths: [] } })
const billingWaiting = (h, id) => { const w = h.ledger.getWait(id); return h.ledger.getTask(id).state === 'waiting_subscription' && (w?.detail?.codes ?? []).includes('BILLING.REVERIFICATION_REQUIRED') }
async function untilAll(h, ids, pred, rounds = 400) {
  for (let i = 0; i < rounds; i += 1) { const r = await h.engine.runUntilIdle({ maxTicks: 200 }); if (ids.every((id) => pred(h, id))) return; h.clock.advance(Math.max(1000, (r.next_wakeup ?? h.clock.now() + 60_000) - h.clock.now() + 1)) }
  throw new Error(`not reached: ${ids.map((id) => h.ledger.getTask(id).state).join(',')}`)
}

test('a WEEKLY quota wait outlives the extra-usage fact: every task WAITS for one consolidated re-verification (no per-task block, no owner resolve), then all resume by themselves', async () => {
  const h = H({ scenario: { quota: [{ from: T0, to: T0 + WEEK }] }, cfg: { technical: { maxEpochs: 3 } } })
  try {
    const ids = ['a', 'b', 'c'].map((x) => h.submit(spec(x)))
    await untilAll(h, ids, billingWaiting)
    assert.ok(h.clock.now() >= T0 + WEEK, 'the quota window really passed')
    const ex = h.adapters.subscription.load().extra_usage; assert.ok(h.clock.now() - ex.verified_at >= GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms, 'the fact is stale: the safety check is still enforced')
    const pkgs = h.ledger.db.prepare("SELECT task_id, payload_json FROM outbox WHERE kind='genuine_blocker'").all()
    assert.equal(pkgs.length, 1, 'ONE owner package for three waiting tasks'); assert.equal(pkgs[0].task_id, null)
    assert.match(JSON.parse(pkgs[0].payload_json).owner_step, /attest-extra-usage-off/)
    assert.deepEqual({ ...owner(h), blockerRows: 0 }, { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }, 'no task was BLOCKED and none needs an owner resolve')
    assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM executions WHERE started_at>=?").get(T0 + WEEK).c, 0, 'no AI session started on the stale fact')
    // the ONE owner intervention: billing safety re-verified (attest + probe) → a fresh fact
    govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'SIMULATED_OWNER_REVERIFIED', verified_at: h.clock.now() - 1000 } }))
    await drive(h)
    for (const id of ids) assert.equal(h.ledger.getTask(id).handoff_ready, 1)
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 1 }, 'exactly one owner involvement in total (the re-verification), zero per-task actions')
  } finally { h.close() }
})

test('SIMULATED supported non-billable re-verification source: the fact is refreshed with NO owner involvement; the live adapters have no such source (the owner step remains there)', async () => {
  const h = H({ scenario: { quota: [{ from: T0, to: T0 + WEEK }] } })
  try {
    let calls = 0
    h.adapters.subscription.reverifyExtraUsage = async () => { calls += 1; return { supported: true, billable: false, enabled: false, verified_at: h.clock.now() - 10, basis: 'SIMULATED_NONBILLABLE_SOURCE' } }
    const id = h.submit(spec('z')); await drive(h)
    assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.ok(calls >= 1)
    assert.ok(h.ledger.recoveryHistory(null).some((r) => r.kind === 'billing_reverified'))
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
  const d = H(); try { assert.equal(typeof d.adapters.subscription.reverifyExtraUsage, 'undefined', 'no such capability is assumed by default') } finally { d.close() }
  assert.equal(GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms, 6 * 3600_000, 'the freshness lifetime is unchanged')
})

test('re-verification responses are judged, never trusted: ENABLED → owner block; billable, old, basis-less or malformed → ignored (keeps waiting); a FUTURE-dated fact stays an owner block', async () => {
  const run = async (resp) => {
    const h = H({ scenario: { quota: [{ from: T0, to: T0 + WEEK }] } }); const id = h.submit(spec('q'))
    if (resp) h.adapters.subscription.reverifyExtraUsage = async () => (typeof resp === 'function' ? resp(h) : resp)
    for (let i = 0; i < 400 && !['blocked'].includes(h.ledger.getTask(id).state) && !billingWaiting(h, id); i += 1) { const r = await h.engine.runUntilIdle({ maxTicks: 100 }); h.clock.advance(Math.max(1000, (r.next_wakeup ?? h.clock.now() + 60_000) - h.clock.now() + 1)) }
    const out = { state: h.ledger.getTask(id).state, reason: h.ledger.getTask(id).lifecycle.blocker_reason, codes: h.ledger.getWait(id)?.detail?.codes ?? [] }; h.close(); return out
  }
  const en = await run((h) => ({ supported: true, billable: false, enabled: true, verified_at: h.clock.now(), basis: 'sim' }))
  assert.equal(en.state, 'blocked'); assert.ok(en.codes.includes('AUTH.EXTRA_USAGE_ENABLED'))
  for (const bad of [(h) => ({ supported: true, billable: true, enabled: false, verified_at: h.clock.now(), basis: 'sim' }), (h) => ({ supported: true, billable: false, enabled: false, verified_at: h.clock.now() - 3600_000, basis: 'sim' }),
    (h) => ({ supported: true, billable: false, enabled: false, verified_at: h.clock.now() }), () => ({ supported: false }), () => null]) {
    const r = await run(bad); assert.equal(r.state, 'waiting_subscription', JSON.stringify(r)); assert.ok(r.codes.includes('BILLING.REVERIFICATION_REQUIRED'))
  }
  const h = H(); try {
    const id = h.submit(spec('f')); govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'x', verified_at: h.clock.now() + 3600_000 } }))
    await h.engine.runUntilIdle({ maxTicks: 50 })
    assert.equal(h.ledger.getTask(id).state, 'blocked', 'a future-dated (tampered) fact is not "merely stale": owner block, fail closed')
  } finally { h.close() }
})

test('an old owner attestation is never permanent: after a fresh re-verification and a completed task, the NEXT long idle period needs re-verification again (a new single package)', async () => {
  const h = H({ scenario: { quota: [{ from: T0, to: T0 + WEEK }] } })
  try {
    const a = h.submit(spec('r'))
    await untilAll(h, [a], billingWaiting)
    govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'SIMULATED_OWNER_REVERIFIED', verified_at: h.clock.now() - 1000 } }))
    await drive(h); assert.equal(h.ledger.getTask(a).handoff_ready, 1)
    h.clock.advance(GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms + 60_000) // the controller idles past the fact lifetime
    const b = h.submit(spec('s'))
    await untilAll(h, [b], billingWaiting)
    assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='genuine_blocker'").get().c, 2, 'a second stale fact → a second (single) package; the first attestation was not reused')
    assert.equal(h.ledger.db.prepare('SELECT COUNT(*) c FROM executions WHERE task_id=?').get(b).c, 0)
  } finally { h.close() }
})
