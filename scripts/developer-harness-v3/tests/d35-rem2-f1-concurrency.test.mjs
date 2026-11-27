// D3.5 independent-verification remediation, F1 — concurrent scheduler exception isolation.
// Reproduces (against the pre-fix code, where `Promise.all` in Scheduler.#round rejected on the FIRST failing step) and then pins the fix: an unexpected exception in ONE admitted step
// never ends the round, releases a sibling's reservation, clears the single-flight exclusion or lets the next round mistake a live workload for an orphan. Simulated adapters; real ledger,
// engine and scheduler.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Scheduler } from '../orchestrator/scheduler.mjs'
import { H, owner } from './d34-rem-helpers.mjs'

const spec = (letter, over = {}) => ({ requirements: { text: `Task ${letter}: add the ${letter} indicator.`, sim_path: `apps/mobile/${letter}/feature.txt` }, scope: { allowed_paths: [`apps/mobile/${letter}/**`], denied_paths: [] }, ...over })
const gate = () => { let open; const p = new Promise((r) => { open = r }); return { p, open } }
const tick = () => new Promise((r) => setImmediate(r))
/** Wait (real time, bounded) until `cond()`; the simulated adapters resolve on microtasks/immediates so this is fast. */
async function until(cond, what, ms = 4000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await tick() } }
const settledState = (p) => { const s = { v: 'pending' }; p.then((x) => { s.v = 'resolved'; s.x = x }, (e) => { s.v = 'rejected'; s.e = e }); return s }

/** Run scheduler rounds until `id` is in `state` (stops BEFORE that state's step executes). */
async function driveTo(h, s, id, state) { for (let i = 0; i < 80 && h.ledger.getTask(id).state !== state; i += 1) await s.round(); assert.equal(h.ledger.getTask(id).state, state) }

test('F1 heavy sibling: one admitted step throws while another (a heavy test run) is still executing — the round waits for it, keeps its work lease and reservation, stays exclusive, and the sibling completes', async () => {
  const h = H()
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const Y = h.submit(spec('y')); await driveTo(h, s, Y, 'testing')
    const X = h.submit(spec('x'))
    const g = gate(); let testsStarted = false
    h.adapters.tests.run = async () => { testsStarted = true; await g.p; return { passed: true, results: { passed: 4, failed: 0, skipped: 0 }, fingerprint: null, summary: '' } }
    const adv = h.engine.advance.bind(h.engine)
    h.engine.advance = async (id) => { if (id === X) throw new Error('boom: unexpected adapter failure') ; return adv(id) }
    const p = s.round(); const st = settledState(p)
    await until(() => testsStarted, 'the heavy test run to start')
    for (let i = 0; i < 20; i += 1) await tick() // the sibling's exception has long since been thrown
    assert.equal(st.v, 'pending', `the round must not end while Y's test run is in flight (it was ${st.v}: ${st.e?.message ?? ''})`)
    assert.equal(h.engine.busy, true, 'the single-flight exclusion is held while admitted work is unresolved')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM work_leases WHERE task_id=? AND state='active'").get(Y).c, 1, 'Y keeps its work lease')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM reservations WHERE state IN ('held','materialized') AND holder_ref LIKE 'w-%'").get().c, 1, "Y's reservation is preserved")
    const again = await s.round(); assert.equal(again.busy, true, 'another scheduling attempt is refused while the first round is unresolved')
    assert.equal(await h.engine.tick().then((r) => r.busy), true, 'so is an engine tick')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM work_leases WHERE task_id=? AND state='superseded'").get(Y).c, 0, 'a live workload is never superseded as an "orphan"')
    g.open(); const r = await p
    assert.equal(st.v, 'resolved')
    assert.equal(h.engine.busy, false)
    assert.deepEqual(r.errors.map((x) => [x.id, x.code]), [[X, 'SCHEDULER.STEP_EXCEPTION']])
    assert.equal(r.ran.find((x) => x.id === Y).action, 'tests_passed', 'the unaffected sibling progressed')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM work_leases WHERE state IN ('active','termination_unverified')").get().c, 0, 'its work lease closed through the verified-termination path')
    assert.equal(L.recoveryHistory(X).filter((x) => x.kind === 'scheduler_step_exception').length, 1, "X's failure is recorded")
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})

test('F1 reasoning sibling: the failing step does not release the pre-launch reservation of a running session, and the next round does not treat that session as an orphan', async () => {
  const h = H({ scenario: { stages: { implementing: [{ units: 2 }] } } })
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const Y = h.submit(spec('y')); await driveTo(h, s, Y, 'implementing')
    const X = h.submit(spec('x'))
    const g = gate(); let started = false
    const orig = h.adapters.session.runUnit.bind(h.adapters.session)
    h.adapters.session.runUnit = async (a) => { if (a.task.task_id === Y && a.stage === 'implementing' && !started) { started = true; await g.p } return orig(a) }
    const adv = h.engine.advance.bind(h.engine)
    h.engine.advance = async (id) => { if (id === X) throw new Error('boom'); return adv(id) }
    const p = s.round(); const st = settledState(p)
    await until(() => started, "Y's session to start")
    for (let i = 0; i < 20; i += 1) await tick()
    assert.equal(st.v, 'pending', `round settled early: ${st.v}`)
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM reservations WHERE state='held' AND holder_ref LIKE 'sched-ai:%'").get().c + L.db.prepare("SELECT COUNT(*) c FROM reservations WHERE state='materialized' AND task_id=?").get(Y).c >= 1, true, "Y's reservation is preserved while its session runs")
    const lease = L.leaseOfTask(Y); assert.ok(lease && h.engine.inflight.has(lease.lease_id))
    assert.equal((await s.round()).busy, true)
    assert.equal(L.leaseOfTask(Y)?.state, 'active', 'the running session was not superseded')
    g.open(); const r = await p
    assert.equal(r.errors.length, 1); assert.equal(r.errors[0].id, X)
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM leases WHERE task_id=? AND state='superseded'").get(Y).c, 0)
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM reservations WHERE state='held' AND holder_ref LIKE 'sched-ai:%'").get().c, 0, 'the pre-launch reservations are released only AFTER every step settled')
  } finally { h.close() }
})

test('F1 bounded recovery: a step that keeps throwing is backed off, bounded, then technically suspended — and the unaffected tasks finish without any owner action', async () => {
  const h = H()
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const X = h.submit(spec('x')); const Z = h.submit(spec('z'))
    const adv = h.engine.advance.bind(h.engine); let throws = 0
    h.engine.advance = async (id) => { if (id === X) { if (L.getSuspension(X)) return { progressed: false }; throws += 1; throw new Error('always') } return adv(id) }
    let nextAt = []
    for (let k = 0; k < 40; k += 1) {
      let r; for (let i = 0; i < 400; i += 1) { r = await s.round(); if (!r.progressed) break }
      if (r.next_wakeup) { nextAt.push(r.next_wakeup); h.clock.advance(Math.max(1000, r.next_wakeup - h.clock.now() + 1)) } else break
    }
    assert.equal(L.getTask(Z).handoff_ready, 1, 'the unaffected task completed its handoff')
    assert.ok(throws >= 1 && throws <= s.cfg.maxStepExceptions, `bounded: ${throws} attempts`)
    assert.equal(L.recoveryHistory(X).filter((x) => x.kind === 'scheduler_step_exception').length, throws)
    assert.ok(L.getSuspension(X), 'the repeatedly failing task is technically suspended, not retried forever'); assert.equal(L.getSuspension(X).cause, 'SCHEDULER_STEP_EXCEPTION_REPEATED')
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }, 'an engineering fault never becomes an owner decision')
    // back-off was real: a failed step is not retried within the same instant
    assert.ok(nextAt.length >= 1)
  } finally { h.close() }
})

test('F1 controller recovery: a step that throws AFTER taking a lease leaves an orphan — the NEXT round reconciles it task-by-task (verified termination), the sibling is untouched, and the failed task is retried after its back-off', async () => {
  const h = H({ scenario: { stages: { implementing: [{ units: 2 }] } } })
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const X = h.submit(spec('x')); const Z = h.submit(spec('z'))
    for (let i = 0; i < 80 && L.getTask(X).state !== 'implementing'; i += 1) await s.round()
    const adv = h.engine.advance.bind(h.engine); let thrown = false
    h.engine.advance = async (id) => { if (id === X && !thrown) { thrown = true; assert.ok(L.acquireLease({ taskId: X, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high' }).ok); throw new Error('boom after lease') } return adv(id) }
    const r1 = await s.round(); assert.deepEqual(r1.errors.map((e) => e.id), [X])
    assert.ok(L.leaseOfTask(X), 'the throwing step left a live lease behind (an orphan: it is not in flight)')
    assert.equal(h.engine.inflight.size, 0)
    for (let k = 0; k < 40 && !(L.getTask(X).handoff_ready && L.getTask(Z).handoff_ready); k += 1) {
      let r; for (let i = 0; i < 400; i += 1) { r = await s.round(); if (!r.progressed) break }
      if (r.next_wakeup) h.clock.advance(Math.max(1000, r.next_wakeup - h.clock.now() + 1))
    }
    assert.equal(L.getTask(Z).handoff_ready, 1, 'the sibling was never disturbed'); assert.equal(L.getTask(X).handoff_ready, 1, 'the failed task recovered and finished')
    assert.ok(L.recoveryHistory(X).some((x) => x.kind === 'recovery_investigate' || x.kind === 'worker_recovered' || x.kind === 'lease_superseded' || /recover|supersede/.test(x.kind)), 'the orphan lease went through recovery, not silent deletion')
    assert.equal(L.liveLeases().length, 0)
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})

// ------------------------------------------------------------------ test-unit boundary audit
const UNITS = ['u1.test.mjs', 'u2.test.mjs', 'u3.test.mjs']
const OK = { status: 0, counts: { tests: 3, pass: 3, fail: 0, skipped: 0, cancelled: 0 } }
async function unitHarness() {
  const h = H(); const L = h.ledger; const s = new Scheduler(h.engine)
  const Y = h.submit(spec('y')); await driveTo(h, s, Y, 'testing')
  const calls = []; h.adapters.tests.units = async () => UNITS
  return { h, L, s, Y, calls }
}

test('F1 unit boundary: a task CANCELLED while a test unit runs produces no accepted evidence and no further units', async () => {
  const { h, L, s, Y, calls } = await unitHarness()
  try {
    h.adapters.tests.runUnit = async ({ unit }) => { calls.push(unit); if (unit === 'u2.test.mjs') L.cancel(Y, { ownerActionId: 'owner-cancel-y' }); return OK }
    for (let i = 0; i < 6; i += 1) await s.round()
    assert.deepEqual(calls, ['u1.test.mjs', 'u2.test.mjs'], 'u3 never started for a cancelled task')
    assert.equal(L.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(Y).c, 0, 'no test run recorded for cancelled work')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM evidence WHERE task_id=? AND evidence_type='test_results'").get(Y).c, 0, 'no evidence accepted')
    assert.equal(L.getTask(Y).handoff_ready, 0)
  } finally { h.close() }
})

test('F1 unit boundary: a candidate that CHANGES while a test unit runs cannot yield evidence for the stale candidate, and its remaining units do not run', async () => {
  const { h, L, s, Y, calls } = await unitHarness()
  try {
    const old = L.currentCandidate(Y)
    h.adapters.tests.runUnit = async ({ unit }) => { calls.push(unit); if (unit === 'u2.test.mjs') assert.ok(L.submitCandidate(Y, { base_sha: old.base_sha, candidate_sha: 'a'.repeat(40), tree_digest: 'b'.repeat(40), patch_digest: 'c'.repeat(64) }).ok); return OK }
    await s.round()
    assert.deepEqual(calls, ['u1.test.mjs', 'u2.test.mjs'], 'u3 of the superseded candidate never started')
    assert.equal(L.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=? AND candidate_sha=?').get(Y, old.candidate_sha).c, 0, 'no run is recorded for the superseded candidate')
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM evidence WHERE task_id=? AND evidence_type='test_results' AND invalidated_at IS NULL").get(Y).c, 0)
    assert.notEqual(L.getTask(Y).state, 'independent_review', 'the stale run did not advance the task')
  } finally { h.close() }
})
