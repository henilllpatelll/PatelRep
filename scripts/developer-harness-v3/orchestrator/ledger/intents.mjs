// Developer Harness V3 (D3.4) — durable action intents, retry budgets and the notification outbox.
//
// A database transaction CANNOT atomically commit a remote side effect (a GitHub push, a PR). So an effect is modelled as an INTENT written (together with the
// evidence consumption that authorizes it) BEFORE the call, then an OUTCOME written after. A crash between the two leaves the intent `dispatched`; on restart
// it becomes `uncertain`, and an uncertain intent may only be reconciled against the remote's real state before anything is retried. D3.4 ships no live
// delivery adapter; this is the interface D3.6 must use.
import { digestOf } from '../../lib/canonical.mjs'
import { consumeAll } from './evidence-store.mjs'

const RETRYABLE = new Set(['failed', 'reconciled_absent'])
const TERMINAL_OK = new Set(['succeeded', 'reconciled_succeeded'])

export function beginIntent(ledger, { taskId, action, idempotencyKey, params, evidenceIds = [], lease = null, policyRevision, candidateSha = null }) {
  return ledger.tx(() => {
    const t = ledger.getTask(taskId)
    if (!t) return { ok: false, code: 'TASK.UNKNOWN' }
    const params_digest = digestOf(params)
    const prior = ledger.db.prepare('SELECT * FROM action_intents WHERE idempotency_key=?').get(idempotencyKey)
    if (prior) {
      if (prior.params_digest !== params_digest || prior.task_id !== taskId || prior.action !== action) return { ok: false, code: 'INTENT.IDEMPOTENCY_CONFLICT' }
      return { ok: true, duplicate: true, intent: { ...prior }, must_reconcile: prior.status === 'uncertain' || prior.status === 'dispatched' }
    }
    if (t.cancelled) return { ok: false, code: 'TASK.CANCELLED' }
    if (policyRevision !== t.policy_revision) return { ok: false, code: 'INTENT.STALE_POLICY_REVISION' }
    if (candidateSha !== t.head_sha) return { ok: false, code: 'INTENT.STALE_CANDIDATE' }
    if (lease) { const c = ledger.checkLease(lease); if (c) return { ok: false, code: c } }
    const unreconciled = ledger.db.prepare("SELECT intent_id FROM action_intents WHERE task_id=? AND action=? AND status IN ('uncertain','dispatched')").get(taskId, action)
    if (unreconciled) return { ok: false, code: 'INTENT.UNRECONCILED_PRIOR', intent_id: unreconciled.intent_id }
    for (const id of evidenceIds) {
      const e = ledger.db.prepare('SELECT * FROM evidence WHERE evidence_id=? AND task_id=?').get(id, taskId)
      if (!e) return { ok: false, code: 'EVIDENCE.UNKNOWN', id }
      if (e.invalidated_at !== null) return { ok: false, code: 'EVIDENCE.INVALIDATED', id }
      if (e.expires_at <= ledger.now()) return { ok: false, code: 'EVIDENCE.EXPIRED', id }
      if (e.fencing_token !== t.fencing_token) return { ok: false, code: 'EVIDENCE.STALE_FENCING_TOKEN', id }
      if (e.candidate_sha !== null && e.candidate_sha !== t.head_sha) return { ok: false, code: 'EVIDENCE.STALE_CANDIDATE', id }
    }
    const c = consumeAll(ledger, evidenceIds, `intent:${idempotencyKey}`) // one transaction with the intent row below
    if (!c.ok) return c
    const now = ledger.now(); const intentId = `in-${digestOf({ idempotencyKey }).slice(0, 24)}`
    ledger.db.prepare('INSERT INTO action_intents(intent_id,task_id,action,idempotency_key,params_digest,candidate_sha,policy_revision,fencing_token,evidence_ids_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(intentId, taskId, action, idempotencyKey, params_digest, candidateSha, policyRevision, t.fencing_token, JSON.stringify(evidenceIds), 'intended', now, now)
    return { ok: true, duplicate: false, intent: { ...ledger.db.prepare('SELECT * FROM action_intents WHERE intent_id=?').get(intentId) } }
  })
}

const setStatus = (ledger, id, from, to, outcome = null) => ledger.tx(() => {
  const r = ledger.db.prepare(`UPDATE action_intents SET status=?, outcome_json=COALESCE(?,outcome_json), updated_at=? WHERE intent_id=? AND status IN (${from.map(() => '?').join(',')})`).run(to, outcome ? JSON.stringify(outcome) : null, ledger.now(), id, ...from)
  return r.changes === 1 ? { ok: true } : { ok: false, code: 'INTENT.BAD_TRANSITION' }
})
// fenced: a stale controller (older fencing token than the task's) cannot dispatch
export const markDispatched = (ledger, id) => ledger.tx(() => {
  const r = ledger.db.prepare('SELECT i.fencing_token f, t.fencing_token tf FROM action_intents i JOIN tasks t ON t.task_id=i.task_id WHERE i.intent_id=?').get(id)
  if (!r || r.f !== r.tf) return { ok: false, code: 'INTENT.STALE_FENCING_TOKEN' }
  return setStatus(ledger, id, ['intended'], 'dispatched')
})
export const recordOutcome = (ledger, id, { success, outcome }) => setStatus(ledger, id, ['dispatched'], success ? 'succeeded' : 'failed', outcome)
export const markUncertain = (ledger, id) => setStatus(ledger, id, ['dispatched'], 'uncertain')
/** Reconcile an uncertain intent against the REMOTE's observed state. Only after this may a retry happen (and only if the effect is absent). */
export const reconcileIntent = (ledger, id, { observed, outcome = null }) => setStatus(ledger, id, ['uncertain'], observed === 'present' ? 'reconciled_succeeded' : 'reconciled_absent', outcome)
export const retryIntent = (ledger, id) => ledger.tx(() => {
  const i = ledger.db.prepare('SELECT status FROM action_intents WHERE intent_id=?').get(id)
  if (!i || !RETRYABLE.has(i.status)) return { ok: false, code: 'INTENT.NOT_RETRYABLE' }
  return setStatus(ledger, id, [...RETRYABLE], 'intended')
})
export const isDone = (intent) => TERMINAL_OK.has(intent.status)
export const getIntent = (ledger, id) => { const r = ledger.db.prepare('SELECT * FROM action_intents WHERE intent_id=?').get(id); return r ? { ...r } : null }

/** On controller restart: anything dispatched but without an outcome is UNCERTAIN, never assumed failed and never blindly retried. Returns the ids changed. */
export function markDispatchedAsUncertain(ledger) {
  return ledger.tx(() => {
    const rows = ledger.db.prepare("SELECT intent_id FROM action_intents WHERE status='dispatched'").all()
    for (const r of rows) ledger.db.prepare("UPDATE action_intents SET status='uncertain', updated_at=? WHERE intent_id=?").run(ledger.now(), r.intent_id)
    return rows.map((r) => r.intent_id)
  })
}

// ---------------------------------------------------------------- retry budgets
export const RETRY_DEFAULTS = Object.freeze({ baseMs: 30_000, maxMs: 30 * 60_000, jitter: 0.25, maxAttemptsPerFingerprint: 3, identicalFailureLimit: 2 })
/**
 * Bounded exponential backoff with jitter per (task, stage, failure fingerprint). `repeated_identical` is true once the SAME fingerprint has recurred
 * `identicalFailureLimit` times: the engine must then change strategy (escalate the model) instead of retrying the same thing.
 */
export function recordFailure(ledger, { taskId, stage, fingerprint, rng = Math.random }, cfg = RETRY_DEFAULTS) {
  return ledger.tx(() => {
    const now = ledger.now()
    const r = ledger.db.prepare('SELECT * FROM retry_budgets WHERE task_id=? AND stage=? AND fingerprint=?').get(taskId, stage, fingerprint)
    const attempts = (r?.attempts ?? 0) + 1
    const delay = Math.min(cfg.maxMs, cfg.baseMs * 2 ** (attempts - 1)); const next = now + Math.round(delay * (1 + cfg.jitter * rng()))
    const exhausted = attempts >= cfg.maxAttemptsPerFingerprint ? 1 : 0
    if (r) ledger.db.prepare('UPDATE retry_budgets SET attempts=?, last_at=?, next_eligible_at=?, exhausted=? WHERE task_id=? AND stage=? AND fingerprint=?').run(attempts, now, next, exhausted, taskId, stage, fingerprint)
    else ledger.db.prepare('INSERT INTO retry_budgets(task_id,stage,fingerprint,attempts,first_at,last_at,next_eligible_at,exhausted) VALUES (?,?,?,?,?,?,?,?)').run(taskId, stage, fingerprint, attempts, now, now, next, exhausted)
    return { attempts, next_eligible_at: next, exhausted: exhausted === 1, repeated_identical: attempts >= cfg.identicalFailureLimit }
  })
}
export function retryEligible(ledger, taskId, stage) {
  const r = ledger.db.prepare('SELECT MAX(next_eligible_at) n FROM retry_budgets WHERE task_id=? AND stage=? AND exhausted=0').get(taskId, stage)
  return r?.n == null || r.n <= ledger.now()
}
export const failureCount = (ledger, taskId, stage) => ledger.db.prepare('SELECT COALESCE(SUM(attempts),0) n FROM retry_budgets WHERE task_id=? AND stage=?').get(taskId, stage).n

// ---------------------------------------------------------------- notification outbox (genuine blockers, completion, handoff only — never routine events)
export function enqueueOutbox(ledger, { taskId = null, kind, dedupeKey, payload }) {
  const r = ledger.db.prepare("INSERT OR IGNORE INTO outbox(task_id,kind,dedupe_key,payload_json,status,next_attempt_at,created_at) VALUES (?,?,?,?,'pending',?,?)").run(taskId, kind, dedupeKey, JSON.stringify(payload), ledger.now(), ledger.now())
  return r.changes === 1
}
export function claimOutbox(ledger, limit = 10) {
  return ledger.tx(() => {
    const rows = ledger.db.prepare("SELECT * FROM outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY outbox_id LIMIT ?").all(ledger.now(), limit)
    for (const r of rows) ledger.db.prepare("UPDATE outbox SET status='claimed', attempts=attempts+1 WHERE outbox_id=?").run(r.outbox_id)
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }))
  })
}
export const ackOutbox = (ledger, id) => ledger.db.prepare("UPDATE outbox SET status='sent' WHERE outbox_id=?").run(id)
/** A claimed-but-unacknowledged row (crash between send and ack) is re-queued: delivery is at-least-once, deduplicated by dedupe_key downstream. */
export const requeueClaimedOutbox = (ledger) => ledger.db.prepare("UPDATE outbox SET status='pending' WHERE status='claimed'").run().changes
