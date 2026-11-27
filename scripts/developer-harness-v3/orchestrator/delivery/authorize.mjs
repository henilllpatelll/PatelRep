// Developer Harness V3 (D3.6-B) — the deterministic AUTHORITY EVALUATOR at every external-effect boundary (gate G-INTENT-EVALUATOR).
//
// The durable intent layer (ledger/intents.mjs) is crash-safety and single-use bookkeeping; it is NOT the authority evaluator. Every delivery effect therefore passes BOTH:
//   1. the D3.2 evaluator `evaluate()` (authority/evaluator.mjs, UNCHANGED), with trusted facts the controller re-derives itself (candidate facts from the trusted fact source,
//      the task's fencing token/revision/authority, the worker environment record, the current main tip from an authenticated observation) — never from the requester;
//   2. the intent layer's ledger re-validation (task, candidate + tree, policy, fencing, lease, evidence validity/expiry/satisfaction, effect uniqueness, activation).
//
// CREATION: evaluate() runs BEFORE any consumption, inside the SAME transaction as the intent insert; single-use evidence is consumed ONLY on `allow`, and exactly the set the
// evaluator returned (`consumes`). A refusal consumes nothing.
// DISPATCH / RETRY: evaluate() runs AGAIN against the CURRENT policy and RE-DERIVED facts, through DurableEvidenceView, an EvidenceLedger in which evidence consumed by THIS intent
// (`consumed_by` = `intent:<idempotency_key>`) counts as held — never as a replay — while evidence consumed by anything else is a replay (EVIDENCE.REPLAYED). The decision must not
// want to consume anything new, the evaluator request must be byte-identical to the one authorized at creation, and the exact effect parameters must still match the trusted
// delivery facts (validateParams, run at creation AND at every re-authorization).
//
// The authoritative policy activates NO action, so with it every real effect is refused here (ACTIVATION.NOT_ACTIVE). The delivery actions that are not in the authoritative
// contract at all (proposal P7) are refused as ACTION.UNKNOWN. Nothing here weakens, bypasses or re-implements the evaluator.
import { evaluate as authoritativeEvaluate } from '../../authority/evaluator.mjs'
import { EvidenceLedger, isSatisfying } from '../../authority/evidence.mjs'
import { authorityOf, usableEvidence } from '../ledger/evidence-store.mjs'
import { beginIntent, consumerOf, getIntent, markDispatched, retryIntent } from '../ledger/intents.mjs'

/** The identity that performs each delivery action. Fixed by trusted code, never chosen by a requester. */
export const ACTION_IDENTITY = Object.freeze({
  publish_candidate_branch: 'trusted_publisher', open_draft_pull_request: 'trusted_publisher', update_pull_request_metadata: 'trusted_publisher', mark_pull_request_ready: 'trusted_publisher',
  rerun_ci_jobs: 'trusted_publisher', dispatch_staging_candidate: 'trusted_publisher', verify_delivery_eligibility: 'delivery_verifier',
})
/** Evidence the DELIVERY path requires in addition to the contract (strengthening only; proposals P7/P8 move these into the authority contract and evaluator). */
export const DELIVERY_EXTRA = Object.freeze({ publish_candidate_branch: ['independent_review'], open_draft_pull_request: ['independent_review'] })

/**
 * An EvidenceLedger over the DURABLE store, read-only. `own` = the consumer key of the intent being (re)validated. Built over the EvidenceLedger class of the evaluator in use
 * (the evaluator requires `instanceof` ITS class), so a labelled proposal evaluator gets the same view semantics.
 */
export function durableViewClass(Base) {
  return class DurableEvidenceView extends Base {
    #L; #own
    constructor(ledger, own) { super(); this.#L = ledger; this.#own = own }
    nonceStatus(nonce, digest) { const r = this.#L.db.prepare('SELECT payload_digest FROM evidence_nonces WHERE nonce=?').get(nonce); if (!r) return 'new'; return r.payload_digest === digest ? 'same' : 'conflict' }
    /** consumed by ANOTHER consumer = consumed (a replay); consumed by this intent = held; an unknown id = consumed (fail closed). */
    isConsumed(id) { const r = this.#L.db.prepare('SELECT consumed_at, consumed_by FROM evidence WHERE evidence_id=?').get(id); if (!r) return true; return r.consumed_at !== null && r.consumed_by !== this.#own }
    recordNonce() { throw new Error('DURABLE_VIEW.READ_ONLY') }
    consumeAll() { throw new Error('DURABLE_VIEW.READ_ONLY') }
    consume() { throw new Error('DURABLE_VIEW.READ_ONLY') }
  }
}
export const DurableEvidenceView = durableViewClass(EvidenceLedger)

/** Evidence the risk class demands even where the contract does not list it for the action: a security-sensitive or security-review-required task never ships without it. */
export const riskRequiredEvidence = (task) => (task.lifecycle.security_review_required || task.risk_class === 'security_sensitive' ? ['security_review'] : [])

/**
 * The trusted half of an evaluator input. `facts` is the TRUSTED fact source (never the requester): candidate(task) -> {ok, facts} (D3.2 candidate facts), environment(task), targetTip(task) -> {sha}.
 * @returns {Promise<{ok:true, trusted:object}|{ok:false, code:string}>}
 */
export async function trustedFacts(L, taskId, identity, facts) {
  const t = L.getTask(taskId)
  if (!t) return { ok: false, code: 'TASK.UNKNOWN' }
  let candidate; let environment; let tip; let delivery
  try { candidate = await facts.candidate(t); environment = await facts.environment(t); tip = await facts.targetTip(t); delivery = facts.delivery ? await facts.delivery(t) : undefined } catch { return { ok: false, code: 'FACTS.SOURCE_ERROR' } }
  if (!candidate?.ok) return { ok: false, code: candidate?.code ?? 'FACTS.CANDIDATE_UNAVAILABLE' }
  if (tip && !tip.ok) return { ok: false, code: tip.code ?? 'FACTS.TARGET_TIP_UNAVAILABLE' }
  const ctx = L.implementerContextIds(taskId).at(-1)
  // `security_review_required` (P7, integrated in D3.6): ALWAYS passed — the authoritative evaluator then requires a security review for every candidate-bound safeguarded action
  const task = { task_id: t.task_id, fencing_token: t.fencing_token, state_revision: t.state_revision, authority: authorityOf(t), ...(ctx ? { author_context_id: ctx } : {}),
    security_review_required: riskRequiredEvidence(t).length > 0 }
  return { ok: true, trusted: { identity, task, candidate: candidate.facts, environment, target_tip_sha: tip?.sha ?? null, ...(delivery ? { delivery } : {}) } }
}

const envelopesOf = (L, ids) => ids.map((id) => L.db.prepare('SELECT envelope_json FROM evidence WHERE evidence_id=?').get(id)).filter(Boolean).map((r) => JSON.parse(r.envelope_json))
class Rollback extends Error { constructor(result) { super('ROLLBACK'); this.result = result } }
/** Run a transaction whose refusal must leave NOTHING behind: the body throws Rollback(result), the transaction rolls back, and the result is returned. */
export const atomically = (L, fn) => { try { return L.tx(fn) } catch (e) { if (e instanceof Rollback) return e.result; throw e } }
const requestOf = (action, taskId, evaluatorParams) => ({ action, task_id: taskId, ...(evaluatorParams ? { params: evaluatorParams } : {}) })

/**
 * CREATE an authorized intent. `params` = the exact effect parameters, bound by digest; `validateParams(params, task)` checks them against the trusted delivery facts (branch ownership,
 * PR identity, run ownership…); `evaluatorParams` = the evaluator-visible request params (D3.2 PARAMS_SPEC only). Atomic: evaluate -> (allow) -> consume `consumes` + insert, or nothing.
 */
export async function authorizeIntent(ctx, { taskId, action, idempotencyKey, params, evaluatorParams = undefined, validateParams = null, lease = null, supersedes = null }) {
  const { ledger: L, policy, facts, evaluateFn = authoritativeEvaluate, View = DurableEvidenceView } = ctx
  if (!Object.hasOwn(ACTION_IDENTITY, action)) return { ok: false, code: 'DELIVERY.ACTION_NOT_A_DELIVERY_ACTION' }
  const t0 = L.getTask(taskId); if (!t0) return { ok: false, code: 'TASK.UNKNOWN' }
  if (L.db.prepare('SELECT 1 FROM action_intents WHERE idempotency_key=?').get(idempotencyKey)) return beginIntent(L, { taskId, action, idempotencyKey, params, policy, candidateSha: t0.head_sha }) // a replay: duplicate or conflict, never new authority
  if (validateParams) { const pv = await validateParams(params, t0); if (!pv.ok) return { ok: false, code: pv.code } }
  const tf = await trustedFacts(L, taskId, ACTION_IDENTITY[action], facts); if (!tf.ok) return tf
  return atomically(L, () => {
    const t = L.getTask(taskId)
    if (t.fencing_token !== tf.trusted.task.fencing_token || t.state_revision !== tf.trusted.task.state_revision || t.fencing_token !== t0.fencing_token || t.state_revision !== t0.state_revision || t.head_sha !== t0.head_sha) return { ok: false, code: 'AUTHORITY.FACTS_STALE' } // the task moved while params were validated or facts derived (security review OPT-4)
    const pool = usableEvidence(L, taskId, policy).filter((r) => isSatisfying(r.envelope.payload)).slice(0, 64)
    const request = requestOf(action, taskId, evaluatorParams)
    const decision = evaluateFn({ policy, request, trusted: tf.trusted, evidence: pool.map((r) => r.envelope), now: L.now(), ledger: new View(L, consumerOf(idempotencyKey)) })
    if (decision.decision !== 'allow') return { ok: false, code: 'AUTHORITY.DENIED', decision }
    // delivery-level strengthening: evidence the contract does not list but the delivery path and the task's risk class require; CITED, so the intent layer re-validates it at every gate
    const cited = new Set(decision.accepted_evidence)
    const typeOf = (id) => pool.find((r) => r.evidence_id === id)?.evidence_type
    for (const type of [...(DELIVERY_EXTRA[action] ?? []), ...riskRequiredEvidence(t)]) {
      if ([...cited].some((id) => typeOf(id) === type)) continue
      const e = pool.find((r) => r.evidence_type === type)
      if (!e) return { ok: false, code: `DELIVERY.REQUIRED_EVIDENCE_MISSING:${type}`, decision }
      cited.add(e.evidence_id)
    }
    if ([...cited].some((id) => !typeOf(id))) return { ok: false, code: 'DELIVERY.EVIDENCE_NOT_IN_STORE', decision }
    const r = beginIntent(L, { taskId, action, idempotencyKey, params, evidenceIds: [...cited], consume: decision.consumes, requestDigest: decision.request_digest, lease, policy, candidateSha: t.head_sha, supersedes })
    if (!r.ok) throw new Rollback({ ...r, decision }) // refuse atomically
    return { ...r, decision }
  })
}

/**
 * RE-AUTHORIZE an existing intent immediately before dispatch (`mode: 'dispatch'`) or before a retry of a proven-absent/failed effect (`mode: 'retry'`), and mark it dispatched in the
 * SAME transaction. A refusal changes nothing.
 */
export async function reauthorize(ctx, intentId, { mode = 'dispatch', lease = null, validateParams = null, evaluatorParams = undefined } = {}) {
  const { ledger: L, policy, facts, evaluateFn = authoritativeEvaluate, View = DurableEvidenceView } = ctx
  const i = getIntent(L, intentId); if (!i) return { ok: false, code: 'INTENT.UNKNOWN' }
  if (!Object.hasOwn(ACTION_IDENTITY, i.action)) return { ok: false, code: 'DELIVERY.ACTION_NOT_A_DELIVERY_ACTION' }
  if (validateParams) { const pv = await validateParams(JSON.parse(i.params_json ?? 'null'), L.getTask(i.task_id)); if (!pv.ok) return { ok: false, code: pv.code } }
  const tf = await trustedFacts(L, i.task_id, ACTION_IDENTITY[i.action], facts); if (!tf.ok) return tf // re-derived NOW
  return atomically(L, () => {
    const t = L.getTask(i.task_id)
    if (t.fencing_token !== tf.trusted.task.fencing_token || t.state_revision !== tf.trusted.task.state_revision) return { ok: false, code: 'AUTHORITY.FACTS_STALE' }
    const cited = JSON.parse(i.evidence_ids_json); const consumed = i.consumed_ids_json == null ? cited : JSON.parse(i.consumed_ids_json)
    const decision = evaluateFn({ policy, request: requestOf(i.action, i.task_id, evaluatorParams), trusted: tf.trusted, evidence: envelopesOf(L, cited), now: L.now(), ledger: new View(L, consumerOf(i.idempotency_key)) })
    if (decision.decision !== 'allow') return { ok: false, code: 'AUTHORITY.DENIED', decision }
    if (!i.authorized_request_digest || decision.request_digest !== i.authorized_request_digest) return { ok: false, code: 'AUTHORITY.REQUEST_CHANGED', decision } // an intent without an evaluator authorization is never dispatched here
    if (decision.consumes.some((id) => !consumed.includes(id))) return { ok: false, code: 'AUTHORITY.NEW_CONSUMPTION_AT_DISPATCH', decision }
    if (mode === 'retry') { const r = retryIntent(L, intentId, { policy, lease }); if (!r.ok) throw new Rollback({ ...r, decision }) }
    const d = markDispatched(L, intentId, { policy, lease }); if (!d.ok) throw new Rollback({ ...d, decision })
    return { ok: true, intent: getIntent(L, intentId), decision }
  })
}
