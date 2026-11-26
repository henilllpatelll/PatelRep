// Developer Harness V3 (D3.5-C) — the bounded, deterministic recovery SUPERVISOR. Builds only on the D3.3/D3.4 primitives (recoveryDecision via reconcileSlot, captureWork +
// persistCheckpoint, verifyCheckpoint, the cleanup authority, suspendTechnically, applyWait). Every decision is task-scoped, idempotent and recorded.
//
// Rules: (1) no replacement execution before the previous one is PROVEN terminated (or the whole worker is verifiably stopped); (2) failed resources are QUARANTINED (an
// append-only record; nothing is deleted on the strength of a failure); (3) reprovision only from a golden image whose integrity is verified against its SEALED record and
// that is read-only — a mismatching golden is NEVER re-blessed: rebuilding a candidate from the pinned inputs is allowed, PROMOTING it is the owner's root-of-trust ceremony;
// (4) recoverable work is preserved BEFORE a disposable worker is replaced — if preservation cannot be verified the worker is quarantined INTACT and the task is suspended with
// diagnostics, never discarded; (5) no storms: attempts, exponential back-off and a circuit breaker per (task, incident) are PERSISTED, so restarts do not reset them;
// (6) unknown evidence is never success.
import { randomUUID } from 'node:crypto'
import { captureWork, persistCheckpoint } from './preserve.mjs'
import { snapshotDirResolver, verifyCheckpoint } from './context-renewal.mjs'
import { executeCleanup, planTaskCleanup } from './cleanup.mjs'
import { reconcileSlot } from './recovery.mjs'
import { suspendTechnically } from './suspension.mjs'

export const SUPERVISOR_DEFAULTS = Object.freeze({
  maxAttempts: Object.freeze({ worker_replace: 3, unverified_termination: 5, checkpoint_restore: 4, provider_wait: 12, disk_pressure: 4 }),
  backoffMs: Object.freeze([30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000]), circuitOpenMs: 2 * 3600_000,
})
export const INCIDENTS = Object.freeze(['sanitizer_failed', 'worker_contaminated', 'overlay_missing', 'overlay_broken', 'golden_mismatch', 'checkpoint_corrupt', 'restore_failed', 'unverified_termination', 'provider_unavailable', 'network_unavailable', 'disk_pressure'])
const BUCKET = { sanitizer_failed: 'worker_replace', worker_contaminated: 'worker_replace', overlay_missing: 'worker_replace', overlay_broken: 'worker_replace', checkpoint_corrupt: 'checkpoint_restore', restore_failed: 'checkpoint_restore',
  unverified_termination: 'unverified_termination', provider_unavailable: 'provider_wait', network_unavailable: 'provider_wait', disk_pressure: 'disk_pressure', golden_mismatch: 'golden' }

const cfgOf = (e) => ({ ...SUPERVISOR_DEFAULTS, ...(e.cfg.supervisor ?? {}), maxAttempts: { ...SUPERVISOR_DEFAULTS.maxAttempts, ...(e.cfg.supervisor?.maxAttempts ?? {}) } })

/** Persisted bounded attempt. @returns {{allowed:boolean, attempts:number, next_at:number, circuit:'closed'|'open', exhausted?:boolean}} */
export function attempt(L, scope, bucket, cfg = SUPERVISOR_DEFAULTS, code = null) {
  return L.tx(() => {
    const now = L.now(); const max = cfg.maxAttempts[bucket] ?? 3
    const row = L.db.prepare('SELECT * FROM recovery_attempts WHERE scope=? AND incident=?').get(scope, bucket)
    if (row && now < row.next_at) return { allowed: false, attempts: row.attempts, next_at: row.next_at, circuit: row.circuit, backing_off: true }
    const attempts = (row?.attempts ?? 0) + 1
    if (attempts > max) {
      const next = now + cfg.circuitOpenMs
      L.db.prepare("INSERT INTO recovery_attempts(scope,incident,attempts,first_at,last_at,next_at,circuit,last_code) VALUES (?,?,?,?,?,?,'open',?) ON CONFLICT(scope,incident) DO UPDATE SET attempts=excluded.attempts, last_at=excluded.last_at, next_at=excluded.next_at, circuit='open', last_code=excluded.last_code").run(scope, bucket, attempts, row?.first_at ?? now, now, next, code)
      return { allowed: false, attempts, next_at: next, circuit: 'open', exhausted: true }
    }
    const next = now + cfg.backoffMs[Math.min(attempts - 1, cfg.backoffMs.length - 1)]
    L.db.prepare("INSERT INTO recovery_attempts(scope,incident,attempts,first_at,last_at,next_at,circuit,last_code) VALUES (?,?,?,?,?,?,'closed',?) ON CONFLICT(scope,incident) DO UPDATE SET attempts=excluded.attempts, last_at=excluded.last_at, next_at=excluded.next_at, circuit='closed', last_code=excluded.last_code").run(scope, bucket, attempts, row?.first_at ?? now, now, next, code)
    return { allowed: true, attempts, next_at: next, circuit: 'closed' }
  })
}
export const succeeded = (L, scope, bucket) => L.db.prepare('DELETE FROM recovery_attempts WHERE scope=? AND incident=?').run(scope, bucket)
export const attemptsOf = (L, scope, bucket) => { const r = L.db.prepare('SELECT * FROM recovery_attempts WHERE scope=? AND incident=?').get(scope, bucket); return r ? { ...r } : null }

export function quarantine(L, { taskId = null, kind, ref, reason, evidence = {} }) {
  const id = `q-${randomUUID()}`
  L.db.prepare('INSERT INTO quarantine(quarantine_id,task_id,kind,ref,reason,evidence_json,at) VALUES (?,?,?,?,?,?,?)').run(id, taskId, kind, String(ref).slice(0, 300), reason, JSON.stringify(evidence).slice(0, 4000), L.now())
  L.recordRecovery(taskId, 'quarantined', { quarantine_id: id, kind, ref: String(ref).slice(0, 120), reason })
  return id
}

/** Report an incident (from a stage or an adapter). Idempotent per task: the supervisor handles it on the task's next scheduling step. */
export function reportIncident(L, taskId, { kind, code = null, stage = null, detail = {} }) {
  if (!INCIDENTS.includes(kind)) throw new Error('INCIDENT.UNKNOWN')
  L.setMeta(`incident:${taskId}`, JSON.stringify({ kind, code, stage, detail, at: L.now() })); L.recordRecovery(taskId, 'incident_reported', { kind, code, stage })
}
export const pendingIncident = (L, taskId) => JSON.parse(L.meta(`incident:${taskId}`) ?? 'null')
const clearIncident = (L, taskId) => L.db.prepare('DELETE FROM meta WHERE key=?').run(`incident:${taskId}`)

/** Golden-image trust: the image must be read-only and its digest must equal the SEALED record. A mismatch is quarantined and never re-blessed. */
async function goldenVerified(e, taskId) {
  let g = null; try { g = await e.adapters.worker.verifyGolden?.() } catch { g = null }
  if (g && g.read_only === true && typeof g.sha256 === 'string' && g.sha256 === g.sealed_sha256) return { ok: true, sha256: g.sha256 }
  quarantine(e.ledger, { taskId, kind: 'golden_image', ref: g?.sha256 ?? 'unknown', reason: g ? 'GOLDEN.INTEGRITY_MISMATCH' : 'GOLDEN.UNVERIFIABLE', evidence: { sealed: g?.sealed_sha256 ?? null, read_only: g?.read_only ?? null } })
  return { ok: false, code: g ? 'GOLDEN.INTEGRITY_MISMATCH' : 'GOLDEN.UNVERIFIABLE' }
}
/** A mismatching golden: optionally REBUILD a candidate from the pinned inputs (allowed) — promoting it to the trusted golden is the owner's root-of-trust ceremony (protected). */
async function goldenBlocked(e, taskId, code) {
  const L = e.ledger
  try {
    const c = await e.adapters.worker.rebuildGoldenCandidate?.()
    if (c) L.recordRecovery(taskId, 'golden_candidate_built', { ok: c.ok === true, candidate_sha256: c.candidate_sha256 ?? null, inputs_verified: c.inputs_verified === true, promoted: false, promotion: 'OWNER_ROOT_OF_TRUST_CEREMONY (never automatic)' })
  } catch { /* the candidate is optional; the block below stands */ }
  e.applyWait(taskId, { kind: 'blocked', reason: 'OWNER_ROOT_OF_TRUST_CEREMONY', codes: [code, 'GOLDEN.PROMOTION_REQUIRES_OWNER'] })
  clearIncident(L, taskId)
  return { progressed: true, action: 'blocked_golden_trust' }
}

/** Handle the task's pending incident. Called by the engine BEFORE any other step of that task. */
export async function superviseIncident(e, taskId) {
  const L = e.ledger; const inc = pendingIncident(L, taskId); if (!inc) return { progressed: false }
  const cfg = cfgOf(e); const bucket = BUCKET[inc.kind]; const t = L.getTask(taskId)
  if (t.cancelled) { clearIncident(L, taskId); return { progressed: true, action: 'incident_dropped_cancelled' } }
  if (inc.kind === 'golden_mismatch') { quarantine(L, { taskId, kind: 'golden_image', ref: inc.detail?.sha256 ?? 'reported', reason: 'GOLDEN.INTEGRITY_MISMATCH' }); return goldenBlocked(e, taskId, 'GOLDEN.INTEGRITY_MISMATCH') }
  const a = attempt(L, taskId, bucket, cfg, inc.code)
  if (a.backing_off) return { progressed: false } // the persisted back-off has not elapsed: nothing happens, nextWakeup includes it
  if (!a.allowed) return exhausted(e, taskId, inc, a)
  switch (inc.kind) {
    case 'sanitizer_failed': case 'worker_contaminated': case 'overlay_missing': case 'overlay_broken': return replaceWorker(e, taskId, inc, cfg)
    case 'checkpoint_corrupt': case 'restore_failed': return fallBackCheckpoint(e, taskId, inc)
    case 'unverified_termination': {
      const r = await reconcileSlot(e, { reason: 'WORKER_TERMINATED', taskId })
      if (r.cleared) { succeeded(L, taskId, bucket); clearIncident(L, taskId); return { progressed: true, action: 'termination_verified' } }
      return { progressed: true, action: 'termination_still_unverified' } // the slot stays held; the next attempt waits for its back-off
    }
    case 'provider_unavailable': case 'network_unavailable':
      e.applyWait(taskId, { kind: 'wait', state: 'waiting_external', reason: 'NETWORK_UNAVAILABLE', eligible_at: a.next_at, codes: [inc.code ?? `PROVIDER.${inc.kind.toUpperCase()}`] })
      clearIncident(L, taskId); return { progressed: true, action: 'waiting_external' }
    case 'disk_pressure': {
      const freed = await diskPressureCleanup(e)
      L.recordRecovery(taskId, 'disk_pressure_cleanup', { freed })
      clearIncident(L, taskId)
      if (!freed.length) e.applyWait(taskId, { kind: 'wait', state: 'waiting_resources', reason: 'DISK_PRESSURE', eligible_at: a.next_at, codes: ['RESOURCE.DISK_LOW'] })
      return { progressed: true, action: 'disk_pressure_handled' }
    }
    default: return { progressed: false }
  }
}

function exhausted(e, taskId, inc, a) {
  const L = e.ledger
  L.recordRecovery(taskId, 'recovery_circuit_open', { incident: inc.kind, attempts: a.attempts, reopen_at: a.next_at })
  clearIncident(L, taskId)
  if (inc.kind === 'unverified_termination') {
    // the worker can be proven neither alive-and-reattachable nor stopped: that is an isolation fact only the owner can resolve (one package); the slot stays held meanwhile
    e.applyWait(taskId, { kind: 'blocked', reason: 'ISOLATION_UNPROVEN', codes: ['ISOLATION.WORKER_TERMINATION_UNPROVABLE'] })
    return { progressed: true, action: 'blocked_isolation_unproven' }
  }
  suspendTechnically(e, taskId, { cause: `RECOVERY_EXHAUSTED:${BUCKET[inc.kind]}`, stage: inc.stage, codes: [inc.code ?? inc.kind] })
  return { progressed: true, action: 'technically_suspended' }
}

/** Preserve → quarantine → verify golden → reprovision. Work that cannot be preserved is NEVER discarded. */
async function replaceWorker(e, taskId, inc, cfg) {
  const L = e.ledger; const A = e.adapters; const lease = L.leaseOfTask(taskId)
  if (lease) { const r = await reconcileSlot(e, { reason: 'WORKER_TERMINATED', taskId }); if (!r.cleared) return { progressed: true, action: 'replacement_waits_for_verified_termination' } } // rule (1)
  const cap = await captureWork(e, taskId, null)
  const kept = persistCheckpoint(e, taskId, cap, { reason: `WORKER_REPLACEMENT:${inc.kind}`, stage: inc.stage, force: true })
  if (!kept.ok) {
    quarantine(L, { taskId, kind: 'worker', ref: inc.detail?.overlay ?? 'task-overlay', reason: 'WORK_PRESERVATION_UNVERIFIED', evidence: { problems: kept.problems ?? [], incident: inc.kind } })
    clearIncident(L, taskId)
    suspendTechnically(e, taskId, { cause: 'WORK_PRESERVATION_UNVERIFIED', stage: inc.stage, codes: [...(kept.problems ?? []).slice(0, 3), inc.kind],
      howToResume: 'The disposable worker could not be replaced safely: its uncommitted work could not be preserved as a VERIFIED checkpoint, so the worker was quarantined INTACT (not destroyed). Extract or discard the work deliberately, then resume the task.' })
    return { progressed: true, action: 'quarantined_intact' }
  }
  quarantine(L, { taskId, kind: 'worker_overlay', ref: inc.detail?.overlay ?? 'task-overlay', reason: inc.code ?? inc.kind, evidence: { preserved_checkpoint: kept.id ?? null } })
  const g = await goldenVerified(e, taskId)
  if (!g.ok) return goldenBlocked(e, taskId, g.code)
  let r = null; try { r = await A.worker.reprovisionOverlay?.({ taskId, golden_sha256: g.sha256 }) } catch { r = null }
  if (r?.ok !== true) { L.recordRecovery(taskId, 'worker_reprovision_failed', { code: r?.code ?? 'UNKNOWN' }); return { progressed: true, action: 'reprovision_failed_backoff' } } // the incident stays pending: next attempt after back-off
  succeeded(L, taskId, 'worker_replace'); clearIncident(L, taskId)
  L.recordRecovery(taskId, 'worker_replaced', { from_golden: g.sha256, preserved_checkpoint: kept.id ?? null, incident: inc.kind })
  return { progressed: true, action: 'worker_replaced' }
}

/** A corrupt or unrestorable checkpoint is quarantined and DE-VERIFIED (never deleted); recovery falls back to the newest checkpoint that still verifies. */
function fallBackCheckpoint(e, taskId, inc) {
  const L = e.ledger; const resolve = snapshotDirResolver(e.snapshotRoot)
  const cps = L.db.prepare('SELECT checkpoint_id FROM checkpoints WHERE task_id=? AND verified=1 ORDER BY seq DESC').all(taskId).map((r) => r.checkpoint_id)
  const bad = inc.detail?.checkpoint_id ?? null
  for (const id of cps) {
    const v = id === bad ? { ok: false, problems: [inc.code ?? 'CHECKPOINT.RESTORE_FAILED'] } : verifyCheckpoint(L, id, { snapshotDir: resolve })
    const tolerable = v.ok || v.problems.every((p) => ['CHECKPOINT.STALE_FENCING_TOKEN', 'CHECKPOINT.WRONG_STAGE'].includes(p))
    if (tolerable) { succeeded(L, taskId, 'checkpoint_restore'); clearIncident(L, taskId); L.recordRecovery(taskId, 'checkpoint_fallback', { using: id, quarantined: cps.slice(0, cps.indexOf(id)) }); return { progressed: true, action: 'checkpoint_fallback' } }
    L.db.prepare('UPDATE checkpoints SET verified=0 WHERE checkpoint_id=?').run(id)
    quarantine(L, { taskId, kind: 'checkpoint', ref: id, reason: v.problems[0] ?? 'CHECKPOINT.CORRUPT', evidence: { problems: v.problems.slice(0, 5) } })
  }
  clearIncident(L, taskId)
  // no checkpoint verifies: the committed work on the task branch is still the recovery source; record it, do not invent one
  L.recordRecovery(taskId, 'checkpoint_none_recoverable', { resume_from: 'committed task branch' })
  return { progressed: true, action: 'resume_from_branch' }
}

/** Disk pressure: clean ONLY task-owned, cleanable resources of tasks that are finished (handoff-ready) or cancelled, through the cleanup authority. */
export async function diskPressureCleanup(e) {
  const L = e.ledger; const A = e.adapters; const freed = []
  if (!A.cleanup || !A.procFacts) return freed
  for (const row of L.db.prepare('SELECT task_id FROM tasks WHERE handoff_ready=1 OR cancelled=1 ORDER BY task_id').all()) {
    const p = await planTaskCleanup(e, row.task_id, { procFacts: A.procFacts, kinds: ['snapshot', 'log', 'temp_dir', 'worker_overlay'] })
    if (!p.ok || !p.plan.allowed.length) continue
    const r = await executeCleanup(e, p, { executor: A.cleanup, dryRun: false })
    freed.push(...(r.results ?? []).filter((x) => x.status === 'verified').map((x) => x.id))
  }
  return freed
}
