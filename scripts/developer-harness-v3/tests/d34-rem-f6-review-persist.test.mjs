// D3.4 remediation F6 — a finished review's DELIVERABLE is persisted BEFORE the reviewer session is torn down, so no crash window can cost a second paid review. The issuer still cannot accept
// it until termination, candidate binding, context independence and read-only proof have been verified. In-process "crash" tests (state-equivalent: everything durable is in SQLite/files)
// plus real SIGKILL subprocess tests at every review boundary. SIMULATED (no model/VM).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHarness } from '../orchestrator/sim/harness.mjs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { loadWorld, saveWorld } from '../orchestrator/sim/sim-world.mjs'
import { CHILD_ENV, ORCH, tmp } from './d34-helpers.mjs'
import { H, drive, settle, execs, owner } from './d34-rem-helpers.mjs'

const reviewers = (h, id) => execs(h, id).filter((e) => /reviewer/.test(e.role))
const dies = (name, nth) => { let n = 0; return (hook) => { if (hook === name && ++n === nth) throw new Error('SIMULATED_CONTROLLER_DEATH') } }

test('F6: the deliverable is persisted BEFORE teardown; until termination is verified the review is still OPEN and the issuer refuses it', async () => {
  let h; const seen = []
  h = H({ hook: (name) => { if (name === 'after_review_deliverable_persisted' && !seen.length) { const rv = h.ledger.db.prepare("SELECT * FROM reviews WHERE kind='independent_review'").get(); seen.push({ review: rv.status, slot: h.ledger.slotHolder()?.state, row: h.ledger.getReviewDeliverable(rv.review_id), issuer: h.cores.independent_reviewer.handle('issue_review', { task_id: rv.task_id, review_id: rv.review_id }) }) } } })
  const id = h.submit(); await drive(h); assert.equal(seen.length, 1)
  assert.equal(seen[0].review, 'open'); assert.equal(seen[0].slot, 'active', 'the session had NOT yet been torn down'); assert.ok(seen[0].row?.deliverable_json, 'the finished result was already durable'); assert.equal(seen[0].issuer.ok, false); assert.equal(seen[0].issuer.code, 'ISSUER.REVIEW_NOT_SUBMITTED')
  assert.equal(h.ledger.getTask(id).handoff_ready, 1); h.close()
})

for (const [point, nth, label] of [['after_review_deliverable_persisted', 1, 'before teardown (independent)'], ['after_session_terminated', 3, 'after verified termination, lease not yet closed'], ['after_lease_closed', 3, 'after the lease was closed'], ['after_review_readonly_verified', 1, 'after the read-only check'],
  ['after_review_deliverable_persisted', 2, 'before teardown (security)'], ['after_lease_closed', 4, 'after the security lease was closed']]) {
  test(`F6: a controller death ${label} costs NO second review session (executions per reviewer role equal an uncrashed run)`, async () => {
    const h = H({ hook: dies(point, nth) }); const id = h.submit(); await assert.rejects(() => h.engine.runUntilIdle({ maxTicks: 200 }), /SIMULATED_CONTROLLER_DEATH/)
    h.engine.hookFn = null; // the restarted controller: recovery of an orphaned lease first, exactly as recoverOnStart does
    const { reconcileSlot } = await import('../orchestrator/recovery.mjs'); await reconcileSlot(h.engine, { reason: 'HOST_RESTARTED' }); await drive(h)
    assert.equal(h.ledger.getTask(id).handoff_ready, 1); const roles = Object.fromEntries(['independent_reviewer', 'security_reviewer'].map((r) => [r, execs(h, id).filter((e) => e.role === r).length])); assert.deepEqual(roles, { independent_reviewer: 1, security_reviewer: 1 }, 'no repeated paid review'); assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }); h.close()
  })
}

test('F6: while a reviewer session termination is UNVERIFIED nothing is accepted or issued; once a verified cleanup supersedes the lease, the persisted deliverable is consumed WITHOUT a new session', async () => {
  const h = H(); let verified = false; const t0 = h.adapters.worker.terminateSession.bind(h.adapters.worker); const c0 = h.adapters.worker.cleanupGuest.bind(h.adapters.worker)
  const isReviewer = (l) => /reviewer/.test(h.ledger.getExecution(l.execution_id).role)
  h.adapters.worker.terminateSession = async (l) => (verified || !isReviewer(l) ? t0(l) : { verified: false }); h.adapters.worker.cleanupGuest = async () => (verified ? c0() : { verified: false })
  const id = h.submit(); let held = false; for (let i = 0; i < 60 && !held; i += 1) { const r = await h.engine.tick(); held = !r.progressed && r.held === true }
  assert.ok(held, 'the engine is holding the slot'); assert.equal(h.ledger.slotHolder().state, 'termination_unverified'); const rv = h.ledger.db.prepare("SELECT * FROM reviews WHERE kind='independent_review'").all()
  assert.equal(rv.length, 1); assert.equal(rv[0].status, 'open', 'not submitted: termination is unproven'); assert.ok(h.ledger.getReviewDeliverable(rv[0].review_id), 'but the finished result is already durable'); assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM evidence WHERE evidence_type='independent_review'").get().c, 0)
  assert.equal(h.cores.independent_reviewer.handle('issue_review', { task_id: id, review_id: rv[0].review_id }).ok, false, 'the issuer refuses an unproven stop')
  verified = true; await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.equal(execs(h, id).filter((e) => e.role === 'independent_reviewer').length, 1, 'the already-paid review result was used'); h.close()
})

test('F6: the persisted deliverable is accepted ONLY while candidate, tree, execution, context and the read-only proof still bind — any mismatch discards it and a fresh review runs', async () => {
  for (const [name, tamper, expectReview] of [
    ['candidate mismatch', (L, rid) => L.db.prepare('UPDATE review_deliverables SET candidate_sha=? WHERE review_id=?').run('a'.repeat(40), rid), 2],
    ['tree mismatch', (L, rid) => L.db.prepare('UPDATE review_deliverables SET tree_digest=? WHERE review_id=?').run('a'.repeat(40), rid), 2],
    ['execution mismatch', (L, rid) => L.db.prepare('UPDATE review_deliverables SET execution_id=? WHERE review_id=?').run('x-other', rid), 2],
    ['context reuse (reviewer shares the implementer context)', (L, rid, id) => L.db.prepare('UPDATE review_deliverables SET context_id=? WHERE review_id=?').run(L.db.prepare("SELECT context_id FROM executions WHERE task_id=? AND role='implementer'").get(id).context_id, rid), 2],
    ['clean', () => {}, 1],
  ]) {
    const h = H({ hook: dies('after_lease_closed', 3) }); const id = h.submit(); await assert.rejects(() => h.engine.runUntilIdle({ maxTicks: 200 }), /SIMULATED_CONTROLLER_DEATH/); h.engine.hookFn = null
    const rid = h.ledger.db.prepare("SELECT review_id FROM reviews WHERE kind='independent_review'").get().review_id; tamper(h.ledger, rid, id); await drive(h)
    assert.equal(h.ledger.getTask(id).handoff_ready, 1, name); assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM reviews WHERE task_id=? AND kind='independent_review'").get(id).c, expectReview, name)
    if (expectReview === 2) assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'review_deliverable_discarded'), `${name}: the refusal is recorded`); h.close()
  }
})

test('F6: a reviewer that modified the candidate AFTER its deliverable was persisted is caught by the read-only proof at consumption (the stale deliverable is never accepted)', async () => {
  const h = H({ hook: dies('after_lease_closed', 3) }); const id = h.submit(); await assert.rejects(() => h.engine.runUntilIdle({ maxTicks: 200 }), /SIMULATED_CONTROLLER_DEATH/); h.engine.hookFn = null
  const w = loadWorld(h.dirs.world); w.tamper_review = true; saveWorld(h.dirs.world, w) // the tree no longer equals the reviewed candidate
  await settle(h); assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'reviewer_modified_candidate'), 'caught'); assert.equal(h.ledger.db.prepare("SELECT status FROM reviews WHERE task_id=? AND kind='independent_review' ORDER BY round").get(id).status, 'verified_fail')
  assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM evidence WHERE evidence_type='independent_review'").get().c, 0); h.close()
})

// ---------------------------------------------------------------- real SIGKILL at every review boundary
const MAIN = path.join(ORCH, 'sim', 'controller-main.mjs')
const controller = (root, over = {}) => { const f = path.join(root, `ctl-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify({ root, scenario: {}, max_ticks: 400, ...over })); const r = spawnSync(process.execPath, [MAIN, f], { encoding: 'utf8', timeout: 240_000, env: CHILD_ENV }); return { status: r.status, err: r.stderr } }
const rolesOf = (root) => { const L = Ledger.open(path.join(root, 'ledger.sqlite')); try { return Object.fromEntries(L.db.prepare('SELECT role, COUNT(*) n FROM executions GROUP BY role').all().map((r) => [r.role, r.n])) } finally { L.close() } }
for (const [point, nth] of [['after_review_deliverable_persisted', 1], ['after_review_deliverable_persisted', 2], ['after_session_terminated', 3], ['after_session_terminated', 4], ['after_lease_closed', 3], ['after_lease_closed', 4], ['after_review_readonly_verified', 1], ['after_review_readonly_verified', 2], ['after_review_submitted', 1], ['after_review_submitted', 2]]) {
  test(`F6: SIGKILL at ${point} #${nth}, restart — the review is NOT bought twice and the handoff completes`, () => {
    const root = tmp('dh34-f6-'); const h0 = createHarness({ root }); const id = h0.submit(); h0.close()
    const base = tmp('dh34-f6b-'); const hb = createHarness({ root: base }); hb.submit(); hb.close(); assert.equal(controller(base).status, 0); const baseline = rolesOf(base)
    controller(root, { crash_at: `${point}:${nth}` }); assert.ok(existsSync(path.join(root, 'crashed-at.txt')) && readFileSync(path.join(root, 'crashed-at.txt'), 'utf8') === `${point}:${nth}`, 'the crash point was reached')
    const last = controller(root); assert.equal(last.status, 0, last.err.slice(0, 300)); const L = Ledger.open(path.join(root, 'ledger.sqlite')); try { assert.equal(L.getTask(id).handoff_ready, 1) } finally { L.close() }
    const got = rolesOf(root); assert.equal(got.independent_reviewer, baseline.independent_reviewer); assert.equal(got.security_reviewer, baseline.security_reviewer); assert.deepEqual(got, baseline)
  })
}
