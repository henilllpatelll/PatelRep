// Developer Harness V3 (D3.4) — durable action intents, retry budgets and the notification outbox.
//
// A database transaction CANNOT atomically commit a remote side effect (a GitHub push, a PR). So an effect is modelled as an INTENT written (together with the
// evidence consumption that authorizes it) BEFORE the call, then an OUTCOME written after. A crash between the two leaves the intent `dispatched`; on restart
// it becomes `uncertain`, and an uncertain intent may only be reconciled against the remote's real state before anything is retried. D3.4 ships no live
// delivery adapter and activates no action; this is the interface D3.6 must use.
//
// Remediation F3: an intent's authorization is re-validated at DISPATCH and at RETRY (not only at creation); reconciliation accepts only explicit, validated, authoritative observations;
// a retry never reuses expired or invalid authorization; a NEW authorized intent supersedes an old PROVEN-absent one without re-consuming single-use evidence.
import { digestOf } from '../../lib/canonical.mjs'
import { consumeAll } from './evidence-store.mjs'

const RETRYABLE = new Set(['failed', 'reconciled_absent'])
const TERMINAL_OK = new Set(['succeeded', 'reconciled_succeeded'])
const consumerOf = (key) => `intent:${key}`

/**
 * EVERY authorization binding an intent depends on, re-checked from the CURRENT ledger and the CURRENT active policy. Used at creation, at DISPATCH and at RETRY: an intent that was valid when
 * it was written is not thereby valid when it is sent. Pure reads. @returns {string|null} the first problem code.
 */
function bindingProblem(ledger, intent, { policy, lease = null, atCreation = false }) {
  const t = ledger.getTask(intent.task_id)
  if (!t) return 'TASK.UNKNOWN'
  if (t.cancelled) return 'TASK.CANCELLED'
  if (!policy?.contract || intent.policy_revision !== policy.revision || t.policy_revision !== policy.revision) return 'INTENT.STALE_POLICY_REVISION'
  if (intent.candidate_sha !== t.head_sha) return 'INTENT.STALE_CANDIDATE'
  if (intent.candidate_sha !== null) {
    const c = ledger.currentCandidate(t.task_id)
    if (!c || c.candidate_sha !== intent.candidate_sha) return 'INTENT.STALE_CANDIDATE'
    if (intent.tree_digest != null && c.tree_digest !== intent.tree_digest) return 'INTENT.STALE_TREE'
  }
  if (intent.fencing_token !== t.fencing_token) return 'INTENT.STALE_FENCING_TOKEN'
  if (intent.lease_id) { if (!lease) return 'INTENT.LEASE_REQUIRED'; if (lease.lease_id !== intent.lease_id) return 'INTENT.LEASE_MISMATCH' }
  if (lease) { const c = ledger.checkLease(lease); if (c) return c }
  const spec = policy.contract.actions?.[intent.action]
  if (!spec) return 'INTENT.UNKNOWN_ACTION'
  if (spec.class === 'prohibited') return 'INTENT.ACTION_PROHIBITED'
  if (!atCreation && spec.requires_activation === true && !(policy.contract.activation?.active_actions ?? []).includes(intent.action)) return 'INTENT.ACTION_NOT_ACTIVE'
  if (!atCreation) { // the EFFECT must be unique too, not only its authorization
    const dup = ledger.db.prepare("SELECT intent_id FROM action_intents WHERE task_id=? AND action=? AND intent_id<>? AND (status IN ('dispatched','uncertain') OR (status IN ('succeeded','reconciled_succeeded') AND params_digest=? AND candidate_sha IS ?))").get(intent.task_id, intent.action, intent.intent_id, intent.params_digest, intent.candidate_sha)
    if (dup) return 'INTENT.EFFECT_NOT_UNIQUE'
  }
  const have = new Set(); const now = ledger.now()
  for (const id of JSON.parse(intent.evidence_ids_json)) {
    const e = ledger.db.prepare('SELECT * FROM evidence WHERE evidence_id=? AND task_id=?').get(id, intent.task_id)
    if (!e) return 'EVIDENCE.UNKNOWN'
    if (e.invalidated_at !== null) return 'EVIDENCE.INVALIDATED'
    if (atCreation) { if (e.consumed_at !== null) return 'EVIDENCE.ALREADY_CONSUMED' } else if (e.consumed_by !== consumerOf(intent.idempotency_key)) return 'EVIDENCE.NOT_CONSUMED_BY_THIS_INTENT'
    if (e.expires_at <= now) return 'EVIDENCE.EXPIRED'
    if (e.policy_revision !== policy.revision) return 'EVIDENCE.STALE_POLICY_REVISION'
    if (e.fencing_token !== t.fencing_token) return 'EVIDENCE.STALE_FENCING_TOKEN'
    if (e.candidate_sha !== null && e.candidate_sha !== t.head_sha) return 'EVIDENCE.STALE_CANDIDATE'
    have.add(e.evidence_type)
  }
  for (const need of spec.required_evidence ?? []) if (!have.has(need)) return 'INTENT.EVIDENCE_NOT_AUTHORIZING_ACTION' // the evidence must be of the kinds THIS action requires, not merely valid
  return null
}

/**
 * Record an intent (and consume its single-use evidence) in ONE transaction. `supersedes` names an earlier intent of this task whose effect is PROVEN absent (failed / reconciled_absent): the new
 * intent needs its OWN fresh, valid evidence (consumed evidence is never re-consumed), and the old intent becomes permanently non-retryable.
 */
export function beginIntent(ledger, { taskId, action, idempotencyKey, params, evidenceIds: rawEvidenceIds = [], lease = null, policy, policyRevision = policy?.revision, candidateSha = null, supersedes = null }) {
  const evidenceIds = [...new Set(rawEvidenceIds)] // a repeated id is one authorization, not a consumption race
  return ledger.tx(() => {
    const t = ledger.getTask(taskId)
    if (!t) return { ok: false, code: 'TASK.UNKNOWN' }
    if (t.cancelled) return { ok: false, code: 'TASK.CANCELLED' } // before the replay shortcut: a cancelled task is never advanced by repeating a call
    const params_digest = digestOf(params)
    const prior = ledger.db.prepare('SELECT * FROM action_intents WHERE idempotency_key=?').get(idempotencyKey)
    if (prior) {
      if (prior.params_digest !== params_digest || prior.task_id !== taskId || prior.action !== action) return { ok: false, code: 'INTENT.IDEMPOTENCY_CONFLICT' }
      return { ok: true, duplicate: true, intent: { ...prior }, must_reconcile: prior.status === 'uncertain' || prior.status === 'dispatched' } // a replay authorizes nothing: dispatch re-validates everything
    }
    if (policyRevision !== t.policy_revision || !policy || policy.revision !== policyRevision) return { ok: false, code: 'INTENT.STALE_POLICY_REVISION' }
    if (candidateSha !== t.head_sha) return { ok: false, code: 'INTENT.STALE_CANDIDATE' }
    const cand = candidateSha ? ledger.currentCandidate(taskId) : null
    const unreconciled = ledger.db.prepare("SELECT intent_id FROM action_intents WHERE task_id=? AND action=? AND status IN ('uncertain','dispatched')").get(taskId, action)
    if (unreconciled) return { ok: false, code: 'INTENT.UNRECONCILED_PRIOR', intent_id: unreconciled.intent_id }
    let old = null
    if (supersedes) {
      old = ledger.db.prepare('SELECT * FROM action_intents WHERE intent_id=? AND task_id=?').get(supersedes, taskId)
      if (!old) return { ok: false, code: 'INTENT.SUPERSEDES_UNKNOWN' }
      if (TERMINAL_OK.has(old.status)) return { ok: false, code: 'INTENT.EFFECT_ALREADY_APPLIED' }
      if (old.superseded_by) return { ok: false, code: 'INTENT.ALREADY_SUPERSEDED' }
      if (!RETRYABLE.has(old.status)) return { ok: false, code: 'INTENT.UNRECONCILED_PRIOR', intent_id: old.intent_id } // only a PROVEN-absent or failed effect may be superseded
    }
    const sibling = ledger.db.prepare("SELECT intent_id FROM action_intents WHERE task_id=? AND action=? AND params_digest=? AND candidate_sha IS ? AND status IN ('failed','reconciled_absent') AND superseded_by IS NULL").get(taskId, action, params_digest, candidateSha)
    if (sibling && sibling.intent_id !== old?.intent_id) return { ok: false, code: 'INTENT.SIBLING_NOT_SUPERSEDED', intent_id: sibling.intent_id } // a proven-absent sibling must be superseded explicitly, or two live intents could both fire
    const applied = ledger.db.prepare("SELECT intent_id FROM action_intents WHERE task_id=? AND action=? AND params_digest=? AND candidate_sha IS ? AND status IN ('succeeded','reconciled_succeeded')").get(taskId, action, params_digest, candidateSha)
    if (applied) return { ok: false, code: 'INTENT.EFFECT_ALREADY_APPLIED', intent_id: applied.intent_id }
    const now = ledger.now(); const intentId = `in-${digestOf({ idempotencyKey }).slice(0, 24)}`
    const draft = { intent_id: intentId, task_id: taskId, action, idempotency_key: idempotencyKey, params_digest, candidate_sha: candidateSha, tree_digest: cand?.tree_digest ?? null, policy_revision: policyRevision, fencing_token: t.fencing_token,
      lease_id: lease?.lease_id ?? null, evidence_ids_json: JSON.stringify(evidenceIds) }
    const problem = bindingProblem(ledger, draft, { policy, lease, atCreation: true })
    if (problem) return { ok: false, code: problem }
    const c = consumeAll(ledger, evidenceIds, consumerOf(idempotencyKey)) // one transaction with the intent row below
    if (!c.ok) return c
    ledger.db.prepare('INSERT INTO action_intents(intent_id,task_id,action,idempotency_key,params_digest,candidate_sha,tree_digest,policy_revision,fencing_token,lease_id,supersedes,evidence_ids_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(intentId, taskId, action, idempotencyKey, params_digest, candidateSha, draft.tree_digest, policyRevision, t.fencing_token, draft.lease_id, old?.intent_id ?? null, draft.evidence_ids_json, 'intended', now, now)
    if (old) ledger.db.prepare('UPDATE action_intents SET superseded_by=? WHERE intent_id=?').run(intentId, old.intent_id)
    return { ok: true, duplicate: false, intent: { ...ledger.db.prepare('SELECT * FROM action_intents WHERE intent_id=?').get(intentId) } }
  })
}

const setStatus = (ledger, id, from, to, outcome = null) => ledger.tx(() => {
  const r = ledger.db.prepare(`UPDATE action_intents SET status=?, outcome_json=COALESCE(?,outcome_json), updated_at=? WHERE intent_id=? AND status IN (${from.map(() => '?').join(',')})`).run(to, outcome ? JSON.stringify(outcome) : null, ledger.now(), id, ...from)
  return r.changes === 1 ? { ok: true } : { ok: false, code: 'INTENT.BAD_TRANSITION' }
})
const revalidate = (ledger, id, { policy, lease }) => {
  const i = ledger.db.prepare('SELECT * FROM action_intents WHERE intent_id=?').get(id)
  if (!i) return { ok: false, code: 'INTENT.UNKNOWN' }
  const p = bindingProblem(ledger, i, { policy, lease })
  return p ? { ok: false, code: p } : { ok: true, intent: i }
}

/** DISPATCH gate: the task, candidate + tree, policy, fencing epoch, lease, evidence (validity AND expiry) and the action's own authorization are all re-validated NOW. A refusal changes nothing. */
export const markDispatched = (ledger, id, { policy, lease = null } = {}) => ledger.tx(() => {
  const v = revalidate(ledger, id, { policy, lease }); if (!v.ok) return v
  return setStatus(ledger, id, ['intended'], 'dispatched')
})
export const recordOutcome = (ledger, id, { success, outcome }) => setStatus(ledger, id, ['dispatched'], success ? 'succeeded' : 'failed', outcome)
export const markUncertain = (ledger, id) => setStatus(ledger, id, ['dispatched'], 'uncertain')

const OBS_KEYS = new Set(['state', 'authoritative', 'observed_at', 'params_digest', 'candidate_sha', 'source', 'ref'])
/**
 * Only an EXPLICIT, VALIDATED, AUTHORITATIVE remote observation reconciles an uncertain intent: { state:'present'|'absent', authoritative:true, observed_at, params_digest, candidate_sha, source }.
 * Anything else — missing, unknown state, non-authoritative, stale, about another effect, unknown fields — is INCONCLUSIVE: the intent stays uncertain and nothing may be retried.
 */
export function reconcileIntent(ledger, id, { observation, outcome = null } = {}) {
  return ledger.tx(() => {
    const i = ledger.db.prepare('SELECT * FROM action_intents WHERE intent_id=?').get(id)
    if (!i) return { ok: false, code: 'INTENT.UNKNOWN' }
    const o = observation; const problems = []
    if (!o || typeof o !== 'object' || Array.isArray(o)) problems.push('OBSERVATION.MALFORMED')
    else {
      for (const k of Object.keys(o)) if (!OBS_KEYS.has(k)) problems.push(`OBSERVATION.UNKNOWN_FIELD:${k}`)
      if (o.state !== 'present' && o.state !== 'absent') problems.push('OBSERVATION.STATE_NOT_EXPLICIT')
      if (o.authoritative !== true) problems.push('OBSERVATION.NOT_AUTHORITATIVE')
      if (!Number.isFinite(o.observed_at) || o.observed_at > ledger.now() || o.observed_at < i.updated_at) problems.push('OBSERVATION.TIME_INVALID')
      if (o.params_digest !== i.params_digest) problems.push('OBSERVATION.WRONG_SUBJECT')
      if (i.candidate_sha !== null && o.candidate_sha !== i.candidate_sha) problems.push('OBSERVATION.WRONG_CANDIDATE')
      if (typeof o.source !== 'string' || !o.source.trim() || o.source.length > 200) problems.push('OBSERVATION.SOURCE_MISSING')
    }
    if (problems.length) return { ok: false, code: 'INTENT.RECONCILIATION_INCONCLUSIVE', problems }
    return setStatus(ledger, id, ['uncertain'], o.state === 'present' ? 'reconciled_succeeded' : 'reconciled_absent', outcome)
  })
}
/** A retry of the SAME intent: only for a proven-absent/failed effect, only while EVERY binding and the original authorization are still valid (expired or invalidated authorization is never reused). */
export const retryIntent = (ledger, id, { policy, lease = null } = {}) => ledger.tx(() => {
  const i = ledger.db.prepare('SELECT status, superseded_by FROM action_intents WHERE intent_id=?').get(id)
  if (!i || !RETRYABLE.has(i.status) || i.superseded_by) return { ok: false, code: 'INTENT.NOT_RETRYABLE' }
  const v = revalidate(ledger, id, { policy, lease }); if (!v.ok) return v
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
