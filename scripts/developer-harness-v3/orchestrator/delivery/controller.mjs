// Developer Harness V3 (D3.6-H) — the deterministic DELIVERY CONTROLLER: publishing -> ci_running -> staging_verification -> merge_eligible. It never merges, never releases,
// never activates anything. No model is used here; a genuine code defect goes back to the implementer through the normal lifecycle (remediation), with a redacted, fenced excerpt.
//
// Every remote effect: trusted param validation -> authorizeIntent (EVALUATOR, consumption only on allow) -> reauthorize (EVALUATOR again, intent layer again) -> the publisher's
// call under a deadline -> success, or UNCERTAIN (any failure) -> authenticated reconciliation (signed observations, absence proven by several reads) -> retry only of a proven-absent
// effect, under re-validated authorization; expired authorization is never reused (a superseding intent with fresh evidence instead).
// Every remote FACT the controller acts on is a verified observation signed by the delivery verifier; every delivery approval is evidence issued by an issuer that re-derived it.
import { evaluate as authoritativeEvaluate } from '../../authority/evaluator.mjs'
import { matchesAny } from '../../lib/paths.mjs'
import { acceptEvidence, satisfyingEvidence, usableEvidence } from '../ledger/evidence-store.mjs'
import { enqueueOutbox, getIntent, markDispatchedAsUncertain, recordFailure, recordOutcome, reconcileIntent } from '../ledger/intents.mjs'
import { budgetExceeded, suspendTechnically, suspensionAllowsRun } from '../suspension.mjs'
import { basisOf, dependencyCurrent, promoteBasis } from '../dependency-basis.mjs'
import { ACTION_IDENTITY, DurableEvidenceView, authorizeIntent, reauthorize, riskRequiredEvidence, trustedFacts } from './authorize.mjs'
import { verifyRemoteObservation } from './observation.mjs'
import { recordDiagnosis, remediationText } from './diagnostics.mjs'
import { acquireStaging, advanceBase, branchFor, ensureDelivery, invalidateStaleMilestones, markStagingUnresolved, nextPoll, pollDue, reach, recordPr, releaseStaging, resolveStaging, schedulePoll, stagingOwner } from './state.mjs'
import { withDeadline } from './watchdog.mjs'
import { PUBLISHER_AUTHOR } from '../issuer/delivery-issuer.mjs'

export const DELIVERY_STATES = Object.freeze(['publishing', 'ci_running', 'staging_verification', 'merge_eligible'])
export const DELIVERY_DEFAULTS = Object.freeze({ pollBaseMs: 60_000, pollMaxMs: 30 * 60_000, networkDeadlineMs: 120_000, ciMissingGraceMs: 30 * 60_000, stagingMissingGraceMs: 15 * 60_000,
  maxCiRerunsPerCandidate: 2, maxStagingRedispatchPerCandidate: 2, maxEffectAttempts: 4, baseUpdatesPerDay: 3, mergeEligibleRecheckMs: 30 * 60_000 })
const API = { publish_candidate_branch: 'push_ref', open_draft_pull_request: 'create_pull', update_pull_request_metadata: 'update_pull', mark_pull_request_ready: 'mark_ready', rerun_ci_jobs: 'rerun_failed_jobs', dispatch_staging_candidate: 'dispatch_staging' }
const codeOf = (e) => String(e?.code ?? e?.status ?? 'ERROR').replace(/[^A-Z0-9_.:-]/gi, '').slice(0, 60)
const P = (action) => ({ progressed: true, action })
const NONE = { progressed: false }

export class DeliveryController {
  /**
   * @param {{engine:object, verifier:object, publisherIssuer:object, ingress:object, publisher:{call:Function}, credential:object, facts:object, evaluateFn?:Function, cfg?:object}} o
   *   `publisher` + `credential`: the trusted publisher's write adapter and its credential. Neither is ever given to the implementer or to a worker.
   */
  constructor({ engine, verifier, publisherIssuer, ingress, publisher, credential, facts, evaluateFn, View = DurableEvidenceView, cfg = {} }) {
    Object.assign(this, { e: engine, verifier, publisherIssuer, ingress, publisher, credential, facts, evaluateFn, View, cfg: { ...DELIVERY_DEFAULTS, ...cfg } })
    this.busy = false; this.started = false
  }
  get L() { return this.e.ledger }
  get policy() { return this.e.policy }
  ctx() { return { ledger: this.L, policy: this.policy, facts: this.evalFacts(), View: this.View, ...(this.evaluateFn ? { evaluateFn: this.evaluateFn } : {}) } }

  // ------------------------------------------------------------------ trusted facts and observations
  async observe(op, params, expect = {}) {
    let r; try { r = await this.verifier.handle(op, params) } catch { r = { ok: false, code: 'VERIFIER.UNAVAILABLE' } }
    if (!r?.ok) return { ok: false, code: r?.code ?? 'VERIFIER.UNAVAILABLE', reset_at: r?.more?.[1] ?? null }
    const v = verifyRemoteObservation(r.envelope, { policy: this.policy, now: this.L.now(), expect })
    return v.ok ? { ok: true, observation: v.observation } : { ok: false, code: v.problems[0] }
  }
  evalFacts() {
    const self = this
    return { ...this.facts,
      async targetTip() { const o = await self.observe('observe_main', {}, { subject: 'ref:main' }); return o.ok ? { ok: true, sha: o.observation.details.sha } : { ok: false, code: o.code } },
      async delivery(t) { const d = self.L.delivery(t.task_id); const runs = self.obsCache?.get(t.task_id)?.details?.ci?.checks?.map((c) => c.run_id).filter(Number.isInteger) ?? []
        return d ? { repository: t.repository, task_branch: d.branch, owned_pr_number: d.pr_number, owned_run_ids: [...new Set(runs)] } : undefined } }
  }
  async observeDelivery(taskId) {
    const o = await this.observe('observe_delivery', { task_id: taskId }, { task_id: taskId, subject: `delivery:${taskId}` })
    if (o.ok) (this.obsCache ??= new Map()).set(taskId, o.observation)
    return o
  }
  async accept(issuer, op, params) {
    let r; try { r = await issuer.handle(op, params) } catch { r = { ok: false, code: 'ISSUER.UNAVAILABLE' } }
    if (!r?.ok) return { ok: false, code: r?.code ?? 'ISSUER.UNAVAILABLE', more: r?.more, reset_at: r?.more?.[1] ?? null }
    const a = acceptEvidence(this.L, r.envelope, { policy: this.policy })
    if (!a.ok) return { ok: false, code: a.problems[0] }
    // an issuer may return the SAME unexpired envelope; if the ledger already invalidated it, it is not usable and is never revived — say so instead of looping on "ok"
    const row = this.L.db.prepare('SELECT invalidated_at, consumed_at FROM evidence WHERE evidence_id=?').get(a.evidence_id)
    if (a.duplicate && row?.invalidated_at !== null) return { ok: false, code: 'EVIDENCE.REISSUE_OF_INVALIDATED' }
    return { ok: true, evidence_id: a.evidence_id, issued: r }
  }
  /** Usable, satisfying evidence of `type` for the CURRENT candidate AND the CURRENT delivery base (after a base update, evidence bound to the old base is not current). */
  have(taskId, type) {
    const head = this.L.getTask(taskId).head_sha; const base = this.L.currentBase(taskId)
    return satisfyingEvidence(this.L, taskId, this.policy, type).filter((r) => (r.candidate_sha === null || r.candidate_sha === head) && (r.envelope.payload.base_sha === undefined || r.envelope.payload.base_sha === base))[0] ?? null
  }

  // ------------------------------------------------------------------ exact effect parameters vs the CURRENT trusted delivery facts
  validator(action) {
    return async (p, t) => {
      const d = this.L.delivery(t.task_id)
      if (!p || p.repository !== t.repository || !d || p.branch !== d.branch || p.branch !== branchFor(t.task_id)) return { ok: false, code: 'DELIVERY.TARGET_NOT_TASK_OWNED' }
      if (t.cancelled) return { ok: false, code: 'TASK.CANCELLED' }
      if (action === 'publish_candidate_branch') {
        if (p.sha !== t.head_sha) return { ok: false, code: 'DELIVERY.HEAD_NOT_CANDIDATE' }
        const o = await this.observeDelivery(t.task_id); if (!o.ok) return { ok: false, code: o.code }
        if ((o.observation.details.ref ?? null) !== (p.expected_old ?? null)) return { ok: false, code: 'DELIVERY.REMOTE_REF_MOVED' } // reconcile a branch discrepancy BEFORE any mutation
        if (p.expected_old && !this.ownShas(t.task_id).includes(p.expected_old)) return { ok: false, code: 'DELIVERY.FOREIGN_HEAD' }
      }
      if (action === 'open_draft_pull_request' && (p.head !== d.branch || p.base !== 'main' || p.head_sha !== t.head_sha || d.pr_number !== null || p.author !== PUBLISHER_AUTHOR)) return { ok: false, code: 'DELIVERY.PR_TARGET_INVALID' }
      if (['update_pull_request_metadata', 'mark_pull_request_ready'].includes(action) && (p.number !== d.pr_number || d.pr_number === null)) return { ok: false, code: 'DELIVERY.PR_NOT_OWNED' }
      if (['rerun_ci_jobs', 'dispatch_staging_candidate'].includes(action)) { const f = await this.observeDelivery(t.task_id); if (!f.ok) return { ok: false, code: f.code } } // review M3: remote-state preconditions from a FRESH read, at creation and again right before dispatch
      if (action === 'rerun_ci_jobs') { const o = this.obsCache?.get(t.task_id); const ours = o?.details?.ci?.checks?.some((c) => c.run_id === p.run_id && c.attempt === p.attempt); if (!ours || p.head_sha !== t.head_sha) return { ok: false, code: 'DELIVERY.RUN_NOT_OWNED' } }
      if (action === 'dispatch_staging_candidate') { const o = this.obsCache?.get(t.task_id); if (p.pr_number !== d.pr_number || p.head_sha !== t.head_sha || o?.details?.staging_busy !== false) return { ok: false, code: 'DELIVERY.STAGING_DISPATCH_UNSAFE' } } // never displace anyone's pending run
      return { ok: true }
    }
  }
  evaluatorParams(action, p) {
    if (!this.policy.contract.actions[action]?.checks?.includes('delivery_target')) return undefined // the authoritative evaluator has no such parameter (proposal P7)
    const x = { repository: p.repository, branch: p.branch }
    for (const k of ['base', 'pr_number', 'run_id', 'attempt', 'head_sha']) if (p[k] !== undefined) x[k] = p[k]
    if (action === 'open_draft_pull_request') x.base = p.base
    if (['update_pull_request_metadata', 'mark_pull_request_ready'].includes(action)) x.pr_number = p.number
    if (action === 'publish_candidate_branch') x.head_sha = p.sha
    return { delivery: x }
  }
  /** Every sha this task itself published (a PR branch may only ever be moved forward from one of these). */
  ownShas(taskId) { return this.L.db.prepare("SELECT params_json FROM action_intents WHERE task_id=? AND action='publish_candidate_branch' AND status IN ('succeeded','reconciled_succeeded')").all(taskId).map((r) => JSON.parse(r.params_json).sha) }

  // ------------------------------------------------------------------ the durable effect protocol
  async effect(taskId, action, key, params) {
    const L = this.L
    const prior = L.db.prepare('SELECT * FROM action_intents WHERE idempotency_key=?').get(key)
    if (prior) return this.resume(prior, params)
    const a = await authorizeIntent(this.ctx(), { taskId, action, idempotencyKey: key, params, evaluatorParams: this.evaluatorParams(action, params), validateParams: this.validator(action) })
    if (!a.ok) return { status: 'refused', code: a.code, decision: a.decision }
    return this.dispatch(a.intent, 'dispatch')
  }
  async resume(i, params) {
    for (let k = 0; i.superseded_by && k < 20; k += 1) i = getIntent(this.L, i.superseded_by) // review M2: always resume the LIVE head of a supersession chain
    params = JSON.parse(i.params_json ?? 'null') ?? params
    if (['succeeded', 'reconciled_succeeded'].includes(i.status)) return { status: 'succeeded', intent_id: i.intent_id }
    if (i.status === 'uncertain') return this.reconcile(i)
    if (i.status === 'dispatched') return { status: 'in_flight', intent_id: i.intent_id } // only after a crash; markDispatchedAsUncertain turns it uncertain at start
    if (i.status === 'intended') return this.dispatch(i, 'dispatch')
    // failed / reconciled_absent: PROVEN absent. Retry under re-validated authorization; if it no longer holds (expired), a NEW intent with fresh evidence supersedes it.
    const n = Number(this.L.meta(`effect_attempts:${i.intent_id}`) ?? 0)
    if (n >= this.cfg.maxEffectAttempts) return { status: 'exhausted', intent_id: i.intent_id, code: 'DELIVERY.EFFECT_ATTEMPTS_EXHAUSTED' }
    this.L.setMeta(`effect_attempts:${i.intent_id}`, n + 1)
    const r = await this.dispatch(i, 'retry')
    if (r.status !== 'refused' || i.superseded_by) return r
    const key = `${i.idempotency_key}#s${n + 1}`
    const a = await authorizeIntent(this.ctx(), { taskId: i.task_id, action: i.action, idempotencyKey: key, params, evaluatorParams: this.evaluatorParams(i.action, params), validateParams: this.validator(i.action), supersedes: i.intent_id })
    return a.ok ? this.dispatch(a.intent, 'dispatch') : { status: 'refused', code: a.code, decision: a.decision }
  }
  async dispatch(i, mode) {
    const L = this.L; const params = JSON.parse(i.params_json)
    const r = await reauthorize(this.ctx(), i.intent_id, { mode, validateParams: this.validator(i.action), evaluatorParams: this.evaluatorParams(i.action, params) })
    if (!r.ok) return { status: 'refused', code: r.code, decision: r.decision, intent_id: i.intent_id }
    let out
    try {
      const w = await withDeadline(L, { opId: `effect:${i.intent_id}:${L.now()}`, taskId: i.task_id, kind: `effect:${i.action}`, ms: this.cfg.networkDeadlineMs }, (signal) => this.publisher.call(API[i.action], apiArgs(i.action, params), { signal, credential: this.credential }))
      // security review OPT-2: success needs a POSITIVE, well-formed response; anything else is uncertain
      out = w.timedOut ? { ok: false, code: 'WATCHDOG.NETWORK_TIMEOUT' } : (w.value && typeof w.value === 'object' && !Array.isArray(w.value) && w.value.ok !== false && !w.value.error) ? { ok: true, value: w.value } : { ok: false, code: 'PUBLISHER.UNRECOGNIZED_RESPONSE' }
      if (w.timedOut && i.action === 'dispatch_staging_candidate') markStagingUnresolved(L, i.task_id) // review O3: hold shared staging as UNRESOLVED until proof
    } catch (e) { if (e?.code === 'SIM_CRASH') throw e; out = { ok: false, code: codeOf(e), reset_at: e?.reset_at ?? null } }
    const rec = recordOutcome(L, i.intent_id, { success: out.ok, outcome: out.ok ? { simulated: true } : { code: out.code } })
    if (!out.ok && out.reset_at) schedulePoll(L, i.task_id, 'delivery', { baseMs: this.cfg.pollBaseMs, maxMs: this.cfg.pollMaxMs, at: out.reset_at, code: 'GITHUB.RATE_LIMITED' })
    return { status: rec.status ?? 'uncertain', intent_id: i.intent_id, code: out.code ?? null }
  }
  async reconcile(i) {
    const o = await this.observe('observe_intent', { intent_id: i.intent_id }, { intent_id: i.intent_id, task_id: i.task_id, params_digest: i.params_digest, candidate_sha: i.candidate_sha })
    if (!o.ok) return { status: 'uncertain', intent_id: i.intent_id, code: o.code, reset_at: o.reset_at }
    const r = reconcileIntent(this.L, i.intent_id, { observation: o.observation })
    if (r.ok) return { status: getIntent(this.L, i.intent_id).status === 'reconciled_succeeded' ? 'succeeded' : 'absent', intent_id: i.intent_id }
    return { status: r.code === 'INTENT.RECONCILIATION_CONFLICT' ? 'conflict' : 'uncertain', intent_id: i.intent_id, code: r.code }
  }
  /** Restart duty: anything dispatched without an outcome is uncertain (never assumed failed, never blindly retried). */
  start() {
    if (this.started) return
    this.started = true; markDispatchedAsUncertain(this.L)
    // operations of the PREVIOUS (dead) controller process can no longer land through it: their rows end here, so the absence rule (settle window + spaced reads) can decide again.
    // Without this a crash would make an uncertain effect permanently unreconcilable as absent (liveness). Single-controller lock assumed (D3.4 OS lock).
    this.L.db.prepare("UPDATE operation_deadlines SET state='process_ended', settled_at=? WHERE state IN ('running','unresolved')").run(this.L.now())
  }

  // ------------------------------------------------------------------ the loop
  async tick() {
    if (this.busy) return { progressed: false, busy: true }
    this.busy = true
    try { this.start(); this.obsCache = new Map(); return await this.#tick() } finally { this.busy = false }
  }
  async #tick() {
    const L = this.L; const out = []
    // reconciliation is READ-ONLY and runs for every task, cancelled ones included: an uncertain effect must be settled before anything else may happen to that task
    for (const i of L.db.prepare("SELECT * FROM action_intents WHERE status='uncertain' AND params_json IS NOT NULL ORDER BY created_at").all()) {
      if (!pollDue(L, i.task_id, `reconcile:${i.intent_id}`)) continue
      const r = await this.reconcile(i)
      if (r.status === 'uncertain') schedulePoll(L, i.task_id, `reconcile:${i.intent_id}`, { baseMs: 30_000, maxMs: 10 * 60_000, code: r.code, at: r.reset_at })
      else if (r.status === 'conflict') this.ownerBlock(i.task_id, `DELIVERY_REMOTE_CONFLICT:${i.action}`)
      out.push({ task_id: i.task_id, action: `reconcile:${r.status}` })
    }
    for (const t of L.db.prepare(`SELECT task_id FROM tasks WHERE cancelled=0 AND handoff_ready=1 AND state IN (${DELIVERY_STATES.map(() => '?').join(',')}) ORDER BY priority, created_at, task_id`).all(...DELIVERY_STATES)) {
      if (!pollDue(L, t.task_id, 'delivery') || !suspensionAllowsRun(this.e, t.task_id)) continue // a cooled-down suspension ends here (the engine never visits a task in delivery)
      if (L.db.prepare("SELECT 1 FROM action_intents WHERE task_id=? AND status IN ('uncertain','dispatched')").get(t.task_id)) continue // never act around an unresolved effect
      let r
      try { r = await this.step(t.task_id) } catch (e) { if (e?.code === 'SIM_CRASH') throw e; r = { progressed: false, error: codeOf(e) }; schedulePoll(L, t.task_id, 'delivery', { baseMs: this.cfg.pollBaseMs, maxMs: this.cfg.pollMaxMs, code: r.error }) }
      out.push({ task_id: t.task_id, ...r })
    }
    // cancelled tasks: no new effect, ever; their shared-staging hold is released only once observation proves nothing of theirs is queued or running
    // review M1: an owner that can no longer use staging (cancelled, technically suspended, blocked) releases it once observation proves nothing of its own is queued or running
    for (const o of [stagingOwner(L)].filter(Boolean)) { const t = L.getTask(o.task_id); if (t?.cancelled || L.getSuspension(o.task_id) || t?.state === 'blocked') await this.maybeReleaseStaging(o.task_id, t?.cancelled ? 'TASK_CANCELLED' : L.getSuspension(o.task_id) ? 'TASK_SUSPENDED' : 'TASK_BLOCKED') }
    return { progressed: out.some((x) => x.progressed), steps: out, next_wakeup: this.nextWakeup() }
  }
  nextWakeup() { return nextPoll(this.L) }
  wait(taskId, code, { at = null } = {}) { schedulePoll(this.L, taskId, 'delivery', { baseMs: this.cfg.pollBaseMs, maxMs: this.cfg.pollMaxMs, code, at }); return { progressed: false, waiting: code } }

  async step(taskId) {
    const L = this.L; const t = L.getTask(taskId)
    if (!dependencyCurrent(L, taskId)) return this.wait(taskId, 'DEPENDENCY_NOT_CURRENT') // the dependency sweep withdraws the handoff; the engine then rebuilds or fails closed
    invalidateStaleMilestones(L, taskId)
    // the LOCAL approvals (tests, reviews) can expire during a long CI or staging wait: hand the task back so the engine re-attests the SAME candidate (bounded by the issuers' 24 h rule;
    // beyond it: proposal P6v2 re-verification, or the authoritative fail-closed suspension). Delivery never proceeds on an approval that is not current.
    if (['test_results', 'independent_review', ...riskRequiredEvidence(t)].some((x) => !this.have(taskId, x))) { withdrawHandoff(L, taskId, 'APPROVALS_NOT_CURRENT'); return P('approvals_reattestation') }
    const o = await this.observeDelivery(taskId)
    if (!o.ok) return this.wait(taskId, o.code, { at: o.reset_at })
    const d = o.observation.details
    // a head on OUR branch that we never pushed (e.g. another automation pushed onto it) is reconciled before ANY mutation: never adopted, never overwritten
    if (d.ref && d.ref !== t.head_sha && !this.ownShas(taskId).includes(d.ref)) return this.ownerBlock(taskId, 'DELIVERY_FOREIGN_HEAD')
    if (d.pr && !d.owned_pr) return this.ownerBlock(taskId, 'DELIVERY_PR_NOT_OWNED')
    if (t.state === 'publishing') return this.publishing(t, d)
    if (d.ref !== t.head_sha || (d.pr && d.pr.head_sha !== t.head_sha)) return this.wait(taskId, 'REMOTE_HEAD_NOT_YET_VISIBLE') // eventual consistency: the push is ours (checked above); wait
    if (t.state === 'ci_running') return this.ciRunning(t, d)
    if (t.state === 'staging_verification') return this.staging(t, d)
    if (t.state === 'merge_eligible') return this.mergeEligible(t, d)
    return NONE
  }

  // ------------------------------------------------------------------ publishing
  async publishing(t, d) {
    const L = this.L; const id = t.task_id
    reach(L, id, 'built'); reach(L, id, 'locally_verified')
    const dl = ensureDelivery(L, id)
    const s = acquireStaging(L, id); if (!s.ok) return this.wait(id, s.code) // a push triggers CI -> staging: V3 serializes its own use of the shared environment
    if (!this.have(id, 'task_authority')) { const a = await this.accept(this.ingress, 'issue_task_authority', { task_id: id }); if (!a.ok) return this.wait(id, a.code) }
    if (d.ref !== t.head_sha) {
      const r = await this.effect(id, 'publish_candidate_branch', `publish:${id}:${t.head_sha}`, { repository: t.repository, branch: dl.branch, sha: t.head_sha, expected_old: d.ref ?? null })
      if (r.status === 'refused' && (r.decision?.reason_codes ?? []).includes('MIGRATION.BASE_NOT_CURRENT')) return this.baseUpdate(t, d, 'NEW_MIGRATION_ON_STALE_BASE')
      return this.afterEffect(id, 'publish', r)
    }
    if (!this.have(id, 'publication_receipt')) { const a = await this.accept(this.publisherIssuer, 'issue_publication_receipt', { task_id: id }); if (!a.ok) return this.wait(id, a.code) }
    if (!d.pr) {
      const r = await this.effect(id, 'open_draft_pull_request', `pr:${id}`, { repository: t.repository, branch: dl.branch, head: dl.branch, base: 'main', head_sha: t.head_sha, draft: true,
        title: `[V3 SIMULATED] ${String(t.requirements?.title ?? t.requirements?.text ?? id).replace(/[\u0000-\u001f]/g, ' ').slice(0, 100)}`, body_digest: this.prBodyDigest(t), author: PUBLISHER_AUTHOR })
      return this.afterEffect(id, 'pull_request', r)
    }
    const pr = recordPr(L, id, d.pr.number); if (!pr.ok) return this.ownerBlock(id, `DELIVERY_PR_RECORD:${pr.code}`)
    if (d.pr.head_sha !== t.head_sha) return this.wait(id, 'PR_HEAD_NOT_YET_VISIBLE')
    const receipt = this.have(id, 'publication_receipt')
    const x = L.tx(() => { const r = L.transition(id, 'ci_running'); if (r.ok) reach(L, id, 'published', { evidenceRef: receipt?.evidence_id }); return r })
    if (!x.ok) return this.wait(id, x.problems[0])
    this.status(id, 'published', { pr_number: d.pr.number })
    return P('published')
  }
  prBodyDigest(t) { return t.requirements_digest }
  afterEffect(taskId, what, r) {
    if (['succeeded', 'absent', 'in_flight', 'uncertain'].includes(r.status)) return { ...this.wait(taskId, `${what}:${r.status}`), progressed: r.status === 'succeeded', action: `${what}:${r.status}` }
    if (r.status === 'conflict') return this.ownerBlock(taskId, `DELIVERY_REMOTE_CONFLICT:${what}`)
    // an action the ACTIVE policy does not activate (or does not know) can never succeed by retrying: ONE terminal, explained suspension — not a retry loop, not an owner prompt per task
    const inactive = (r.decision?.reason_codes ?? []).filter((c) => /^ACTIVATION\.NOT_ACTIVE:|^ACTION\.UNKNOWN$/.test(c))
    if (inactive.length) return this.suspend(taskId, 'DELIVERY_NOT_ACTIVATED', inactive, { terminal: true, howToResume: 'V3 delivery actions are INACTIVE by policy. Nothing is wrong with this task: its candidate is locally verified and handed off. Real delivery needs the protected proposals (P7) and the owner activation ceremony (G-* gates, D3.9); until then the existing human PR process applies.' })
    const f = recordFailure(this.L, { taskId, stage: `delivery:${what}`, fingerprint: `${what}:${r.code}`.slice(0, 120), rng: this.e.rng })
    if (f.exhausted || r.status === 'exhausted') return this.suspend(taskId, `DELIVERY_${what.toUpperCase()}_REFUSED`, [r.code ?? 'unknown', ...((r.decision?.reason_codes ?? []).slice(0, 5))])
    return this.wait(taskId, r.code ?? r.status, { at: f.next_eligible_at })
  }

  // ------------------------------------------------------------------ CI
  async ciRunning(t, d) {
    const L = this.L; const id = t.task_id; const ci = d.ci
    if (!ci) return this.wait(id, 'CI_STATE_UNAVAILABLE')
    if (ci.overall === 'success') {
      const a = await this.accept(this.verifier, 'issue_ci_gate', { task_id: id }); if (!a.ok) return this.wait(id, a.code)
      const x = L.tx(() => { const r = L.transition(id, 'staging_verification'); if (r.ok) reach(L, id, 'ci_verified', { evidenceRef: a.evidence_id }); return r }); if (!x.ok) return this.wait(id, x.problems[0])
      this.status(id, 'ci_verified', {}); return P('ci_verified')
    }
    if (ci.overall === 'pending') return this.wait(id, 'CI_PENDING')
    if (ci.overall === 'missing') {
      const since = L.db.prepare("SELECT reached_at FROM delivery_milestones WHERE task_id=? AND milestone='published' AND candidate_sha=? AND invalidated_at IS NULL").get(id, t.head_sha)?.reached_at ?? L.now()
      return L.now() - since < this.cfg.ciMissingGraceMs ? this.wait(id, 'CI_NOT_STARTED') : this.suspend(id, 'CI_RESULT_MISSING', ['CI.REQUIRED_CHECK_MISSING'])
    }
    // failed / cancelled: deterministic diagnosis first (in the verifier: the controller never sees a raw log)
    const fd = await this.observe('ci_failure_details', { task_id: id }, { task_id: id, subject: `ci_failure:${id}` }); if (!fd.ok) return this.wait(id, fd.code, { at: fd.reset_at })
    const results = fd.observation.details.results ?? []
    for (const r of results) recordDiagnosis(L, { taskId: id, candidateSha: t.head_sha, source: 'ci', runId: r.run_id, attempt: r.attempt, job: r.job, d: r })
    if (results.some((r) => r.classification === 'protected_control_plane')) return this.suspend(id, 'PROTECTED_CONTROL_PLANE_FAILURE', results.filter((r) => r.classification === 'protected_control_plane').map((r) => `CI.PROTECTED:${r.fingerprint}`), { terminal: true, howToResume: 'A protected control-plane guard failed on this candidate. That is never a routine CI repair: prepare a protected proposal through the owner-controlled procedure (doc 39).' })
    if (results.length && results.every((r) => r.classification === 'transient')) return this.rerunCi(t, results)
    return this.toRemediation(id, 'CI_FAILED', remediationText('ci', results.filter((r) => r.classification !== 'transient')), `ci:${results.map((r) => r.fingerprint).sort().join('+')}`.slice(0, 120))
  }
  async rerunCi(t, results) {
    const L = this.L; const id = t.task_id; const key = `ci_reruns:${id}:${t.head_sha}`; const n = Number(L.meta(key) ?? 0)
    if (n >= this.cfg.maxCiRerunsPerCandidate) return this.suspend(id, 'CI_TRANSIENT_FAILURE_REPEATED', results.map((r) => `CI.TRANSIENT:${r.fingerprint}`)) // infrastructure, not code: a cooled-down technical suspension, never remediation
    const r0 = results[0]
    const a = await this.accept(this.verifier, 'issue_ci_failure_diagnosis', { task_id: id, run_id: r0.run_id, attempt: r0.attempt }); if (!a.ok) return this.wait(id, a.code)
    const dl = L.delivery(id)
    const r = await this.effect(id, 'rerun_ci_jobs', `rerun:${id}:${r0.run_id}:${r0.attempt}`, { repository: t.repository, branch: dl.branch, run_id: r0.run_id, attempt: r0.attempt, head_sha: t.head_sha })
    if (r.status === 'succeeded') L.setMeta(key, n + 1)
    return this.afterEffect(id, 'ci_rerun', r)
  }

  // ------------------------------------------------------------------ staging
  async staging(t, d) {
    const L = this.L; const id = t.task_id; const g = d.staging
    const s = acquireStaging(L, id); if (!s.ok) return this.wait(id, s.code)
    if (g?.state === 'success') {
      const a = await this.accept(this.verifier, 'issue_staging_gate', { task_id: id }); if (!a.ok) return this.wait(id, a.code)
      reach(L, id, 'staging_verified', { evidenceRef: a.evidence_id })
      return this.toMergeEligible(t, d)
    }
    if (g?.state === 'pending') return this.wait(id, 'STAGING_PENDING')
    const runs = (d.staging_runs ?? []).filter((r) => r.head_sha === t.head_sha && !r.ineligible)
    if (g?.state === 'failed') { // deterministic diagnosis in the verifier (the controller never sees a raw staging log)
      const fd = await this.observe('staging_failure_details', { task_id: id }, { task_id: id, subject: `staging_failure:${id}` }); if (!fd.ok) return this.wait(id, fd.code, { at: fd.reset_at })
      const r = fd.observation.details.result
      recordDiagnosis(L, { taskId: id, candidateSha: t.head_sha, source: 'staging', runId: r.run_id, attempt: r.attempt, job: r.job, d: r })
      if (r.classification === 'transient') return this.redispatchStaging(t, d, 'STAGING_TRANSIENT')
      if (r.classification === 'protected_control_plane') return this.suspend(id, 'PROTECTED_CONTROL_PLANE_FAILURE', [`STAGING.PROTECTED:${r.fingerprint}`], { terminal: true, howToResume: 'A protected staging safeguard refused this candidate: a protected proposal, never a routine repair (doc 39).' })
      return this.toRemediation(id, 'STAGING_FAILED', remediationText('staging', [r]), `staging:${r.fingerprint}`)
    }
    // missing: our automatic staging run was displaced by a newer pending run, or never started
    const ciAt = L.db.prepare("SELECT reached_at FROM delivery_milestones WHERE task_id=? AND milestone='ci_verified' AND candidate_sha=? AND invalidated_at IS NULL").get(id, t.head_sha)?.reached_at ?? L.now()
    if (runs.some((r) => ['pending', 'in_progress'].includes(r.status))) return this.wait(id, 'STAGING_QUEUED')
    if (!runs.some((r) => r.displaced) && L.now() - ciAt < this.cfg.stagingMissingGraceMs) return this.wait(id, 'STAGING_NOT_STARTED')
    return this.redispatchStaging(t, d, 'STAGING_DISPLACED_OR_MISSING')
  }
  async redispatchStaging(t, d, why) {
    const L = this.L; const id = t.task_id; const key = `staging_dispatch:${id}:${t.head_sha}`; const n = Number(L.meta(key) ?? 0)
    if (d.staging_busy) return this.wait(id, `STAGING_BUSY:${why}`) // the shared group is in use (perhaps by another PR): never queue behind it, never displace a pending run
    if (n >= this.cfg.maxStagingRedispatchPerCandidate) return this.suspend(id, 'STAGING_REDISPATCH_EXHAUSTED', [why])
    const a = await this.accept(this.verifier, 'issue_staging_admission', { task_id: id }); if (!a.ok) return this.wait(id, a.code)
    const dl = L.delivery(id)
    const r = await this.effect(id, 'dispatch_staging_candidate', `${key}:${n + 1}`, { repository: t.repository, branch: dl.branch, pr_number: dl.pr_number, head_sha: t.head_sha })
    if (['succeeded', 'uncertain', 'in_flight'].includes(r.status)) L.setMeta(key, n + 1)
    return this.afterEffect(id, 'staging_dispatch', r)
  }
  async toMergeEligible(t, d) {
    const L = this.L; const id = t.task_id
    // the EVALUATOR must allow verify_delivery_eligibility for exactly this candidate and policy FIRST; then the verifier issues the package from its own re-reads
    const ev = await this.evaluateOnly(id, 'verify_delivery_eligibility')
    if (!ev.ok) return this.afterEffect(id, 'delivery_verification', { status: 'refused', code: ev.code, decision: ev.decision })
    const a = await this.accept(this.verifier, 'issue_delivery_verification', { task_id: id }); if (!a.ok) return this.wait(id, a.code)
    const pkg = a.issued.package
    const x = L.tx(() => { const r = L.transition(id, 'merge_eligible'); if (r.ok) { reach(L, id, 'merge_eligible', { evidenceRef: a.evidence_id }); L.setMeta(`delivery_package:${id}:${t.head_sha}`, JSON.stringify({ package: pkg, package_digest: a.issued.package_digest, signature: a.issued.package_signature })) } return r })
    if (!x.ok) return this.wait(id, x.problems[0])
    await this.maybeReleaseStaging(id, 'STAGING_VERIFIED')
    await this.ensureReady(t) // review O5: marked ready AFTER the eligibility transition; re-ensured on every merge_eligible step
    this.status(id, 'merge_eligible', { pr_number: L.delivery(id).pr_number, package_digest: a.issued.package_digest, merge: 'NOT PERFORMED (D3.6 has no merge authority)' })
    return P('merge_eligible')
  }
  async ensureReady(t) { const L = this.L; const dl = L.delivery(t.task_id); return this.effect(t.task_id, 'mark_pull_request_ready', `ready:${t.task_id}:${t.head_sha}`, { repository: t.repository, branch: dl.branch, number: dl.pr_number }) }
  /** An action with no remote effect (it authorizes ISSUING a delivery verification): the evaluator alone, nothing consumed (`verify_delivery_eligibility` requires no single-use evidence). */
  async evaluateOnly(taskId, action) {
    const tf = await trustedFacts(this.L, taskId, ACTION_IDENTITY[action], this.evalFacts()); if (!tf.ok) return tf
    const pool = usableEvidence(this.L, taskId, this.policy).slice(0, 64)
    const decision = (this.evaluateFn ?? authoritativeEvaluate)({ policy: this.policy, request: { action, task_id: taskId }, trusted: tf.trusted, evidence: pool.map((r) => r.envelope), now: this.L.now(), ledger: new this.View(this.L, `evaluate:${taskId}`) })
    if (decision.decision === 'allow' && decision.consumes.length) return { ok: false, code: 'AUTHORITY.UNEXPECTED_CONSUMPTION', decision } // nothing may be consumed without a durable intent
    return decision.decision === 'allow' ? { ok: true, decision } : { ok: false, code: 'AUTHORITY.DENIED', decision }
  }

  // ------------------------------------------------------------------ merge_eligible: monitored, never merged
  async mergeEligible(t, d) {
    const L = this.L; const id = t.task_id
    if (d.main && d.main !== L.currentBase(id)) return this.baseUpdate(t, d, 'MAIN_ADVANCED') // the main ruleset is STRICT (up to date before merge): a newer main needs a new, re-verified candidate
    const pr = d.pr; if (pr?.draft) { const r = await this.ensureReady(t); if (r && r.status !== 'succeeded') return this.afterEffect(id, 'mark_ready', r) }
    if (!this.have(id, 'delivery_verification')) { const a = await this.accept(this.verifier, 'issue_delivery_verification', { task_id: id }); if (!a.ok) return this.wait(id, a.code) } // re-verified (same head) when the 1 h package expires
    return this.wait(id, 'MERGE_ELIGIBLE_AWAITING_D37', { at: L.now() + this.cfg.mergeEligibleRecheckMs })
  }

  // ------------------------------------------------------------------ base advancement (D3.6-F)
  async baseUpdate(t, d, why) {
    const L = this.L; const id = t.task_id; const now = L.now()
    const hist = JSON.parse(L.meta(`base_updates:${id}`) ?? '[]').filter((x) => now - x < 24 * 3600_000)
    if (hist.length >= this.cfg.baseUpdatesPerDay) return this.wait(id, 'BASE_UPDATE_BUDGET', { at: hist[0] + 24 * 3600_000 }) // bounded: main moving all day never becomes an endless update loop
    const newBase = d.main
    let m; try { m = await this.facts.mergeBase(t, newBase) } catch (e) { return this.wait(id, `BASE_UPDATE:${codeOf(e)}`) }
    L.setMeta(`base_updates:${id}`, JSON.stringify([...hist, now]))
    if (!m.ok && m.code === 'MERGE.CONFLICT') {
      const contract = this.policy.contract
      const prot = m.conflicts.filter((p) => matchesAny([...contract.protected_paths, ...contract.root_of_trust_paths, `${contract.migrations.directory}/**`], p) || !matchesAny(t.scope.allowed_paths, p))
      if (prot.length) return this.suspend(id, 'BASE_UPDATE_PROTECTED_CONFLICT', prot.slice(0, 5).map((p) => `CONFLICT:${p}`), { terminal: true, howToResume: 'The new main conflicts with this task in protected, migration or out-of-scope files. Such conflicts are never resolved automatically: review and resubmit the task on the current main.' })
      const edge = L.lc.base_conflict_rebuild
      if (!edge) return this.suspend(id, 'BASE_UPDATE_CONFLICT', m.conflicts.slice(0, 5).map((p) => `CONFLICT:${p}`), { terminal: true, howToResume: 'Main advanced and conflicts with this task. The authoritative lifecycle has no rebuild edge for it (proposal P6v2 base_conflict_rebuild): resubmit the task on the current main, or apply P6v2.' })
      // the conflict is resolved by the implementer ON THE NEW BASE (the trusted git prepares that worktree); the base generation advances with the rebuild edge, atomically
      const r = L.tx(() => { const x = L.transition(id, edge.to, { reason_code: edge.reason }); if (!x.ok) return x; advanceBase(L, id, newBase); withdrawHandoff(L, id, 'BASE_UPDATE_CONFLICT'); invalidateStaleMilestones(L, id)
        L.setMeta(`remediation:${id}`, `Main advanced to ${newBase.slice(0, 12)} and conflicts with this task in: ${m.conflicts.join(', ')}. Resolve the conflict inside the task scope on the NEW base; every approval and delivery result of the old base was withdrawn.`); return x })
      return r.ok ? P('base_conflict_rebuild') : this.wait(id, r.problems[0])
    }
    if (!m.ok) return this.wait(id, `BASE_UPDATE:${m.code}`)
    const r = L.tx(() => {
      advanceBase(L, id, newBase)
      const s = L.submitCandidate(id, { base_sha: newBase, candidate_sha: m.candidate_sha, tree_digest: m.tree_digest, patch_digest: m.patch_digest }); if (!s.ok) throw Object.assign(new Error('BASE_UPDATE_REFUSED'), { s })
      L.setMeta(`paths:${id}:${m.candidate_sha}`, JSON.stringify(m.changed_paths.slice(0, 2000)))
      const b = basisOf(L, id); if (b) promoteBasis(L, id, m.candidate_sha, b.basis) // the dependency basis is unchanged by a base update of THIS task
      withdrawHandoff(L, id, 'BASE_UPDATED'); invalidateStaleMilestones(L, id)
      L.recordRecovery(id, 'base_updated', { why, base: newBase, candidate: m.candidate_sha })
      return s
    })
    this.status(id, 'base_updated', { base: newBase, candidate: m.candidate_sha })
    return r.ok ? P('base_updated') : this.wait(id, 'BASE_UPDATE_REFUSED')
  }

  // ------------------------------------------------------------------ returning work to the implementer, technical suspension, owner blockers, status
  async toRemediation(taskId, reason, instruction, fingerprint) {
    const L = this.L
    const f = recordFailure(L, { taskId, stage: `delivery:${reason.toLowerCase()}`, fingerprint, rng: this.e.rng })
    const x = L.tx(() => { L.setMeta(`remediation:${taskId}`, instruction); const r = L.transition(taskId, 'remediation', { reason_code: reason }); if (r.ok) { withdrawHandoff(L, taskId, reason); L.recordRecovery(taskId, 'delivery_remediation', { reason, fingerprint, attempts: f.attempts }) } return r })
    if (!x.ok) return this.suspend(taskId, `DELIVERY_REMEDIATION_REFUSED:${reason}`, x.problems)
    await this.maybeReleaseStaging(taskId, reason)
    const over = budgetExceeded(this.e, taskId); if (over || f.exhausted) return this.suspend(taskId, over ?? `REPEATED_DELIVERY_FAILURE:${reason}`, [fingerprint])
    return P('remediation')
  }
  async maybeReleaseStaging(taskId, basis) {
    const o = stagingOwner(this.L); if (!o || o.task_id !== taskId) return
    const v = await this.observeDelivery(taskId); if (!v.ok) return
    const own = (v.observation.details.staging_runs ?? []).filter((r) => ['pending', 'in_progress'].includes(r.status) && !r.ineligible)
    const unresolvedIntent = this.L.db.prepare("SELECT 1 FROM action_intents WHERE task_id=? AND action='dispatch_staging_candidate' AND status IN ('intended','dispatched','uncertain')").get(taskId)
    if (o.state === 'unresolved' && !unresolvedIntent && own.length === 0) resolveStaging(this.L, taskId, { observedIdle: true }) // review O3: an unresolved hold becomes releasable only with proof
    releaseStaging(this.L, taskId, { observedIdle: own.length === 0, basis })
  }
  suspend(taskId, cause, codes = [], extra = {}) { suspendTechnically(this.e, taskId, { cause, stage: this.L.getTask(taskId).state, codes, ...extra }); return P('technically_suspended') }
  ownerBlock(taskId, code) { this.e.applyWait(taskId, { kind: 'blocked', reason: 'OWNER_DECISION_REQUIRED', codes: [`OWNER_DECISION_REQUIRED:${code}`] }); return P('owner_blocked') }
  status(taskId, milestone, payload) { enqueueOutbox(this.L, { taskId, kind: 'delivery_status', dedupeKey: `delivery:${taskId}:${milestone}:${this.L.getTask(taskId).head_sha}`, payload: { task_id: taskId, milestone, candidate_sha: this.L.getTask(taskId).head_sha, simulated: true, ...payload } }) }
}

function apiArgs(action, p) {
  switch (action) {
    case 'publish_candidate_branch': return { branch: p.branch, sha: p.sha, expected_old: p.expected_old ?? null }
    case 'open_draft_pull_request': return { head: p.head, base: p.base, draft: p.draft === true, title: p.title, body_digest: p.body_digest }
    case 'update_pull_request_metadata': return { number: p.number, title: p.title, body_digest: p.body_digest }
    case 'mark_pull_request_ready': return { number: p.number }
    case 'rerun_ci_jobs': return { run_id: p.run_id, attempt: p.attempt }
    case 'dispatch_staging_candidate': return { pr_number: p.pr_number }
    default: return {}
  }
}
/** Withdraw the task's LOCAL handoff (it goes back to the engine): kept as superseded history, never deleted. */
export function withdrawHandoff(L, taskId, cause) {
  const pkg = L.meta(`handoff:${taskId}`)
  L.db.prepare('UPDATE tasks SET handoff_ready=0, updated_at=? WHERE task_id=?').run(L.now(), taskId)
  if (pkg) { L.setMeta(`handoff_superseded:${taskId}:${L.now()}`, JSON.stringify({ ...JSON.parse(pkg), superseded_at: L.now(), cause })); L.db.prepare('DELETE FROM meta WHERE key=?').run(`handoff:${taskId}`) }
  L.recordRecovery(taskId, 'handoff_withdrawn', { cause })
}
