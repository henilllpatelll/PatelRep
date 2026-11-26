// D3.5-E — task-owned cleanup under simulated DISK PRESSURE, in disposable temp fixtures: identity/provenance, the D3.2 evaluator as the one policy, and every adversarial
// case (symlink/junction, traversal, another task's files, the owner's files, PID reuse, a running process, a live lease, a migration, the primary worktree, the last
// recoverable checkpoint). Real files and a real NTFS junction are used; deletion happens only inside the test's own temp directory.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { assignWorkspace } from '../orchestrator/ledger/slots.mjs'
import { executeCleanup, ownedResources, pathFacts, planTaskCleanup, reconcileCleanup, registerOwned } from '../orchestrator/cleanup.mjs'
import { H, tmp } from './d34-rem-helpers.mjs'

const T = Date.parse('2026-11-25T11:00:00Z')

function fixture() {
  const h = H(); const L = h.ledger
  const root = path.join(tmp('dh35-clean-'), 'dh3')
  const t1 = h.submit({ requirements: { text: 'cleanup task one' } }); const t2 = h.submit({ requirements: { text: 'cleanup task two' } })
  const w1 = assignWorkspace(L, t1, { root }).workspace.worktree_path; const w2 = assignWorkspace(L, t2, { root }).workspace.worktree_path
  const mk = (p, file = 'x.bin') => { mkdirSync(p, { recursive: true }); writeFileSync(path.join(p, file), 'data'); return p }
  const ownerFile = path.join(root, 'owner-notes.txt'); mkdirSync(root, { recursive: true }); writeFileSync(ownerFile, 'the owner\'s file')
  const t2Overlay = mk(path.join(w2, 'overlay'))
  const procs = new Map([[4100, { start_time_ms: T, alive: true }], [4200, { start_time_ms: T + 999, alive: true }], [4300, { start_time_ms: T, alive: true }], [9999, { start_time_ms: T, alive: true }]]) // 9999 = the owner's dev server (never registered)
  const id = {}
  id.overlay = registerOwned(L, t1, { kind: 'worker_overlay', canonicalRef: mk(path.join(w1, 'overlay')), lifecycle: 'stale' })
  const junctionTarget = t2Overlay; const junction = path.join(w1, 'evil-junction'); mkdirSync(w1, { recursive: true }); symlinkSync(junctionTarget, junction, 'junction')
  id.junction = registerOwned(L, t1, { kind: 'temp_dir', canonicalRef: junction, lifecycle: 'stale' })
  id.traversal = registerOwned(L, t1, { kind: 'temp_dir', canonicalRef: `${w1}${path.sep}..${path.sep}..${path.sep}owner-notes.txt`, lifecycle: 'stale' })
  id.outside = registerOwned(L, t1, { kind: 'log', canonicalRef: ownerFile, lifecycle: 'stale' })
  id.pidReused = registerOwned(L, t1, { kind: 'review_agent', processIdentity: { pid: 4200, start_time_ms: T }, lifecycle: 'idle' })
  id.idleReviewer = registerOwned(L, t1, { kind: 'review_agent', processIdentity: { pid: 4100, start_time_ms: T }, lifecycle: 'idle' })
  id.running = registerOwned(L, t1, { kind: 'test_process', processIdentity: { pid: 4300, start_time_ms: T }, lifecycle: 'running' })
  id.migration = registerOwned(L, t1, { kind: 'migration', lifecycle: 'idle' })
  id.primary = registerOwned(L, t1, { kind: 'worktree', canonicalRef: mk(path.join(w1, 'primary')), protectedClass: 'primary_worktree', lifecycle: 'stale' })
  const cp = L.recordCheckpoint(t1, { reason: 'TEST', payload: { a: 1 } }); L.markCheckpointVerified(cp)
  id.lastCp = registerOwned(L, t1, { kind: 'checkpoint_snapshot', canonicalRef: mk(path.join(w1, 'snap-last')), lifecycle: 'stale', detail: { checkpoint_id: cp } })
  L.transition(t1, 'queued'); L.transition(t1, 'planning')
  const lease = L.acquireLease({ taskId: t1, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'high' }).lease
  id.leased = registerOwned(L, t1, { kind: 'temp_dir', canonicalRef: mk(path.join(w1, 'leased')), executionId: lease.execution_id, lifecycle: 'stale' })
  id.t2 = registerOwned(L, t2, { kind: 'worker_overlay', canonicalRef: t2Overlay, lifecycle: 'stale' })
  const stopped = new Set()
  const procFacts = async (pi) => { const p = procs.get(pi?.pid); return p && !stopped.has(pi.pid) ? { alive: p.alive, start_time_ms: p.start_time_ms } : { alive: false } }
  const executor = {
    async remove(item) {
      if (item.process) { if (procs.get(item.process.pid)?.start_time_ms !== item.process.start_time_ms) return { ok: false, code: 'PID_REUSED_AT_EXECUTION' }; stopped.add(item.process.pid); return { ok: true } }
      const f = pathFacts(item.ref, w1); if (!f.ok) return { ok: false, code: f.code } // the executor RE-CHECKS identity immediately before acting (no TOCTOU)
      rmSync(item.ref, { recursive: true, force: true }); return { ok: true }
    },
    async verifyGone(item) { return { gone: item.process ? stopped.has(item.process.pid) : !existsSync(item.ref) } },
  }
  return { h, L, t1, t2, w1, w2, id, ownerFile, t2Overlay, junction, procFacts, executor, stopped, lease, root }
}

test('disk-pressure cleanup plan: ONLY the task\'s own eligible resources are allowed; every adversarial case is refused with its reason', async () => {
  const f = fixture()
  try {
    const p = await planTaskCleanup(f.h.engine, f.t1, { procFacts: f.procFacts, workspaceRoot: f.w1, protectedRoots: [path.join(f.w1, 'primary')] })
    assert.ok(p.ok)
    assert.deepEqual(p.plan.allowed.map((a) => a.id).sort(), [f.id.overlay, f.id.idleReviewer].sort())
    const why = Object.fromEntries(p.plan.refused.map((r) => [r.id, r.codes]))
    assert.ok(why[f.id.junction].includes('CLEANUP.LINK_REFUSED'), JSON.stringify(why[f.id.junction]))
    assert.ok(why[f.id.traversal].includes('CLEANUP.PATH_TRAVERSAL'))
    assert.ok(why[f.id.outside].includes('CLEANUP.OUTSIDE_TASK_WORKSPACE'))
    assert.ok(why[f.id.pidReused].includes('CLEANUP.PID_REUSED'))
    assert.ok(why[f.id.running].includes('RESOURCE.UNSAFE_LIFECYCLE'), 'a running process is never cleaned (the D3.2 evaluator decides)')
    assert.ok(why[f.id.migration].includes('CLEANUP.PROTECTED:migration'))
    assert.ok(why[f.id.primary].some((c) => /primary_worktree/.test(c)))
    assert.ok(why[f.id.lastCp].includes('CLEANUP.LAST_RECOVERABLE_CHECKPOINT'))
    assert.ok(why[f.id.leased].includes('CLEANUP.ACTIVE_LEASE'))
    assert.ok(!p.plan.allowed.concat(p.plan.refused).some((x) => x.id === f.id.t2), 'another task\'s resource is not even considered')
  } finally { f.h.close() }
})

test('disk-pressure cleanup execution (simulated adapters, temp fixture): removes exactly the allowed set; the other task\'s files, the junction target and the owner\'s files survive', async () => {
  const f = fixture()
  try {
    const p = await planTaskCleanup(f.h.engine, f.t1, { procFacts: f.procFacts, workspaceRoot: f.w1, protectedRoots: [path.join(f.w1, 'primary')] })
    f.L.closeLease(f.lease, { terminationVerified: true, endReason: 'completed' }) // while the task holds a live lease only idle-reviewer releases execute (review CR-8)
    const dry = await executeCleanup(f.h.engine, p, { executor: f.executor, dryRun: true })
    assert.ok(dry.results.every((r) => r.status === 'planned')); assert.ok(existsSync(path.join(f.w1, 'overlay')), 'a dry run changes nothing')
    const r = await executeCleanup(f.h.engine, p, { executor: f.executor, dryRun: false })
    assert.deepEqual(r.results.map((x) => x.status), ['verified', 'verified'])
    assert.ok(!existsSync(path.join(f.w1, 'overlay'))); assert.ok(f.stopped.has(4100))
    assert.ok(existsSync(f.t2Overlay) && existsSync(path.join(f.t2Overlay, 'x.bin')), 'the junction target (another task\'s overlay) is intact')
    assert.ok(existsSync(f.ownerFile), 'the owner\'s file is intact')
    assert.ok(!f.stopped.has(9999) && !f.stopped.has(4200) && !f.stopped.has(4300), 'no unrelated or unverified process was stopped (the owner\'s dev server pid 9999 was never registered)')
    assert.ok(existsSync(path.join(f.w1, 'snap-last')) && existsSync(path.join(f.w1, 'primary')) && existsSync(path.join(f.w1, 'leased')))
    const res = Object.fromEntries(ownedResources(f.L, f.t1).map((x) => [x.resource_id, x]))
    assert.equal(res[f.id.overlay].lifecycle, 'removed'); assert.equal(res[f.id.idleReviewer].termination_verified, 1)
    assert.equal(f.L.db.prepare("SELECT COUNT(*) c FROM authority_log WHERE kind='cleanup_verified'").get().c, 2, 'each verified cleanup is on the authority log')
    // ownership identity is immutable once recorded
    assert.throws(() => f.L.db.prepare('UPDATE resources SET task_id=? WHERE resource_id=?').run(f.t2, f.id.junction), /RESOURCE_IDENTITY_IMMUTABLE/)
    assert.throws(() => f.L.db.prepare('DELETE FROM resources').run(), /NO_DELETE/)
  } finally { f.h.close() }
})

test('cleanup crash safety: an intent interrupted while executing is RE-VERIFIED on restart — never re-executed blind, never assumed done; live execution is refused', async () => {
  const f = fixture()
  try {
    const p = await planTaskCleanup(f.h.engine, f.t1, { procFacts: f.procFacts, workspaceRoot: f.w1, protectedRoots: [path.join(f.w1, 'primary')], kinds: ['worker_overlay'] })
    f.L.closeLease(f.lease, { terminationVerified: true, endReason: 'completed' })
    f.h.engine.hookFn = (name) => { if (name === 'cleanup_executing') throw new Error('CRASH_INJECTED') }
    await assert.rejects(() => executeCleanup(f.h.engine, p, { executor: f.executor, dryRun: false }), /CRASH_INJECTED/)
    f.h.engine.hookFn = null
    assert.equal(f.L.db.prepare('SELECT status FROM cleanup_intents WHERE dry_run=0').get().status, 'executing')
    const again = await executeCleanup(f.h.engine, p, { executor: f.executor, dryRun: false })
    assert.equal(again.results[0].code, 'CLEANUP.INTENT_IN_FLIGHT', 'a second cleanup of the same resource cannot start while the first is unresolved')
    const rec = await reconcileCleanup(f.h.engine, { executor: f.executor })
    assert.deepEqual(rec.map((x) => x.status), ['failed'], 'the directory verifiably still exists: failed (review CR-15), NOT verified')
    assert.ok(existsSync(path.join(f.w1, 'overlay')), 'reconciliation did not delete anything')
    const again2 = await executeCleanup(f.h.engine, await planTaskCleanup(f.h.engine, f.t1, { procFacts: f.procFacts, workspaceRoot: f.w1, kinds: ['worker_overlay'] }), { executor: f.executor, dryRun: false })
    assert.deepEqual(again2.results.map((x) => x.status), ['verified'], 'a FAILED intent does not block a fresh, re-planned cleanup')
    const live = await executeCleanup({ ledger: f.L, adapters: { simulated: false }, hook() {} }, p, { executor: f.executor, dryRun: false })
    assert.equal(live.code, 'CLEANUP.LIVE_EXECUTION_NOT_AUTHORIZED')
  } finally { f.h.close() }
})

test('registration requires identity: a process needs pid + creation time (never a name); a path resource needs a canonical absolute path', () => {
  const f = fixture()
  try {
    assert.throws(() => registerOwned(f.L, f.t1, { kind: 'review_agent', processIdentity: { pid: 5 } }), /PROCESS_IDENTITY_REQUIRED/)
    assert.throws(() => registerOwned(f.L, f.t1, { kind: 'review_agent', processIdentity: { image: 'node.exe' } }), /PROCESS_IDENTITY_REQUIRED/)
    assert.throws(() => registerOwned(f.L, f.t1, { kind: 'temp_dir', canonicalRef: 'relative/dir' }), /CANONICAL_PATH_REQUIRED/)
    assert.throws(() => registerOwned(f.L, f.t1, { kind: 'whatever', canonicalRef: f.w1 }), /KIND_UNKNOWN/)
  } finally { f.h.close() }
})

test('review CR-8: execution re-checks the plan (tampered or stale plans refused) and a task with a LIVE lease gets only idle-reviewer releases', async () => {
  const f = fixture()
  try {
    const p = await planTaskCleanup(f.h.engine, f.t1, { procFacts: f.procFacts, workspaceRoot: f.w1, protectedRoots: [path.join(f.w1, 'primary')] })
    const live = await executeCleanup(f.h.engine, p, { executor: f.executor, dryRun: false })
    assert.deepEqual(Object.fromEntries(live.results.map((r) => [r.id, r.code ?? r.status])), { [f.id.overlay]: 'CLEANUP.TASK_HAS_LIVE_LEASE', [f.id.idleReviewer]: 'verified' })
    assert.ok(existsSync(path.join(f.w1, 'overlay')))
    const tampered = { ...p, plan: { ...p.plan, allowed: [...p.plan.allowed, { id: f.id.t2, kind: 'worker_overlay', ref: f.t2Overlay }] } }
    assert.equal((await executeCleanup(f.h.engine, tampered, { executor: f.executor, dryRun: false })).code, 'CLEANUP.PLAN_TAMPERED')
    f.h.clock.advance(61_000); assert.equal((await executeCleanup(f.h.engine, p, { executor: f.executor, dryRun: false })).code, 'CLEANUP.PLAN_STALE')
    assert.ok(existsSync(f.t2Overlay))
  } finally { f.h.close() }
})
