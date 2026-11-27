// Developer Harness V3 (D3.6-K) — trusted DELIVERY issuers. Same rule as issuer-core.mjs: there is NO "sign this payload" operation. Every operation takes IDENTIFIERS and the issuer
// derives every signed fact itself: from its OWN read of the remote (the `reader`, outside the controller), a READ-ONLY handle on the controller's ledger, its pinned policy and the
// independently derived candidate facts. The controller can ask; it cannot tell an issuer what is true.
//
//   delivery_verifier  observe_intent · observe_delivery · observe_main · ci_failure_details · issue_ci_gate · issue_ci_failure_diagnosis · issue_staging_admission ·
//                      issue_staging_gate · issue_delivery_verification            (the authenticated remote reader + CI/staging/delivery verifier)
//   trusted_publisher  issue_publication_receipt                                 (receipt only from an authenticated read of the pushed ref and PR, never from a model claim)
//   task_ingress       issue_task_authority                                      (SIMULATED owner-task ingress: real ingress needs authenticated owner channels, G-OWNER-ACTION-EVIDENCE)
//
// Residual, recorded under G-ISSUER-INDEPENDENT-FACTS: the issuers still read controller-written ledger rows for TASK facts (candidate record, delivery branch, the intent's recorded
// parameters). REMOTE facts — what GitHub shows — come only from the reader. In this phase the reader is the simulator; a live reader with its own read-only credential, running as
// its own OS account (G-ISSUER-ACCOUNTS), is an activation prerequisite.
import { DatabaseSync } from 'node:sqlite'
import { createHash, createPublicKey, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto'
import { isSatisfying, signingMessage } from '../../authority/evidence.mjs'
import { canonicalize, digestOf } from '../../lib/canonical.mjs'
import { loadSigningKey } from './key-custody.mjs'
import { OBSERVATION_SCHEMA, observationMessage } from '../delivery/observation.mjs'
import { authorityOf } from '../ledger/evidence-store.mjs'
import { ciState, stagingGate, WORKFLOWS } from '../delivery/required-checks.mjs'
import { diagnose } from '../delivery/diagnostics.mjs'
import { observeEffect } from '../delivery/effect-subjects.mjs'

export const DELIVERY_OPS = Object.freeze({
  delivery_verifier: Object.freeze(['observe_intent', 'observe_delivery', 'observe_main', 'ci_failure_details', 'staging_failure_details', 'issue_ci_gate', 'issue_ci_failure_diagnosis', 'issue_staging_admission', 'issue_staging_gate', 'issue_delivery_verification']),
  trusted_publisher: Object.freeze(['issue_publication_receipt']),
  task_ingress: Object.freeze(['issue_task_authority']),
})
export const PACKAGE_DOMAIN = 'patelrep-developer-harness-v3-delivery-package\n'
export const PUBLISHER_AUTHOR = 'patelrep-v3-publisher[bot]'
const TTL_MS = { publication_receipt: 6 * 3600_000, ci_gate: 6 * 3600_000, staging_gate: 6 * 3600_000, delivery_verification: 3600_000, task_authority: 24 * 3600_000, ci_failure_diagnosis: 30 * 60_000, staging_admission: 15 * 60_000 }
const refuse = (code, ...more) => ({ ok: false, code, more })
const idOf = (x) => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(x)
const h = (s) => createHash('sha256').update(s).digest('hex')
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export class DeliveryIssuer {
  /** @param {{identity:string, keyId:string, keyDir:string, ledger:object, policy:object, reader:{view:Function, jobLog:Function}, facts:{candidate:Function}, clock?:Function, storeFile:string}} o  `ledger` MUST be read-only. */
  constructor({ identity, keyId, keyDir, ledger, policy, reader, facts, clock = Date.now, storeFile }) {
    if (!DELIVERY_OPS[identity]) throw new Error('ISSUER.IDENTITY_HAS_NO_OPERATIONS')
    Object.assign(this, { identity, keyId, keyDir, ledger, policy, reader, facts, clock })
    this.store = new DatabaseSync(storeFile)
    this.store.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS issued (subject_key TEXT PRIMARY KEY, evidence_id TEXT NOT NULL, envelope_json TEXT NOT NULL, issued_at INTEGER NOT NULL) STRICT')
  }
  close() { this.store.close() }

  async handle(op, params = {}) {
    if (!DELIVERY_OPS[this.identity].includes(op)) return refuse('ISSUER.OPERATION_NOT_PERMITTED_FOR_IDENTITY')
    try { const fn = this[`op_${op}`]; return fn ? await fn.call(this, params) : refuse('ISSUER.UNKNOWN_OPERATION') } catch (e) { return refuse(e?.rate_limited ? 'GITHUB.RATE_LIMITED' : 'ISSUER.INTERNAL_ERROR', String(e?.code ?? e?.message ?? '').slice(0, 60), e?.reset_at ?? null) }
  }

  // ------------------------------------------------------------------ shared derivations
  #key() {
    const key = this.policy.trusted_keys[this.keyId]; const now = this.clock()
    if (!key || key.identity !== this.identity || now < Date.parse(key.not_before) || now >= Date.parse(key.not_after)) return refuse('ISSUER.KEY_NOT_REGISTERED_OR_NOT_VALID')
    const k = loadSigningKey(this.keyDir, this.keyId); if (!k.ok) return refuse(k.code) // checked on EVERY signature: emergency deactivation is immediate
    return { ok: true, key: k.key, pub: createPublicKey({ key: Buffer.from(key.public_key, 'base64'), format: 'der', type: 'spki' }) }
  }
  #task(taskId, { observeOnly = false } = {}) {
    if (!idOf(taskId)) return refuse('ISSUER.BAD_REQUEST')
    const t = this.ledger.getTask(taskId); if (!t) return refuse('ISSUER.UNKNOWN_TASK')
    if (t.cancelled && !observeOnly) return refuse('ISSUER.TASK_CANCELLED') // evidence is never issued for a cancelled task; a READ-ONLY observation still is (it proves what is left running)
    if (t.policy_revision !== this.policy.revision) return refuse('ISSUER.POLICY_REVISION_MISMATCH')
    const c = this.ledger.currentCandidate(taskId); const d = this.ledger.delivery(taskId)
    return { ok: true, t, c: c && c.candidate_sha === t.head_sha ? c : null, d, base: this.ledger.currentBase(taskId) }
  }
  #candidateAgrees(t, c, base) {
    const f = this.facts.candidate({ repository: t.repository, base_sha: base, candidate_sha: c.candidate_sha })
    return !!f?.ok && f.candidate_sha === c.candidate_sha && f.tree_digest === c.tree_digest && f.patch_digest === c.patch_digest
  }
  #sign(message) { const k = this.#key(); if (!k.ok) return k; const value = edSign(null, message, k.key).toString('base64'); if (!edVerify(null, message, k.pub, Buffer.from(value, 'base64'))) return refuse('ISSUER.KEY_DOES_NOT_MATCH_POLICY'); return { ok: true, value } }
  /** A signed observation (verifier only). */
  #observation(fields) {
    const payload = { observation_id: `obs-${randomBytes(12).toString('hex')}`, reader_identity: 'delivery_verifier', repository: fields.repository, task_id: fields.task_id, subject: fields.subject, state: fields.state,
      observed_at: this.clock(), read_id: `read-${randomBytes(8).toString('hex')}`, policy_revision: this.policy.revision,
      ...(fields.intent_id ? { intent_id: fields.intent_id } : {}), ...(fields.params_digest ? { params_digest: fields.params_digest } : {}), ...(fields.candidate_sha ? { candidate_sha: fields.candidate_sha } : {}),
      ...(fields.remote_version != null ? { remote_version: String(fields.remote_version).slice(0, 80) } : {}), details: fields.details ?? {} }
    const s = this.#sign(observationMessage(payload)); if (!s.ok) return s
    return { ok: true, envelope: { schema: OBSERVATION_SCHEMA, version: 1, payload, signature: { alg: 'ed25519', key_id: this.keyId, value: s.value } } }
  }
  /** Evidence, at most once per subject while live (an expired one is re-issued under a successor subject; the controller accepts each nonce once). */
  #emit(type, subjectKey, t, fields) {
    if (!Object.hasOwn(this.policy.contract.evidence_types, type)) return refuse('ISSUER.EVIDENCE_TYPE_NOT_IN_POLICY')
    if (!this.policy.contract.evidence_types[type].issuers.includes(this.identity)) return refuse('ISSUER.NOT_AN_ISSUER_OF_TYPE')
    let key = subjectKey
    for (let i = 0; ; i += 1) {
      if (i >= 8) return refuse('ISSUER.SUCCESSOR_BUDGET_EXHAUSTED') // bounded: the controller turns this into a technical suspension
      key = i === 0 ? subjectKey : `${subjectKey}#r${i}`
      const prior = this.store.prepare('SELECT envelope_json FROM issued WHERE subject_key=?').get(key); if (!prior) break
      const env = JSON.parse(prior.envelope_json)
      // F1 remediation (review M1): an unexpired envelope the controller's ledger has INVALIDATED (a withdrawn result) is never served again — recovery issues a SUCCESSOR subject from THIS read; an envelope the ledger has not seen, or still holds, is the same duplicate as before
      const inv = this.ledger.db.prepare('SELECT invalidated_at FROM evidence WHERE evidence_id=?').get(env.payload.evidence_id)
      if (Date.parse(env.payload.expires_at) > this.clock() && (!inv || inv.invalidated_at === null)) return { ok: true, duplicate: true, envelope: env }
    }
    const now = this.clock(); const ttl = Math.min(TTL_MS[type] ?? 3600_000, this.policy.contract.evidence_types[type].max_ttl_seconds * 1000); const stamp = h(key)
    const payload = { evidence_id: `ev-${type}-${stamp.slice(0, 24)}`, evidence_type: type, issuer_identity: this.identity, task_id: t.task_id, repository: t.repository, policy_revision: this.policy.revision,
      issued_at: iso(now), expires_at: iso(now + ttl), nonce: `n-${randomBytes(16).toString('hex')}`, idempotency_id: fields.idempotency_id ?? `i-${stamp.slice(0, 32)}`, fencing_token: t.fencing_token, verdict: 'pass', ...fields }
    const s = this.#sign(signingMessage(payload)); if (!s.ok) return s
    const envelope = { schema: 'patelrep.developer-harness-v3.evidence', version: 1, payload, signature: { alg: 'ed25519', key_id: this.keyId, value: s.value } }
    this.store.prepare('INSERT INTO issued(subject_key,evidence_id,envelope_json,issued_at) VALUES (?,?,?,?)').run(key, payload.evidence_id, JSON.stringify(envelope), now)
    return { ok: true, duplicate: false, envelope }
  }
  #binds(x) { return { base_sha: x.base, candidate_sha: x.c.candidate_sha, tree_digest: x.c.tree_digest, patch_digest: x.c.patch_digest } }
  /** The remote facts of the task's delivery, from ONE read. */
  #remote(x) {
    const view = this.reader.view(); const branch = x.d?.branch ?? null
    const prs = branch ? view.prs.filter((p) => p.head_ref === branch && p.state === 'open') : []
    const pr = x.d?.pr_number ? view.prs.find((p) => p.number === x.d.pr_number) ?? null : prs[0] ?? null
    return { view, branch, ref: branch ? view.refs[branch] ?? null : null, pr, open_prs_for_branch: prs.length, main: view.main }
  }
  #ownedPr(x, r) { return !!r.pr && r.pr.state === 'open' && r.pr.head_ref === r.branch && r.pr.base_ref === 'main' && r.pr.author === PUBLISHER_AUTHOR && r.open_prs_for_branch === 1 && (x.d?.pr_number == null || r.pr.number === x.d.pr_number) }

  // ------------------------------------------------------------------ delivery_verifier: observations
  op_observe_main() { const v = this.reader.view(); return this.#observation({ repository: v.repository, task_id: 'repository', subject: 'ref:main', state: 'present', remote_version: v.main, details: { sha: v.main } }) }
  op_observe_intent({ intent_id }) {
    if (!idOf(intent_id)) return refuse('ISSUER.BAD_REQUEST')
    const i = this.ledger.db.prepare('SELECT * FROM action_intents WHERE intent_id=?').get(intent_id); if (!i || !i.params_json) return refuse('ISSUER.UNKNOWN_INTENT')
    let pd = null; try { pd = digestOf(JSON.parse(i.params_json)) } catch { pd = null }
    if (pd !== i.params_digest) return refuse('ISSUER.INTENT_PARAMS_INCONSISTENT') // security review OPT-6: the reader never signs a digest it did not recompute
    const t = this.ledger.getTask(i.task_id); const view = this.reader.view()
    const o = observeEffect(i.action, JSON.parse(i.params_json), view, { dispatchedAt: i.dispatched_at })
    return this.#observation({ repository: t.repository, task_id: i.task_id, intent_id, params_digest: i.params_digest, candidate_sha: i.candidate_sha, ...o })
  }
  op_observe_delivery({ task_id }) {
    const x = this.#task(task_id, { observeOnly: true }); if (!x.ok) return x
    const r = this.#remote(x); const head = x.c?.candidate_sha ?? null
    const ci = head && r.branch ? ciState(r.view, { head_sha: head, head_branch: r.branch, pr_number: r.pr?.number }) : null
    const staging = head ? stagingGate(r.view, { head_sha: head, pr_number: r.pr?.number }) : null // the SAME function the issuance and the final verification use (F1)
    const stagingRuns = r.view.runs.filter((y) => y.workflow === WORKFLOWS.staging && (y.pr_number === r.pr?.number || y.head_sha === head)).map((y) => ({ id: y.id, head_sha: y.head_sha, status: y.status, conclusion: y.conclusion, event: y.event, created_at: y.created_at, displaced: !!y.displaced, ineligible: !!y.ineligible }))
    const stagingBusy = r.view.runs.some((y) => y.workflow === WORKFLOWS.staging && ['pending', 'in_progress'].includes(y.status))
    return this.#observation({ repository: x.t.repository, task_id, subject: `delivery:${task_id}`, state: 'present', candidate_sha: head ?? undefined, remote_version: r.ref ?? 'none',
      details: { branch: r.branch, ref: r.ref, main: r.main, pr: r.pr ? { number: r.pr.number, head_sha: r.pr.head_sha, base: r.pr.base_ref, draft: r.pr.draft, author: r.pr.author, state: r.pr.state, title: r.pr.title, body_digest: r.pr.body_digest } : null,
        owned_pr: this.#ownedPr(x, r), open_prs_for_branch: r.open_prs_for_branch, ci, staging, staging_runs: stagingRuns.slice(-10), staging_busy: stagingBusy } })
  }
  /** Bounded, REDACTED diagnoses of the failed required checks of the exact head (the controller never sees a raw log). */
  op_ci_failure_details({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    const r = this.#remote(x); const ci = ciState(r.view, { head_sha: x.c.candidate_sha, head_branch: r.branch, pr_number: r.pr?.number })
    const failed = ci.checks.filter((c) => ['failed', 'cancelled'].includes(c.state))
    const results = failed.slice(0, 4).map((c) => { const d = diagnose({ source: 'ci', job: c.name, log: c.state === 'cancelled' ? 'The run was cancelled: runner is offline' : this.reader.jobLog(c.run_id, c.attempt) ?? '' }); return { job: c.name, run_id: c.run_id, attempt: c.attempt, ...d, excerpt: d.excerpt.slice(0, 6000) } })
    return this.#observation({ repository: x.t.repository, task_id, subject: `ci_failure:${task_id}`, state: 'present', candidate_sha: x.c.candidate_sha, details: { results } })
  }

  /** The latest failed staging run of the exact head, diagnosed from its bounded, REDACTED log. */
  op_staging_failure_details({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    const r = this.#remote(x)
    const run = r.view.runs.filter((y) => y.workflow === WORKFLOWS.staging && y.head_sha === x.c.candidate_sha && y.pr_number === r.pr?.number && y.status === 'completed' && y.conclusion === 'failure').sort((a, b) => b.id - a.id)[0]
    if (!run) return refuse('ISSUER.NO_FAILED_STAGING_RUN')
    const d = diagnose({ source: 'staging', job: 'Staging Candidate', log: this.reader.jobLog(run.id, run.attempt) ?? '' })
    return this.#observation({ repository: x.t.repository, task_id, subject: `staging_failure:${task_id}`, state: 'present', candidate_sha: x.c.candidate_sha, details: { result: { job: 'Staging Candidate', run_id: run.id, attempt: run.attempt, ...d, excerpt: d.excerpt.slice(0, 6000) } } })
  }

  // ------------------------------------------------------------------ delivery_verifier: evidence
  op_issue_ci_gate({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    if (!this.#candidateAgrees(x.t, x.c, x.base)) return refuse('ISSUER.CANDIDATE_FACTS_DISAGREE')
    const r = this.#remote(x)
    if (!this.#ownedPr(x, r) || r.pr.head_sha !== x.c.candidate_sha || r.ref !== x.c.candidate_sha) return refuse('ISSUER.PR_HEAD_NOT_CANDIDATE')
    const ci = ciState(r.view, { head_sha: x.c.candidate_sha, head_branch: r.branch, pr_number: r.pr?.number })
    if (ci.overall !== 'success') return refuse('ISSUER.CI_NOT_SUCCESSFUL', ci.overall)
    return this.#emit('ci_gate', `ci_gate:${task_id}:${x.c.candidate_sha}:${ci.checks.map((c) => `${c.run_id}.${c.run_attempt}.${c.attempt}`).join(',')}:e${x.t.fencing_token}`, x.t, this.#binds(x))
  }
  op_issue_ci_failure_diagnosis({ task_id, run_id, attempt }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    const r = this.#remote(x); const ci = ciState(r.view, { head_sha: x.c.candidate_sha, head_branch: r.branch, pr_number: r.pr?.number })
    const c = ci.checks.find((y) => y.run_id === run_id && y.attempt === attempt && ['failed', 'cancelled'].includes(y.state)); if (!c) return refuse('ISSUER.NO_SUCH_FAILED_ATTEMPT')
    const d = diagnose({ source: 'ci', job: c.name, log: c.state === 'cancelled' ? 'The run was cancelled: runner is offline' : this.reader.jobLog(run_id, attempt) ?? '' })
    if (d.classification !== 'transient') return refuse('ISSUER.NOT_TRANSIENT', d.classification) // only an infrastructure failure authorizes a re-run; a code defect never does
    return this.#emit('ci_failure_diagnosis', `ci_diag:${task_id}:${x.c.candidate_sha}:${run_id}:${attempt}`, x.t, { ...this.#binds(x), idempotency_id: `i-diag-${run_id}-${attempt}-${d.fingerprint.slice(0, 16)}` })
  }
  op_issue_staging_admission({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    const owner = this.ledger.db.prepare("SELECT * FROM staging_reservations WHERE kind='shared_staging' AND state IN ('held','unresolved')").get()
    if (!owner || owner.task_id !== task_id || owner.state !== 'held' || owner.candidate_sha !== x.c.candidate_sha) return refuse('ISSUER.STAGING_NOT_RESERVED_FOR_CANDIDATE')
    const r = this.#remote(x)
    if (r.view.runs.some((y) => y.workflow === WORKFLOWS.staging && y.pr_number === r.pr?.number && ['pending', 'in_progress'].includes(y.status))) return refuse('ISSUER.STAGING_RUN_ALREADY_QUEUED') // never displace our own pending run
    return this.#emit('staging_admission', `staging_admission:${task_id}:${x.c.candidate_sha}:${owner.reservation_id}:${this.clock()}`, x.t, this.#binds(x))
  }
  op_issue_staging_gate({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    if (!this.#candidateAgrees(x.t, x.c, x.base)) return refuse('ISSUER.CANDIDATE_FACTS_DISAGREE')
    const r = this.#remote(x)
    // the audited gap (doc 31 §4): the workflow reports Staging Gate without re-checking the PR head; the verifier re-checks it at read time
    if (!this.#ownedPr(x, r) || r.pr.head_sha !== x.c.candidate_sha) return refuse('ISSUER.PR_HEAD_NOT_CANDIDATE')
    const g = stagingGate(r.view, { head_sha: x.c.candidate_sha, pr_number: r.pr.number })
    if (g.state !== 'success') return refuse(g.problem === 'STAGING.PROVENANCE_MISMATCH' ? 'ISSUER.STAGING_PROVENANCE_MISMATCH' : 'ISSUER.STAGING_NOT_SUCCESSFUL', g.state)
    const run = r.view.runs.find((y) => y.id === g.run_id)
    return this.#emit('staging_gate', `staging_gate:${task_id}:${x.c.candidate_sha}:${run.id}.${g.run_attempt}.${g.attempt}:e${x.t.fencing_token}`, x.t, this.#binds(x))
  }
  /** The signed SIMULATED delivery-verification package: every current evidence id + digest bound to the exact candidate and policy, plus the remote facts re-read now. */
  op_issue_delivery_verification({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE')
    if (!this.#candidateAgrees(x.t, x.c, x.base)) return refuse('ISSUER.CANDIDATE_FACTS_DISAGREE')
    const need = ['task_authority', 'test_results', 'independent_review', ...(x.t.lifecycle.security_review_required || x.t.risk_class === 'security_sensitive' ? ['security_review'] : []), 'publication_receipt', 'ci_gate', 'staging_gate']
    const now = this.clock(); const ev = []
    for (const type of need) {
      const rows = this.ledger.db.prepare('SELECT * FROM evidence WHERE task_id=? AND evidence_type=? AND invalidated_at IS NULL AND expires_at>? AND fencing_token=? AND policy_revision=? AND candidate_sha IS ? ORDER BY accepted_at DESC').all(task_id, type, now, x.t.fencing_token, this.policy.revision, type === 'task_authority' ? null : x.c.candidate_sha)
      const good = rows.find((e) => { try { const p = JSON.parse(e.envelope_json).payload; return isSatisfying(p) && (type === 'task_authority' || (p.tree_digest === x.c.tree_digest && p.base_sha === x.base)) } catch { return false } })
      if (!good) return refuse('ISSUER.DELIVERY_EVIDENCE_MISSING', type)
      ev.push({ type, evidence_id: good.evidence_id, digest: good.payload_digest, expires_at: good.expires_at })
    }
    const r = this.#remote(x)
    if (!this.#ownedPr(x, r) || r.pr.head_sha !== x.c.candidate_sha || r.ref !== x.c.candidate_sha) return refuse('ISSUER.PR_HEAD_NOT_CANDIDATE')
    if (r.main !== x.base) return refuse('ISSUER.MAIN_NOT_THE_BASE') // the strict main ruleset: a package is only issued for a candidate that is up to date with main
    const ci = ciState(r.view, { head_sha: x.c.candidate_sha, head_branch: r.branch, pr_number: r.pr?.number }); if (ci.overall !== 'success') return refuse('ISSUER.CI_NOT_SUCCESSFUL', ci.overall)
    const g = stagingGate(r.view, { head_sha: x.c.candidate_sha, pr_number: r.pr.number }); if (g.state !== 'success') return refuse(g.problem === 'STAGING.PROVENANCE_MISMATCH' ? 'ISSUER.STAGING_PROVENANCE_MISMATCH' : 'ISSUER.STAGING_NOT_SUCCESSFUL', g.state) // same provenance rule as the staging-gate issuance (F1)
    const pkg = { schema: 'patelrep.developer-harness-v3.delivery-verification-package', version: 1, simulated: true, task_id, repository: x.t.repository, base_sha: x.base, candidate_sha: x.c.candidate_sha, tree_digest: x.c.tree_digest,
      patch_digest: x.c.patch_digest, policy_revision: this.policy.revision, fencing_token: x.t.fencing_token, pr_number: r.pr.number, branch: r.branch, main_at_verification: r.main, evidence: ev,
      ci: ci.checks.map((c) => ({ name: c.name, run_id: c.run_id, attempt: c.attempt, run_attempt: c.run_attempt })), staging: { run_id: g.run_id, attempt: g.attempt, run_attempt: g.run_attempt }, verified_at: now, merge_authority: 'NONE (D3.6 never merges; D3.7 supplies merge evidence)' }
    const s = this.#sign(Buffer.from(`${PACKAGE_DOMAIN}${canonicalize(pkg)}`, 'utf8')); if (!s.ok) return s
    const digest = digestOf(pkg)
    const e = this.#emit('delivery_verification', `delivery_verification:${task_id}:${x.c.candidate_sha}:${digest}`, x.t, { ...this.#binds(x), idempotency_id: `dvp-${digest.slice(0, 48)}` })
    return e.ok ? { ...e, package: pkg, package_signature: { alg: 'ed25519', key_id: this.keyId, value: s.value }, package_digest: digest } : e
  }

  // ------------------------------------------------------------------ trusted_publisher
  op_issue_publication_receipt({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x; if (!x.c) return refuse('ISSUER.NO_CURRENT_CANDIDATE'); if (!x.d) return refuse('ISSUER.NO_DELIVERY_RECORD')
    if (!this.#candidateAgrees(x.t, x.c, x.base)) return refuse('ISSUER.CANDIDATE_FACTS_DISAGREE')
    const r = this.#remote(x)
    if (r.ref !== x.c.candidate_sha) return refuse('ISSUER.REMOTE_REF_NOT_CANDIDATE') // a receipt is derived from the authenticated remote ref, never from what the publish call returned
    if (r.open_prs_for_branch > 1 || (r.pr && !this.#ownedPr(x, r))) return refuse('ISSUER.PR_NOT_OWNED')
    return this.#emit('publication_receipt', `publication_receipt:${task_id}:${x.c.candidate_sha}:${x.d.branch}:e${x.t.fencing_token}`, x.t, this.#binds(x))
  }

  // ------------------------------------------------------------------ task_ingress (SIMULATED)
  op_issue_task_authority({ task_id }) {
    const x = this.#task(task_id); if (!x.ok) return x
    if (digestOf(x.t.requirements) !== x.t.requirements_digest) return refuse('ISSUER.REQUIREMENTS_TAMPERED')
    return this.#emit('task_authority', `task_authority:${task_id}:${x.base}:e${x.t.fencing_token}`, x.t, { base_sha: x.base, authority_digest: digestOf(authorityOf(x.t)) })
  }
}
