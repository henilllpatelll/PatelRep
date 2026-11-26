// Developer Harness V3 (D3.4) — durable evidence store. Reuses the D3.2 verifier (authority/evidence.mjs) UNCHANGED; the ledger adds the durable halves of
// its contract: nonce binding that survives restarts, one-time atomic consumption, and invalidation on head or policy change.
//
// Acceptance is VERIFICATION, not issuance: nothing here can sign. A signature must verify against a key pinned by the ACTIVE policy for the claimed issuer.
import { digestOf } from '../../lib/canonical.mjs'
import { isSatisfying, validateEvidence } from '../../authority/evidence.mjs'

/** The authority a task was granted, as the evidence's `authority_digest` binds it. Derived ONLY from the immutable submitted scope. */
export const authorityOf = (task) => ({ repository: task.repository, base_sha: task.base_sha, allowed_paths: task.scope.allowed_paths ?? [], denied_paths: task.scope.denied_paths ?? [] })

export function bindingFor(ledger, taskId, policy) {
  const t = ledger.getTask(taskId); const c = ledger.currentCandidate(taskId)
  return { repository: t.repository, base_sha: t.base_sha, candidate_sha: c?.candidate_sha, tree_digest: c?.tree_digest, patch_digest: c?.patch_digest, policy_revision: policy.revision,
    environment_id: t.environment_id ?? undefined, authority_digest: digestOf(authorityOf(t)) }
}

/**
 * Verify and durably accept one envelope. All checks and the insert run in ONE immediate transaction, so a concurrent acceptance of the same nonce cannot
 * interleave. Same nonce + same payload digest is an idempotent no-op; same nonce + different payload is a conflict and is refused.
 */
export function acceptEvidence(ledger, envelope, { policy }) {
  return ledger.tx(() => {
    const p = envelope?.payload
    if (!p || typeof p.task_id !== 'string') return { ok: false, problems: ['EVIDENCE.MALFORMED'] }
    const t = ledger.getTask(p.task_id)
    if (!t) return { ok: false, problems: ['EVIDENCE.UNKNOWN_TASK'] }
    const implContexts = ledger.implementerContextIds(t.task_id)
    const v = validateEvidence(envelope, { policy, now: ledger.now(), binding: bindingFor(ledger, t.task_id, policy), task: { task_id: t.task_id, fencing_token: t.fencing_token }, authorContextId: implContexts.at(-1) ?? null })
    if (!v.ok) return { ok: false, problems: v.problems }
    const problems = []
    if (t.policy_revision && t.policy_revision !== policy.revision) problems.push('EVIDENCE.TASK_POLICY_REVISION_MISMATCH')
    const needsContext = ['independent_review', 'security_review'].includes(p.evidence_type)
    if (needsContext) {
      // Independence is checked against EVERY implementer/planner context and every other reviewer context, not just the latest one.
      const others = ledger.contextIdsUsed(t.task_id).filter((c) => c.context_id !== p.context_id)
      if (implContexts.includes(p.context_id)) problems.push('EVIDENCE.NOT_INDEPENDENT')
      const sameContextOtherKind = ledger.db.prepare("SELECT 1 FROM reviews WHERE task_id=? AND context_id=? AND kind<>?").get(t.task_id, p.context_id, p.evidence_type)
      if (sameContextOtherKind) problems.push('EVIDENCE.REVIEW_CONTEXT_REUSED')
      const review = ledger.db.prepare('SELECT * FROM reviews WHERE task_id=? AND kind=? AND context_id=? AND candidate_sha=? AND tree_digest=?').get(t.task_id, p.evidence_type, p.context_id, p.candidate_sha, p.tree_digest)
      if (!review) problems.push('EVIDENCE.NO_MATCHING_REVIEW_RECORD')
      else if (review.status === 'invalidated') problems.push('EVIDENCE.REVIEW_INVALIDATED')
      void others
    }
    if (problems.length) return { ok: false, problems }
    const prior = ledger.db.prepare('SELECT payload_digest FROM evidence_nonces WHERE nonce=?').get(p.nonce)
    if (prior) return prior.payload_digest === v.digest ? { ok: true, duplicate: true, evidence_id: p.evidence_id } : { ok: false, problems: ['EVIDENCE.NONCE_CONFLICT'] }
    if (ledger.db.prepare('SELECT 1 FROM evidence WHERE evidence_id=?').get(p.evidence_id)) return { ok: false, problems: ['EVIDENCE.ID_CONFLICT'] }
    const now = ledger.now()
    ledger.db.prepare('INSERT INTO evidence_nonces(nonce,payload_digest,seen_at) VALUES (?,?,?)').run(p.nonce, v.digest, now)
    ledger.db.prepare(`INSERT INTO evidence(evidence_id,task_id,evidence_type,issuer_identity,nonce,idempotency_id,payload_digest,envelope_json,candidate_sha,tree_digest,policy_revision,fencing_token,expires_at,accepted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.evidence_id, p.task_id, p.evidence_type, p.issuer_identity, p.nonce, p.idempotency_id, v.digest, JSON.stringify(envelope), p.candidate_sha ?? null, p.tree_digest ?? null,
      p.policy_revision, p.fencing_token, Date.parse(p.expires_at), now)
    return { ok: true, duplicate: false, evidence_id: p.evidence_id, satisfying: isSatisfying(p) }
  })
}

/** Evidence still usable RIGHT NOW for the task's current candidate, policy and fencing token (not invalidated, expired, consumed or for another head). */
export function usableEvidence(ledger, taskId, policy, { types = null } = {}) {
  const t = ledger.getTask(taskId); const now = ledger.now()
  const rows = ledger.db.prepare('SELECT * FROM evidence WHERE task_id=? AND invalidated_at IS NULL AND expires_at>? AND fencing_token=? AND policy_revision=?').all(taskId, now, t.fencing_token, policy.revision)
  return rows.filter((r) => (!types || types.includes(r.evidence_type)) && (r.candidate_sha === null || r.candidate_sha === t.head_sha)
    && (!policy.contract.evidence_types[r.evidence_type]?.single_use || r.consumed_at === null)).map((r) => ({ ...r, envelope: JSON.parse(r.envelope_json) }))
}
export const satisfyingEvidence = (ledger, taskId, policy, type) => usableEvidence(ledger, taskId, policy, { types: [type] }).filter((r) => isSatisfying(r.envelope.payload))

/** Atomically consume every id or none. Call inside the SAME transaction as the intent it authorizes (see intents.mjs beginIntent). */
export function consumeAll(ledger, ids, consumer) {
  return ledger.tx(() => {
    const now = ledger.now()
    for (const id of ids) {
      const r = ledger.db.prepare('SELECT consumed_at, invalidated_at, expires_at FROM evidence WHERE evidence_id=?').get(id)
      if (!r) return { ok: false, code: 'EVIDENCE.UNKNOWN', id }
      if (r.consumed_at !== null) return { ok: false, code: 'EVIDENCE.ALREADY_CONSUMED', id }
      if (r.invalidated_at !== null) return { ok: false, code: 'EVIDENCE.INVALIDATED', id }
      if (r.expires_at <= now) return { ok: false, code: 'EVIDENCE.EXPIRED', id }
    }
    for (const id of ids) { const u = ledger.db.prepare('UPDATE evidence SET consumed_at=?, consumed_by=? WHERE evidence_id=? AND consumed_at IS NULL').run(now, consumer, id); if (u.changes !== 1) throw new Error('EVIDENCE.CONSUME_RACE') }
    return { ok: true }
  })
}
