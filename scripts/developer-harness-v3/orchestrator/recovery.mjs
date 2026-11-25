// Developer Harness V3 (D3.4) — restart / recovery. Reuses the D3.3 `recoveryDecision` (host-fact liveness, PID-reuse and unknown-liveness fail-closed)
// and ADDS what D3.3 left declarative: the mandatory guest cleanup (kill the worker's processes, then verify) BEFORE a lease is superseded or any new
// session is admitted. Nothing the old session reported is believed; only host facts and the verified cleanup count. Unrelated processes are never touched
// (the adapters only know task-owned supervisor/guest worker processes — `terminate_unowned_processes` is a prohibited action in the contract).
import { acquireLock, releaseLock } from '../lib/atomic.mjs'
import { isPidAlive } from '../runtime/launcher.mjs'
import { recoveryDecision } from '../runtime/worker-lifecycle.mjs'
import { markDispatchedAsUncertain, requeueClaimedOutbox } from './ledger/intents.mjs'

/**
 * Resolve the reasoning slot if it is held. Fail closed: on any doubt the slot stays held and NO session starts.
 * @returns {Promise<{cleared:boolean, code?:string, decision?:string, new_fencing_token?:number}>}
 */
export async function reconcileSlot(e, { reason = 'HOST_RESTARTED' } = {}) {
  const L = e.ledger; const A = e.adapters
  const holder = L.slotHolder()
  if (!holder) return { cleared: true }
  let facts
  try { facts = await A.worker.liveness() } catch { facts = { record: null, liveness: { supervisor: null, qemu: null } } }
  const lease = { expires_at: new Date(holder.expires_at).toISOString(), fencing_token: holder.fencing_token }
  const d = recoveryDecision({ record: facts.record, lease, liveness: facts.liveness, now: L.now() })
  if (d.action === 'investigate') { L.recordRecovery(holder.task_id, 'recovery_investigate', { codes: d.codes }); return { cleared: false, code: d.codes[0], decision: d.action } }
  // The task is shown as recovering BEFORE the lease is superseded, so a crash between the two is still found in `worker_recovery`.
  const t = L.getTask(holder.task_id)
  if (!t.lifecycle.resume_to && t.state !== 'completed') L.transition(holder.task_id, 'worker_recovery', { reason_code: reason === 'HOST_RESTARTED' ? 'HOST_RESTARTED' : 'WORKER_TERMINATED' })
  let verified = false
  try {
    if (d.action === 'terminate' || d.action === 'mark_exited') verified = (await A.worker.stopWorker?.())?.verified === true
    // 'reattach' (and every other action): the session under the OLD lease must be dead before the new lease exists
    else verified = (await A.worker.cleanupGuest())?.verified === true
    if (d.action === 'reattach' && verified) verified = (await A.worker.verifyNoWorkerProcesses?.())?.verified !== false
  } catch { verified = false }
  const r = L.supersedeLease({ guestCleanupVerified: verified, reason: reason === 'HOST_RESTARTED' ? 'HOST_RESTARTED' : 'WORKER_TERMINATED' })
  if (!r.ok) return { cleared: false, code: r.code, decision: d.action }
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
