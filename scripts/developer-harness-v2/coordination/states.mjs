// Developer Harness V2 — Phase 5 deterministic task lifecycle.
//
// A pure, in-process state machine. It starts nothing, grants nothing and runs no background process. It decides ONE
// thing: whether a requested lifecycle transition is legal given the record and INDEPENDENTLY gathered facts. Every
// decision carries reason codes. It cannot control the Claude Code runtime: enforcement exists only for callers that
// route their lifecycle changes through applyTransition (the coordination CLI does).
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadContract } from '../policy-engine.mjs'
import { PLAN_SCHEMA, planRouting, verifyDiffAgainstPlan } from '../routing/router.mjs'
import {
  ApprovalLedger, authorizeAction, canonical, evidenceHead, isVerifiedRemote, latestPass, makeEvidence, openBlockingFindings, reconcileEvidence, sha256, validEvidence,
} from './evidence.mjs'

export { canonical, sha256 }
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

export const STATES = Object.freeze(['requested', 'planned', 'implementing', 'testing', 'reviewing', 'pr_open', 'ci_running', 'staging_running', 'ready_for_human_review', 'blocked', 'unproven'])
export const ORDER = Object.freeze({ requested: 0, planned: 1, implementing: 2, testing: 3, reviewing: 4, pr_open: 5, ci_running: 6, staging_running: 7, ready_for_human_review: 8 })
export const STOP_STATES = Object.freeze(['blocked', 'unproven'])
/** `unproven` only ever follows `pr_open` or later, so it is held to the pr_open evidence bar. */
export const rank = (state) => (state === 'unproven' ? ORDER.pr_open : ORDER[state])
export const PR_BASE = 'main'

/** Is `facts` about THIS task's worktree/branch/history? Used by every mutating entry point, not only the CLI. */
export function identityProblems(record, facts) {
  const p = []
  if (facts.worktree_id !== record.repo.worktree_id) p.push('IDENTITY.WORKTREE_CHANGED')
  if (facts.branch !== record.repo.branch) p.push('IDENTITY.BRANCH_CHANGED')
  if (facts.base_is_ancestor !== true) p.push('IDENTITY.BASE_NOT_ANCESTOR_OF_HEAD')
  if (facts.unmerged || facts.operation_in_progress) p.push('WORKTREE.UNRECONCILED_GIT_OPERATION')
  if (['unrelated', 'unknown_object'].includes(facts.recorded_head_relation)) p.push('HISTORY.RECORDED_HEAD_NOT_AN_ANCESTOR')
  return p
}

/** Live predicates over a provider-verified snapshot. The single definition used by transitions AND resume. */
export function remoteGates(record, facts, remote) {
  const r = isVerifiedRemote(remote) ? remote : null
  const passed = (g) => Boolean(g) && g.head_sha === facts.head_sha && g.status === 'completed' && g.conclusion === 'success'
  const prOpen = Boolean(r?.pr) && r.pr.head_sha === facts.head_sha && r.pr.state === 'open' && r.pr.head_ref === record.repo.branch && r.pr.base_ref === PR_BASE
  const c = r?.staging_candidate
  const candidateOk = Boolean(c) && prOpen && c.candidate_sha === facts.head_sha && c.pr_number === r.pr.number && c.branch === r.pr.head_ref && c.branch === record.repo.branch
  return { remote: r, prOpen, ciObserved: Boolean(r?.ci_gate) && r.ci_gate.head_sha === facts.head_sha, ciPassed: passed(r?.ci_gate), candidateOk, stagingPassed: passed(r?.staging_gate) }
}
/** What the live snapshot must show for a recorded remote state to still be believable. */
export function liveGateProblems(record, facts, remote, state = record.state) {
  const g = remoteGates(record, facts, remote)
  const p = []
  if (!g.remote) return ['REMOTE.NO_VERIFIED_GITHUB_SNAPSHOT']
  if (!g.prOpen) p.push('REMOTE.PR_NOT_OPEN_AT_HEAD_ON_TASK_BRANCH')
  if (['ci_running', 'staging_running', 'ready_for_human_review'].includes(state) && !g.ciObserved) p.push('REMOTE.CI_GATE_NOT_OBSERVED_FOR_HEAD')
  if (['staging_running', 'ready_for_human_review'].includes(state)) { if (!g.ciPassed) p.push('EVIDENCE.CI_GATE_NOT_PASSED_FOR_HEAD'); if (!g.candidateOk) p.push('EVIDENCE.STAGING_CANDIDATE_IDENTITY_MISMATCH') }
  if (state === 'ready_for_human_review' && !g.stagingPassed) p.push('EVIDENCE.STAGING_GATE_NOT_PASSED_FOR_HEAD')
  return p
}
/** Explicit transition table. Anything not listed is illegal. blocked is terminal; unproven returns only through fresh remote proof. */
export const TRANSITIONS = Object.freeze({
  requested: ['planned', 'blocked'],
  planned: ['implementing', 'blocked'],
  implementing: ['testing', 'blocked'],
  testing: ['reviewing', 'implementing', 'blocked'],
  reviewing: ['pr_open', 'implementing', 'blocked'],
  pr_open: ['ci_running', 'implementing', 'blocked', 'unproven'],
  ci_running: ['staging_running', 'implementing', 'blocked', 'unproven'],
  staging_running: ['ready_for_human_review', 'implementing', 'blocked', 'unproven'],
  ready_for_human_review: ['implementing', 'blocked'],
  blocked: [],
  unproven: ['pr_open', 'implementing', 'blocked'],
})

export const contractDigest = (c) => sha256(canonical([c.version, c.roles, c.actions, c.protected_paths, c.topology]))
export const loadRepoContract = (root = REPO_ROOT) => loadContract(path.join(root, 'docs/developer-harness-v2/contract.json'))
export const scopeDigestOf = (files) => sha256(canonical([...new Set(files)].sort()))

/** Snapshot of a routing plan sufficient to rebuild and verify it. The plan itself is recomputed, never trusted from disk. */
export function planSummary(input) {
  const plan = planRouting(input)
  const contract = loadRepoContract()
  return {
    plan,
    summary: {
      schema: PLAN_SCHEMA, input: { task: input.task, files: [...(input.files ?? [])], surface: input.surface ?? null, modification: input.modification ?? 'edit', authorize: [...(input.authorize ?? [])] },
      digest: sha256(canonical(plan)), contract_digest: contractDigest(contract), status: plan.status, sequence: [...plan.sequence],
      required_roles: plan.roles.required.map((r) => r.role), security_required: plan.reviews.security,
      human_approvals: plan.human_approvals.map((a) => ({ action: a.action, path: a.path })), side_effects: plan.side_effects_authorized.map((s) => s.action),
    },
  }
}
/** Rebuild the plan from the stored INPUT and report whether it still equals what was recorded. */
export function rebuildPlan(record) {
  const plan = planRouting({ ...record.plan.input, files: record.plan.input.files, surface: record.plan.input.surface ?? undefined })
  const contract = loadRepoContract()
  const problems = []
  if (sha256(canonical(plan)) !== record.plan.digest) problems.push('PLAN.DIGEST_CHANGED')
  if (contractDigest(contract) !== record.plan.contract_digest) problems.push('PLAN.CONTRACT_CHANGED')
  if (canonical(plan.roles.required.map((r) => r.role)) !== canonical(record.plan.required_roles)) problems.push('PLAN.REQUIRED_ROLES_CHANGED')
  // Every stored summary field (approvals, side effects, security flag, sequence) must equal what the stored INPUT derives.
  // The input itself has no anchor outside the checkpoint (documented limitation).
  const { input: _a, digest: _b, contract_digest: _c, ...derived } = planSummary(record.plan.input).summary
  const { input: _d, digest: _e, contract_digest: _f, ...stored } = record.plan
  if (canonical(derived) !== canonical(stored)) problems.push('PLAN.SUMMARY_MISMATCH')
  return { plan, problems, contract }
}

export function createRecord({ task_id, input, base_sha, facts, now = new Date().toISOString() }) {
  const { summary } = planSummary(input)
  const files = summary.input.files
  return {
    schema: 'developer-harness-v2/checkpoint@1', schema_version: 1, revision: 1, task_id, created_at: now, updated_at: now,
    repo: { base_sha, branch: facts.branch, head_sha: facts.head_sha, worktree_id: facts.worktree_id, tree_digest: facts.tree_digest },
    state: 'requested', state_history: [{ from: null, to: 'requested', at: now, event_id: `create-${task_id}`, actor: 'coordinator', reason_code: 'TASK.CREATED', reason: 'checkpoint created', evidence_ids: [] }],
    stop: null, plan: summary, scope: { files: [...files].sort(), digest: scopeDigestOf(files) },
    handoffs: [], evidence: [], findings: [], approvals: [], event_ids: [`create-${task_id}`],
  }
}

const push = (rec, entry) => {
  rec.state_history.push(entry)
  rec.event_ids = [...rec.event_ids, entry.event_id].slice(-2000)
  rec.state = entry.to
  rec.stop = STOP_STATES.includes(entry.to) ? { kind: entry.to, codes: [entry.reason_code], detail: entry.reason } : null
}

/** Record-internal consistency: the state must be supported by the evidence that is recorded for it. Never repairs. */
export function checkStateConsistency(record) {
  const p = []
  const last = record.state_history.at(-1)
  if (!last || last.to !== record.state) p.push('CONSISTENCY.HISTORY_TAIL_MISMATCH')
  for (let i = 1; i < record.state_history.length; i++) {
    const h = record.state_history[i]
    if (record.state_history[i - 1].to !== h.from) p.push('CONSISTENCY.HISTORY_CHAIN_BROKEN')
    if (!TRANSITIONS[h.from]?.includes(h.to)) p.push('CONSISTENCY.HISTORY_ILLEGAL_TRANSITION')
  }
  // A state is supported only by VALID evidence (passing where a pass is the point). Invalidated or failing records never count.
  const has = (k, pass = true) => record.evidence.some((e) => e.kind === k && e.status === 'valid' && (!pass || e.result === 'pass'))
  const o = rank(record.state)
  if (o >= ORDER.reviewing && !has('local_tests')) p.push('CONSISTENCY.MISSING_LOCAL_TEST_EVIDENCE')
  if (o >= ORDER.pr_open && !has('review')) p.push('CONSISTENCY.MISSING_REVIEWER_EVIDENCE')
  if (o >= ORDER.pr_open && record.plan.security_required && !has('security_review')) p.push('CONSISTENCY.MISSING_SECURITY_REVIEW_EVIDENCE')
  if (o >= ORDER.pr_open && !has('pull_request', false)) p.push('CONSISTENCY.MISSING_PR_EVIDENCE')
  if (o >= ORDER.ci_running && !has('ci_gate', false)) p.push('CONSISTENCY.MISSING_CI_EVIDENCE')
  if (o >= ORDER.staging_running && !has('staging_candidate', false)) p.push('CONSISTENCY.MISSING_STAGING_CANDIDATE_EVIDENCE')
  if (o >= ORDER.ready_for_human_review && !has('staging_gate')) p.push('CONSISTENCY.MISSING_STAGING_GATE_EVIDENCE')
  const writers = record.handoffs.filter((h) => h.status === 'active' && h.writes_code)
  if (writers.length > 1) p.push('CONSISTENCY.MULTIPLE_ACTIVE_WRITERS')
  if (record.handoffs.filter((h) => h.status === 'active').length > 1) p.push('CONSISTENCY.MULTIPLE_ACTIVE_ROLES')
  return [...new Set(p)]
}

/** Turn an independently verified remote snapshot into evidence records bound to its exact SHAs. Idempotent. */
export function adoptRemote(record, remote, now) {
  if (!isVerifiedRemote(remote)) return record
  const next = structuredClone(record)
  const add = (kind, result, bound, summary) => {
    const head = kind === 'staging_candidate' ? bound.candidate_sha : bound.head_sha
    const same = validEvidence(next, kind).filter((e) => evidenceHead(e) === head)
    if (same.length === 1 && same[0].result === result && canonical(same[0].bound) === canonical(bound)) return
    for (const e of same) { e.status = 'invalidated'; e.invalidated = { code: 'EVIDENCE.SUPERSEDED', at: now, reason: 'newer observation for the same head' } }
    next.evidence.push(makeEvidence({ kind, result, by: 'github_provider', bound, summary, now }))
  }
  const res = (g) => (g.status !== 'completed' ? 'pending' : g.conclusion === 'success' ? 'pass' : 'fail')
  if (remote.pr) add('pull_request', remote.pr.state === 'open' && remote.pr.draft ? 'pass' : 'fail', { head_sha: remote.pr.head_sha, pr_number: remote.pr.number, branch: remote.pr.head_ref }, `PR #${remote.pr.number} ${remote.pr.state}${remote.pr.draft ? ' draft' : ''}`)
  if (remote.ci_gate) add('ci_gate', res(remote.ci_gate), { head_sha: remote.ci_gate.head_sha, pr_number: remote.pr?.number ?? null }, `CI Gate ${remote.ci_gate.status}/${remote.ci_gate.conclusion}`)
  if (remote.staging_candidate) add('staging_candidate', 'pass', { candidate_sha: remote.staging_candidate.candidate_sha, pr_number: remote.staging_candidate.pr_number, branch: remote.staging_candidate.branch }, 'staging candidate observed')
  if (remote.staging_gate) add('staging_gate', res(remote.staging_gate), { head_sha: remote.staging_gate.head_sha, pr_number: remote.pr?.number ?? null }, `Staging Gate ${remote.staging_gate.status}/${remote.staging_gate.conclusion}`)
  return next
}

/**
 * Apply independently gathered facts to a record: refresh head/tree identity, invalidate stale evidence and regress to
 * `implementing` when local work changed after testing began. Returns the (possibly regressed) record. Never loses data.
 */
export function syncWithFacts(record, facts, remote, now) {
  const { record: rec, invalidations } = reconcileEvidence(record, facts, isVerifiedRemote(remote) ? remote : null, now)
  const changed = record.repo.head_sha !== facts.head_sha || record.repo.tree_digest !== facts.tree_digest
  rec.repo.head_sha = facts.head_sha
  rec.repo.tree_digest = facts.tree_digest
  rec.repo.worktree_id = record.repo.worktree_id
  let regressed = false
  if (changed && (ORDER[rec.state] >= ORDER.testing || rec.state === 'unproven')) {
    push(rec, { from: rec.state, to: 'implementing', at: now, event_id: `regress-${facts.head_sha.slice(0, 12)}-${facts.tree_digest.slice(0, 12)}`, actor: 'system', reason_code: record.repo.head_sha !== facts.head_sha ? 'EVIDENCE.HEAD_CHANGED' : 'EVIDENCE.TREE_CHANGED', reason: 'local work changed after verification began; prior test, review and remote evidence no longer applies', evidence_ids: invalidations.map((i) => i.id) })
    regressed = true
  }
  return { record: rec, invalidations, regressed }
}

const REVIEWERS = ['independent_reviewer', 'security_reviewer']
const POST_PR = ['pr_open', 'ci_running', 'staging_running', 'ready_for_human_review']

/** A recorded FAIL after verification began sends the task back to implementing: a later pass elsewhere cannot hide it. */
export function regressForFailure(record, code, reason, now, eventId) {
  const next = structuredClone(record)
  if (rank(next.state) < ORDER.reviewing || STOP_STATES.includes(next.state)) return next
  push(next, { from: next.state, to: 'implementing', at: now, event_id: eventId, actor: 'system', reason_code: code, reason: String(reason).slice(0, 300), evidence_ids: [] })
  next.updated_at = now
  return next
}

/** Local support a recorded lifecycle state still needs (tests, reviews, blocking findings). Shared by resume and requestAction. */
export function localSupportProblems(rec, plan, facts, humanDecisions) {
  const p = []
  const r = rank(rec.state)
  if (r >= ORDER.reviewing && !latestPass(rec, 'local_tests')) p.push('EVIDENCE.LOCAL_TESTS_MISSING_OR_STALE')
  if (r >= ORDER.pr_open) {
    if (!latestPass(rec, 'review')) p.push('EVIDENCE.INDEPENDENT_REVIEW_MISSING_OR_STALE')
    if (plan.reviews.security && !latestPass(rec, 'security_review')) p.push('EVIDENCE.SECURITY_REVIEW_MISSING_OR_STALE')
    if (openBlockingFindings(rec, facts, humanDecisions).length) p.push('FINDING.BLOCKING_OPEN')
  }
  return p
}

/** Everything that must hold LOCALLY before a push / draft PR is even requested (shared by the transition and by requestAction). */
export function localPrProblems(rec, plan, facts, humanDecisions) {
  const p = []
  const done = (role) => rec.handoffs.some((h) => h.role === role && h.status === 'completed' && h.head_sha === facts.head_sha)
  const acts = new Set(plan.side_effects_authorized.map((s) => s.action))
  if (!(plan.status === 'routed' && acts.has('push_dedicated_branch_fast_forward') && acts.has('open_draft_pull_request'))) p.push('SIDE_EFFECT.PUSH_AND_DRAFT_PR_NOT_TASK_AUTHORIZED')
  if (!latestPass(rec, 'local_tests')) p.push('EVIDENCE.LOCAL_TESTS_MISSING_OR_STALE')
  if (!(done('independent_reviewer') && latestPass(rec, 'review'))) p.push('EVIDENCE.INDEPENDENT_REVIEW_MISSING_OR_STALE')
  if (plan.reviews.security && !(done('security_reviewer') && latestPass(rec, 'security_review'))) p.push('EVIDENCE.SECURITY_REVIEW_MISSING_OR_STALE')
  if (openBlockingFindings(rec, facts, humanDecisions).length) p.push('FINDING.BLOCKING_OPEN')
  if (facts.dirty) p.push('TREE.DIRTY_UNPUSHED_CHANGES')
  return p
}
const fail = (record, codes, extra = {}) => ({ ok: false, record, codes: [...new Set(codes)], ...extra })

/**
 * @param ctx { facts, remote?, ledger?, now?, event_id, reason_code?, reason?, humanDecisions?, actor? }
 * @returns {{ok:boolean, record, codes:string[], duplicate?:boolean, regressed?:boolean, invalidations?:object[]}}
 */
export function applyTransition(record, to, ctx) {
  const now = ctx.now ?? new Date().toISOString()
  if (!ctx.event_id) return fail(record, ['TRANSITION.EVENT_ID_REQUIRED'])
  if (record.event_ids.includes(ctx.event_id)) {
    const prior = record.state_history.find((h) => h.event_id === ctx.event_id)
    if (prior && prior.to === to) return { ok: true, duplicate: true, record, codes: ['TRANSITION.DUPLICATE_EVENT_IGNORED'] }
    return fail(record, ['TRANSITION.EVENT_ID_REUSED_FOR_DIFFERENT_TARGET'])
  }
  if (!STATES.includes(to)) return fail(record, ['TRANSITION.UNKNOWN_STATE'])
  if (record.state === 'blocked') return fail(record, ['TRANSITION.FROM_TERMINAL_BLOCKED'])
  if (!TRANSITIONS[record.state].includes(to)) return fail(record, ['TRANSITION.ILLEGAL'], { from: record.state, to })
  if (to === 'blocked') {
    // The safe stop must always be recordable — even when the plan, contract or checkpoint consistency is what went wrong.
    if (!ctx.reason_code) return fail(record, ['TRANSITION.REASON_CODE_REQUIRED'])
    const next = structuredClone(record)
    push(next, { from: next.state, to: 'blocked', at: now, event_id: ctx.event_id, actor: ctx.actor ?? 'coordinator', reason_code: ctx.reason_code, reason: String(ctx.reason ?? 'stop recorded').slice(0, 300), evidence_ids: [] })
    next.updated_at = now
    return { ok: true, record: next, codes: [ctx.reason_code] }
  }
  const bad = [...checkStateConsistency(record), ...identityProblems(record, ctx.facts)]
  if (bad.length) return fail(record, bad)

  // Adopt first, reconcile second: remote evidence for any SHA other than the local head is invalidated before any guard reads it.
  const synced = syncWithFacts(adoptRemote(record, ctx.remote, now), ctx.facts, ctx.remote, now)
  const rec = synced.record
  if (synced.regressed) return { ...fail(rec, ['TRANSITION.STATE_REGRESSED', ...synced.invalidations.map((i) => i.code)]), regressed: true, invalidations: synced.invalidations }

  const { plan, problems } = rebuildPlan(rec)
  const f = [...problems]
  const facts = ctx.facts
  const remote = isVerifiedRemote(ctx.remote) ? ctx.remote : null
  const need = (cond, code) => { if (!cond) f.push(code) }
  const from = rec.state
  // Reviewer handoffs only count at THIS head; planner/implementer handoffs legitimately span the commits they produce.
  const handoffDone = (role) => rec.handoffs.some((h) => h.role === role && h.status === 'completed' && (!REVIEWERS.includes(role) || h.head_sha === facts.head_sha))
  const blocking = openBlockingFindings(rec, facts, ctx.humanDecisions)
  const sideEffects = new Set(plan.side_effects_authorized.map((s) => s.action))
  const gates = remoteGates(rec, facts, remote)
  const { prOpen, candidateOk } = gates
  const evidenceIds = []
  const cite = (e) => { if (e) evidenceIds.push(e.id); return e }

  if (to === 'planned') {
    need(plan.status === 'routed', 'PLAN.NOT_ROUTED')
  } else if (to === 'implementing' && from === 'planned') {
    need(plan.status === 'routed', 'PLAN.NOT_ROUTED')
    if (plan.roles.required.some((r) => r.role === 'planner')) need(handoffDone('planner'), 'PLAN.REQUIRED_PLANNER_NOT_COMPLETED')
    // Approvals come from the REBUILT plan (never the stored summary). Check all first, then consume all: a failure elsewhere must not burn them.
    const led = ctx.ledger ?? new ApprovalLedger()
    const reqs = [...new Map(plan.human_approvals.map((a) => [`${a.action}|${a.path}`, { action: a.action, target: a.path }])).values()]
    const missing = reqs.filter((a) => !led.has(a.action, a.target, rec.task_id, facts.head_sha))
    if (missing.length) f.push('APPROVAL.FRESH_REQUIRED', ...missing.map((m) => `APPROVAL.MISSING.${m.action}`))
    else if (!f.length) {
      for (const a of reqs) {
        const c = led.consume({ ...a, task_id: rec.task_id, head_sha: facts.head_sha })
        if (!c.ok) f.push(c.code, 'APPROVAL.FRESH_REQUIRED')
        else rec.approvals.push({ id: c.approval_id, action: a.action, target: a.target, task_id: rec.task_id, head_sha: facts.head_sha, recorded_at: now, expires_at: c.expires_at, single_use: true, consumed: true, audit_only: true, origin: 'session_attestation' })
      }
    }
  } else if (to === 'testing') {
    need(handoffDone('implementer'), 'HANDOFF.IMPLEMENTER_NOT_COMPLETED')
    const d = verifyDiffAgainstPlan(plan, facts.changed_files)
    if (!d.ok) f.push('SCOPE.DIFF_NOT_COVERED_BY_PLAN', ...d.stops.map((s) => s.code), ...d.addedTriggers.map((t) => `SCOPE.ADDED_TRIGGER.${t}`))
    if (rec.scope.files.length) need(facts.changed_files.every((x) => rec.scope.files.includes(x)), 'SCOPE.OUTSIDE_APPROVED_SCOPE')
  } else if (to === 'reviewing') {
    need(cite(latestPass(rec, 'local_tests')), 'EVIDENCE.LOCAL_TESTS_MISSING_OR_STALE')
  } else if (to === 'pr_open') {
    f.push(...localPrProblems(rec, plan, facts, ctx.humanDecisions))
    for (const k of ['local_tests', 'review', 'security_review']) cite(latestPass(rec, k))
    need(prOpen && remote.pr.draft, 'REMOTE.UNPROVEN_OR_PR_HEAD_MISMATCH')
    cite(validEvidence(rec, 'pull_request').at(-1))
  } else if (to === 'ci_running') {
    need(prOpen, 'REMOTE.UNPROVEN_OR_PR_HEAD_MISMATCH')
    need(remote?.ci_gate && remote.ci_gate.head_sha === facts.head_sha, 'REMOTE.CI_GATE_NOT_OBSERVED_FOR_HEAD')
    cite(validEvidence(rec, 'ci_gate').at(-1))
  } else if (to === 'staging_running') {
    // Gates are decided from the LIVE verified snapshot in this very call; remote-kind evidence read from disk is history only.
    need(prOpen, 'REMOTE.UNPROVEN_OR_PR_HEAD_MISMATCH')
    need(gates.ciPassed, 'EVIDENCE.CI_GATE_NOT_PASSED_FOR_HEAD')
    need(candidateOk, 'EVIDENCE.STAGING_CANDIDATE_IDENTITY_MISMATCH')
    cite(validEvidence(rec, 'ci_gate').at(-1)); cite(validEvidence(rec, 'staging_candidate').at(-1))
  } else if (to === 'ready_for_human_review') {
    need(prOpen, 'REMOTE.UNPROVEN_OR_PR_HEAD_MISMATCH')
    need(gates.ciPassed, 'EVIDENCE.CI_GATE_NOT_PASSED_FOR_HEAD')
    need(candidateOk, 'EVIDENCE.STAGING_CANDIDATE_IDENTITY_MISMATCH')
    need(gates.stagingPassed, 'EVIDENCE.STAGING_GATE_NOT_PASSED_FOR_HEAD')
    cite(validEvidence(rec, 'ci_gate').at(-1)); cite(validEvidence(rec, 'staging_candidate').at(-1)); cite(validEvidence(rec, 'staging_gate').at(-1))
    need(cite(latestPass(rec, 'local_tests')) && cite(latestPass(rec, 'review')), 'EVIDENCE.LOCAL_OR_REVIEW_STALE')
    if (plan.reviews.security) need(cite(latestPass(rec, 'security_review')), 'EVIDENCE.SECURITY_REVIEW_MISSING_OR_STALE')
    need(blocking.length === 0, 'FINDING.BLOCKING_OPEN')
    need(!facts.dirty, 'TREE.DIRTY_UNPUSHED_CHANGES')
  } else if (to === 'unproven') {
    need(!remote, 'UNPROVEN.REMOTE_EVIDENCE_IS_AVAILABLE')
  } else if (to === 'blocked') {
    need(Boolean(ctx.reason_code), 'TRANSITION.REASON_CODE_REQUIRED')
  } else if (to === 'implementing') {
    need(Boolean(ctx.reason_code), 'TRANSITION.REASON_CODE_REQUIRED')
  }
  if (f.length) return fail(record, f) // never hand back a half-reconciled record: persisting it would break its own consistency

  const reasonCode = ctx.reason_code ?? `TRANSITION.${from.toUpperCase()}_TO_${to.toUpperCase()}`
  push(rec, { from, to, at: now, event_id: ctx.event_id, actor: ctx.actor ?? 'coordinator', reason_code: reasonCode, reason: String(ctx.reason ?? 'guards satisfied').slice(0, 300), evidence_ids: [...new Set(evidenceIds)] })
  rec.updated_at = now
  return { ok: true, record: rec, codes: [reasonCode], invalidations: synced.invalidations }
}

/**
 * Request a side-effecting action. `run` executes only on allow. A stale-SHA or other-task approval blocks the task
 * (N-7): the approval is revoked, the state becomes `blocked` and no side effect runs.
 */
export function requestAction(record, req, ctx, run = null) {
  const now = ctx.now ?? new Date().toISOString()
  const deny = (code, reason, rec = record) => ({ allowed: false, code, reason, blocking: false, record: rec })
  const { plan, contract, problems } = rebuildPlan(record)
  if (problems.length) return { ...deny(problems[0], 'plan or contract changed; no action authorized'), record: applyBlock(record, ctx, now, problems[0], 'plan or contract changed; no action authorized') }
  const cls = contract.actions[req.action]
  if (!cls) return deny('ACTION.UNKNOWN', 'action is not in the contract')
  if (cls === 'forbidden') return deny('ACTION.FORBIDDEN', 'forbidden under any approval')
  if (cls === 'task_authorized' && !plan.side_effects_authorized.some((s) => s.action === req.action)) return deny('ACTION.NOT_TASK_AUTHORIZED', 'the human task request did not name this side effect')
  const idp = identityProblems(record, ctx.facts)
  if (idp.length) return deny(idp[0], 'not the worktree/branch/history this task started in')
  if (STOP_STATES.includes(record.state)) return deny('ACTION.TASK_IS_STOPPED', `task is ${record.state}; no side effect may run`)
  const ledger = ctx.ledger ?? new ApprovalLedger()
  const fit = { push_dedicated_branch_fast_forward: ['reviewing'], open_draft_pull_request: ['reviewing'], interact_with_pull_request_or_issue: POST_PR, modify_pull_request_state: POST_PR, mark_pull_request_ready_for_review: ['ready_for_human_review'] }[req.action]
  const allowedStates = fit ?? (cls === 'allowed' ? STATES.filter((s) => !STOP_STATES.includes(s)) : ['implementing', 'testing'])
  // N-7: a live grant (same action, same target, unexpired) given for ANOTHER head is stale. It is always revoked. If the action
  // was otherwise legal in the recorded state, the task is blocked; if it never could have applied, only the denial is returned.
  if (ledger.revokeStale({ action: req.action, target: req.target, task_id: record.task_id, head_sha: ctx.facts.head_sha })) {
    if (allowedStates.includes(record.state)) return { allowed: false, code: 'APPROVAL.STALE_SHA', reason: 'approval was given for a different head SHA; it is revoked', blocking: true, record: applyBlock(record, ctx, now, 'APPROVAL.STALE_SHA', 'approval given for a different head SHA') }
    return deny('APPROVAL.STALE_SHA', 'approval was given for a different head SHA; it is revoked (the action was not legal in this state anyway)')
  }
  const inconsistent = checkStateConsistency(record)
  if (inconsistent.length) return { ...deny(inconsistent[0], 'checkpoint is internally inconsistent'), codes: inconsistent }
  const synced = syncWithFacts(record, ctx.facts, null, now)
  if (synced.regressed) return deny('ACTION.STATE_REGRESSED_RESYNC_FIRST', 'local work changed; prior evidence is invalidated', synced.record)
  const state = synced.record.state
  if (!allowedStates.includes(state)) return deny('ACTION.WRONG_LIFECYCLE_STATE', `${req.action} is not legal in ${state}`, synced.record)
  if (['push_dedicated_branch_fast_forward', 'open_draft_pull_request'].includes(req.action)) {
    const lp = localPrProblems(synced.record, plan, ctx.facts, ctx.humanDecisions)
    if (lp.length) return { ...deny(lp[0], `local readiness not met: ${lp.join(', ')}`, synced.record), codes: lp }
  } else if (cls !== 'allowed' && POST_PR.includes(state)) {
    // Acting on a PR trusts nothing recorded: local support AND the live GitHub snapshot must still hold.
    const live = [...localSupportProblems(synced.record, plan, ctx.facts, ctx.humanDecisions), ...liveGateProblems(synced.record, ctx.facts, ctx.remote)]
    if (live.length) return { ...deny(live.includes('REMOTE.NO_VERIFIED_GITHUB_SNAPSHOT') ? 'REMOTE.UNPROVEN' : live[0], `recorded state not supported now: ${live.join(', ')}`, synced.record), codes: live }
  }
  const d = authorizeAction(synced.record, req, ctx.facts, contract, plan, ledger, run)
  if (!d.allowed && d.blocking && record.state !== 'blocked') return { ...d, record: applyBlock(record, ctx, now, d.code, d.reason) }
  return { ...d, record: synced.record }
}
function applyBlock(record, ctx, now, code, reason) {
  const next = structuredClone(record)
  if (next.state === 'blocked') return next
  push(next, { from: next.state, to: 'blocked', at: now, event_id: `block-${code}-${sha256(canonical([ctx.facts.head_sha, now])).slice(0, 8)}`, actor: 'system', reason_code: code, reason: String(reason).slice(0, 300), evidence_ids: [] })
  next.updated_at = now
  return next
}

/** Legal next step per state (documentation of the exact recovery action; never an authorization). */
export const RECOVERY_ACTION = Object.freeze({
  requested: 'Rebuild the routing plan from the stored task input and transition requested→planned if it still routes.',
  planned: 'Obtain FRESH human approvals for any protected path, complete the planner handoff if the plan requires one, then planned→implementing.',
  implementing: 'Continue in the same worktree. Uncommitted changes are preserved; never reset, stash, clean or rebase them.',
  testing: 'Re-run local checks against the CURRENT tree and record fresh local_tests evidence.',
  reviewing: 'Run any missing independent/security reviewer on the final diff, or — if every review is valid — wait for a freshly confirmed, task-authorized push.',
  pr_open: 'Read GitHub state through a verified provider (read-only). Do not push or modify the PR without fresh authorization.',
  ci_running: 'Observe CI Gate for the exact head through a verified provider. Never dispatch a workflow.',
  staging_running: 'Observe Staging Candidate provenance and Staging Gate for the exact head through a verified provider. Never dispatch a workflow.',
  ready_for_human_review: 'Report ready_for_human_review. A human reviews and merges; the harness never merges.',
  blocked: 'No automatic recovery. Inspect read-only and return to the human with the recorded reason codes.',
  unproven: 'Supply a verified GitHub provider snapshot and re-evaluate. Never assume CI or Staging passed.',
})
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
