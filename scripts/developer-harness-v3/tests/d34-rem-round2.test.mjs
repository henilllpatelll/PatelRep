// D3.4 remediation, review round 2 — regressions for what the independent Sonnet code review found in the first remediation commit (11014d6c): stale-checkpoint overlay, a failed capture
// becoming an "empty verified" checkpoint, oversize work being dropped, suspension notification/session-cap generations, the cool-down vs extra-usage fact lifetime, a cancelled dependency stalling
// silently, a low adapter turn count weakening the hard ceiling. SIMULATED.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { T0 } from '../orchestrator/sim/harness.mjs'
import { wtDir } from '../orchestrator/sim/sim-world.mjs'
import { reconcileSlot } from '../orchestrator/recovery.mjs'
import { suspendTechnically } from '../orchestrator/suspension.mjs'
import { H, drive, settle, execs, owner, finalBytes, unitLines, govSet } from './d34-rem-helpers.mjs'

const RENEW = (specs) => ({ baseContext: 20_000, growthPerUnit: 40_000, contextWindow: 200_000, stages: { implementing: specs }, tests: [{ passed: true }] })
const kinds = (h, id) => h.ledger.recoveryHistory(id).map((x) => x.kind)

test('R2-1a: a renewal checkpoint is NOT restored over later COMMITTED work (incomplete implementation retried after a renewal): every committed byte survives', async () => {
  // run 1: 4 units, renewal after unit 3, session 2 commits and claims only step-a (incomplete → retried); run 2 completes
  const h = H({ scenario: RENEW([{ units: 4, completes: ['step-a'] }, { units: 5, completes: ['step-a', 'step-b'] }]) }); const id = h.submit(); await drive(h)
  assert.equal(h.ledger.getTask(id).handoff_ready, 1);
  assert.equal(finalBytes(h, id), unitLines(4, 1) + unitLines(5, 2), 'run 1 committed 4 units (v1); run 2 appended its 5 units (v2): nothing reverted')
  assert.ok(!h.ledger.recoveryHistory(id).some((x) => x.kind === 'stage_failure' && /RESTORE\./.test(x.detail.code ?? '')), 'and no wasted session failed on RESTORE.HEAD_MISMATCH'); h.close()
})

test('R2-1b: a controller death after the final commit (before the deliverable is saved) does not carry a stale snapshot over committed work', async () => {
  const h = H({ scenario: RENEW([{ units: 5 }]) }); const id = h.submit(); const set = h.ledger.setMeta.bind(h.ledger); let armed = true
  h.ledger.setMeta = (k, v) => { if (armed && String(k).startsWith('stage_done:') && String(k).endsWith(':implementing')) { armed = false; throw new Error('SIMULATED_CONTROLLER_DEATH') } return set(k, v) }
  await assert.rejects(() => h.engine.runUntilIdle({ maxTicks: 100 }), /SIMULATED_CONTROLLER_DEATH/); assert.ok(h.ledger.slotHolder(), 'the dead controller left its lease')
  const r = await reconcileSlot(h.engine, { reason: 'HOST_RESTARTED' }); assert.equal(r.cleared, true); assert.ok(!kinds(h, id).includes('checkpoint_carried_forward'), 'the worktree is present (merely clean): nothing is carried forward')
  await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  // the 5 committed units (v1) are intact; the re-run session (the deliverable was never saved) legitimately appends ONE more simulated unit (v2) — nothing reverted, nothing carried over from the stale snapshot
  assert.equal(finalBytes(h, id), unitLines(5, 1) + 'unit 6 of v2' + String.fromCharCode(10)); h.close()
})

test('R2-2a: a capture FAILURE at renewal never becomes an empty "verified" checkpoint and never lets the worktree be rebuilt empty — the renewal fails, the work stays, the retry restores everything', async () => {
  const h = H({ scenario: RENEW([{ units: 5 }]) }); const id = h.submit(); let units = 0; let threw = false
  const ru = h.adapters.session.runUnit.bind(h.adapters.session); h.adapters.session.runUnit = async (a) => { if (a.stage === 'implementing') units += 1; return ru(a) }
  const cs = h.adapters.git.captureSnapshot.bind(h.adapters.git); h.adapters.git.captureSnapshot = async (...a) => { if (units >= 3 && !threw) { threw = true; throw new Error('guest unreachable') } return cs(...a) }
  await drive(h); assert.ok(threw, 'the failure was injected'); assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  assert.equal(finalBytes(h, id), unitLines(5, 1), 'all five units: the failed capture lost nothing')
  assert.ok(!h.ledger.recoveryHistory(id).some((x) => x.kind === 'uncommitted_work_preserved' && x.detail.files === 0 && /RENEWAL/.test(x.detail.reason ?? '')), 'no empty checkpoint was recorded as "preserved"'); h.close()
})

test('R2-2b: legitimate work that is merely TOO BIG to snapshot is never dropped — the stage fails (budgeted, then technically suspended) with the worktree untouched', async () => {
  const big = 'x'.repeat(6 * 1024 * 1024)
  const h = H({ scenario: RENEW([{ units: 5, extraFiles: [{ path: 'apps/mobile/big.bin.txt', content: big }], extraFilesOnUnit: 2 }]), cfg: { technical: { maxEpochs: 1 } } }); const id = h.submit(); await drive(h)
  assert.equal(h.ledger.getTask(id).handoff_ready, 0); assert.equal(h.ledger.getSuspension(id)?.disposition, 'terminal', 'bounded, explicit disposition — not a silent stall'); assert.equal(owner(h).blockerRows, 0)
  assert.ok(existsSync(path.join(wtDir(h.dirs.world, id), 'apps', 'mobile', 'big.bin.txt')), 'the oversize file is STILL in the worktree: nothing was reset or deleted')
  assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'stage_failure' && /UNPRESERVABLE_WORK/.test(x.detail.code ?? '')), 'recorded with a code that says why'); assert.ok(!kinds(h, id).includes('unsafe_artifacts_quarantined'), 'oversize is not "unsafe"'); h.close()
})

test('R2-3: after resumeSuspended, a re-suspension and the terminal disposition are notified AGAIN (suspension generations)', async () => {
  const TECH = { maxRemediationCyclesPerEpoch: 2, maxEpochs: 2, cooldownsMs: [3600_000, 7200_000], maxSessionsPerTask: 100 }
  const h = H({ scenario: { tests: [{ passed: false, fingerprint: 'never' }] }, cfg: { technical: TECH } }); const id = h.submit(); await drive(h)
  const count = () => h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='technical_suspension'").get().c; const first = count(); assert.equal(first, TECH.maxEpochs + 1)
  govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'SIMULATED_VERIFIED_OFF', verified_at: h.clock.now() - 1000 } })); assert.ok(h.engine.resumeSuspended(id).ok); await drive(h)
  assert.equal(count(), 2 * first, 'the second round of suspensions and its terminal disposition were announced too'); assert.equal(h.ledger.getSuspension(id).disposition, 'terminal'); h.close()
})

test('R2-4: resumeSuspended gives a FRESH lifetime session budget (the next admission is not terminally re-suspended by sessions already spent)', async () => {
  const h = H({ scenario: { tests: Array.from({ length: 100 }, (_, i) => ({ passed: false, fingerprint: `d-${i}` })) }, cfg: { technical: { maxSessionsPerTask: 7, maxRemediationCyclesPerEpoch: 50, maxEpochs: 50 } } }); const id = h.submit(); await drive(h)
  const spent = execs(h, id).length; assert.ok(spent <= 7); assert.match(h.ledger.getSuspension(id).cause, /SESSION_BUDGET/)
  govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'SIMULATED_VERIFIED_OFF', verified_at: h.clock.now() - 1000 } })); assert.ok(h.engine.resumeSuspended(id).ok); await drive(h)
  assert.ok(execs(h, id).length > spent, 'new sessions were admitted after the explicit resume'); assert.ok(execs(h, id).length <= 2 * 7, 'but still capped per generation'); h.close()
})

test('R2-5: a cool-down never outlives the extra-usage fact: clamped to the remaining freshness (10-minute floor); an already-stale fact is not made worse', async () => {
  const mk = () => { const h = H({ scenario: {} }); const id = h.submit(); return { h, id } }
  { const { h, id } = mk(); govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'x', verified_at: h.clock.now() - 5 * 3600_000 } })); const s = suspendTechnically(h.engine, id, { cause: 'X', stage: 'testing' })
    assert.ok(s.retry_at - h.clock.now() <= 50 * 60_000 && s.retry_at - h.clock.now() >= 10 * 60_000, `clamped to the ~50 minutes of freshness left: ${(s.retry_at - h.clock.now()) / 60_000} min`); h.close() }
  { const { h, id } = mk(); govSet(h, (g) => ({ ...g, extra_usage: { enabled: false, basis: 'x', verified_at: h.clock.now() - 7 * 3600_000 } })); const s = suspendTechnically(h.engine, id, { cause: 'X', stage: 'testing' }); assert.ok(s.retry_at - h.clock.now() >= 30 * 60_000, 'already stale: the normal cool-down'); h.close() }
  { const { h, id } = mk(); const s = suspendTechnically(h.engine, id, { cause: 'X', stage: 'testing' }); assert.ok(s.retry_at - h.clock.now() >= 30 * 60_000 && s.retry_at - h.clock.now() <= 33 * 60_000, 'fresh fact: the configured 30-minute first cool-down'); assert.ok(T0 > 0); h.close() }
})

test('R2-6: a task whose DEPENDENCY was cancelled ends in an explicit owner-level conflict with one package — never a silent stall', async () => {
  const h = H({ scenario: {} }); const a = h.submit(); const b = h.submit({ requirements: { text: 'a second, dependent task' }, depends_on: [a] }); assert.ok(h.ledger.cancel(a).ok)
  await settle(h); const t = h.ledger.getTask(b); assert.equal(t.state, 'blocked'); assert.equal(t.lifecycle.blocker_reason, 'UNRESOLVABLE_REQUIREMENT_CONFLICT'); assert.equal(owner(h).blockerRows, 1)
  const pkg = JSON.parse(h.ledger.db.prepare("SELECT payload_json FROM outbox WHERE kind='genuine_blocker'").get().payload_json); assert.ok(pkg.codes.some((c) => c.includes('DEPENDENCY_CANCELLED'))); h.close()
})

test('R2-7: an adapter that under-reports turns cannot weaken the HARD turn ceiling (the stream\'s own assistant-message count raises it)', async () => {
  const h = H({ scenario: { baseContext: 20_000, growthPerUnit: 100, contextWindow: 200_000, turnsPerUnit: 30, stages: { implementing: [{ units: 6 }] } } }); const id = h.submit()
  const ru = h.adapters.session.runUnit.bind(h.adapters.session); h.adapters.session.runUnit = async (a) => { const r = await ru(a); return { ...r, turns: 0 } }
  await drive(h); assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'context_renewed' && x.detail.basis === 'hard_ceiling_turns'), 'renewed at the hard ceiling although the adapter reported 0 turns'); assert.equal(finalBytes(h, id), unitLines(6)); h.close()
})

test('R2-8: a read-only REVIEWER that left files behind gets no checkpoint of them (read-only stages never preserve work)', async () => {
  const h = H({ scenario: { stages: { independent_review: [{ fail: 'SESSION.TRANSIENT', failTimes: 1 }, {}] } } }); const id = h.submit(); await drive(h)
  assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM checkpoints WHERE task_id=? AND reason LIKE 'SESSION_EXIT:%' AND payload_json LIKE '%independent_review%'").get(id).c, 0); assert.equal(h.ledger.getTask(id).handoff_ready, 1); h.close()
})

