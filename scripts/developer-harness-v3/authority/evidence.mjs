// Developer Harness V3 (D3.2) — evidence envelopes: strict schema, signature verification, candidate/policy binding, freshness, replay.
//
// AUTHENTICATION: evidence is accepted only if an Ed25519 signature verifies against a key pinned by the ACTIVE policy for the
// claimed issuer identity. A checksum, a field saying "reviewer", or text in a log is NOT authentication. D3.2 ships the VERIFIER only:
// no issuer service, key or signing code exists in production paths, and no production issuer identity is deployed (D3.3 work).
//
// This module is pure: it reads no clock, file, network or environment. `now` is an argument.
import { createPublicKey, verify } from 'node:crypto'
import { canonicalize, checkShape, digestOf, isPlainObject, v } from '../lib/canonical.mjs'
import { IDENTITIES } from './contract.mjs'

export const EVIDENCE_SCHEMA = 'patelrep.developer-harness-v3.evidence'
export const SIGNING_DOMAIN = 'patelrep-developer-harness-v3-evidence\n'

const PAYLOAD_SPEC = {
  required: {
    evidence_id: v.id, evidence_type: v.id, issuer_identity: v.oneOf(...IDENTITIES), task_id: v.id, repository: v.repo, policy_revision: v.sha64,
    issued_at: v.iso, expires_at: v.iso, nonce: v.id, idempotency_id: v.id, fencing_token: v.int, verdict: v.oneOf('pass', 'fail', 'findings_open'),
  },
  optional: {
    base_sha: v.sha40, candidate_sha: v.sha40, tree_digest: v.sha40, patch_digest: v.sha64, environment_id: v.id, subject_policy_revision: v.sha64, authority_digest: v.sha64,
    context_id: v.id,
    findings: v.arrayOf((f) => isPlainObject(f) && v.id(f.id) && v.oneOf('critical', 'high', 'medium', 'low', 'info')(f.severity) && typeof f.resolved === 'boolean', 200),
    results: (r) => isPlainObject(r) && Object.values(r).every((n) => Number.isSafeInteger(n) && n >= 0),
  },
}
const ENVELOPE_SPEC = { required: { schema: v.oneOf(EVIDENCE_SCHEMA), version: v.oneOf(1), payload: isPlainObject,
  signature: (s) => isPlainObject(s) && s.alg === 'ed25519' && v.id(s.key_id) && typeof s.value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(s.value) && Object.keys(s).length === 3 } }

const BIND_CODE = { repository: 'WRONG_REPOSITORY', base_sha: 'WRONG_BASE_SHA', candidate_sha: 'WRONG_CANDIDATE_SHA', tree_digest: 'WRONG_TREE_DIGEST',
  policy_revision: 'WRONG_POLICY_REVISION', environment_id: 'WRONG_ENVIRONMENT', subject_policy_revision: 'WRONG_SUBJECT_POLICY_REVISION', authority_digest: 'WRONG_AUTHORITY_DIGEST' }

export const signingMessage = (payload) => Buffer.from(`${SIGNING_DOMAIN}${canonicalize(payload)}`, 'utf8')

/** A payload satisfies a requirement only with verdict `pass` and no open blocking finding. */
export function isSatisfying(payload) {
  if (payload.verdict !== 'pass') return false
  return !(payload.findings ?? []).some((f) => ['critical', 'high'].includes(f.severity) && !f.resolved)
}

/**
 * @param {object} envelope untrusted
 * @param {{policy:object, now:number, binding:object, task:{task_id:string,fencing_token:number}, authorContextId?:string|null}} ctx trusted
 *   binding = the trusted candidate/environment facts the evidence must be bound to (repository, base_sha, candidate_sha, tree_digest,
 *   policy_revision, environment_id, subject_policy_revision)
 * @returns {{ok:boolean, problems:string[], payload?:object, digest?:string}}
 */
export function validateEvidence(envelope, { policy, now, binding, task, authorContextId = null }) {
  const problems = []
  try {
    const shape = checkShape(envelope, ENVELOPE_SPEC, 'envelope')
    if (shape.length) return { ok: false, problems: ['EVIDENCE.MALFORMED'] }
    const payloadShape = checkShape(envelope.payload, PAYLOAD_SPEC, 'payload')
    if (payloadShape.length) return { ok: false, problems: ['EVIDENCE.MALFORMED'] }
    const p = envelope.payload
    const type = Object.hasOwn(policy.contract.evidence_types, p.evidence_type) ? policy.contract.evidence_types[p.evidence_type] : null
    if (!type) return { ok: false, problems: ['EVIDENCE.UNKNOWN_TYPE'] }
    if (!type.issuers.includes(p.issuer_identity)) problems.push('EVIDENCE.UNAUTHORIZED_ISSUER')

    // authentication
    const key = Object.hasOwn(policy.trusted_keys, envelope.signature.key_id) ? policy.trusted_keys[envelope.signature.key_id] : undefined
    if (!key) problems.push('EVIDENCE.UNKNOWN_KEY')
    else {
      if (key.identity !== p.issuer_identity) problems.push('EVIDENCE.KEY_IDENTITY_MISMATCH')
      const issued = Date.parse(p.issued_at)
      if (issued < Date.parse(key.not_before) || issued >= Date.parse(key.not_after) || now >= Date.parse(key.not_after) || now < Date.parse(key.not_before)) problems.push('EVIDENCE.KEY_NOT_VALID')
      let authentic = false
      try {
        authentic = verify(null, signingMessage(p), createPublicKey({ key: Buffer.from(key.public_key, 'base64'), format: 'der', type: 'spki' }), Buffer.from(envelope.signature.value, 'base64'))
      } catch { authentic = false }
      if (!authentic) problems.push('EVIDENCE.BAD_SIGNATURE')
    }

    // freshness
    const issued = Date.parse(p.issued_at); const expires = Date.parse(p.expires_at)
    const skew = policy.contract.limits.evidence_clock_skew_seconds * 1000
    if (issued > now + skew) problems.push('EVIDENCE.FROM_THE_FUTURE')
    if (!(expires > issued)) problems.push('EVIDENCE.INVERTED_VALIDITY')
    else if (expires - issued > type.max_ttl_seconds * 1000) problems.push('EVIDENCE.TTL_TOO_LONG')
    if (now >= expires) problems.push('EVIDENCE.EXPIRED')

    // binding to the exact candidate, policy and environment
    if (p.policy_revision !== policy.revision) problems.push('EVIDENCE.WRONG_POLICY_REVISION')
    for (const field of type.binds) {
      if (field === 'policy_revision') continue
      if (p[field] === undefined || binding[field] === undefined || p[field] !== binding[field]) problems.push(`EVIDENCE.${BIND_CODE[field]}`)
    }
    if (p.patch_digest !== undefined && binding.patch_digest !== undefined && p.patch_digest !== binding.patch_digest) problems.push('EVIDENCE.WRONG_PATCH_DIGEST')

    // task ownership and fencing
    if (p.task_id !== task.task_id) problems.push('EVIDENCE.WRONG_TASK')
    if (p.fencing_token !== task.fencing_token) problems.push('EVIDENCE.STALE_FENCING_TOKEN')

    // independence of review contexts (attribution is signed, not self-asserted)
    if (type.independent_of_author) {
      if (!p.context_id) problems.push('EVIDENCE.CONTEXT_MISSING')
      else if (!authorContextId) problems.push('EVIDENCE.AUTHOR_CONTEXT_UNKNOWN') // independence cannot be shown without the author's context
      else if (p.context_id === authorContextId) problems.push('EVIDENCE.NOT_INDEPENDENT')
    }
    return { ok: problems.length === 0, problems: [...new Set(problems)], payload: p, digest: digestOf(envelope.payload) }
  } catch { return { ok: false, problems: ['EVIDENCE.VALIDATION_ERROR'] } }
}

/** In-memory replay ledger. The durable implementation (SQLite, D3.3) must preserve exactly these semantics. */
export class EvidenceLedger {
  #nonces = new Map()
  #consumed = new Set()
  /** @returns {'new'|'same'|'conflict'} */
  nonceStatus(nonce, digest) {
    if (!this.#nonces.has(nonce)) return 'new'
    return this.#nonces.get(nonce) === digest ? 'same' : 'conflict'
  }
  recordNonce(nonce, digest) { if (!this.#nonces.has(nonce)) this.#nonces.set(nonce, digest) }
  isConsumed(evidenceId) { return this.#consumed.has(evidenceId) }
  /** Atomically consume every id or none. The caller must do this in the SAME transaction as the action it authorizes. */
  consumeAll(ids) {
    if (ids.some((i) => this.#consumed.has(i))) return false
    for (const i of ids) this.#consumed.add(i)
    return true
  }
  consume(evidenceId) {
    if (this.#consumed.has(evidenceId)) return false
    this.#consumed.add(evidenceId)
    return true
  }
}
