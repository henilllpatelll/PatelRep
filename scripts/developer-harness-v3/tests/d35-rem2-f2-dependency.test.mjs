// D3.5 independent-verification remediation, F2 — dependency-basis invalidation AND actual re-verification.
// The pre-fix scheduler withdrew a downstream task's evidence when an upstream candidate changed but then recorded the NEW upstream state as the dependency basis, after which the engine
// re-attested the downstream's OLD test run and OLD reviews and handed it off again — "validated" against a configuration nobody had built or verified. These tests drive the whole recovery:
//   * AUTHORITATIVE lifecycle (no rebuild transition exists): the downstream FAILS CLOSED (terminal technical suspension, evidence and handoff withdrawn, never re-handed-off);
//   * PROPOSAL lifecycle (P6 + the dependency-rebuild edge, labelled test configuration only): the downstream is REBUILT and RE-VERIFIED (new session, new test run, new reviews, new handoff).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Scheduler } from '../orchestrator/scheduler.mjs'
import { H, owner } from './d34-rem-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PROPOSALS = path.join(ROOT, 'docs/developer-harness-v3/proposals')
const spec = (letter, over = {}) => ({ requirements: { text: `Task ${letter}: add the ${letter} indicator.`, sim_path: `apps/mobile/${letter}/feature.txt` }, scope: { allowed_paths: [`apps/mobile/${letter}/**`], denied_paths: [] }, ...over })

/** The labelled PROPOSAL reducer: P6 (which now includes the dependency-rebuild edge) applied to a disposable copy. Nothing is applied to the repository. */
export async function proposalReducer() {
  const t = mkdtempSync(path.join(os.tmpdir(), 'dh35-p6f2-'))
  for (const rel of ['scripts/developer-harness-v3/lifecycle/lifecycle.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs', 'docs/developer-harness-v3/task-lifecycle.json']) { mkdirSync(path.dirname(path.join(t, rel)), { recursive: true }); copyFileSync(path.join(ROOT, rel), path.join(t, rel)) }
  const ap = spawnSync('git', ['apply', '-p1', path.join(PROPOSALS, 'P6-lifecycle-consolidated.patch')], { cwd: t, encoding: 'utf8' }); assert.equal(ap.status, 0, ap.stderr)
  const mod = await import(pathToFileURL(path.join(t, 'scripts/developer-harness-v3/lifecycle/lifecycle.mjs')).href)
  return { label: 'PROPOSAL_UNDER_TEST', applyEvent: mod.applyEvent, createTask: mod.createTask, lc: mod.loadLifecycle() }
}

async function drive(h, s) {
  for (let k = 0; k < 300; k += 1) {
    let nw = null; let idle = false
    for (let i = 0; i < 600; i += 1) { const r = await s.round(); if (!r.progressed) { idle = true; nw = r.next_wakeup; break } }
    assert.ok(idle, 'the scheduler reaches idle (no runaway loop)')
    if (!nw) return
    h.clock.advance(nw <= h.clock.now() ? 1000 : nw - h.clock.now() + 1)
  }
  throw new Error('drive: still waking')
}
const live = (L, id) => L.db.prepare('SELECT COUNT(*) c FROM evidence WHERE task_id=? AND invalidated_at IS NULL').get(id).c
const handoffDigest = (L, id) => JSON.parse(L.meta(`handoff:${id}`) ?? 'null')?.digest ?? null
const swapCandidate = (L, id, ch = 'f') => { const c = L.currentCandidate(id); assert.ok(L.submitCandidate(id, { base_sha: c.base_sha, candidate_sha: ch.repeat(40), tree_digest: 'e'.repeat(40), patch_digest: 'd'.repeat(64) }).ok) }

test('REPRODUCTION (pre-fix defect, now refused): an upstream candidate change must never end with the downstream re-handed-off on its OLD, re-attested evidence', async () => {
  const h = H()
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] }))
    await drive(h, s)
    assert.equal(L.getTask(D).handoff_ready, 1); const oldDigest = handoffDigest(L, D); const oldCand = L.currentCandidate(D).candidate_sha
    swapCandidate(L, B)
    assert.deepEqual(s.checkDependencyBasis(), [D])
    await drive(h, s)
    // the broken behaviour: handoff_ready=1 again, with D's old candidate and re-attested evidence, a "validated" new basis
    assert.equal(L.getTask(D).handoff_ready, 0, 'the downstream is NOT handed off against an unverified dependency configuration')
    assert.equal(L.currentCandidate(D).candidate_sha, oldCand)
    assert.equal(L.recoveryHistory(D).filter((r) => r.kind === 'evidence_reattested').length, 0, 'no stale approval was re-signed')
    assert.notEqual(handoffDigest(L, D), oldDigest, 'the old handoff package is not current')
  } finally { h.close() }
})

test('AUTHORITATIVE lifecycle, three-task chain B -> D -> G: an upstream candidate change withdraws D and (transitively) G and FAILS CLOSED — nothing is re-authorized, no handoff, one explicit suspension each', async () => {
  const h = H()
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] })); const G = h.submit(spec('g', { depends_on: [D] }))
    await drive(h, s)
    for (const id of [B, D, G]) assert.equal(L.getTask(id).handoff_ready, 1)
    const dDigest = handoffDigest(L, D); const gDigest = handoffDigest(L, G)
    swapCandidate(L, B)
    assert.deepEqual(s.checkDependencyBasis().sort(), [D, G].sort(), 'D (direct) and G (transitive) are both withdrawn')
    for (const id of [D, G]) { assert.equal(L.getTask(id).handoff_ready, 0, `${id} handoff withdrawn`); assert.equal(live(L, id), 0, `${id} approvals withdrawn`) }
    assert.deepEqual(s.checkDependencyBasis(), [], 'idempotent')
    await drive(h, s)
    for (const id of [D, G]) {
      assert.equal(L.getTask(id).handoff_ready, 0, `${id} is NOT re-handed-off`)
      assert.equal(L.recoveryHistory(id).filter((r) => r.kind === 'evidence_reattested').length, 0)
    }
    assert.equal(L.getSuspension(D)?.disposition, 'terminal'); assert.equal(L.getSuspension(D)?.cause, 'DEPENDENCY_BASIS_CHANGED')
    assert.equal(L.getTask(B).handoff_ready, 1, 'the upstream is unaffected')
    assert.notEqual(handoffDigest(L, D), dDigest); assert.notEqual(handoffDigest(L, G), gDigest)
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM meta WHERE key LIKE 'handoff_superseded:%'").get().c >= 2, true, 'the superseded packages are preserved as history, not current')
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }, 'an engineering condition is never an owner decision')
  } finally { h.close() }
})

test('AUTHORITATIVE lifecycle: upstream CANCELLATION withdraws the downstream handoff and its approvals and blocks it explicitly (never a silently valid handoff)', async () => {
  const h = H()
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] }))
    await drive(h, s); assert.equal(L.getTask(D).handoff_ready, 1)
    L.cancel(B)
    s.checkDependencyBasis(); await drive(h, s)
    assert.equal(L.getTask(D).handoff_ready, 0, 'handoff withdrawn'); assert.equal(live(L, D), 0)
    assert.equal(L.getTask(D).state, 'blocked'); assert.ok(L.getWait(D)?.detail?.codes?.some((c) => /DEPENDENCY_CANCELLED/.test(c)))
  } finally { h.close() }
})

test('a dependency that is merely NOT READY (rebuilding) withdraws the downstream handoff but keeps its evidence; when the SAME candidate is ready again the downstream hands off again with a NEW package', async () => {
  const h = H()
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] }))
    await drive(h, s)
    const before = handoffDigest(L, D); const ev = live(L, D)
    L.db.prepare('UPDATE tasks SET handoff_ready=0 WHERE task_id=?').run(B) // B temporarily not ready (its own re-verification)
    s.checkDependencyBasis()
    assert.equal(L.getTask(D).handoff_ready, 0, 'no downstream handoff while the dependency is not ready'); assert.equal(live(L, D), ev, 'but nothing was invalidated: the candidate did not change')
    await s.round(); assert.equal(L.getTask(D).state, 'dependency_waiting', 'it waits, explicitly')
    L.db.prepare('UPDATE tasks SET handoff_ready=1 WHERE task_id=?').run(B)
    await drive(h, s)
    assert.equal(L.getTask(D).handoff_ready, 1)
    assert.ok(L.recoveryHistory(D).some((r) => r.kind === 'handoff_withdrawn' && r.detail.cause === 'DEPENDENCY_NOT_READY'), 'the withdrawal is recorded')
    assert.ok(L.meta(`handoff_superseded:${D}:${before}`), 'the old package was superseded (kept as history) and the handoff was rebuilt from still-valid evidence')
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})

test('PROPOSAL lifecycle, chain B -> D -> G: B is rebuilt; D and G are REBUILT and RE-VERIFIED (new sessions, new test runs, new reviews, new handoffs) — and each is bound to the new basis', async () => {
  const R = await proposalReducer()
  const h = H({ ledgerOptions: { proposalReducer: R } })
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] })); const G = h.submit(spec('g', { depends_on: [D] }))
    await drive(h, s)
    for (const id of [B, D, G]) assert.equal(L.getTask(id).handoff_ready, 1)
    const old = Object.fromEntries([B, D, G].map((id) => [id, { cand: L.currentCandidate(id).candidate_sha, digest: handoffDigest(L, id), runs: L.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(id).c, reviews: L.db.prepare('SELECT COUNT(*) c FROM reviews WHERE task_id=?').get(id).c, execs: L.db.prepare('SELECT COUNT(*) c FROM executions WHERE task_id=?').get(id).c }]))
    // B is changed upstream: an explicit rebuild of B (the declared back-edge), not a hand-edit of the ledger
    L.db.prepare('UPDATE tasks SET handoff_ready=0 WHERE task_id=?').run(B)
    const t = L.transition(B, 'implementing', { reason_code: R.lc.dependency_rebuild.reason }); assert.ok(t.ok, t.problems?.join())
    L.setMeta(`remediation:${B}`, 'Upstream requirement changed: rebuild.'); L.setMeta(`dep_rebuild:${B}`, '1')
    await drive(h, s)
    for (const id of [B, D, G]) assert.equal(L.getTask(id).handoff_ready, 1, `${id} handed off again`)
    for (const id of [D, G]) {
      assert.notEqual(L.currentCandidate(id).candidate_sha, old[id].cand, `${id} was REBUILT (new candidate)`)
      assert.ok(L.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(id).c > old[id].runs, `${id} was RE-TESTED`)
      assert.ok(L.db.prepare('SELECT COUNT(*) c FROM reviews WHERE task_id=?').get(id).c > old[id].reviews, `${id} was RE-REVIEWED`)
      assert.ok(L.db.prepare('SELECT COUNT(*) c FROM executions WHERE task_id=?').get(id).c > old[id].execs, `${id} ran a NEW session`)
      assert.notEqual(handoffDigest(L, id), old[id].digest, `${id}: a new package`)
      assert.equal(L.recoveryHistory(id).filter((r) => r.kind === 'evidence_reattested').length, 0, `${id}: nothing old was re-signed`)
      const basis = JSON.parse(L.meta(`dep_basis:${id}`)); assert.equal(basis.candidate, L.currentCandidate(id).candidate_sha, `${id}'s basis is bound to its CURRENT candidate`)
    }
    const dBasis = JSON.parse(L.meta(`dep_basis:${D}`)); assert.equal(dBasis.basis[0].candidate, L.currentCandidate(B).candidate_sha, 'D is verified against the CURRENT upstream candidate')
    const gBasis = JSON.parse(L.meta(`dep_basis:${G}`)); assert.equal(gBasis.basis[0].candidate, L.currentCandidate(D).candidate_sha, 'G is verified against the CURRENT D candidate')
    assert.equal(L.getSuspension(D), null); assert.equal(L.getSuspension(G), null)
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }, 'zero owner interventions')
  } finally { h.close() }
})

test('PROPOSAL lifecycle: a dependency basis that changes DURING the downstream\'s own build (interrupted work) is discarded — the session result is never recorded as verified against the new basis', async () => {
  const R = await proposalReducer()
  const h = H({ ledgerOptions: { proposalReducer: R } })
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] }))
    let swapped = false
    const orig = h.adapters.session.runUnit.bind(h.adapters.session)
    h.adapters.session.runUnit = async (a) => { if (a.task.task_id === D && a.stage === 'implementing' && !swapped) { swapped = true; swapCandidate(L, B) } return orig(a) } // B changes while D's implementation session runs
    await drive(h, s)
    assert.ok(swapped)
    const basis = JSON.parse(L.meta(`dep_basis:${D}`)); assert.equal(basis.basis[0].candidate, L.currentCandidate(B).candidate_sha, 'the final basis is the CURRENT one — D was built again, not stamped')
    assert.ok(L.recoveryHistory(D).some((r) => r.kind === 'dependency_basis_changed_during_build'), 'the discarded build is recorded')
    assert.ok(L.db.prepare('SELECT COUNT(*) c FROM executions WHERE task_id=? AND role=?').get(D, 'implementer').c >= 2, 'a second implementation session was bought')
    assert.equal(L.getTask(D).handoff_ready, 1)
  } finally { h.close() }
})

test('idempotent and crash-safe: the sweep and the recovery can be repeated or interrupted at any point without changing the outcome', async () => {
  const h = H()
  try {
    const L = h.ledger; const s = new Scheduler(h.engine)
    const B = h.submit(spec('b')); const D = h.submit(spec('d', { depends_on: [B] })); const G = h.submit(spec('g', { depends_on: [D] }))
    await drive(h, s); swapCandidate(L, B)
    const a = s.checkDependencyBasis(); const snap = () => JSON.stringify([L.getTask(D).handoff_ready, L.getTask(G).handoff_ready, live(L, D), live(L, G), L.recoveryHistory(D).length, L.recoveryHistory(G).length])
    const s1 = snap(); for (let i = 0; i < 3; i += 1) assert.deepEqual(s.checkDependencyBasis(), []); assert.equal(snap(), s1)
    assert.equal(a.length, 2)
    // a "controller restart": a fresh engine/scheduler over the same ledger reaches the same state
    const s2 = new Scheduler(h.engine); await drive(h, s2)
    assert.equal(L.getTask(D).handoff_ready, 0); assert.equal(L.getTask(G).handoff_ready, 0)
  } finally { h.close() }
})
