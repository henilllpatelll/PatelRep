// Developer Harness V3 (D3.5-A) — WORK slots and per-task workspaces. Reasoning leases stay in ledger.mjs (`acquireLease`, now per slot).
//
// A heavy deterministic workload (a test run) holds a work slot of its own kind, with the same invariants as a reasoning lease, enforced by the database (schema V3):
// one live work lease per slot, one per task and kind, slot range bounded by `slot_config`, identity immutable, a closed lease never reopens, a termination that was not
// verified keeps its slot (and its memory reservation) until recovery verifies the stop. Every task gets ONE worktree, worker overlay, checkpoint namespace and candidate
// namespace, derived from a digest of the task id (never from untrusted text) and unique across tasks — a task can never be handed another task's workspace.
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

const plain = (r) => (r ? { ...r } : null)
const LIVE = "('active','termination_unverified')"

export function liveWork(L, kind = 'heavy_test') { return L.db.prepare(`SELECT * FROM work_leases WHERE kind=? AND state IN ${LIVE} ORDER BY slot_no`).all(kind).map(plain) }
export function workOfTask(L, taskId, kind = 'heavy_test') { return plain(L.db.prepare(`SELECT * FROM work_leases WHERE task_id=? AND kind=? AND state IN ${LIVE}`).get(taskId, kind)) }

/** Atomically take a free work slot (and its reservation) for `taskId`. */
export function acquireWork(L, { taskId, kind = 'heavy_test', unitRef, ttlMs = 35 * 60_000, reservation = null }) {
  return L.tx(() => {
    const t = L.getTask(taskId)
    if (!t) return { ok: false, code: 'TASK.UNKNOWN' }
    if (t.cancelled) return { ok: false, code: 'TASK.CANCELLED' }
    if (typeof unitRef !== 'string' || !unitRef || unitRef.length > 200) return { ok: false, code: 'WORK.UNIT_REF_REQUIRED' }
    const live = liveWork(L, kind); const used = new Set(live.map((w) => w.slot_no)); const cap = L.slotCapacity(kind)
    let slot = null
    for (let s = 1; s <= cap; s += 1) if (!used.has(s)) { slot = s; break }
    if (slot === null) { const h = live.find((w) => w.state === 'termination_unverified') ?? live[0]; return { ok: false, code: h.state === 'termination_unverified' ? 'WORK.SLOT_HELD_TERMINATION_UNVERIFIED' : 'WORK.SLOT_BUSY', holder: h } }
    if (live.some((w) => w.task_id === taskId)) return { ok: false, code: 'WORK.TASK_ALREADY_HOLDS' }
    const now = L.now(); const workId = `w-${randomUUID()}`
    L.db.prepare('INSERT INTO work_leases(work_id,task_id,kind,slot_no,unit_ref,fencing_token,state,issued_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').run(workId, taskId, kind, slot, unitRef, t.fencing_token, 'active', now, now + ttlMs)
    if (reservation) L.reserveFor(taskId, workId, kind, reservation)
    return { ok: true, work: { work_id: workId, task_id: taskId, kind, slot_no: slot, unit_ref: unitRef, fencing_token: t.fencing_token, expires_at: now + ttlMs } }
  })
}

/** @returns {string|null} a WORK.* code when the presented work lease is not the current, unexpired, same-token lease of its task. */
export function checkWork(L, presented) {
  const w = L.db.prepare('SELECT w.*, t.fencing_token task_token FROM work_leases w JOIN tasks t ON t.task_id=w.task_id WHERE w.work_id=?').get(presented?.work_id ?? '')
  if (!w) return 'WORK.NONE'
  if (w.state !== 'active') return 'WORK.NOT_ACTIVE'
  if (presented.task_id !== w.task_id) return 'WORK.WRONG_TASK'
  if (presented.fencing_token !== w.fencing_token || w.fencing_token !== w.task_token) return 'WORK.STALE_FENCING_TOKEN'
  if (w.expires_at <= L.now()) return 'WORK.EXPIRED'
  return null
}

export function materializeWork(L, workId) { L.db.prepare("UPDATE reservations SET state='materialized' WHERE holder_ref=? AND state='held'").run(workId) }

/** Close a work lease. Only a VERIFIED stop frees the slot and the reservation. */
export function closeWork(L, presented, { terminationVerified }) {
  return L.tx(() => {
    const w = L.db.prepare('SELECT * FROM work_leases WHERE work_id=?').get(presented?.work_id ?? '')
    if (!w || w.task_id !== presented.task_id) return { ok: false, code: 'WORK.STALE_IDENTITY' }
    if (w.state !== 'active' && w.state !== 'termination_unverified') return { ok: true, duplicate: true }
    if (terminationVerified === true) { L.db.prepare("UPDATE work_leases SET state='released', closed_at=? WHERE work_id=?").run(L.now(), w.work_id); L.releaseReservation(w.work_id) }
    else L.db.prepare("UPDATE work_leases SET state='termination_unverified' WHERE work_id=?").run(w.work_id)
    return { ok: true, released: terminationVerified === true }
  })
}

/** Recovery of an orphaned work lease: only with a VERIFIED stop of its workload; otherwise nothing changes and the slot stays held. */
export function supersedeWork(L, { workId, stopVerified, reason = 'HOST_RESTARTED' }) {
  return L.tx(() => {
    const w = L.db.prepare(`SELECT * FROM work_leases WHERE work_id=? AND state IN ${LIVE}`).get(workId)
    if (!w) return { ok: true, none: true }
    if (stopVerified !== true) return { ok: false, code: 'RECOVERY.WORK_STOP_UNVERIFIED' }
    L.db.prepare("UPDATE work_leases SET state='superseded', closed_at=? WHERE work_id=?").run(L.now(), workId)
    L.releaseReservation(workId)
    L.recordRecovery(w.task_id, 'work_superseded', { work_id: workId, kind: w.kind, reason })
    return { ok: true, task_id: w.task_id }
  })
}

const SAFE_ROOT = (root) => typeof root === 'string' && path.isAbsolute(root) && !root.split(/[\\/]/).includes('..')
/** Deterministic, collision-checked per-task names: derived from a digest of the task id, so untrusted text never becomes a path. Idempotent. */
export function assignWorkspace(L, taskId, { root }) {
  if (!SAFE_ROOT(root)) return { ok: false, code: 'WORKSPACE.ROOT_INVALID' }
  return L.tx(() => {
    if (!L.getTask(taskId)) return { ok: false, code: 'TASK.UNKNOWN' }
    const existing = workspaceOf(L, taskId)
    if (existing) return { ok: true, workspace: existing, duplicate: true }
    const h = createHash('sha256').update(`dh3-task:${taskId}`).digest('hex').slice(0, 20)
    const ws = { worktree_path: path.join(root, 'worktrees', `t-${h}`), overlay_id: `ovl-${h}`, checkpoint_ns: `cp/t-${h}`, candidate_ns: `cand/t-${h}` }
    try {
      L.db.prepare('INSERT INTO task_workspaces(task_id,worktree_path,overlay_id,checkpoint_ns,candidate_ns,created_at) VALUES (?,?,?,?,?,?)').run(taskId, ws.worktree_path, ws.overlay_id, ws.checkpoint_ns, ws.candidate_ns, L.now())
    } catch (e) { if (/UNIQUE/.test(String(e.message))) return { ok: false, code: 'WORKSPACE.COLLISION' }; throw e }
    return { ok: true, workspace: workspaceOf(L, taskId) }
  })
}
export function workspaceOf(L, taskId) { return plain(L.db.prepare('SELECT * FROM task_workspaces WHERE task_id=?').get(taskId)) }
