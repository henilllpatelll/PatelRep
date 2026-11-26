// D3.4 remediation F5 — retries that are EXHAUSTED are technical suspensions, not owner decisions. Bounded retries, strategy escalation and a durable cool-down with an automatic resume;
// a terminal technical disposition after the epoch budget; no unlimited subscription consumption; no silent indefinite stall; owner-only blockers stay owner-only. SIMULATED.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { T0 } from '../orchestrator/sim/harness.mjs'
import { classifyBlocker } from '../orchestrator/suspension.mjs'
import { H, execs, owner, spy, MAND, govSet } from './d34-rem-helpers.mjs'

const TECH = { maxRemediationCyclesPerEpoch: 2, maxStageFailuresPerEpoch: 6, maxReviewRoundsPerEpoch: 2, cooldownsMs: [3600_000, 2 * 3600_000, 4 * 3600_000], maxEpochs: 3, maxSessionsPerTask: 60 }
const HT = (o = {}) => H({ ...o, cfg: { ...(o.cfg ?? {}), technical: { ...TECH, ...(o.technical ?? {}) } } })
const terminal = (L, id) => L.getTask(id).handoff_ready === 1 || L.getTask(id).cancelled === 1 || L.getTask(id).state === 'blocked' || L.getSuspension?.(id)?.disposition === 'terminal'

/** Like the other suites' drive, but at EVERY idle point asserts that the engine is not silently stalled: each live task is in an explicit disposition OR a wake-up is scheduled. */
async function drive(h, { rounds = 200, after = null } = {}) {
  let last
  for (let i = 0; i < rounds; i += 1) {
    last = await h.engine.runUntilIdle({ maxTicks: 400 }); assert.ok(last.idle, 'no runaway loop')
    const live = h.ledger.listTasks("cancelled=0 AND handoff_ready=0 AND state<>'completed'").filter((r) => !terminal(h.ledger, r.task_id))
    if (live.length && !last.next_wakeup) assert.fail(`SILENT STALL: ${live.map((r) => `${r.task_id}:${r.state}`)} idle with no wake-up and no terminal disposition`)
    if (after) after(h, last)
    if (!last.next_wakeup) return last
    h.clock.advance(Math.max(1000, last.next_wakeup - h.clock.now() + 1))
  }
  throw new Error('drive: still waking after many rounds')
}
const notes = (h, kind) => h.ledger.db.prepare('SELECT * FROM outbox WHERE kind=? ORDER BY outbox_id').all(kind).map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }))
const impl = (h, id) => execs(h, id).filter((e) => e.role === 'implementer')

test('F5: classification — only genuine owner-only conditions are owner blockers; exhausted retries, test failures, review failures, issuer errors and expired approvals are technical', () => {
  for (const c of ['TEST_FAILED', 'REVIEW_FINDINGS_OPEN', 'REPEATED_FAILURE', 'REPEATED_IDENTICAL_FAILURE', 'REVIEW_ROUNDS_EXCEEDED', 'HANDOFF_EVIDENCE_UNOBTAINABLE', 'CLIENT.TIMEOUT', 'IPC.TIMEOUT', 'ISSUER.INTERNAL_ERROR', 'EVIDENCE.EXPIRED', 'ROUTE.MODEL_SUBSTITUTED', 'CANDIDATE.EMPTY', 'SESSION.VERSION_MISMATCH', 'PLAN.SHAPE']) assert.equal(classifyBlocker(c), 'technical', c)
  for (const c of ['TASK.REQUIREMENTS_TAMPERED', 'AUTH.EXTRA_USAGE_ENABLED', 'AUTH.EXTRA_USAGE_UNVERIFIED', 'SUBSCRIPTION.STATE:auth_expired', 'SUBSCRIPTION.STATE:unauthorized_billing', 'SUBSCRIPTION.STATE_UNKNOWN', 'ISOLATION_UNPROVEN', 'PROHIBITED_ACTION_REQUIRED']) assert.equal(classifyBlocker(c), 'owner', c)
  assert.equal(classifyBlocker('SOMETHING.NEW'), 'technical', 'unknown codes are technical: the default must not interrupt the owner')
})

test('F5: a recurring identical failure → bounded retries, ONE model escalation, then a TECHNICAL suspension (never OWNER_DECISION_REQUIRED); it cools down and RESUMES BY ITSELF with a different strategy', async () => {
  const h = HT({ scenario: { tests: [{ passed: false, fingerprint: 'same-failure', summary: 's' }, { passed: false, fingerprint: 'same-failure', summary: 's' }, { passed: false, fingerprint: 'same-failure', summary: 's' }, { passed: false, fingerprint: 'same-failure', summary: 's' }, { passed: true }] } })
  const calls = spy(h); const id = h.submit(); await drive(h)
  const t = h.ledger.getTask(id); assert.equal(t.handoff_ready, 1, 'it eventually completed WITHOUT the owner'); assert.notEqual(t.state, 'blocked'); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  const n = notes(h, 'technical_suspension'); assert.ok(n.length >= 1, 'a durable notification exists'); const p = n[0].payload
  assert.equal(p.owner_permission_required, false); assert.equal(p.disposition, 'cooling_down'); assert.ok(p.automatic_resume_at > T0); assert.ok(p.diagnostics.failure_fingerprints.some((f) => /same-failure/.test(f.fingerprint) && f.attempts >= 1), 'actionable diagnostics: what failed, how often'); assert.ok(p.diagnostics.stage && p.diagnostics.cause && Number.isInteger(p.epoch))
  assert.ok(calls.some((c) => c.stage === 'implementing' && c.model === 'opus'), 'strategy escalation happened'); assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'technical_suspension_ended'), 'resumed automatically after the cool-down'); h.close()
})

test('F5: a failure that NEVER clears ends in an explicit TERMINAL technical disposition after the epoch budget — bounded sessions, one notification per epoch, no wake-up, no silent stall', async () => {
  const h = HT({ scenario: { tests: [{ passed: false, fingerprint: 'never-fixed', summary: 's' }] } }); const id = h.submit(); await drive(h)
  const s = h.ledger.getSuspension(id); assert.equal(s.disposition, 'terminal'); assert.equal(s.epoch, TECH.maxEpochs + 1, 'maxEpochs cool-downs, then the terminal disposition'); assert.equal(h.ledger.getTask(id).handoff_ready, 0); assert.notEqual(h.ledger.getTask(id).state, 'blocked')
  assert.ok(impl(h, id).length <= (TECH.maxEpochs + 1) * (TECH.maxRemediationCyclesPerEpoch + 2), `bounded paid sessions: ${impl(h, id).length}`)
  const n = notes(h, 'technical_suspension'); assert.equal(n.length, TECH.maxEpochs + 1, 'one notification per suspension'); assert.equal(n.at(-1).payload.disposition, 'terminal'); assert.equal(n.at(-1).payload.owner_permission_required, false); assert.ok(/resume/i.test(n.at(-1).payload.how_to_resume))
  assert.equal(new Set(n.map((x) => x.dedupe_key)).size, n.length); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  const idle = await h.engine.runUntilIdle(); assert.equal(idle.next_wakeup, null); h.clock.advance(30 * 24 * 3600_000); const again = await h.engine.runUntilIdle(); assert.equal(again.log.every((r) => !r.progressed), true, 'nothing ever happens again by itself: no unlimited consumption')
  const before = execs(h, id).length; govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'SIMULATED_VERIFIED_OFF', verified_at: h.clock.now() - 1000 } })); assert.equal(h.engine.resumeSuspended(id).ok, true, 'an explicit resume starts a fresh epoch budget'); assert.equal(h.ledger.getSuspension(id), null); await drive(h, { rounds: 5 }).catch(() => {}); assert.ok(execs(h, id).length > before); h.close()
})

test('F5: DIFFERENT failure fingerprints every time cannot evade the budget — the per-epoch remediation cap holds across fingerprints and candidate changes', async () => {
  const tests = Array.from({ length: 80 }, (_, i) => ({ passed: false, fingerprint: `distinct-${i}`, summary: `failure ${i}` })); const h = HT({ scenario: { tests } }); const id = h.submit(); await drive(h)
  const s = h.ledger.getSuspension(id); assert.equal(s.disposition, 'terminal'); const runs = h.ledger.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(id).c
  assert.ok(runs <= (TECH.maxEpochs + 1) * (TECH.maxRemediationCyclesPerEpoch + 1), `test runs bounded across epochs: ${runs}`); assert.ok(new Set(h.ledger.db.prepare('SELECT failure_fingerprint f FROM test_runs WHERE task_id=?').all(id).map((r) => r.f)).size === runs, 'every run really had a different fingerprint'); h.close()
})

test('F5: review failures — different mandatory findings every round — are bounded per epoch (rounds counted across candidates) and become a TECHNICAL suspension, not OWNER_DECISION_REQUIRED', async () => {
  const specs = Array.from({ length: 30 }, (_, i) => ({ findings: [MAND(`f-${i}`)] })); const h = HT({ scenario: { stages: { independent_review: specs } }, technical: { maxRemediationCyclesPerEpoch: 20 } }); const id = h.submit(); await drive(h)
  assert.equal(h.ledger.getSuspension(id).disposition, 'terminal'); assert.notEqual(h.ledger.getTask(id).state, 'blocked'); assert.equal(owner(h).blockerRows, 0)
  const rounds = h.ledger.db.prepare("SELECT COUNT(*) c FROM reviews WHERE task_id=? AND kind='independent_review'").get(id).c; assert.ok(rounds <= (TECH.maxEpochs + 1) * (TECH.maxReviewRoundsPerEpoch + 1), `review sessions bounded: ${rounds}`)
  const n = notes(h, 'technical_suspension'); assert.ok(n.some((x) => /REVIEW_ROUNDS_EXCEEDED/.test(x.payload.diagnostics.cause)), 'cause names the review budget'); h.close()
})

test('F5: transient ISSUER errors back off, suspend technically if they persist, and the task resumes by itself once the issuer is healthy', async () => {
  const h = HT({ scenario: {} }); const real = h.adapters.issuer.testResults; let calls = 0
  h.adapters.issuer.testResults = async (...a) => { calls += 1; return calls <= 7 ? { ok: false, code: 'IPC.TIMEOUT' } : real(...a) }
  const id = h.submit(); await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }); assert.ok(notes(h, 'technical_suspension').length >= 1)
  assert.ok(h.ledger.recoveryHistory(id).filter((x) => x.kind === 'stage_failure' && x.detail.code === 'IPC.TIMEOUT').length >= 3); h.close()
})

test('F5: EXPIRED approvals at handoff are re-attested (fresh evidence, same candidate) — not an owner decision', async () => {
  let h; let fired = false
  h = HT({ scenario: {}, hook: (name) => { if (name === 'after_evidence_accepted' && !fired && h.ledger.db.prepare("SELECT COUNT(*) c FROM evidence WHERE evidence_type='security_review'").get().c === 1) { fired = true; h.clock.advance(7 * 3600_000) } } }); const id = h.submit(); await drive(h)
  assert.equal(fired, true); assert.equal(h.ledger.getTask(id).handoff_ready, 1, 'handoff completed'); assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'evidence_reattested'), 'by re-attestation'); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM executions WHERE task_id=? AND role IN ('independent_reviewer','security_reviewer')").get(id).c, 2, 'no extra paid review session was needed'); h.close()
})

test('F5: handoff that cannot obtain evidence is retried on a PERSISTED schedule, suspends technically while the issuers are down, and completes by itself once they are back — never a stall, never OWNER_DECISION_REQUIRED', async () => {
  const g = HT({ scenario: {} }); let fired = false; let down = true
  g.engine.hookFn = (name) => { if (name === 'after_evidence_accepted' && !fired && g.ledger.db.prepare("SELECT COUNT(*) c FROM evidence WHERE evidence_type='security_review'").get().c === 1) { fired = true; g.clock.advance(7 * 3600_000) } }
  const rr = g.adapters.issuer.review; const rt = g.adapters.issuer.testResults
  g.adapters.issuer.review = async (...a) => (down && fired ? { ok: false, code: 'IPC.UNAVAILABLE' } : rr(...a)); g.adapters.issuer.testResults = async (...a) => (down && fired ? { ok: false, code: 'IPC.UNAVAILABLE' } : rt(...a))
  const gid = g.submit(); await drive(g, { after: (hh) => { if (hh.clock.now() > T0 + 9 * 3600_000) down = false } })
  assert.equal(g.ledger.getTask(gid).handoff_ready, 1, 'recovered once the issuers came back'); assert.deepEqual(owner(g), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }); assert.ok(g.ledger.recoveryHistory(gid).some((x) => x.kind === 'handoff_evidence_insufficient'))
  assert.ok(notes(g, 'technical_suspension').length >= 1, 'the outage was reported as a technical suspension with diagnostics'); assert.equal(g.ledger.getSuspension(gid), null, 'and cleared when handoff completed'); g.close()
})

test('F5: the engine wakes for pending notification retries — an undelivered outbox row is never forgotten', async () => {
  const h = HT({ scenario: {} }); let n = 0; h.adapters.notifier.send = async () => { n += 1; return n > 2 }
  const id = h.submit(); const r = await drive(h, { rounds: 30 }); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(h.ledger.db.prepare("SELECT status FROM outbox WHERE kind='handoff_ready'").get().status, 'sent', 'delivered after retries'); assert.ok(n >= 3); void r; h.close()
})

test('F5: genuine owner-only conditions are STILL owner blockers (auth expired, unauthorized billing) — the reclassification did not hide them', async () => {
  const h = HT({ scenario: {} }); h.adapters.subscription.save({ ...h.adapters.subscription.load(), state: 'auth_expired', reason_codes: ['AUTH.EXPIRED'] }); const id = h.submit(); await h.engine.runUntilIdle({ maxTicks: 50 })
  const t = h.ledger.getTask(id); assert.equal(t.state, 'blocked'); assert.equal(t.lifecycle.blocker_reason, 'OWNER_AUTH_EXPIRED'); assert.equal(owner(h).blockerRows, 1); h.close()
})

test('F5: the lifetime session cap stops unlimited subscription consumption even if every epoch keeps finding new things to retry', async () => {
  const tests = Array.from({ length: 200 }, (_, i) => ({ passed: false, fingerprint: `d-${i}` })); const h = HT({ scenario: { tests }, technical: { maxSessionsPerTask: 7, maxRemediationCyclesPerEpoch: 50, maxEpochs: 50 } }); const id = h.submit(); await drive(h)
  assert.ok(execs(h, id).length <= 7, `lifetime cap held: ${execs(h, id).length}`); assert.equal(h.ledger.getSuspension(id).disposition, 'terminal'); assert.match(notes(h, 'technical_suspension').at(-1).payload.diagnostics.cause, /SESSION_BUDGET/); h.close()
})

test('F5: every default cool-down is shorter than the extra-usage fact lifetime, so an automatic resume never needs the owner to re-verify billing safety', async () => {
  const { TECH_DEFAULTS } = await import('../orchestrator/suspension.mjs'); const { GOVERNOR_DEFAULTS } = await import('../runtime/subscription-governor.mjs')
  assert.ok(Math.max(...TECH_DEFAULTS.cooldownsMs) < GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms, 'cool-down < fact lifetime'); assert.ok(TECH_DEFAULTS.cooldownsMs.every((c, i, a) => i === 0 || c >= a[i - 1]), 'cool-downs never shrink')
})
