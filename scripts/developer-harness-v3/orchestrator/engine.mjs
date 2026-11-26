// Developer Harness V3 (D3.4) — the persistent orchestrator: a deterministic, single-threaded state machine over the ledger.
//
// AI is invoked only inside `stages.mjs` session stages. Everything else — scheduling, admission, waiting, retries, evidence verification, lease and
// recovery management, notification — is plain code with injected clocks and adapters. A finished session NEVER completes a task; D3.4 ends at a verified
// delivery HANDOFF (`handoff_ready`), because publishing, CI, staging and merging belong to D3.6+.
//
// MODE: only `simulated` exists in D3.4. `live` refuses to construct until every activation gate in activation-gates.mjs is closed.
import { admit } from '../runtime/resource-governor.mjs'
import { admitAiWork, lifecycleFor } from '../runtime/subscription-governor.mjs'
import { enqueueOutbox, claimOutbox, ackOutbox, retryEligible } from './ledger/intents.mjs'
import { routeStage } from './routing.mjs'
import { RENEWAL_DEFAULTS } from './context-renewal.mjs'
import { RETRY_DEFAULTS } from './ledger/intents.mjs'
import { liveExecutionAllowed } from './activation-gates.mjs'
import * as stages from './stages.mjs'
import { reconcileSlot } from './recovery.mjs'
import { TECH_DEFAULTS, budgetExceeded, classifyBlocker, resumeSuspended, sessionsUsed, suspendTechnically, suspensionAllowsRun } from './suspension.mjs'

export const ENGINE_DEFAULTS = Object.freeze({ cliVersion: '2.1.331', leaseTtlMs: 35 * 60_000, /* >= the 30-minute work-unit ceiling + margin: a unit must never outlive its lease */ maxUnitsPerStage: 40, renewal: RENEWAL_DEFAULTS, retry: RETRY_DEFAULTS, technical: TECH_DEFAULTS,
  resourceRecheckMs: 30_000, subscriptionRecheckMs: 15 * 60_000, networkRecheckMs: 60_000 })

/** state → what admission it needs before work may start in it */
const NEEDS = { planning: { stage: 'planning', ai: true, profile: 'reasoning' }, implementing: { stage: 'implementing', ai: true, profile: 'reasoning' }, testing: { stage: 'testing', ai: false, profile: 'heavy_test' },
  independent_review: { stage: 'independent_review', ai: true, profile: 'reasoning' }, security_review: { stage: 'security_review', ai: true, profile: 'reasoning' } }

export class Engine {
  constructor({ ledger, policy, adapters, cfg = {}, rng = Math.random, hook = null, snapshotRoot, mode = 'simulated' }) {
    if (mode !== 'simulated') {
      const g = liveExecutionAllowed()
      throw new Error(`ENGINE.LIVE_EXECUTION_DISABLED:${g.open.length} activation gates open`)
    }
    if (adapters?.simulated !== true) throw new Error('ENGINE.SIMULATED_MODE_REQUIRES_SIMULATED_ADAPTERS')
    Object.assign(this, { ledger, policy, adapters, rng, hookFn: hook, snapshotRoot, mode, cfg: { ...ENGINE_DEFAULTS, ...cfg, renewal: { ...RENEWAL_DEFAULTS, ...(cfg.renewal ?? {}) }, retry: { ...RETRY_DEFAULTS, ...(cfg.retry ?? {}) }, technical: { ...TECH_DEFAULTS, ...(cfg.technical ?? {}) } } })
  }
  hook(name, ctx = {}) { this.hookFn?.(name, ctx) }
  /** The admission a stage needs (also used by the session runner to RE-admit at every unit boundary and before every fresh session). */
  needFor(stage) { return NEEDS[stage] ?? null }
  /** Start a fresh budget for a technically suspended task (operator/test convenience — NOT a permission decision). */
  resumeSuspended(taskId) { return resumeSuspended(this, taskId) }

  // ------------------------------------------------------------ admission
  /**
   * Pure with respect to the ledger's task state: decides whether `stage` may start (or, with `ownLease`, may CONTINUE) now. Never starts anything.
   * `ownLease` = the lease of the session that is asking to continue: the slot it holds is its OWN, not an unrelated occupied reasoning slot; any other holder is still `busy`.
   */
  async checkAdmission(taskId, need, { ownLease = null } = {}) {
    const L = this.ledger; const A = this.adapters; const now = L.now(); const t = L.getTask(taskId)
    if (t.cancelled) return { ok: false, kind: 'cancelled', codes: ['TASK.CANCELLED'] }
    if (!L.requirementsIntact(taskId)) return { ok: false, kind: 'blocked', reason: 'OWNER_DECISION_REQUIRED', codes: ['TASK.REQUIREMENTS_TAMPERED'] }
    const holder = L.slotHolder(); const own = !!ownLease && !!holder && holder.lease_id === ownLease.lease_id && holder.task_id === taskId && holder.state === 'active'
    if (need.ai && holder && !own) return { ok: false, kind: 'busy', codes: ['LEASE.SLOT_HELD'] }
    if (need.ai && !own && sessionsUsed(L, taskId) >= this.cfg.technical.maxSessionsPerTask) return { ok: false, kind: 'suspend', cause: 'SESSION_BUDGET_EXHAUSTED', codes: ['SESSION_BUDGET_EXHAUSTED'] } // a NEW session only: continuing the paid one is not a new purchase
    const s = await A.resources.sample()
    const res = admit(need.profile, { host: s.host, history: s.history ?? [], prevPressure: s.prevPressure ?? 'clear', guest: s.guest, active: { reasoning_sessions: holder && !own ? 1 : 0, heavy_test_workloads: s.heavy ?? 0 }, reservations: s.reservations ?? [], now, accel: s.accel })
    if (res.decision !== 'admit') return { ok: false, kind: 'wait', state: 'waiting_resources', reason: res.lifecycle_reason, eligible_at: now + this.cfg.resourceRecheckMs + Math.round(this.rng() * 5000), codes: res.reason_codes }
    if (!need.ai) return { ok: true }
    const gov = A.subscription.load()
    const a = admitAiWork(gov, { now, priority: need.stage === 'security_review' ? 'security' : 'owner' })
    if (!a.admit) {
      const state = gov?.state
      if (!gov || a.codes.some((c) => /^AUTH\./.test(c)) || ['auth_expired', 'auth_unverified', 'unauthorized_billing'].includes(state)) {
        return { ok: false, kind: 'blocked', reason: state === 'auth_expired' ? 'OWNER_AUTH_EXPIRED' : 'OWNER_DECISION_REQUIRED', codes: a.codes }
      }
      const lf = ['exhausted', 'provider_unavailable', 'network_unavailable', 'unknown'].includes(state) ? lifecycleFor(state) : { state: 'waiting_subscription', reason: 'SUBSCRIPTION_LIMIT' }
      const fallback = now + (lf.state === 'waiting_external' ? this.cfg.networkRecheckMs : this.cfg.subscriptionRecheckMs)
      return { ok: false, kind: 'wait', state: lf.state, reason: lf.reason, eligible_at: a.next_eligible_at ?? gov?.next_eligible_at ?? fallback, codes: a.codes }
    }
    const route = routeStage({ stage: need.stage, task: t, escalated: L.meta(`escalated:${taskId}`) === '1', subscription: { admit: true } })
    return route.wait ? { ok: false, kind: 'wait', state: 'waiting_subscription', reason: 'SUBSCRIPTION_LIMIT', eligible_at: now + this.cfg.subscriptionRecheckMs, codes: [route.code] } : { ok: true, route }
  }

  /** Check + side effects: moves the task to the right waiting/blocked state. @returns {{go:true, route?:object}|{go:false, outcome:string}} */
  async gate(taskId, need) {
    const r = await this.checkAdmission(taskId, need)
    if (r.ok) return { go: true, route: r.route }
    if (r.kind === 'busy' || r.kind === 'cancelled') return { go: false, outcome: 'busy' }
    if (r.kind === 'suspend') { suspendTechnically(this, taskId, { cause: r.cause, stage: need.stage, codes: r.codes }); return { go: false, outcome: 'suspended' } }
    this.applyWait(taskId, r)
    return { go: false, outcome: r.kind }
  }

  applyWait(taskId, w) {
    const L = this.ledger; const t = L.getTask(taskId)
    // A genuine blocker needs at least one OWNER-ONLY cause. Anything else reaching here is an engineering condition mislabelled as an owner decision: it becomes a technical suspension.
    if (w.kind === 'blocked' && !(w.codes ?? []).some((c) => classifyBlocker(c) === 'owner') && !['OWNER_AUTH_EXPIRED', 'OWNER_ROOT_OF_TRUST_CEREMONY', 'PROHIBITED_ACTION_REQUIRED', 'ISOLATION_UNPROVEN', 'UNRESOLVABLE_REQUIREMENT_CONFLICT'].includes(w.reason)) {
      suspendTechnically(this, taskId, { cause: (w.codes ?? [])[0] ?? w.reason ?? 'UNKNOWN', stage: t.state, codes: w.codes ?? [] }); return
    }
    if (w.kind === 'blocked') {
      if (t.state !== 'blocked') { const r = L.transition(taskId, 'blocked', { reason_code: w.reason }); if (!r.ok) throw new Error(`ENGINE.BLOCK_REFUSED:${r.problems[0]}`) }
      L.setWait(taskId, { kind: 'blocked', reason: w.reason, detail: { codes: w.codes } })
      this.blockerPackage(taskId, w.reason, w.codes)
      return
    }
    if (t.state !== w.state || t.lifecycle.blocker_reason) { const r = L.transition(taskId, w.state, { reason_code: w.reason }); if (!r.ok) throw new Error(`ENGINE.WAIT_REFUSED:${r.problems[0]}`) }
    L.setWait(taskId, { kind: w.state, reason: w.reason, eligibleAt: w.eligible_at ?? null, detail: { codes: w.codes } })
  }

  /** ONE actionable package per genuine blocker (and only for genuine blockers): what is blocked, why, the exact owner action, and what is preserved. */
  blockerPackage(taskId, reason, codes) {
    const L = this.ledger; const t = L.getTask(taskId)
    enqueueOutbox(L, { taskId, kind: 'genuine_blocker', dedupeKey: `blocker:${taskId}:${t.state_revision}:${reason}:${codes.join(',')}`, payload: { task_id: taskId, reason, codes, state_when_blocked: t.lifecycle.resume_to, head_sha: t.head_sha,
      preserved: { ledger: 'all state, plan, checkpoints and evidence retained', resume: 'owner_action_id required to leave blocked' } } })
  }

  // ------------------------------------------------------------ the loop
  async tick() {
    const L = this.ledger; const now = L.now()
    await this.deliverOutbox()
    // recovery of an unverified/orphaned slot comes first: no new session may start while the old one is not proven dead
    if (L.slotHolder()) { const r = await reconcileSlot(this, { reason: 'WORKER_TERMINATED' }); if (!r.cleared) return { progressed: false, held: true, code: r.code, next_wakeup: now + 5000 } }
    for (const row of L.listTasks("cancelled=0 AND handoff_ready=0 AND state<>'completed'")) {
      const r = await this.advance(row.task_id)
      if (r.progressed) return { progressed: true, task_id: row.task_id, action: r.action }
    }
    return { progressed: false, next_wakeup: this.nextWakeup() }
  }

  /** Run until nothing can progress. `maxTicks` bounds runaway loops in tests; time-based waits are skipped by the caller advancing the fixture clock. */
  async runUntilIdle({ maxTicks = 500 } = {}) {
    const log = []
    for (let i = 0; i < maxTicks; i += 1) { const r = await this.tick(); log.push(r); if (!r.progressed) return { idle: true, ticks: i + 1, log, next_wakeup: r.next_wakeup ?? null } }
    return { idle: false, ticks: maxTicks, log }
  }

  nextWakeup() {
    const L = this.ledger
    const w = L.db.prepare("SELECT MIN(eligible_at) m FROM waits w JOIN tasks t ON t.task_id=w.task_id WHERE t.cancelled=0 AND t.handoff_ready=0 AND w.eligible_at IS NOT NULL").get().m
    const r = L.db.prepare('SELECT MIN(next_eligible_at) m FROM retry_budgets WHERE exhausted=0 AND next_eligible_at>?').get(L.now()).m
    const sus = L.db.prepare("SELECT MIN(s.retry_at) m FROM suspensions s JOIN tasks t ON t.task_id=s.task_id WHERE t.cancelled=0 AND t.handoff_ready=0 AND s.disposition='cooling_down'").get().m
    const ob = L.db.prepare("SELECT MIN(next_attempt_at) m FROM outbox WHERE status='pending' AND next_attempt_at>?").get(L.now()).m // an undelivered notification is never forgotten
    const xs = [w, r, sus, ob].filter((x) => Number.isFinite(x))
    return xs.length ? Math.min(...xs) : null
  }

  async advance(taskId) {
    const L = this.ledger; const t = L.getTask(taskId); const s = t.state
    const done = (action) => ({ progressed: true, action })
    const none = { progressed: false }
    if (!suspensionAllowsRun(this, taskId)) return none // cooling down (a wake-up is scheduled) or terminal (an explicit disposition, one notification)
    switch (s) {
      case 'submitted': { const r = L.transition(taskId, 'queued'); return r.ok ? done('queued') : none }
      case 'queued': {
        if (L.deadDependencies(taskId).length) return this.dependencyConflict(taskId)
        if (L.openDependencies(taskId).length) { const w = L.transition(taskId, 'dependency_waiting', { reason_code: 'DEPENDENCY_TASK_OPEN' }); return w.ok ? done('dependency_waiting') : none }
        const r = L.transition(taskId, 'planning'); return r.ok ? done('planning') : none
      }
      case 'dependency_waiting': {
        if (L.deadDependencies(taskId).length) return this.dependencyConflict(taskId)
        if (L.openDependencies(taskId).length) return none
        const r = L.transition(taskId, L.resumeTarget(taskId)); return r.ok ? done('dependencies_satisfied') : none
      }
      case 'waiting_resources': case 'waiting_subscription': case 'waiting_external': return this.tryResume(t)
      case 'worker_recovery': case 'context_recovery': {
        const r = await reconcileSlot(this, { reason: 'HOST_RESTARTED' })
        if (!r.cleared) return none
        const back = L.transition(taskId, L.resumeTarget(taskId)); return back.ok ? done('recovered') : none
      }
      case 'remediation': {
        if (!['testing', 'independent_review', 'security_review'].every((k) => retryEligible(L, taskId, k))) return none
        const r = L.transition(taskId, 'implementing'); return r.ok ? done('remediation_started') : none
      }
      case 'planning': return stages.planning(this, taskId)
      case 'implementing': return stages.implementing(this, taskId)
      case 'testing': return stages.testing(this, taskId)
      case 'independent_review': return stages.review(this, taskId, 'independent_review')
      case 'security_review': return stages.review(this, taskId, 'security_review')
      case 'publishing': return await stages.handoff(this, taskId)
      default: return none // paused, blocked (owner-only exit), stages beyond D3.4's scope
    }
  }

  /** A task whose dependency was CANCELLED can never proceed by itself: an explicit owner-level conflict with one actionable package, not an indefinite silent stall. */
  dependencyConflict(taskId) {
    const dead = this.ledger.deadDependencies(taskId)
    this.applyWait(taskId, { kind: 'blocked', reason: 'UNRESOLVABLE_REQUIREMENT_CONFLICT', codes: [...dead.map((d) => `UNRESOLVABLE_REQUIREMENT_CONFLICT:DEPENDENCY_CANCELLED:${d}`)] })
    return { progressed: true, action: 'blocked_dependency_cancelled' }
  }

  async tryResume(t) {
    const L = this.ledger; const now = L.now(); const w = L.getWait(t.task_id)
    if (w?.eligible_at && now < w.eligible_at) return { progressed: false }
    const target = t.lifecycle.via_remediation ? 'implementing' : t.lifecycle.resume_to
    const need = NEEDS[target] ?? { stage: 'deterministic', ai: false, profile: 'deterministic' }
    const r = await this.checkAdmission(t.task_id, need)
    if (r.kind === 'busy' || r.kind === 'cancelled') return { progressed: false }
    if (r.kind === 'suspend') { suspendTechnically(this, t.task_id, { cause: r.cause, stage: target, codes: r.codes }); return { progressed: true, action: 'technically_suspended' } }
    if (r.ok) { const x = L.transition(t.task_id, target); if (x.ok) { L.clearWait(t.task_id); return { progressed: true, action: 'resumed' } } return { progressed: false } }
    // still not admissible: refresh the wait (and change state only if the reason class changed) — never flap events
    this.applyWait(t.task_id, r)
    return { progressed: false }
  }

  /** The owner's (or a test's) explicit resolution of a genuine blocker. The only way out of `blocked`. */
  ownerResolve(taskId, ownerActionId) {
    const L = this.ledger; const t = L.getTask(taskId)
    if (t.state !== 'blocked') return { ok: false, problems: ['TASK.NOT_BLOCKED'] }
    const r = L.transition(taskId, L.resumeTarget(taskId), { owner_action_id: ownerActionId })
    if (r.ok) { L.clearWait(taskId); L.db.prepare('DELETE FROM retry_budgets WHERE task_id=?').run(taskId) } // a fresh owner decision starts a fresh retry epoch
    return r
  }

  // ------------------------------------------------------------ notification outbox (at-least-once, deduplicated by dedupe_key)
  async deliverOutbox() {
    for (const row of claimOutbox(this.ledger)) {
      let ok = false
      try { ok = (await this.adapters.notifier.send(row)) === true } catch { ok = false }
      if (ok) ackOutbox(this.ledger, row.outbox_id)
      else this.ledger.db.prepare("UPDATE outbox SET status='pending', next_attempt_at=? WHERE outbox_id=?").run(this.ledger.now() + 60_000, row.outbox_id)
    }
  }
}
