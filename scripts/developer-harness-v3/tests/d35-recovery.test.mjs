// D3.5-C — self-healing worker recovery (SIMULATED worker/VM; real ledger, real snapshots on disk, real engine stages): preserve-before-replace, quarantine, golden-image trust,
// checkpoint fallback, unverified termination, disk pressure, provider waits and storm prevention through persisted, bounded attempts that survive a controller restart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileTree, wtDir } from '../orchestrator/sim/sim-world.mjs'
import { createHarness, FixtureClock } from '../orchestrator/sim/harness.mjs'
import { buildCheckpoint } from '../orchestrator/context-renewal.mjs'
import { registerOwned } from '../orchestrator/cleanup.mjs'
import { SUPERVISOR_DEFAULTS, attemptsOf, reportIncident, superviseIncident } from '../orchestrator/recovery-supervisor.mjs'
import { H, drive, finalBytes, owner, tmp } from './d34-rem-helpers.mjs'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const G = 'a'.repeat(64)
/** The FIRST implementing session's worker reports `incident`; optionally with uncommitted work already in the worktree (what must be preserved). */
function withIncident(h, incident, { work = null, times = 1 } = {}) {
  let left = times; const orig = h.adapters.worker.ensure.bind(h.adapters.worker)
  h.adapters.worker.ensure = async (t) => {
    if (left > 0 && h.ledger.getTask(t.task_id).state === 'implementing') {
      left -= 1
      if (work) writeFileTree(wtDir(h.dirs.world, t.task_id), [{ path: 'apps/mobile/feature.txt', content: Buffer.from(work) }])
      return { ok: false, code: 'WORKER.HOME_NOT_SANITIZED', incident, detail: { overlay: 'task.qcow2' } }
    }
    return orig(t)
  }
}
const golden = (h, { sha = G, sealed = G, ro = true } = {}) => { const calls = { reprov: [], rebuild: 0 }; h.adapters.worker.verifyGolden = async () => ({ sha256: sha, sealed_sha256: sealed, read_only: ro }); h.adapters.worker.reprovisionOverlay = async (x) => { calls.reprov.push(x); return { ok: true } }; h.adapters.worker.rebuildGoldenCandidate = async () => { calls.rebuild += 1; return { ok: true, candidate_sha256: 'b'.repeat(64), inputs_verified: true } }; return calls }
const kinds = (h, id) => h.ledger.recoveryHistory(id).map((r) => r.kind)

test('failed guest sanitizer: uncommitted work is PRESERVED (verified checkpoint) before the worker is quarantined, the overlay is reprovisioned from the VERIFIED golden, and the work survives', async () => {
  const h = H()
  try {
    const id = h.submit(); withIncident(h, 'sanitizer_failed', { work: 'PRESERVED-LINE from before the sanitizer failure\n' }); const g = golden(h)
    await drive(h)
    assert.equal(h.ledger.getTask(id).handoff_ready, 1)
    assert.equal(g.reprov.length, 1); assert.equal(g.reprov[0].golden_sha256, G)
    const k = kinds(h, id)
    assert.ok(k.indexOf('uncommitted_work_preserved') < k.indexOf('quarantined') && k.includes('worker_replaced'), k.join(','))
    assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM quarantine WHERE kind='worker_overlay'").get().c, 1)
    assert.match(finalBytes(h, id), /PRESERVED-LINE/, 'the preserved work reached the final candidate')
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})

test('preservation that cannot be VERIFIED: the contaminated worker is quarantined INTACT (never reprovisioned/destroyed) and the task is technically suspended with diagnostics', async () => {
  const h = H()
  try {
    const id = h.submit(); withIncident(h, 'worker_contaminated', { work: 'unsaved work\n' }); const g = golden(h)
    let fail = true; const orig = h.adapters.git.captureSnapshot.bind(h.adapters.git)
    h.adapters.git.captureSnapshot = async (...a) => { if (fail && h.ledger.meta(`incident:${id}`)) throw new Error('disk read error'); return orig(...a) }
    for (let i = 0; i < 40 && !h.ledger.getSuspension(id); i += 1) { await h.engine.runUntilIdle({ maxTicks: 50 }); h.clock.advance(31_000) }
    fail = false
    const s = h.ledger.getSuspension(id)
    assert.equal(s.cause, 'WORK_PRESERVATION_UNVERIFIED'); assert.equal(g.reprov.length, 0, 'nothing was reprovisioned over unpreserved work')
    assert.equal(h.ledger.db.prepare("SELECT reason FROM quarantine WHERE kind='worker'").get().reason, 'WORK_PRESERVATION_UNVERIFIED')
    assert.ok(existsSync(path.join(wtDir(h.dirs.world, id), 'apps', 'mobile', 'feature.txt')), 'the work is still there')
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 }, 'an engineering condition, not an owner permission question')
  } finally { h.close() }
})

test('golden-image tampering: the golden is quarantined and NEVER re-blessed; a candidate rebuilt from pinned inputs is NOT promoted; one owner root-of-trust package', async () => {
  const h = H()
  try {
    const id = h.submit(); withIncident(h, 'sanitizer_failed'); const g = golden(h, { sha: 'c'.repeat(64) })
    await drive(h)
    const t = h.ledger.getTask(id)
    assert.equal(t.state, 'blocked'); assert.equal(t.lifecycle.blocker_reason, 'OWNER_ROOT_OF_TRUST_CEREMONY')
    assert.equal(g.reprov.length, 0, 'no worker was provisioned from an unverified golden')
    assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM quarantine WHERE kind='golden_image' AND reason='GOLDEN.INTEGRITY_MISMATCH'").get().c, 1)
    const cand = h.ledger.recoveryHistory(id).find((r) => r.kind === 'golden_candidate_built')
    assert.equal(cand.detail.promoted, false); assert.equal(g.rebuild, 1)
    assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='genuine_blocker'").get().c, 1)
    // a writable golden is as untrusted as a mismatching one
    const h2 = H(); try { const id2 = h2.submit(); withIncident(h2, 'overlay_missing'); const g2 = golden(h2, { ro: false }); await drive(h2); assert.equal(h2.ledger.getTask(id2).state, 'blocked'); assert.equal(g2.reprov.length, 0) } finally { h2.close() }
  } finally { h.close() }
})

test('recovery storm prevention: reprovisioning that keeps failing is bounded by PERSISTED attempts with exponential back-off — a controller restart does not reset them — then a technical suspension', async () => {
  const root = tmp()
  let h = createHarness({ root })
  const id = h.submit(); withIncident(h, 'overlay_broken'); const calls = []
  const arm = (x) => { x.adapters.worker.verifyGolden = async () => ({ sha256: G, sealed_sha256: G, read_only: true }); x.adapters.worker.reprovisionOverlay = async (a) => { calls.push(x.clock.now()); return { ok: false, code: 'QEMU.IMG_FAILED' } } }
  arm(h)
  for (let i = 0; i < 6 && calls.length < 1; i += 1) await h.engine.runUntilIdle({ maxTicks: 50 })
  assert.equal(calls.length, 1)
  const at = h.clock.now(); h.close()
  h = createHarness({ root, clock: new FixtureClock(at) }); arm(h) // restart: the attempt count and back-off come from the ledger
  try {
    assert.equal(attemptsOf(h.ledger, id, 'worker_replace').attempts, 1)
    await h.engine.runUntilIdle({ maxTicks: 50 }); assert.equal(calls.length, 1, 'the restarted controller respects the persisted back-off')
    for (let i = 0; i < 200 && !h.ledger.getSuspension(id); i += 1) { const r = await h.engine.runUntilIdle({ maxTicks: 50 }); h.clock.advance(Math.max(1000, (r.next_wakeup ?? h.clock.now()) - h.clock.now() + 1)) }
    assert.equal(calls.length, SUPERVISOR_DEFAULTS.maxAttempts.worker_replace, 'exactly the bounded number of reprovision attempts')
    const gaps = calls.slice(1).map((c, i) => c - calls[i])
    assert.ok(gaps[0] >= SUPERVISOR_DEFAULTS.backoffMs[0] && gaps[1] >= SUPERVISOR_DEFAULTS.backoffMs[1], `exponential back-off: ${gaps}`)
    assert.equal(h.ledger.getSuspension(id).cause, 'RECOVERY_EXHAUSTED:worker_replace')
    assert.ok(kinds(h, id).includes('recovery_circuit_open'))
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})

test('checkpoint corruption / failed restore: the bad checkpoint is quarantined and de-verified (never deleted); recovery falls back to the newest checkpoint that verifies', async () => {
  const h = H()
  try {
    const L = h.ledger; const id = h.submit(); L.transition(id, 'queued'); L.transition(id, 'planning')
    const cp1 = buildCheckpoint(L, id, { reason: 'T1', snapshot: null, workerHead: null, stage: 'planning', quarantined: [], notes: '' }).id; L.markCheckpointVerified(cp1)
    const cp2 = buildCheckpoint(L, id, { reason: 'T2', snapshot: null, workerHead: null, stage: 'planning', quarantined: [], notes: '' }).id; L.markCheckpointVerified(cp2)
    reportIncident(L, id, { kind: 'restore_failed', code: 'SNAPSHOT.DIGEST_MISMATCH', stage: 'planning', detail: { checkpoint_id: cp2 } })
    const r = await superviseIncident(h.engine, id)
    assert.equal(r.action, 'checkpoint_fallback'); assert.equal(L.latestCheckpoint(id).checkpoint_id, cp1)
    assert.equal(L.db.prepare("SELECT COUNT(*) c FROM quarantine WHERE kind='checkpoint' AND ref=?").get(cp2).c, 1)
    // now cp1 is corrupt too: nothing verifies → resume from the committed branch; BOTH checkpoints still exist
    L.db.prepare("UPDATE checkpoints SET payload_json='{\"tampered\":true}' WHERE checkpoint_id=?").run(cp1)
    reportIncident(L, id, { kind: 'checkpoint_corrupt', code: 'CHECKPOINT.PAYLOAD_DIGEST_MISMATCH', stage: 'planning', detail: {} })
    h.clock.advance(SUPERVISOR_DEFAULTS.backoffMs[0] + 1)
    assert.equal((await superviseIncident(h.engine, id)).action, 'resume_from_branch')
    assert.equal(L.db.prepare('SELECT COUNT(*) c FROM checkpoints WHERE task_id=?').get(id).c, 2, 'no checkpoint was deleted'); assert.equal(L.latestCheckpoint(id), null)
  } finally { h.close() }
})

test('unverified termination: re-verified with back-off while the slot stays HELD; a verified stop frees it; an unprovable one ends in ONE isolation package (never a second session)', async () => {
  const h = H()
  try {
    const L = h.ledger; const id = h.submit(); L.transition(id, 'queued'); L.transition(id, 'planning')
    const l = L.acquireLease({ taskId: id, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'high' }).lease
    L.closeLease(l, { terminationVerified: false, endReason: 'X' })
    let cleanOk = false; h.adapters.worker.cleanupGuest = async () => ({ verified: cleanOk }); h.adapters.worker.verifyNoWorkerProcesses = async () => ({ verified: cleanOk })
    h.adapters.worker.liveness = async () => ({ record: { schema: 'patelrep.developer-harness-v3.vm-supervisor', supervisor_pid: 1, qemu_pid: 2, marker: 'm', state: 'running' }, liveness: { supervisor: true, qemu: true, qemuImage: 'qemu-system-x86_64.exe', reused: false } })
    reportIncident(L, id, { kind: 'unverified_termination', stage: 'planning' })
    for (let i = 0; i < SUPERVISOR_DEFAULTS.maxAttempts.unverified_termination; i += 1) { assert.equal((await superviseIncident(h.engine, id)).action, 'termination_still_unverified'); assert.ok(L.leaseOfTask(id), 'slot held'); h.clock.advance(31 * 60_000) }
    assert.equal((await superviseIncident(h.engine, id)).action, 'blocked_isolation_unproven')
    assert.equal(L.getTask(id).lifecycle.blocker_reason, 'ISOLATION_UNPROVEN'); assert.ok(L.leaseOfTask(id), 'still held: no replacement execution')
    // separately: a stop that becomes verifiable frees the slot
    const h2 = H(); try {
      const L2 = h2.ledger; const id2 = h2.submit(); L2.transition(id2, 'queued'); L2.transition(id2, 'planning')
      const l2 = L2.acquireLease({ taskId: id2, role: 'planner', stage: 'planning', model: 'sonnet', effort: 'high' }).lease; L2.closeLease(l2, { terminationVerified: false, endReason: 'X' })
      reportIncident(L2, id2, { kind: 'unverified_termination', stage: 'planning' })
      assert.equal((await superviseIncident(h2.engine, id2)).action, 'termination_verified'); assert.equal(L2.leaseOfTask(id2), null)
    } finally { h2.close() }
  } finally { h.close() }
})

test('disk pressure: only cleanable resources of FINISHED or cancelled tasks are removed; a running task\'s resources and unregistered files are untouched', async () => {
  const h = H()
  try {
    const L = h.ledger; const done = h.submit({ requirements: { text: 'finished' } }); const running = h.submit({ requirements: { text: 'running' } })
    L.db.prepare('UPDATE tasks SET handoff_ready=1 WHERE task_id=?').run(done)
    const root = path.join(h.dirs.root, 'ws'); const d1 = path.join(root, 'd1'); const r1 = path.join(root, 'r1'); const stray = path.join(root, 'owner-file.txt')
    for (const d of [d1, r1]) mkdirSync(d, { recursive: true }); writeFileSync(stray, 'x')
    L.db.prepare('INSERT INTO task_workspaces VALUES (?,?,?,?,?,?)').run(done, root, 'o1', 'c1', 'n1', 1)
    const a = registerOwned(L, done, { kind: 'snapshot', canonicalRef: d1, lifecycle: 'stale' }); const b = registerOwned(L, running, { kind: 'snapshot', canonicalRef: r1, lifecycle: 'stale' })
    const removed = []
    h.adapters.procFacts = async () => ({ alive: false })
    h.adapters.cleanup = { async remove(item) { removed.push(item.id); return { ok: true } }, async verifyGone(item) { return { gone: removed.includes(item.id) } } }
    reportIncident(L, running, { kind: 'disk_pressure', stage: 'implementing' })
    assert.equal((await superviseIncident(h.engine, running)).action, 'disk_pressure_handled')
    assert.deepEqual(removed, [a]); assert.ok(!removed.includes(b)); assert.ok(existsSync(stray))
  } finally { h.close() }
})

test('provider / network unavailable: a bounded waiting_external with back-off — never an owner blocker', async () => {
  const h = H()
  try {
    const L = h.ledger; const id = h.submit(); L.transition(id, 'queued'); L.transition(id, 'planning')
    reportIncident(L, id, { kind: 'provider_unavailable', code: 'PROVIDER.HTTP_529', stage: 'planning' })
    assert.equal((await superviseIncident(h.engine, id)).action, 'waiting_external')
    assert.equal(L.getTask(id).state, 'waiting_external'); assert.ok(L.getWait(id).eligible_at > h.clock.now())
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
})
