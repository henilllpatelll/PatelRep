// Developer Harness V3 (D3.2) — task lifecycle reducer (pure). Contract: docs/developer-harness-v3/task-lifecycle.json.
//
// Not a runtime: no database, lease manager or scheduler exists in D3.2. This reducer pins the invariants the D3.4 persistent
// orchestrator must preserve: monotonic revisions, fencing tokens, idempotency, legal transitions only, resume to the recorded state
// only, evidence invalidation on head or policy change, and "a finished session is not a finished task".
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkShape, digestOf, v } from '../lib/canonical.mjs'

export const LIFECYCLE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/developer-harness-v3/task-lifecycle.json')
export const loadLifecycle = (file = LIFECYCLE_PATH) => JSON.parse(readFileSync(file, 'utf8'))

const EVENT_SPEC = {
  required: { event_id: v.id, idempotency_id: v.id, task_id: v.id, kind: v.oneOf('transition', 'session_completed', 'head_changed', 'policy_changed', 'worker_recovered'), expected_revision: v.int, fencing_token: v.int },
  optional: { to: v.id, reason_code: v.id, head_sha: v.sha40, policy_revision: v.sha64, new_fencing_token: v.int, owner_action_id: v.id },
}
const MAX_REMEMBERED = 256
const has = Object.hasOwn

export function createTask({ task_id, production_required = true, security_review_required = true, fencing_token = 1, policy_revision = null }) {
  return Object.freeze({ task_id, state: 'submitted', resume_to: null, via_remediation: false, blocker_reason: null, state_revision: 0, fencing_token, head_sha: null, policy_revision,
    production_required, security_review_required, idempotency: Object.freeze([]), invalidated_evidence: Object.freeze([]) })
}

const isTerminal = (s) => s === 'completed'

/** @returns {{ok:boolean, task:object, problems:string[], duplicate:boolean, invalidated:string[]}} (the input task is returned unchanged unless ok) */
export function applyEvent(lc, task, event) {
  const fail = (...problems) => ({ ok: false, task, problems, duplicate: false, invalidated: [] })
  try {
    if (checkShape(event, EVENT_SPEC, 'event').length) return fail('EVENT.MALFORMED')
    if (event.task_id !== task.task_id) return fail('EVENT.WRONG_TASK')
    // Fencing first: a stale or future token never gets a "success", not even for a replayed idempotency id.
    if (event.fencing_token !== task.fencing_token) return fail('EVENT.STALE_FENCING_TOKEN')
    const digest = digestOf(event)
    const seen = task.idempotency.find((e) => e.id === event.idempotency_id)
    if (seen) return seen.digest === digest ? { ok: true, task, problems: [], duplicate: true, invalidated: [] } : fail('EVENT.IDEMPOTENCY_CONFLICT')
    if (event.expected_revision !== task.state_revision) return fail('EVENT.STALE_REVISION')
    const remembered = Object.freeze([...task.idempotency, Object.freeze({ id: event.idempotency_id, digest })].slice(-MAX_REMEMBERED))
    const next = (patch) => ({ ok: true, task: Object.freeze({ ...task, ...patch, state_revision: task.state_revision + 1, idempotency: remembered }), problems: [], duplicate: false,
      invalidated: patch.invalidated_evidence ?? [] })
    const recoverable = has(lc.recoverable_states, task.state)
    /** The state the task is "really" in: where it will resume to, if it is waiting. */
    const effective = recoverable ? (task.state === 'remediation' ? 'testing' : task.resume_to) : task.state
    const afterMerge = ['merged', 'production_release', 'production_verification'].includes(effective)

    if (event.kind === 'session_completed') return next({}) // recorded, state unchanged: a finished session is not a finished task

    if (event.kind === 'worker_recovered') {
      if (event.new_fencing_token !== task.fencing_token + 1) return fail('EVENT.FENCING_TOKEN_MUST_INCREMENT')
      return next({ fencing_token: event.new_fencing_token })
    }

    if (event.kind === 'head_changed' || event.kind === 'policy_changed') {
      const isHead = event.kind === 'head_changed'
      if (isHead ? !event.head_sha : !event.policy_revision) return fail(isHead ? 'EVENT.HEAD_REQUIRED' : 'EVENT.POLICY_REVISION_REQUIRED')
      if (isTerminal(task.state) || afterMerge) return fail(isHead ? 'EVENT.HEAD_CHANGE_AFTER_MERGE' : 'EVENT.POLICY_CHANGE_AFTER_MERGE')
      if (isHead ? event.head_sha === task.head_sha : event.policy_revision === task.policy_revision) return next({})
      const idx = lc.main_flow.indexOf(effective)
      const verified = idx > lc.main_flow.indexOf('implementing') || task.state === 'remediation'
      const patch = { ...(isHead ? { head_sha: event.head_sha } : { policy_revision: event.policy_revision }),
        invalidated_evidence: isHead ? lc.evidence_invalidation.head_change : ['*'] }
      if (verified) {
        // Verification no longer holds: work resumes from `testing`. A waiting task stays waiting but now resumes there; a task already in
        // remediation keeps going (it re-verifies after implementing anyway).
        if (!recoverable) Object.assign(patch, { state: lc.evidence_invalidation.state_after_head_change })
        else if (task.state !== 'remediation') Object.assign(patch, { resume_to: lc.evidence_invalidation.state_after_head_change })
      }
      return next(patch)
    }

    // transition
    const to = event.to
    if (!to || (!lc.main_flow.includes(to) && !has(lc.recoverable_states, to))) return fail('TRANSITION.UNKNOWN_STATE')
    if (isTerminal(task.state)) return fail('TRANSITION.FROM_TERMINAL')
    if (has(lc.recoverable_states, to)) {
      const spec = lc.recoverable_states[to]
      if (!event.reason_code || !spec.reasons.includes(event.reason_code)) return fail('TRANSITION.REASON_NOT_ALLOWED_FOR_STATE')
      if (to === 'blocked' && lc.never_blocked_reasons.includes(event.reason_code)) return fail('TRANSITION.NEVER_A_GENUINE_BLOCKER')
      if (to === 'remediation' && (recoverable || !lc.remediation_from.includes(task.state))) return fail('TRANSITION.ILLEGAL')
      if (to === 'production_incident' && !lc.incident_from.includes(effective)) return fail('TRANSITION.ILLEGAL')
      const blockerReason = to === 'blocked' ? event.reason_code : null
      if (recoverable) return next({ state: to, blocker_reason: blockerReason }) // moving between waiting states keeps the original resume target
      return next({ state: to, resume_to: task.state, via_remediation: to === 'remediation', blocker_reason: blockerReason })
    }
    if (recoverable) {
      // The only legal exit: back to the recorded state, or to `implementing` when the wait began as remediation.
      const target = task.via_remediation ? 'implementing' : task.resume_to
      if (to !== target) return fail('TRANSITION.MUST_RESUME_TO_RECORDED_STATE')
      if (task.state === 'blocked' && !event.owner_action_id) return fail('TRANSITION.OWNER_ACTION_REQUIRED')
      return next({ state: to, resume_to: null, via_remediation: false, blocker_reason: null })
    }
    if (!lc.forward[task.state].includes(to)) return fail('TRANSITION.ILLEGAL')
    if (task.state === 'independent_review' && to === 'publishing' && task.security_review_required) return fail('TRANSITION.SECURITY_REVIEW_REQUIRED')
    if (task.state === 'independent_review' && to === 'security_review' && !task.security_review_required) return fail('TRANSITION.SECURITY_REVIEW_NOT_REQUIRED')
    if (to === 'completed' && task.state === 'merged' && task.production_required) return fail('TRANSITION.PRODUCTION_REQUIRED')
    if (to === 'production_release' && !task.production_required) return fail('TRANSITION.PRODUCTION_NOT_REQUIRED')
    return next({ state: to })
  } catch { return fail('EVENT.ERROR') }
}
