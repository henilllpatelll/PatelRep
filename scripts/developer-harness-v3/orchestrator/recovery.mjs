// Developer Harness V3 (D3.4) — restart / recovery. Reuses the D3.3 `recoveryDecision` (host-fact liveness, PID-reuse and unknown-liveness fail-closed)
// and ADDS what D3.3 left declarative: the mandatory guest cleanup (kill the worker's processes, then verify) BEFORE a lease is superseded or any new
// session is admitted. Nothing the old session reported is believed; only host facts and the verified cleanup count. Unrelated processes are never touched
// (the adapters only know task-owned supervisor/guest worker processes — `terminate_unowned_processes` is a prohibited action in the contract).
import { acquireLock, releaseLock } from '../lib/atomic.mjs'
import { captureWork, persistCheckpoint } from './preserve.mjs'
import { isPidAlive } from '../runtime/launcher.mjs'
import { recoveryDecision } from '../runtime/worker-lifecycle.mjs'
import { markDispatchedAsUncertain, requeueClaimedOutbox } from './ledger/intents.mjs'

/**
 * Resolve the reasoning slot if it is held. Fail closed: on any doubt the slot stays held and NO session starts. EVIDENCE MUST BE EXPLICIT: a liveness probe that throws or reports unknown,
 * a cleanup/stop/process-verification result that is missing or is not exactly `verified: true` — none of these is ever treated as "cleaned up".
 * The dead session's uncommitted work is captured BEFORE the lease is superseded and its checkpoint commits IN THE SAME TRANSACTION as the supersession, so there is no instant at which the
 * slot is free but the work is not durable.
 * @returns {Promise<{cleared:boolean, code?:string, decision?:string, new_fencing_token?:number}>}
 */
export async function reconcileSlot(e, { reason = 'HOST_RESTARTED' } = {}) {
  const L = e.ledger; const A = e.adapters
  const holder = L.slotHolder()
  if (!holder) return { cleared: true }
  let facts = null
  try { facts = await A.worker.liveness() } catch { facts = null }
  if (!facts || typeof facts !== 'object' || typeof facts.liveness !== 'object' || facts.liveness === null) {
    L.recordRecovery(holder.task_id, 'recovery_investigate', { codes: ['RECOVERY.LIVENESS_UNAVAILABLE'] }); return { cleared: false, code: 'RECOVERY.LIVENESS_UNAVAILABLE', decision: 'investigate' }
  }
  const lease = { expires_at: new Date(holder.expires_at).toISOString(), fencing_token: holder.fencing_token }
  const d = recoveryDecision({ record: facts.record, lease, liveness: facts.liveness, now: L.now() })
  if (d.action === 'investigate') { L.recordRecovery(holder.task_id, 'recovery_investigate', { codes: d.codes }); return { cleared: false, code: d.codes[0], decision: d.action } }
  // The task is shown as recovering BEFORE the lease is superseded, so a crash between the two is still found in `worker_recovery`.
  const t = L.getTask(holder.task_id)
  if (!t.lifecycle.resume_to && t.state !== 'completed') L.transition(holder.task_id, 'worker_recovery', { reason_code: reason === 'HOST_RESTARTED' ? 'HOST_RESTARTED' : 'WORKER_TERMINATED' })
  let verified = false
  try {
    if (d.action === 'terminate' || d.action === 'mark_exited') verified = (await A.worker.stopWorker?.())?.verified === true
    // 'reattach' / 'none': the session under the OLD lease must be dead before the new lease exists — kill, then independently verify that no worker process remains
    else verified = (await A.worker.cleanupGuest?.())?.verified === true && (await A.worker.verifyNoWorkerProcesses?.())?.verified === true
  } catch { verified = false }
  const lc = reason === 'HOST_RESTARTED' ? 'HOST_RESTARTED' : 'WORKER_TERMINATED'
  const stage = L.getExecution(holder.execution_id)?.stage ?? null
  const cap = verified ? await captureWork(e, holder.task_id, null) : null // only a verified-dead session leaves a quiescent tree to read
  e.hook('before_lease_supersede', { taskId: holder.task_id })
  const r = L.supersedeLease({ guestCleanupVerified: verified, reason: lc, alsoOnSuperseded: () => {
    if (!cap) return null
    try { return persistCheckpoint(e, holder.task_id, cap, { reason: 'CRASH_RECOVERY', stage, carry: true }) } catch (err) { L.recordRecovery(holder.task_id, 'uncommitted_work_not_preserved', { error: String(err?.message).slice(0, 80) }); return null }
  } })
  if (!r.ok) return { cleared: false, code: r.code, decision: d.action }
  e.hook('after_lease_superseded', { taskId: holder.task_id })
  L.recordRecovery(holder.task_id, 'worker_recovered', { decision: d.action, codes: d.codes, new_fencing_token: r.new_fencing_token })
  return { cleared: true, decision: d.action, new_fencing_token: r.new_fencing_token }
}

/** Controller start-up: single controller (OS-level lock), uncertain effects, unacknowledged outbox, orphaned reasoning slot. */
export async function recoverOnStart(e, { lockFile, isHolderAlive = (rec) => isPidAlive(rec.pid) }) {
  const L = e.ledger
  const lock = acquireLock(lockFile, { execution_id: 'controller', acquired_at: new Date(L.now()).toISOString() }, { isHolderAlive })
  if (!lock.ok) return { ok: false, code: lock.code }
  const uncertain = markDispatchedAsUncertain(L)
  const requeued = requeueClaimedOutbox(L)
  const prevTick = Number(L.meta('last_tick_at') ?? 0); const now = L.now()
  const clockJump = prevTick && (now < prevTick || now - prevTick > (e.cfg.maxClockGapMs ?? 6 * 3600_000))
  if (clockJump) L.recordRecovery(null, 'clock_jump', { previous: prevTick, now })
  L.setMeta('last_tick_at', now)
  const slot = await reconcileSlot(e, { reason: 'HOST_RESTARTED' }) // regardless of lease expiry: the previous controller is gone
  return { ok: true, uncertain_intents: uncertain, outbox_requeued: requeued, clock_jump: !!clockJump, slot, release: () => releaseLock(lockFile, { execution_id: 'controller' }) }
}
