// Developer Harness V3 (D3.2) — task lifecycle reducer (pure). Contract: docs/developer-harness-v3/task-lifecycle.json.
//
// Not a runtime: no database, lease manager or scheduler exists in D3.2. This reducer pins the invariants the D3.4 persistent
// orchestrator must preserve: monotonic revisions, fencing tokens, idempotency, legal transitions only, resume to the recorded state
// only, evidence invalidation on head or policy change, and "a finished session is not a finished task".
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkShape, v } from '../lib/canonical.mjs'

export const LIFECYCLE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/developer-harness-v3/task-lifecycle.json')
export const loadLifecycle = (file = LIFECYCLE_PATH) => JSON.parse(readFileSync(file, 'utf8'))

const EVENT_SPEC = {
  required: { event_id: v.id, idempotency_id: v.id, task_id: v.id, kind: v.oneOf('transition', 'session_completed', 'head_changed'), expected_revision: v.int, fencing_token: v.int },
  optional: { to: v.id, reason_code: v.id, head_sha: v.sha40 },
}
const MAX_REMEMBERED = 256

export function createTask({ task_id, production_required = true, fencing_token = 1 }) {
  return Object.freeze({ task_id, state: 'submitted', resume_to: null, blocker_reason: null, state_revision: 0, fencing_token, head_sha: null, production_required,
    idempotency_ids: Object.freeze([]), invalidated_evidence: Object.freeze([]) })
}

const isTerminal = (s) => s === 'completed'

/** @returns {{ok:boolean, task:object, problems:string[], duplicate:boolean, invalidated:string[]}} (the input task is returned unchanged unless ok) */
export function applyEvent(lc, task, event) {
  const fail = (...problems) => ({ ok: false, task, problems, duplicate: false, invalidated: [] })
  try {
    if (checkShape(event, EVENT_SPEC, 'event').length) return fail('EVENT.MALFORMED')
    if (event.task_id !== task.task_id) return fail('EVENT.WRONG_TASK')
    if (task.idempotency_ids.includes(event.idempotency_id)) return { ok: true, task, problems: [], duplicate: true, invalidated: [] }
    if (event.fencing_token !== task.fencing_token) return fail('EVENT.STALE_FENCING_TOKEN')
    if (event.expected_revision !== task.state_revision) return fail('EVENT.STALE_REVISION')
    const remembered = Object.freeze([...task.idempotency_ids, event.idempotency_id].slice(-MAX_REMEMBERED))
    const next = (patch) => ({ ok: true, task: Object.freeze({ ...task, ...patch, state_revision: task.state_revision + 1, idempotency_ids: remembered }), problems: [], duplicate: false,
      invalidated: patch.invalidated_evidence ?? [] })

    if (event.kind === 'session_completed') return next({}) // recorded, state unchanged: a finished session is not a finished task

    if (event.kind === 'head_changed') {
      if (!event.head_sha) return fail('EVENT.HEAD_REQUIRED')
      if (isTerminal(task.state) || ['merged', 'production_release', 'production_verification'].includes(task.state)) return fail('EVENT.HEAD_CHANGE_AFTER_MERGE')
      if (event.head_sha === task.head_sha) return next({})
      const idx = lc.main_flow.indexOf(task.state)
      const afterImplement = idx > lc.main_flow.indexOf('implementing') || task.state in lc.recoverable_states
      return next({ head_sha: event.head_sha, invalidated_evidence: lc.evidence_invalidation.head_change,
        ...(afterImplement && task.state !== 'blocked' ? { state: lc.evidence_invalidation.state_after_head_change, resume_to: null, blocker_reason: null } : {}) })
    }

    // transition
    const to = event.to
    if (!to || (!lc.main_flow.includes(to) && !(to in lc.recoverable_states))) return fail('TRANSITION.UNKNOWN_STATE')
    if (isTerminal(task.state)) return fail('TRANSITION.FROM_TERMINAL')
    if (to in lc.recoverable_states) {
      const spec = lc.recoverable_states[to]
      if (!event.reason_code || !spec.reasons.includes(event.reason_code)) return fail('TRANSITION.REASON_NOT_ALLOWED_FOR_STATE')
      if (to === 'blocked' && lc.never_blocked_reasons.includes(event.reason_code)) return fail('TRANSITION.NEVER_A_GENUINE_BLOCKER')
      if (to === 'remediation' && !lc.remediation_from.includes(task.state)) return fail('TRANSITION.ILLEGAL')
      if (to === 'production_incident' && !lc.incident_from.includes(task.state) && !(task.state in lc.recoverable_states)) return fail('TRANSITION.ILLEGAL')
      if (task.state in lc.recoverable_states) {
        // moving between recoverable states keeps the ORIGINAL resume target; remediation is entered from, and returns to, active work.
        if (to === 'remediation') return fail('TRANSITION.ILLEGAL')
        return next({ state: to, blocker_reason: to === 'blocked' ? event.reason_code : null })
      }
      return next({ state: to, resume_to: task.state, blocker_reason: to === 'blocked' ? event.reason_code : null })
    }
    if (task.state in lc.recoverable_states) {
      const target = task.state === 'remediation' ? 'implementing' : task.resume_to
      if (to !== target) return fail('TRANSITION.MUST_RESUME_TO_RECORDED_STATE')
      return next({ state: to, resume_to: null, blocker_reason: null })
    }
    if (!lc.forward[task.state].includes(to)) return fail('TRANSITION.ILLEGAL')
    if (to === 'completed' && task.state === 'merged' && task.production_required) return fail('TRANSITION.PRODUCTION_REQUIRED')
    if (to === 'production_release' && !task.production_required) return fail('TRANSITION.PRODUCTION_NOT_REQUIRED')
    return next({ state: to })
  } catch { return fail('EVENT.ERROR') }
}
