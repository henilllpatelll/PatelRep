// Developer Harness V3 (D3.6) — AUTHENTICATED remote observations (the reconciliation boundary demanded by doc 18 §8 / gate G-INTENT-EVALUATOR).
//
// A remote observation says "at observed_at, the remote showed state S for subject X (of effect E)". It is accepted ONLY when it is SIGNED by a key the ACTIVE policy pins for the
// `delivery_verifier` identity (the trusted reader; it reads the remote with its own read access, outside the controller), under a signing domain that differs from evidence
// (an observation can never be replayed as evidence or vice versa), and only while it is fresh. A caller-supplied object with `authoritative: true` is NOT an observation: the
// ledger's reconcileIntent accepts only objects returned by verifyRemoteObservation (a module-private brand). This module VERIFIES; it has no signing code.
//
// What an observation can NOT do: prove absence by itself. One `absent` read may be stale (eventual consistency, a listing lag). absenceProven() requires several DISTINCT reads,
// all made after the dispatch plus a settle window and spread apart, with no `present` ever seen. Until then an uncertain intent stays uncertain and nothing may be retried.
import { createPublicKey, verify } from 'node:crypto'
import { canonicalize, checkShape, digestOf, isPlainObject, v } from '../../lib/canonical.mjs'

export const OBSERVATION_SCHEMA = 'patelrep.developer-harness-v3.remote-observation'
export const OBSERVATION_DOMAIN = 'patelrep-developer-harness-v3-remote-observation\n'
export const READER_IDENTITY = 'delivery_verifier'
export const OBSERVATION_DEFAULTS = Object.freeze({ maxAgeMs: 10 * 60_000, skewMs: 60_000 })
/** The rule an `absent` conclusion must satisfy (persisted reads in remote_observations). */
export const ABSENCE_RULE = Object.freeze({ minReads: 2, settleMs: 60_000, gapMs: 30_000 })

const STATES = ['present', 'absent', 'conflict', 'rejected']
const SUBJECT = (x) => typeof x === 'string' && /^[a-z_]{2,40}:[A-Za-z0-9._:/#@+-]{1,200}$/.test(x)
const detailOk = (d) => { try { return isPlainObject(d) && Buffer.byteLength(canonicalize(d)) <= 32768 } catch { return false } }
const PAYLOAD_SPEC = {
  required: { observation_id: v.id, reader_identity: v.oneOf(READER_IDENTITY), repository: v.repo, task_id: v.id, subject: SUBJECT, state: v.oneOf(...STATES),
    observed_at: (x) => Number.isSafeInteger(x) && x > 0, read_id: v.id, policy_revision: v.sha64 },
  optional: { intent_id: v.id, params_digest: v.sha64, candidate_sha: v.sha40, remote_version: (x) => typeof x === 'string' && x.length <= 80, details: detailOk },
}
const ENVELOPE_SPEC = { required: { schema: v.oneOf(OBSERVATION_SCHEMA), version: v.oneOf(1), payload: isPlainObject,
  signature: (s) => isPlainObject(s) && s.alg === 'ed25519' && v.id(s.key_id) && typeof s.value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(s.value) && Object.keys(s).length === 3 } }

export const observationMessage = (payload) => Buffer.from(`${OBSERVATION_DOMAIN}${canonicalize(payload)}`, 'utf8')

const VERIFIED = new WeakSet()
/** True only for objects produced by verifyRemoteObservation in THIS process. */
export const isVerifiedObservation = (o) => typeof o === 'object' && o !== null && VERIFIED.has(o)

/**
 * @param {object} envelopeIn untrusted
 * @param {{policy:object, now:number, expect?:{repository?:string, task_id?:string, intent_id?:string|null, subject?:string, params_digest?:string, candidate_sha?:string|null}, maxAgeMs?:number}} ctx
 * @returns {{ok:true, observation:object, digest:string}|{ok:false, problems:string[]}}
 */
export function verifyRemoteObservation(envelopeIn, { policy, now, expect = {}, maxAgeMs = OBSERVATION_DEFAULTS.maxAgeMs }) {
  try {
    const env = structuredClone(envelopeIn) // read once
    if (checkShape(env, ENVELOPE_SPEC, 'observation').length) return { ok: false, problems: ['OBSERVATION.MALFORMED'] }
    if (Buffer.from(env.signature.value, 'base64').toString('base64') !== env.signature.value) return { ok: false, problems: ['OBSERVATION.MALFORMED'] }
    if (checkShape(env.payload, PAYLOAD_SPEC, 'payload').length) return { ok: false, problems: ['OBSERVATION.MALFORMED'] }
    const p = env.payload; const problems = []
    const key = policy?.trusted_keys && Object.hasOwn(policy.trusted_keys, env.signature.key_id) ? policy.trusted_keys[env.signature.key_id] : null
    if (!key) problems.push('OBSERVATION.UNKNOWN_KEY')
    else {
      if (key.identity !== READER_IDENTITY) problems.push('OBSERVATION.KEY_NOT_A_READER')
      if (now < Date.parse(key.not_before) || now >= Date.parse(key.not_after) || p.observed_at < Date.parse(key.not_before) || p.observed_at >= Date.parse(key.not_after)) problems.push('OBSERVATION.KEY_NOT_VALID')
      let authentic = false
      try { authentic = verify(null, observationMessage(p), createPublicKey({ key: Buffer.from(key.public_key, 'base64'), format: 'der', type: 'spki' }), Buffer.from(env.signature.value, 'base64')) } catch { authentic = false }
      if (!authentic) problems.push('OBSERVATION.BAD_SIGNATURE')
    }
    if (p.policy_revision !== policy?.revision) problems.push('OBSERVATION.WRONG_POLICY_REVISION')
    if (p.observed_at > now + OBSERVATION_DEFAULTS.skewMs) problems.push('OBSERVATION.FROM_THE_FUTURE')
    if (now - p.observed_at > maxAgeMs) problems.push('OBSERVATION.STALE')
    for (const k of ['repository', 'task_id', 'intent_id', 'subject', 'params_digest', 'candidate_sha']) {
      if (!Object.hasOwn(expect, k)) continue
      if ((p[k] ?? null) !== (expect[k] ?? null)) problems.push(`OBSERVATION.WRONG_${k.toUpperCase()}`)
    }
    if (problems.length) return { ok: false, problems: [...new Set(problems)] }
    const observation = Object.freeze({ ...p, details: Object.freeze(structuredClone(p.details ?? {})), key_id: env.signature.key_id })
    VERIFIED.add(observation)
    return { ok: true, observation, digest: digestOf(p) }
  } catch { return { ok: false, problems: ['OBSERVATION.VALIDATION_ERROR'] } }
}

/**
 * Has the ABSENCE of an effect been proven by the recorded authenticated reads? rows: remote_observations of the intent (any order). Present wins forever (an effect that was
 * seen once happened, whatever a later listing says); a conflict is never absence.
 * @returns {{proven:boolean, code:string}}
 */
export function absenceProven(rows, dispatchedAt, rule = ABSENCE_RULE) {
  if (rows.some((r) => r.state === 'present')) return { proven: false, code: 'OBSERVATION.PRESENT_SEEN' }
  if (rows.some((r) => r.state === 'conflict')) return { proven: false, code: 'OBSERVATION.CONFLICT_SEEN' }
  if (!Number.isFinite(dispatchedAt)) return { proven: false, code: 'OBSERVATION.DISPATCH_TIME_UNKNOWN' }
  const absent = rows.filter((r) => r.state === 'absent' && r.observed_at >= dispatchedAt + rule.settleMs)
  const reads = new Map(); for (const r of absent) if (!reads.has(r.read_id)) reads.set(r.read_id, r.observed_at)
  if (reads.size < rule.minReads) return { proven: false, code: 'OBSERVATION.ABSENCE_NOT_YET_PROVEN' }
  const times = [...reads.values()].sort((a, b) => a - b)
  if (times.at(-1) - times[0] < rule.gapMs) return { proven: false, code: 'OBSERVATION.ABSENCE_READS_TOO_CLOSE' }
  return { proven: true, code: 'OBSERVATION.ABSENCE_PROVEN' }
}
