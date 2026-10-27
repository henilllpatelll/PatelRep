// Idempotent checkpoint state for the dependency orchestrator. The state lives in a workflow artifact written by the
// trusted workflow, so an interrupted run resumes from GitHub, not from a chat session.
//
// The state is UNTRUSTED input on load: it is strictly re-validated, can never authorize a merge
// (approvals come only from the trusted policy on main) and every safety decision is recomputed from
// live GitHub facts.
export const STATE_SCHEMA = 1
const HISTORY_LIMIT = 300
const BLOCKER_LIMIT = 8
const PR_STATUSES = ['queued', 'waiting-ci', 'waiting-staging', 'updating', 'repairing', 'verified', 'blocked', 'superseded', 'merged', 'closed']
export const TERMINAL_STATUSES = new Set(['verified', 'blocked', 'superseded', 'merged', 'closed'])
const BATCH_STATUSES = ['idle', 'active', 'complete', 'halted']
const COUNTERS = ['update_branch', 'repair', 'staging', 'reverify', 'research']

const text = (value, max = 300) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, max)
const count = (value) => (Number.isInteger(value) && value >= 0 && value < 10000 ? value : 0)
const sha = (value) => (/^[0-9a-f]{40}$/.test(value ?? '') ? value : null)

export function emptyState(now = new Date().toISOString()) {
  return {
    schema: STATE_SCHEMA,
    batch: { id: null, status: 'idle', mode: 'plan-only', started_at: null, deadline_at: null, ticks: 0, requested_prs: null, last_tick_at: null, finished_at: null },
    prs: {},
    order: [],
    history: [],
    research: {},
    metrics: { branch_updates: 0, staging_dispatches: 0, repair_requests: 0, merges: 0, claude_invocations: 0, claude_usd: 0, ci_minutes: 0, staging_minutes: 0, wall_ms: 0 },
    updated_at: now,
  }
}

export function emptyPr(number) {
  return {
    number,
    status: 'queued',
    risk: 'low',
    head_sha: null,
    attempts: Object.fromEntries(COUNTERS.map((key) => [key, 0])),
    attempt_main_sha: null,
    staging_dispatched_for: null,
    wait_since: null,
    verified: null,
    blockers: [],
    updated_at: null,
  }
}

/** Strict re-validation. Anything malformed is dropped, never trusted. */
export function validateState(raw) {
  if (!raw || raw.schema !== STATE_SCHEMA || typeof raw.batch !== 'object' || typeof raw.prs !== 'object') throw new Error('orchestrator state: unsupported schema')
  const state = emptyState(text(raw.updated_at, 40))
  const batch = raw.batch
  state.batch = {
    id: batch.id ? text(batch.id, 80) : null,
    status: BATCH_STATUSES.includes(batch.status) ? batch.status : 'idle',
    mode: batch.mode === 'process' ? 'process' : 'plan-only',
    started_at: batch.started_at ? text(batch.started_at, 40) : null,
    deadline_at: batch.deadline_at ? text(batch.deadline_at, 40) : null,
    ticks: count(batch.ticks),
    requested_prs: Array.isArray(batch.requested_prs) ? batch.requested_prs.filter((n) => Number.isInteger(n) && n > 0).slice(0, 50) : null,
    last_tick_at: batch.last_tick_at ? text(batch.last_tick_at, 40) : null,
    finished_at: batch.finished_at ? text(batch.finished_at, 40) : null,
  }
  for (const [key, value] of Object.entries(raw.prs)) {
    const number = Number(key)
    if (!Number.isInteger(number) || number < 1) continue
    const pr = emptyPr(number)
    pr.status = PR_STATUSES.includes(value.status) ? value.status : 'queued'
    pr.risk = ['low', 'medium', 'high'].includes(value.risk) ? value.risk : 'high'
    pr.head_sha = sha(value.head_sha)
    for (const counter of COUNTERS) pr.attempts[counter] = count(value.attempts?.[counter])
    pr.attempt_main_sha = sha(value.attempt_main_sha)
    pr.staging_dispatched_for = sha(value.staging_dispatched_for)
    pr.wait_since = value.wait_since ? text(value.wait_since, 40) : null
    pr.verified = value.verified && sha(value.verified.head_sha) && sha(value.verified.base_sha)
      ? { head_sha: value.verified.head_sha, base_sha: value.verified.base_sha, ci_run_id: count(value.verified.ci_run_id), staging_run_id: count(value.verified.staging_run_id), at: text(value.verified.at, 40) }
      : null
    pr.blockers = (Array.isArray(value.blockers) ? value.blockers : []).slice(-BLOCKER_LIMIT).map((b) => ({ code: text(b.code, 60), detail: text(b.detail, 400), at: text(b.at, 40) }))
    pr.updated_at = value.updated_at ? text(value.updated_at, 40) : null
    state.prs[number] = pr
  }
  state.order = (Array.isArray(raw.order) ? raw.order : []).filter((n) => state.prs[n])
  state.history = (Array.isArray(raw.history) ? raw.history : []).slice(-HISTORY_LIMIT).map((h) => ({ at: text(h.at, 40), tick: count(h.tick), pr: h.pr ? count(h.pr) : null, action: text(h.action, 60), detail: text(h.detail, 300), outcome: text(h.outcome, 40) }))
  state.research = validateResearchMap(raw.research)
  for (const key of Object.keys(state.metrics)) state.metrics[key] = Number.isFinite(raw.metrics?.[key]) && raw.metrics[key] >= 0 ? raw.metrics[key] : 0
  return state
}

const RISKS = ['low', 'medium', 'high']

/** Research is advisory text from a model reading untrusted changelogs: strictly shaped, bounded, escaped. */
export function validateResearchMap(raw) {
  const out = {}
  for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const number = Number(key)
    if (!Number.isInteger(number) || number < 1 || !value || typeof value !== 'object') continue
    out[number] = {
      updates_key: text(value.updates_key, 400),
      at: text(value.at, 40),
      findings: (Array.isArray(value.findings) ? value.findings : []).slice(0, 12).map((f) => ({
        package: text(f.package, 80),
        breaking: ['yes', 'no', 'unknown'].includes(f.breaking) ? f.breaking : 'unknown',
        summary: text(f.summary, 500),
        risk_floor: RISKS.includes(f.risk_floor) ? f.risk_floor : 'low',
        evidence: (Array.isArray(f.evidence) ? f.evidence : []).slice(0, 3).map((u) => text(u, 200)).filter((u) => /^https:\/\//.test(u)),
      })),
    }
  }
  return out
}

export function recordHistory(state, entry, now) {
  state.history.push({ at: now, tick: state.batch.ticks, pr: entry.pr ?? null, action: text(entry.action, 60), detail: text(entry.detail, 300), outcome: text(entry.outcome ?? 'planned', 40) })
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT)
}

export function block(prState, code, detail, now) {
  prState.status = 'blocked'
  const last = prState.blockers[prState.blockers.length - 1]
  if (!last || last.code !== code || last.detail !== text(detail, 400)) prState.blockers.push({ code, detail: text(detail, 400), at: now })
  if (prState.blockers.length > BLOCKER_LIMIT) prState.blockers.shift()
  prState.updated_at = now
}

/** Attempt budget counted per PR; branch-update attempts reset only when main legitimately moved. */
export function attemptsLeft(prState, counter, limit, mainSha = null) {
  if (counter === 'update_branch' && prState.attempt_main_sha !== mainSha) return limit
  return Math.max(0, limit - prState.attempts[counter])
}

export function consumeAttempt(prState, counter, mainSha = null) {
  if (counter === 'update_branch' && prState.attempt_main_sha !== mainSha) {
    prState.attempts.update_branch = 0
    prState.attempt_main_sha = mainSha
  }
  prState.attempts[counter] += 1
}
