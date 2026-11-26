// Developer Harness V3 (D3.6-C/G/H/J) — durable delivery state: the task-owned branch and PR, explicit milestones, the shared-staging reservation and persisted polling.
// Everything here is ledger bookkeeping; nothing here performs or authorizes a remote effect.
import { randomUUID } from 'node:crypto'

// ------------------------------------------------------------------ the task-owned branch and PR
/** Deterministic and collision-free per task (a task id is unique): two tasks can never own one branch, and a task can never get a second branch. */
export const branchFor = (taskId) => `dh3/${String(taskId).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)}`
export function ensureDelivery(L, taskId) {
  return L.tx(() => {
    const d = L.delivery(taskId); if (d) return d
    const t = L.getTask(taskId); const now = L.now()
    L.db.prepare('INSERT INTO deliveries(task_id,branch,pr_number,base_sha,generation,created_at,updated_at) VALUES (?,?,NULL,?,0,?,?)').run(taskId, branchFor(taskId), t.base_sha, now, now)
    return L.delivery(taskId)
  })
}
/** The PR number is set ONCE, from an authenticated observation of the PR the publisher created (never from a response body or a model). */
export function recordPr(L, taskId, number) {
  const d = L.delivery(taskId); if (!d) return { ok: false, code: 'DELIVERY.NO_RECORD' }
  if (d.pr_number === number) return { ok: true, duplicate: true }
  if (d.pr_number !== null) return { ok: false, code: 'DELIVERY.PR_ALREADY_RECORDED' }
  try { L.db.prepare('UPDATE deliveries SET pr_number=?, updated_at=? WHERE task_id=?').run(number, L.now(), taskId) } catch { return { ok: false, code: 'DELIVERY.PR_OWNED_BY_ANOTHER_TASK' } }
  return { ok: true }
}
/** A base update: the next generation of the delivery base (monotonic; recorded in the authority log by the database). */
export function advanceBase(L, taskId, baseSha) {
  const d = ensureDelivery(L, taskId)
  L.db.prepare('UPDATE deliveries SET base_sha=?, generation=generation+1, updated_at=? WHERE task_id=?').run(baseSha, L.now(), taskId)
  return L.delivery(taskId)
}

// ------------------------------------------------------------------ milestones (explicit, candidate-bound, never 'merged' in D3.6)
export const MILESTONES = Object.freeze(['built', 'locally_verified', 'published', 'ci_verified', 'staging_verified', 'merge_eligible'])
export function reach(L, taskId, milestone, { evidenceRef = null } = {}) {
  if (!MILESTONES.includes(milestone)) return { ok: false, code: 'MILESTONE.UNKNOWN_OR_NOT_D36' }
  const c = L.currentCandidate(taskId); const t = L.getTask(taskId)
  if (!c || c.candidate_sha !== t.head_sha) return { ok: false, code: 'MILESTONE.NO_CURRENT_CANDIDATE' }
  L.db.prepare('INSERT OR IGNORE INTO delivery_milestones(task_id,milestone,candidate_sha,tree_digest,base_sha,evidence_ref,reached_at) VALUES (?,?,?,?,?,?,?)').run(taskId, milestone, c.candidate_sha, c.tree_digest, L.currentBase(taskId), evidenceRef, L.now())
  return { ok: true }
}
/** Milestones of a candidate that is no longer current (a head change, a base update) are invalidated — kept as history, never reused. @returns {number} rows invalidated */
export function invalidateStaleMilestones(L, taskId) {
  const t = L.getTask(taskId)
  return L.db.prepare('UPDATE delivery_milestones SET invalidated_at=? WHERE task_id=? AND invalidated_at IS NULL AND (candidate_sha IS NOT ? OR base_sha IS NOT ?)').run(L.now(), taskId, t.head_sha, L.currentBase(taskId)).changes
}
export function invalidateMilestones(L, taskId, milestones) {
  for (const m of milestones) L.db.prepare('UPDATE delivery_milestones SET invalidated_at=? WHERE task_id=? AND milestone=? AND invalidated_at IS NULL').run(L.now(), taskId, m)
}
export const currentMilestones = (L, taskId) => { const t = L.getTask(taskId); return L.db.prepare('SELECT milestone FROM delivery_milestones WHERE task_id=? AND candidate_sha IS ? AND invalidated_at IS NULL').all(taskId, t.head_sha).map((r) => r.milestone) }

// ------------------------------------------------------------------ the ONE shared staging environment
export const stagingOwner = (L) => { const r = L.db.prepare("SELECT * FROM staging_reservations WHERE kind='shared_staging' AND state IN ('held','unresolved')").get(); return r ? { ...r } : null }
/** Acquire (or keep, re-binding to the task's CURRENT candidate) the shared-staging reservation. Another owner — held OR unresolved — means busy: never shared, never stolen. */
export function acquireStaging(L, taskId) {
  return L.tx(() => {
    const t = L.getTask(taskId); const o = stagingOwner(L)
    if (o && o.task_id !== taskId) return { ok: false, code: 'STAGING.BUSY', holder: o.task_id, state: o.state }
    if (o && o.state === 'unresolved') return { ok: false, code: 'STAGING.OWN_RESERVATION_UNRESOLVED' } // our own earlier staging operation is unresolved: hold, never re-acquire around it
    if (o) { if (o.candidate_sha !== t.head_sha) L.db.prepare('UPDATE staging_reservations SET candidate_sha=? WHERE reservation_id=?').run(t.head_sha, o.reservation_id); return { ok: true, reservation_id: o.reservation_id, duplicate: true } }
    const id = `stg-${randomUUID()}`
    try { L.db.prepare("INSERT INTO staging_reservations(reservation_id,kind,task_id,candidate_sha,state,acquired_at) VALUES (?,'shared_staging',?,?,'held',?)").run(id, taskId, t.head_sha, L.now()) } catch { return { ok: false, code: 'STAGING.BUSY' } }
    return { ok: true, reservation_id: id }
  })
}
/**
 * Release ONLY with proof: `basis` must come from an authenticated observation that no staging run of this task's PR is pending or running, and the caller must have found no
 * unresolved staging intent. An unresolved reservation (a timed-out staging operation) is never released here.
 */
export function releaseStaging(L, taskId, { observedIdle, basis }) {
  return L.tx(() => {
    const o = stagingOwner(L); if (!o || o.task_id !== taskId) return { ok: true, duplicate: true }
    if (o.state !== 'held') return { ok: false, code: 'STAGING.UNRESOLVED_NOT_RELEASABLE' }
    if (observedIdle !== true) return { ok: false, code: 'STAGING.NOT_PROVEN_IDLE' }
    if (L.db.prepare("SELECT 1 FROM action_intents WHERE task_id=? AND action='dispatch_staging_candidate' AND status IN ('intended','dispatched','uncertain')").get(taskId)) return { ok: false, code: 'STAGING.INTENT_UNRESOLVED' }
    L.db.prepare("UPDATE staging_reservations SET state='released', released_at=?, release_basis=? WHERE reservation_id=?").run(L.now(), String(basis).slice(0, 200), o.reservation_id)
    return { ok: true }
  })
}
/** The watchdog's only move on a staging operation that did not settle: HOLD the reservation as unresolved (released only by a later authenticated proof via resolveStaging). */
export function markStagingUnresolved(L, taskId) { return L.db.prepare("UPDATE staging_reservations SET state='unresolved' WHERE kind='shared_staging' AND task_id=? AND state='held'").run(taskId).changes === 1 }
export function resolveStaging(L, taskId, { observedIdle }) {
  if (observedIdle !== true) return { ok: false, code: 'STAGING.NOT_PROVEN_IDLE' }
  return { ok: L.db.prepare("UPDATE staging_reservations SET state='held' WHERE kind='shared_staging' AND task_id=? AND state='unresolved'").run(taskId).changes === 1 }
}

// ------------------------------------------------------------------ persisted polling (deterministic; no model, no busy loop)
export function pollDue(L, taskId, subject) { const r = L.db.prepare('SELECT next_at FROM delivery_polls WHERE task_id=? AND subject=?').get(taskId, subject); return !r || r.next_at <= L.now() }
/** Exponential back-off per (task, subject), capped; `at` (e.g. a rate-limit reset) overrides when later. Persisted: survives restarts. */
export function schedulePoll(L, taskId, subject, { baseMs, maxMs, code = null, at = null, reset = false, rng = Math.random }) {
  const prev = L.db.prepare('SELECT attempts FROM delivery_polls WHERE task_id=? AND subject=?').get(taskId, subject)
  const attempts = reset ? 0 : (prev?.attempts ?? 0) + 1
  const delay = Math.min(maxMs, baseMs * 2 ** Math.min(attempts, 16)); const next = Math.max(L.now() + Math.round(delay * (1 + 0.2 * rng())), at ?? 0)
  L.db.prepare('INSERT INTO delivery_polls(task_id,subject,next_at,attempts,last_code) VALUES (?,?,?,?,?) ON CONFLICT(task_id,subject) DO UPDATE SET next_at=excluded.next_at, attempts=excluded.attempts, last_code=excluded.last_code').run(taskId, subject, next, attempts, code)
  return next
}
export const clearPoll = (L, taskId, subject) => L.db.prepare('DELETE FROM delivery_polls WHERE task_id=? AND subject=?').run(taskId, subject)
export const nextPoll = (L) => L.db.prepare('SELECT MIN(p.next_at) m FROM delivery_polls p JOIN tasks t ON t.task_id=p.task_id WHERE t.cancelled=0').get().m ?? null
