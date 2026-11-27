// D3.6-I — the watchdog (D3.5 residual R-20): a never-settling step must not freeze unrelated tasks, and a timeout never releases what an unresolved operation holds.
// SIMULATED adapters; real timers only for the deadlines themselves (milliseconds). Nothing is killed anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { circuitOpen, noteHealthy, noteTimeout, unresolvedOperations, withDeadline } from '../orchestrator/delivery/watchdog.mjs'
import { Scheduler } from '../orchestrator/scheduler.mjs'
import { stagingOwner } from '../orchestrator/delivery/state.mjs'
import { harness, intents, ops, state } from './d36-helpers.mjs'

test('withDeadline: in time -> settled; late -> UNRESOLVED (the signal is aborted, holds are recorded and kept) and its own late settlement is recorded; nothing leaks as an unhandled rejection', async () => {
  const h = await harness(); const L = h.ledger
  const a = await withDeadline(L, { opId: 'op-a', kind: 'k', ms: 1000 }, async () => 7); assert.deepEqual(a, { timedOut: false, value: 7 })
  let release; let aborted = false
  const b = await withDeadline(L, { opId: 'op-b', taskId: null, kind: 'k', ms: 20, holds: ['work-1'] }, (signal) => { signal.addEventListener('abort', () => { aborted = true }); return new Promise((res) => { release = res }) })
  assert.equal(b.timedOut, true); assert.equal(aborted, true, 'cooperative cancellation: the operation was asked to stop')
  assert.deepEqual(unresolvedOperations(L).map((o) => [o.op_id, o.holds]), [['op-b', ['work-1']]], 'the hold is recorded, not released')
  release(1); assert.equal(await b.settled, 1); assert.equal(L.db.prepare("SELECT state FROM operation_deadlines WHERE op_id='op-b'").get().state, 'settled_late')
  const c = await withDeadline(L, { opId: 'op-c', kind: 'k', ms: 10 }, () => new Promise((_, rej) => setTimeout(() => rej(new Error('late failure')), 30)))
  await assert.rejects(c.settled, /late failure/); h.close()
})

test('R-20: a scheduler step that never settles is DETACHED — an unrelated task keeps progressing, while the hung task keeps its work slot and reservation and is excluded until its own late settlement', async () => {
  const h = await harness({ cfg: {} })
  const a = h.submit({ requirements: { text: 'a', sim_path: 'apps/mobile/a/x.txt' }, scope: { allowed_paths: ['apps/mobile/a/**'], denied_paths: [] } })
  const b = h.submit({ requirements: { text: 'b', sim_path: 'apps/mobile/b/x.txt' }, scope: { allowed_paths: ['apps/mobile/b/**'], denied_paths: [] } })
  const run = h.adapters.tests.run; let release = null
  h.adapters.tests.run = async (x) => (x.task.task_id === a ? new Promise((res) => { release = () => res({ passed: true, results: { passed: 4, failed: 0, skipped: 0 }, fingerprint: null }) }) : run(x))
  const S = new Scheduler(h.engine, { stepDetachMs: 30 })
  for (let i = 0; i < 60 && !release; i += 1) { const r = await S.round(); if (!r.progressed) h.clock.advance(60_000) }
  assert.ok(release, 'task A is inside its never-settling test step')
  const before = state(h, b); let progressedB = false
  for (let i = 0; i < 40; i += 1) { const r = await S.round(); if (r.ran.some((x) => x.id === b && x.action)) progressedB = true; if (!r.progressed) h.clock.advance(60_000); if (h.ledger.getTask(b).handoff_ready === 1) break }
  assert.ok(progressedB, `B progressed while A was hung (B: ${before} -> ${state(h, b)})`)
  assert.ok(S.hung.has(a) && h.engine.detached.has(a), 'A is detached, not abandoned')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM work_leases WHERE task_id=? AND state='active'").get(a), 'A STILL holds its heavy-test work slot (never released by a timer)')
  assert.ok(unresolvedOperations(h.ledger, a).length >= 1)
  release(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(S.hung.has(a), false, 'released only by its own late settlement'); assert.ok(h.ledger.recoveryHistory(a).some((r) => r.kind === 'watchdog_step_settled_late'))
  h.adapters.tests.run = run; h.close()
})

test('a hung NETWORK call is aborted at its deadline and left UNCERTAIN (never assumed cancelled): reconciled absent, retried once', async () => {
  const h = await harness({ dcfg: { networkDeadlineMs: 40 } }); const id = h.submit(); h.github.inject('push_ref', 'hang')
  assert.ok((await h.drive({ until: () => state(h, id) === 'merge_eligible', maxRounds: 400 })).done)
  const p = intents(h, id).find((i) => i.action === 'publish_candidate_branch'); assert.equal(p.status, 'succeeded', 'retried after absence was proven')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM remote_observations WHERE intent_id=? AND state='absent'").get(p.intent_id), 'absence came from authenticated reads, not from the timeout')
  assert.equal(ops(h, 'push_ref').length, 1); assert.ok(h.ledger.db.prepare("SELECT 1 FROM operation_deadlines WHERE kind='effect:publish_candidate_branch' AND state IN ('unresolved','settled_late')").get()); h.close()
})

test('cancellation during a remote operation: no NEW effect ever, the uncertain one is still reconciled, and the shared-staging hold is released only after observation proves it idle', async () => {
  const h = await harness(); const id = h.submit(); h.github.inject('push_ref', 'lose_response')
  await h.drive({ until: () => intents(h, id).some((i) => i.action === 'publish_candidate_branch' && i.status === 'uncertain'), maxRounds: 100 })
  assert.equal(stagingOwner(h.ledger)?.task_id, id)
  // D3.6 integration (P6v3): cancellation is an owner-only terminal transition — a bare cancel is refused; the owner cancellation then stops every new effect
  assert.equal(h.ledger.cancel(id).problems[0], 'TASK.OWNER_ACTION_REQUIRED'); assert.ok(h.ledger.cancel(id, { ownerActionId: 'owner-cancel-watchdog-1' }).ok); assert.equal(h.ledger.getTask(id).state, 'cancelled')
  await h.drive({ until: () => !stagingOwner(h.ledger), maxRounds: 60 })
  assert.equal(intents(h, id).find((i) => i.action === 'publish_candidate_branch').status, 'reconciled_succeeded', 'reconciliation is read-only and still settles it')
  assert.equal(ops(h, 'create_pull').length, 0, 'no PR for a cancelled task'); assert.equal(stagingOwner(h.ledger), null); h.close()
})

test('circuit breaker: repeated timeouts open a persisted circuit with growing back-off; a healthy result closes it', async () => {
  const h = await harness(); const L = h.ledger
  for (let i = 0; i < 2; i += 1) assert.equal(noteTimeout(L, 'gh').open, false)
  const o = noteTimeout(L, 'gh'); assert.equal(o.open, true); assert.ok(circuitOpen(L, 'gh').open)
  const o2 = noteTimeout(L, 'gh'); assert.ok(o2.until - L.now() > o.until - L.now(), 'back-off grows')
  noteHealthy(L, 'gh'); assert.equal(circuitOpen(L, 'gh').open, false); h.close()
})
