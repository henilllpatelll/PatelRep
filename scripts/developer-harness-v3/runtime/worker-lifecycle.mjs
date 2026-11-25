// Developer Harness V3 (D3.3) — worker lifecycle and recovery primitives for D3.4 to consume.
//
// Minimal, controller-owned (Z2) recovery state; NOT the D3.4 task ledger. Rules:
//  * every worker run has an execution identity and a lease carrying a fencing token; recovery always issues a NEW lease with token+1, so a stale
//    worker (or a resurrected controller) can never act with old authority — the D3.2 lifecycle reducer rejects any event with the old token;
//  * nothing reported by the worker is authoritative history: liveness is established from host facts (supervisor/QEMU pids, image names, marker);
//  * cleanup may only touch resources the controller registered for the same task, that are idle/stale/exited, and never a migration — decided by
//    the D3.2 evaluator's `cleanup_task_owned_resources` + `resource_ownership` check, not by name patterns. Unowned processes are never terminated.
import { randomUUID } from 'node:crypto'

export const LEASE_TTL_MS = 10 * 60000

export function issueLease({ workerId, taskId, previous = null, now, ttlMs = LEASE_TTL_MS }) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(workerId ?? '') || !/^[A-Za-z0-9._:-]{1,128}$/.test(taskId ?? '')) throw new Error('LEASE.BAD_ID')
  const token = previous ? previous.fencing_token + 1 : 1
  return Object.freeze({ schema: 'patelrep.developer-harness-v3.worker-lease', worker_id: workerId, task_id: taskId, execution_identity: randomUUID(), fencing_token: token,
    issued_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString(), supersedes: previous?.execution_identity ?? null })
}

export const renewLease = (lease, { now, ttlMs = LEASE_TTL_MS }) => Object.freeze({ ...lease, expires_at: new Date(now + ttlMs).toISOString() })

/** An action carrying (execution_identity, fencing_token) is accepted only against the CURRENT, unexpired lease. */
export function checkLease(current, presented, { now }) {
  if (!current) return 'LEASE.NONE'
  if (!presented || presented.execution_identity !== current.execution_identity) return 'LEASE.STALE_IDENTITY'
  if (presented.fencing_token !== current.fencing_token) return 'LEASE.STALE_FENCING_TOKEN'
  if (Date.parse(current.expires_at) <= now) return 'LEASE.EXPIRED'
  return null
}

export const validLease = (x) => !!x && x.schema === 'patelrep.developer-harness-v3.worker-lease' && Number.isInteger(x.fencing_token) && x.fencing_token >= 1 && typeof x.execution_identity === 'string' && Number.isFinite(Date.parse(x.expires_at))
export const validVmRecord = (x) => !!x && x.schema === 'patelrep.developer-harness-v3.vm-supervisor' && Number.isInteger(x.supervisor_pid) && Number.isInteger(x.qemu_pid) && typeof x.marker === 'string'

/**
 * Decide what to do with a worker after a controller (re)start, from HOST facts only.
 * @param {{record:object|null, lease:object|null, liveness:{supervisor:boolean|null, qemu:boolean|null, qemuImage:string|null}, now:number}} o
 * @returns {{action:'none'|'reattach'|'terminate'|'mark_exited'|'investigate', lifecycle_event:object|null, codes:string[]}}
 */
export function recoveryDecision({ record, lease, liveness, now }) {
  if (!record) return { action: 'none', lifecycle_event: null, codes: ['RECOVERY.NO_WORKER'] }
  if (!validVmRecord(record)) return { action: 'investigate', lifecycle_event: null, codes: ['RECOVERY.RECORD_CORRUPT'] }
  // An `exited` record is final: its pids are never trusted again (they may belong to unrelated processes by now).
  if (record.state === 'exited') return { action: 'mark_exited', lifecycle_event: workerTerminated(lease), codes: ['RECOVERY.WORKER_EXITED'] }
  const { supervisor, qemu, qemuImage, reused } = liveness ?? {}
  if (supervisor === null || qemu === null || supervisor === undefined || qemu === undefined) return { action: 'investigate', lifecycle_event: null, codes: ['RECOVERY.LIVENESS_UNKNOWN'] } // fail closed: never "assume dead and start a second VM"
  if (reused || (qemu && qemuImage && !/^qemu-system-x86_64(\.exe)?$/i.test(qemuImage))) return { action: 'investigate', lifecycle_event: null, codes: ['RECOVERY.PID_REUSED'] }
  if (!supervisor && !qemu) return { action: 'mark_exited', lifecycle_event: workerTerminated(lease), codes: ['RECOVERY.WORKER_GONE'] }
  if (supervisor && !qemu) return { action: 'terminate', lifecycle_event: workerTerminated(lease), codes: ['RECOVERY.SUPERVISOR_WITHOUT_VM'] }
  if (!supervisor && qemu) return { action: 'terminate', lifecycle_event: workerTerminated(lease), codes: ['RECOVERY.VM_WITHOUT_SUPERVISOR'] } // cannot happen with KILL_ON_JOB_CLOSE; treat as hostile
  // Both alive. Any session that was running under the old lease is NOT resumed: its authority is fenced off by the new lease, and its processes
  // inside the guest must be killed (`guest_cleanup`) BEFORE new work is admitted — fencing the controller alone leaves the old tools running.
  const expired = !lease || Date.parse(lease.expires_at) <= now
  return { action: 'reattach', guest_cleanup: 'kill_worker_processes_then_verify', lifecycle_event: lease ? { kind: 'worker_recovered', reason_code: 'HOST_RESTARTED', new_fencing_token: lease.fencing_token + 1 } : null, codes: [expired ? 'RECOVERY.LEASE_EXPIRED_REISSUE' : 'RECOVERY.REATTACH_REISSUE'] }
}
const workerTerminated = (lease) => (lease ? { kind: 'transition', to: 'worker_recovery', reason_code: 'WORKER_TERMINATED', new_fencing_token: lease.fencing_token + 1 } : null)

/** Ownership registry entry, written by the controller when IT creates a resource. Names are never used to infer ownership. */
export function registerResource(registry, { id, ownerTaskId, kind, lifecycle = 'running', detail = {} }) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id ?? '')) throw new Error('RESOURCE.BAD_ID')
  if (registry[id]) throw new Error('RESOURCE.DUPLICATE')
  return { ...registry, [id]: { owner_task_id: ownerTaskId, kind, lifecycle, detail, registered_at: new Date().toISOString() } }
}
export const setLifecycle = (registry, id, lifecycle) => (registry[id] ? { ...registry, [id]: { ...registry[id], lifecycle } } : registry)

/**
 * Which registered resources may be cleaned for `taskId`? Delegates every decision to the D3.2 evaluator (cleanup_task_owned_resources) so there
 * is exactly one policy. `evaluateFn` is the evaluator; `policy` the pinned, loaded policy; `taskCtx` the trusted task block.
 */
export function cleanupPlan({ registry, taskId, evaluateFn, policy, taskCtx, now }) {
  const trustedResources = Object.fromEntries(Object.entries(registry).map(([k, r]) => [k, { owner_task_id: r.owner_task_id, kind: r.kind, lifecycle: r.lifecycle }]))
  const allowed = []; const refused = []
  for (const id of Object.keys(registry)) {
    const d = evaluateFn({ policy, request: { action: 'cleanup_task_owned_resources', task_id: taskId, params: { resource_id: id } }, trusted: { identity: 'orchestrator', task: taskCtx, resources: trustedResources }, now })
    if (d.decision === 'allow') allowed.push(id); else refused.push({ id, reason_codes: d.reason_codes })
  }
  return { allowed, refused }
}
