// Developer Harness V3 (D3.4 remediation F5) — technical suspension: what happens when an AUTOMATED retry budget is exhausted.
//
// Principle: the owner is interrupted only for a GENUINE owner-only condition (authentication, billing safety, tampered requirements, isolation, a prohibited action, an
// unresolvable requirement conflict). A test that keeps failing, a coding defect that recurs, an issuer outage, an expired approval or a review that keeps finding things is an
// ENGINEERING condition: it is handled with bounded retries, strategy escalation and a durable, scheduled cool-down — and a notification carrying diagnostics, never a permission question.
//
// Mechanics (the D3.2 lifecycle reducer is untouched — it has no "technical suspension" state, see proposal P3 in docs/developer-harness-v3/21):
//   * the task KEEPS its lifecycle state (a stage it is in, or `remediation`); a ledger `suspensions` row says "do not schedule until retry_at" (cooling_down) or "never again by itself" (terminal);
//   * every suspension starts a new EPOCH: retry budgets reset, the strategy escalates (epoch 1: stronger model; epoch 2+: a materially different approach is requested);
//   * after `maxEpochs` cool-downs, or when the lifetime session budget is spent, the disposition is TERMINAL: nothing runs by itself, ever (no unlimited subscription consumption), and exactly
//     one notification says so. `resumeSuspended` starts a fresh budget (an operator convenience, not a permission);
//   * every suspension is one deduplicated outbox notification with actionable diagnostics.
import { createHash } from 'node:crypto'
import { enqueueOutbox } from './ledger/intents.mjs'
import { scanContent } from './snapshot.mjs'
import { GOVERNOR_DEFAULTS } from '../runtime/subscription-governor.mjs'

// Every cool-down is SHORTER than the extra-usage fact lifetime (GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms = 6 h): a resume after a cool-down must not need the owner to re-verify billing safety, because the
// fact is refreshed only by a session's own provider stream (doc 07). A test pins this invariant.
export const TECH_DEFAULTS = Object.freeze({ maxRemediationCyclesPerEpoch: 6, maxStageFailuresPerEpoch: 8, maxReviewRoundsPerEpoch: 4, cooldownsMs: Object.freeze([30 * 60_000, 2 * 3600_000, 5 * 3600_000]), maxEpochs: 3, maxSessionsPerTask: 150 })

/** Failure text originates in adapters/workers (UNTRUSTED). Only short code-shaped strings that carry no credential pattern are stored or notified; anything else becomes a stable hash. */
export const safeCode = (c) => {
  const s = String(c ?? ''); const h = createHash('sha256').update(s).digest('hex').slice(0, 12)
  if (/^[A-Za-z0-9_.:|+#=/\-]{1,120}$/.test(s) && !scanContent(Buffer.from(s)).length) return s
  const prefix = s.split(':')[0] // the code-shaped HEAD survives (so classification does not change); only the free-text tail is replaced
  return /^[A-Z][A-Z0-9_.]{1,60}$/.test(prefix) && !scanContent(Buffer.from(prefix)).length ? `${prefix}:REDACTED:${h}` : `REDACTED:${h}`
}

const OWNER_ONLY = [/^SESSION\.PERMISSION_MODE_MISMATCH/, /^TASK\.REQUIREMENTS_TAMPERED$/, /^AUTH\./, /^SUBSCRIPTION\.STATE(_UNKNOWN$|:)/, /^ISOLATION/, /^PROHIBITED_ACTION/, /^OWNER_/, /^UNRESOLVABLE_REQUIREMENT_CONFLICT/]
/** 'owner' only for the genuine owner-only conditions; EVERYTHING else — including unknown codes — is 'technical' (the safe default is not to interrupt the owner). */
export const classifyBlocker = (code) => (OWNER_ONLY.some((re) => re.test(String(code ?? ''))) ? 'owner' : 'technical')

export const epochOf = (L, taskId) => Number(L.meta(`epoch:${taskId}`) ?? 0)
const floorOf = (L, taskId) => JSON.parse(L.meta(`epoch_floor:${taskId}`) ?? '{"rec":0,"rev":0}')
const setFloor = (L, taskId) => L.setMeta(`epoch_floor:${taskId}`, JSON.stringify({ rec: L.db.prepare('SELECT COALESCE(MAX(recovery_id),0) m FROM recovery_history').get().m, rev: L.db.prepare('SELECT COALESCE(MAX(rowid),0) m FROM reviews').get().m }))

/** Sessions bought in the CURRENT generation: `resumeSuspended` starts a new generation, so an operator's fresh budget really is fresh. */
export const sessionsUsed = (L, taskId) => L.db.prepare('SELECT COUNT(*) c FROM executions WHERE task_id=?').get(taskId).c - Number(L.meta(`session_offset:${taskId}`) ?? 0)
const generationOf = (L, taskId) => Number(L.meta(`suspension_gen:${taskId}`) ?? 0)
export const recordsInEpoch = (L, taskId, kind) => L.db.prepare('SELECT COUNT(*) c FROM recovery_history WHERE task_id=? AND kind=? AND recovery_id>?').get(taskId, kind, floorOf(L, taskId).rec).c
export const reviewRoundsInEpoch = (L, taskId, kind) => L.db.prepare("SELECT COUNT(*) c FROM reviews WHERE task_id=? AND kind=? AND rowid>? AND status IN ('verified_pass','verified_fail','submitted')").get(taskId, kind, floorOf(L, taskId).rev).c

/** @returns {string|null} the cause code of the first task-wide budget that is spent — counted across failure fingerprints, candidate changes and every stage of the CURRENT epoch. */
export function budgetExceeded(e, taskId, { reviewKind = null } = {}) {
  const L = e.ledger; const c = e.cfg.technical
  if (sessionsUsed(L, taskId) >= c.maxSessionsPerTask) return 'SESSION_BUDGET_EXHAUSTED'
  if (recordsInEpoch(L, taskId, 'remediation_entered') >= c.maxRemediationCyclesPerEpoch) return 'REMEDIATION_CYCLES_EXCEEDED'
  if (recordsInEpoch(L, taskId, 'stage_failure') >= c.maxStageFailuresPerEpoch) return 'STAGE_FAILURES_EXCEEDED'
  for (const k of reviewKind ? [reviewKind] : ['independent_review', 'security_review']) if (reviewRoundsInEpoch(L, taskId, k) >= c.maxReviewRoundsPerEpoch) return `REVIEW_ROUNDS_EXCEEDED:${k}`
  return null
}

/**
 * Enter a technical suspension. Idempotent for an active suspension (never stacks epochs for one cause). Returns the suspension row.
 * @param {{cause:string, stage?:string, codes?:string[]}} s
 */
export function suspendTechnically(e, taskId, { cause, stage = null, codes = [] }) {
  const L = e.ledger; const c = e.cfg.technical
  const active = L.getSuspension(taskId); if (active) return active
  // an owner-only cause is NEVER cooled down and retried (defence in depth: every caller already routes these, this makes the invariant local)
  const ownerCodes = [cause, ...codes].filter((x) => classifyBlocker(x) === 'owner')
  if (ownerCodes.length) { e.applyWait(taskId, { kind: 'blocked', reason: 'OWNER_DECISION_REQUIRED', codes: ownerCodes.map(safeCode) }); return null }
  return L.tx(() => {
    const now = L.now(); const epoch = epochOf(L, taskId) + 1
    const terminal = epoch > c.maxEpochs || cause === 'SESSION_BUDGET_EXHAUSTED'
    const base = c.cooldownsMs[Math.min(epoch - 1, c.cooldownsMs.length - 1)]
    let cool = base + Math.round(base * 0.1 * e.rng())
    // The cool-down must also end while the extra-usage fact is still fresh (it ages from the LAST provider stream, not from the suspension): clamp it, with a 10-minute floor.
    const verifiedAt = e.adapters.subscription?.load?.()?.extra_usage?.verified_at
    const room = Number.isFinite(verifiedAt) && verifiedAt <= now ? GOVERNOR_DEFAULTS.extra_usage_fact_ttl_ms - (now - verifiedAt) - 10 * 60_000 : null // an ALREADY-stale fact cannot be saved by waiting less
    if (room !== null && room > 0) cool = Math.min(cool, Math.max(10 * 60_000, room))
    const retryAt = terminal ? null : now + cool
    const t = L.getTask(taskId)
    const budgets = L.db.prepare('SELECT stage, fingerprint, attempts FROM retry_budgets WHERE task_id=? ORDER BY stage, fingerprint').all(taskId).map((r) => ({ stage: r.stage, fingerprint: r.fingerprint, attempts: r.attempts }))
    const recent = L.recoveryHistory(taskId).filter((x) => x.kind === 'stage_failure').slice(-5).map((x) => ({ stage: x.detail.stage ?? null, code: x.detail.code ?? null, fingerprint: x.detail.fingerprint ?? null }))
    const diagnostics = { stage, cause, codes: codes.slice(0, 10), epoch, lifecycle_state: t.state, head_sha: t.head_sha, failure_fingerprints: budgets, recent_failures: recent, sessions_used: sessionsUsed(L, taskId),
      escalated_model: L.meta(`escalated:${taskId}`) === '1', open_mandatory_findings: L.openMandatoryFindings(taskId).map((f) => ({ id: f.finding_id, severity: f.severity, path: f.path })).slice(0, 20) }
    L.setMeta(`epoch:${taskId}`, epoch)
    L.setSuspension(taskId, { epoch, disposition: terminal ? 'terminal' : 'cooling_down', cause, stage, retryAt, diagnostics })
    L.db.prepare('DELETE FROM retry_budgets WHERE task_id=?').run(taskId) // the next epoch starts with fresh per-fingerprint budgets (the per-generation session cap resets only through an explicit resumeSuspended)
    L.recordRecovery(taskId, 'technical_suspension', { epoch, cause, stage, disposition: terminal ? 'terminal' : 'cooling_down', retry_at: retryAt })
    const payload = { task_id: taskId, epoch, disposition: terminal ? 'terminal' : 'cooling_down', owner_permission_required: false,
      automatic_resume_at: retryAt, diagnostics, how_to_resume: terminal ? 'Automatic engineering has stopped for this task (its retry and session budgets are spent). Inspect the diagnostics, then resume with a fresh budget (engine.resumeSuspended) — this is not a permission decision.'
        : 'No action needed: the task resumes automatically at automatic_resume_at with a stronger/different strategy. It can be resumed earlier with engine.resumeSuspended.' }
    if (scanContent(Buffer.from(JSON.stringify(payload))).length) payload.diagnostics = { redacted: true, cause: safeCode(cause) } // a notification never carries a credential-shaped string
    enqueueOutbox(L, { taskId, kind: 'technical_suspension', dedupeKey: `suspension:${taskId}:g${generationOf(L, taskId)}:${epoch}`, payload })
    return L.getSuspension(taskId)
  })
}

/** Called by the scheduler: has a cool-down finished? If so the suspension is cleared, the strategy escalated and a fresh epoch budget begins. @returns {boolean} true when the task may run now. */
export function suspensionAllowsRun(e, taskId) {
  const L = e.ledger; const s = L.getSuspension(taskId)
  if (!s) return true
  if (s.disposition === 'terminal' || L.now() < s.retry_at) return false
  L.tx(() => { L.clearSuspension(taskId); setFloor(L, taskId); L.setMeta(`escalated:${taskId}`, '1'); if (s.epoch >= 2) L.setMeta(`strategy_hint:${taskId}`, '1'); L.recordRecovery(taskId, 'technical_suspension_ended', { epoch: s.epoch, strategy: s.epoch >= 2 ? 'different_approach' : 'stronger_model' }) })
  return true
}

/** Operator/test convenience: start a FRESH epoch budget for a suspended task. Not a permission decision; it cannot unblock an owner-only blocker. */
export function resumeSuspended(e, taskId) {
  const L = e.ledger; const s = L.getSuspension(taskId)
  if (!s) return { ok: false, problems: ['SUSPENSION.NONE'] }
  L.tx(() => { L.clearSuspension(taskId); L.setMeta(`epoch:${taskId}`, 0); L.setMeta(`suspension_gen:${taskId}`, generationOf(L, taskId) + 1); L.setMeta(`session_offset:${taskId}`, L.db.prepare('SELECT COUNT(*) c FROM executions WHERE task_id=?').get(taskId).c); setFloor(L, taskId); L.db.prepare('DELETE FROM retry_budgets WHERE task_id=?').run(taskId); L.recordRecovery(taskId, 'technical_suspension_resumed', { epoch: s.epoch }) })
  return { ok: true }
}
