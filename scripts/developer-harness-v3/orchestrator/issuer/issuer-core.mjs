// Developer Harness V3 (D3.4) — trusted issuer (ONE identity per instance, ONE key per instance). Runs in its own process (issuer-main.mjs).
//
// There is deliberately NO "sign this payload" operation. Each operation takes IDENTIFIERS (a task, a run, a review), and the issuer derives every signed fact
// itself: from a READ-ONLY handle on the controller's ledger, from its own pinned policy, and from an independently-derived candidate (`facts.candidate`).
// A request that disagrees with those facts is refused. The verdict of a reviewer is computed here from its structured findings, never copied from the
// reviewer's own claim (AI reviewer output is advisory input to a trusted verifier).
//
// Replay protection: every subject is issued AT MOST ONCE (durable `issued` table, UNIQUE subject_key); asking again returns the same envelope. The
// controller's ledger independently accepts each nonce once and consumes single-use evidence atomically (ledger/evidence-store.mjs).
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, sign as edSign, verify as edVerify, createPublicKey } from 'node:crypto'
import { signingMessage } from '../../authority/evidence.mjs'
import { loadSigningKey } from './key-custody.mjs'
import { verifyActualModel } from '../routing.mjs'

export const OPS = Object.freeze({
  orchestrator: Object.freeze(['issue_test_results']),
  independent_reviewer: Object.freeze(['issue_review']),
  security_reviewer: Object.freeze(['issue_review']),
  delivery_verifier: Object.freeze(['issue_isolation_attestation']),
})
const REVIEW_KIND = { independent_reviewer: 'independent_review', security_reviewer: 'security_review' }
const REVIEW_FAMILY = { independent_review: 'sonnet', security_review: 'opus' } // the routing table's mandatory models for each review kind
const TTL_MS = { test_results: 6 * 3600_000, independent_review: 4 * 3600_000, security_review: 4 * 3600_000, isolation_attestation: 3600_000 }
const refuse = (code, ...more) => ({ ok: false, code, more })
const idOf = (x) => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(x)
const h = (s) => createHash('sha256').update(s).digest('hex')

export class IssuerCore {
  /**
   * @param {{identity:string, keyId:string, keyDir:string, ledger:object, policy:object, facts:object, clock?:()=>number, storeFile:string}} o
   *   `ledger` MUST be a read-only handle (Ledger.openReadOnly). `policy` is the loaded, pinned policy supplied from OUTSIDE the candidate environment.
   */
  constructor({ identity, keyId, keyDir, ledger, policy, facts, clock = Date.now, storeFile }) {
    if (!OPS[identity]) throw new Error('ISSUER.IDENTITY_HAS_NO_OPERATIONS')
    Object.assign(this, { identity, keyId, keyDir, ledger, policy, facts, clock })
    this.store = new DatabaseSync(storeFile)
    this.store.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS issued (subject_key TEXT PRIMARY KEY, evidence_id TEXT NOT NULL, envelope_json TEXT NOT NULL, issued_at INTEGER NOT NULL) STRICT')
  }
  close() { this.store.close() }

  handle(op, params) {
    if (op === 'status') return { ok: true, identity: this.identity, key_id: this.keyId, operations: OPS[this.identity], policy_revision: this.policy.revision }
    if (!OPS[this.identity].includes(op)) return refuse('ISSUER.OPERATION_NOT_PERMITTED_FOR_IDENTITY')
    try {
      if (op === 'issue_test_results') return this.issueTestResults(params)
      if (op === 'issue_review') return this.issueReview(params)
      if (op === 'issue_isolation_attestation') return this.issueIsolationAttestation(params)
    } catch (e) { return refuse('ISSUER.INTERNAL_ERROR', String(e.message).slice(0, 80)) }
    return refuse('ISSUER.UNKNOWN_OPERATION')
  }

  #preflight(taskId) {
    if (!idOf(taskId)) return refuse('ISSUER.BAD_REQUEST')
    const t = this.ledger.getTask(taskId)
    if (!t) return refuse('ISSUER.UNKNOWN_TASK')
    if (t.cancelled) return refuse('ISSUER.TASK_CANCELLED')
    if (!t.policy_revision || t.policy_revision !== this.policy.revision) return refuse('ISSUER.POLICY_REVISION_MISMATCH')
    if (!t.environment_id) return refuse('ISSUER.NO_ENVIRONMENT')
    const key = this.policy.trusted_keys[this.keyId]
    const now = this.clock()
    if (!key || key.identity !== this.identity || now < Date.parse(key.not_before) || now >= Date.parse(key.not_after)) return refuse('ISSUER.KEY_NOT_REGISTERED_OR_NOT_VALID')
    const c = this.ledger.currentCandidate(taskId)
    if (!c || c.candidate_sha !== t.head_sha) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    return { ok: true, t, c }
  }

  #independentCandidate(t, c) {
    const f = this.facts.candidate({ repository: t.repository, base_sha: t.base_sha, candidate_sha: c.candidate_sha })
    if (!f?.ok || f.candidate_sha !== c.candidate_sha || f.tree_digest !== c.tree_digest || f.patch_digest !== c.patch_digest) return refuse('ISSUER.CANDIDATE_FACTS_DISAGREE')
    return { ok: true }
  }

  #emit(type, subjectKey, payloadFields, t) {
    const prior = this.store.prepare('SELECT envelope_json FROM issued WHERE subject_key=?').get(subjectKey)
    if (prior) return { ok: true, duplicate: true, envelope: JSON.parse(prior.envelope_json) }
    const k = loadSigningKey(this.keyDir, this.keyId) // checked on EVERY issuance: emergency deactivation takes effect immediately
    if (!k.ok) return refuse(k.code)
    const now = this.clock(); const max = this.policy.contract.evidence_types[type].max_ttl_seconds * 1000
    const ttl = Math.min(TTL_MS[type], max)
    const stamp = h(subjectKey)
    const payload = { evidence_id: `ev-${type}-${stamp.slice(0, 24)}`, evidence_type: type, issuer_identity: this.identity, task_id: t.task_id, repository: t.repository, policy_revision: this.policy.revision,
      issued_at: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'), expires_at: new Date(now + ttl).toISOString().replace(/\.\d{3}Z$/, 'Z'), nonce: `n-${randomBytes(16).toString('hex')}`, idempotency_id: `i-${stamp.slice(0, 32)}`,
      fencing_token: t.fencing_token, ...payloadFields }
    const value = edSign(null, signingMessage(payload), k.key).toString('base64')
    const envelope = { schema: 'patelrep.developer-harness-v3.evidence', version: 1, payload, signature: { alg: 'ed25519', key_id: this.keyId, value } }
    // self-check against the PUBLIC key the policy pins: a mis-wired key can never leave this process as "evidence"
    const pub = createPublicKey({ key: Buffer.from(this.policy.trusted_keys[this.keyId].public_key, 'base64'), format: 'der', type: 'spki' })
    if (!edVerify(null, signingMessage(payload), pub, Buffer.from(value, 'base64'))) return refuse('ISSUER.KEY_DOES_NOT_MATCH_POLICY')
    this.store.prepare('INSERT INTO issued(subject_key,evidence_id,envelope_json,issued_at) VALUES (?,?,?,?)').run(subjectKey, payload.evidence_id, JSON.stringify(envelope), now)
    return { ok: true, duplicate: false, envelope }
  }

  issueTestResults({ task_id, run_id }) {
    const pf = this.#preflight(task_id); if (!pf.ok) return pf
    const { t, c } = pf
    if (!idOf(run_id)) return refuse('ISSUER.BAD_REQUEST')
    // `testing` for the first issuance; later states only to RE-ATTEST the same run for the same candidate under a newer recovery epoch (see below)
    if (!['testing', 'independent_review', 'security_review', 'publishing'].includes(t.lifecycle.state)) return refuse('ISSUER.TASK_NOT_IN_TESTING')
    const run = this.ledger.db.prepare('SELECT * FROM test_runs WHERE run_id=? AND task_id=?').get(run_id, task_id)
    if (!run) return refuse('ISSUER.UNKNOWN_RUN')
    if (run.candidate_sha !== c.candidate_sha || run.tree_digest !== c.tree_digest) return refuse('ISSUER.RUN_FOR_ANOTHER_CANDIDATE')
    // A run from the CURRENT or an EARLIER recovery epoch may be (re-)attested for the unchanged candidate; one from a FUTURE epoch cannot exist.
    if (run.fencing_token > t.fencing_token) return refuse('ISSUER.STALE_FENCING_TOKEN')
    if (run.passed !== 1 && t.lifecycle.state !== 'testing') return refuse('ISSUER.NOT_A_PASSING_RUN')
    const ic = this.#independentCandidate(t, c); if (!ic.ok) return ic
    const results = JSON.parse(run.results_json)
    const clean = Object.fromEntries(Object.entries(results).filter(([, n]) => Number.isSafeInteger(n) && n >= 0).slice(0, 20))
    const pass = run.passed === 1 && (clean.failed ?? 0) === 0 && (clean.passed ?? 0) > 0
    return this.#emit('test_results', `test_results:${task_id}:${run_id}:${c.candidate_sha}:e${t.fencing_token}`, { base_sha: t.base_sha, candidate_sha: c.candidate_sha, tree_digest: c.tree_digest, patch_digest: c.patch_digest,
      environment_id: t.environment_id, results: clean, verdict: pass ? 'pass' : 'fail' }, t)
  }

  issueReview({ task_id, review_id }) {
    const kind = REVIEW_KIND[this.identity]
    const pf = this.#preflight(task_id); if (!pf.ok) return pf
    const { t, c } = pf
    if (!idOf(review_id)) return refuse('ISSUER.BAD_REQUEST')
    const r = this.ledger.getReview(review_id)
    if (!r || r.task_id !== task_id) return refuse('ISSUER.UNKNOWN_REVIEW')
    if (r.kind !== kind) return refuse('ISSUER.REVIEW_KIND_MISMATCH')
    if (r.status !== 'submitted' && r.status !== 'verified_pass') return refuse('ISSUER.REVIEW_NOT_SUBMITTED') // verified_pass only for re-attestation
    if (r.candidate_sha !== c.candidate_sha || r.tree_digest !== c.tree_digest) return refuse('ISSUER.REVIEW_FOR_ANOTHER_CANDIDATE')
    if (r.policy_revision !== this.policy.revision || r.environment_id !== t.environment_id) return refuse('ISSUER.REVIEW_BINDING_MISMATCH')
    // Epoch rule (same as test results): a review made in an earlier recovery epoch for the SAME candidate may be re-attested under the current one.
    // Every other check below still applies in full, and a review row from a future epoch cannot exist.
    if (r.fencing_token > t.fencing_token) return refuse('ISSUER.STALE_FENCING_TOKEN')
    if (r.readonly_verified !== 1 || r.post_tree_digest !== r.tree_digest) return refuse('ISSUER.READONLY_NOT_VERIFIED')
    const ex = this.ledger.getExecution(r.execution_id)
    if (!ex || ex.status !== 'terminated_verified' || ex.context_id !== r.context_id) return refuse('ISSUER.REVIEW_SESSION_NOT_VERIFIED_STOPPED')
    if (ex.role !== (kind === 'independent_review' ? 'independent_reviewer' : 'security_reviewer')) return refuse('ISSUER.WRONG_REVIEWER_ROLE')
    const mv = verifyActualModel({ requested: REVIEW_FAMILY[kind], actual: ex.model_actual, mandatory: true })
    if (ex.model_requested !== REVIEW_FAMILY[kind] || !mv.ok) return refuse('ISSUER.MANDATORY_REVIEW_MODEL_NOT_SATISFIED', mv.code ?? 'ROUTE.WRONG_REQUESTED_MODEL')
    // independence: computed here from the ledger, never taken from the reviewer
    const others = this.ledger.db.prepare('SELECT context_id, role FROM executions WHERE task_id=? AND execution_id<>?').all(task_id, r.execution_id)
    if (others.some((o) => o.context_id === r.context_id)) return refuse('ISSUER.CONTEXT_NOT_INDEPENDENT')
    const sibling = this.ledger.db.prepare("SELECT 1 FROM reviews WHERE task_id=? AND context_id=? AND review_id<>?").get(task_id, r.context_id, review_id)
    if (sibling) return refuse('ISSUER.REVIEW_CONTEXT_REUSED')
    const ic = this.#independentCandidate(t, c); if (!ic.ok) return ic
    const rows = this.ledger.db.prepare('SELECT * FROM findings WHERE review_id=?').all(review_id)
    // mandatory findings from EARLIER rounds stay blocking until an independent reviewer confirmed them (status 'confirmed'); the implementer cannot clear them by editing
    const carried = this.ledger.db.prepare("SELECT * FROM findings WHERE task_id=? AND mandatory=1 AND status='carried' AND review_id<>? AND review_id IN (SELECT review_id FROM reviews WHERE kind=?)").all(task_id, review_id, kind)
    // critical/high are ALWAYS blocking regardless of the reviewer's `mandatory` flag; a reviewer can add blockers but never remove them
    const blocking = rows.filter((f) => (f.mandatory === 1 || f.severity === 'critical' || f.severity === 'high') && f.status === 'open').concat(carried)
    const seen = new Set(rows.map((f) => f.finding_id))
    const findings = [...rows.map((f) => ({ id: f.finding_id, severity: f.severity, resolved: f.status !== 'open' })), ...carried.filter((f) => !seen.has(f.finding_id)).map((f) => ({ id: f.finding_id, severity: f.severity, resolved: false }))]
    return this.#emit(kind, `${kind}:${review_id}:${c.candidate_sha}:e${t.fencing_token}`, { base_sha: t.base_sha, candidate_sha: c.candidate_sha, tree_digest: c.tree_digest, patch_digest: c.patch_digest, context_id: r.context_id,
      findings, verdict: blocking.length ? 'findings_open' : 'pass' }, t)
  }

  issueIsolationAttestation({ task_id, environment_id }) {
    const pf = this.#preflight(task_id); if (!pf.ok) return pf
    const { t } = pf
    if (!idOf(environment_id) || environment_id !== t.environment_id) return refuse('ISSUER.ENVIRONMENT_MISMATCH')
    const iso = this.facts.isolation(environment_id)
    // Every condition below is independently required; the D3.3 probe-VM PASS alone satisfies NONE of the last four (see docs 15/17, gates G-*).
    const need = { suite_passed_all_scenarios: iso?.suite_passed_all_scenarios === true, acceptance_current_for_closure_and_image: iso?.current === true,
      full_size_worker_admitted: iso?.full_size_worker_admitted === true, worker_runs_as_dedicated_account: iso?.dedicated_worker_account === true,
      qemu_outbound_firewall_rule: iso?.qemu_firewall_rule === true, environment_id_matches: iso?.environment_id === environment_id, acceptance_digest_present: /^[0-9a-f]{64}$/.test(iso?.acceptance_digest ?? '') }
    const failed = Object.entries(need).filter(([, ok]) => !ok).map(([k]) => `ISOLATION.${k}`)
    if (failed.length) return refuse('ISSUER.ISOLATION_PRECONDITIONS_UNMET', ...failed)
    return this.#emit('isolation_attestation', `isolation_attestation:${task_id}:${environment_id}:${iso.acceptance_digest}:e${t.fencing_token}`, { environment_id, verdict: 'pass' }, t)
  }
}
