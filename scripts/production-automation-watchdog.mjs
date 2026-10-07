#!/usr/bin/env node
// Phase 5C: read-only production automation watchdog.
// Observation only: it reads GitHub Actions run metadata and writes a sanitized evidence artifact.
// It never deploys, migrates, rolls back, cancels, reruns, dispatches, approves, merges, pushes, or tags.
// Identity is the exact workflow FILE path + repository + run id/attempt/SHA. run.name / display_title is never read.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realProductionAutomationWatchdogDeps } from './production-automation-watchdog-deps.mjs'

export const WATCHDOG_SCHEMA = 'patelrep.production-automation-watchdog.v1'
export const WATCHDOG_WORKFLOW_NAME = 'Production Automation Watchdog'
export const WATCHDOG_WORKFLOW_PATH = '.github/workflows/production-automation-watchdog.yml'
export const WATCHDOG_ARTIFACT = 'production-automation-watchdog'
export const WATCHDOG_NOTIFICATION_KEY = 'watchdog:production-automation'

// Same trusted set production request policy uses to decide a production operation is in flight.
export const ACTIVE_RUN_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting', 'requested', 'pending'])

// Fixed policy. Deliberately NOT configurable from workflow inputs, env, or repository variables.
// These are conservative OPERATIONAL OBSERVATION thresholds, not derived from a universal workflow timeout:
// - Production Release has no explicit job timeout (GitHub's default job limit is far longer), and Production
//   Rollback sets one only on its provenance job, so a hung production job could otherwise run for hours.
//   45 minutes in progress is chosen as well beyond a healthy release; 30 minutes queued/waiting needs a human.
// - Control-plane jobs vary: stabilization, auto-rollback request and re-entry use 10 minutes; audit and recovery
//   readiness use 15; Production Operations Notify sets none. 20 minutes exceeds every explicit ceiling, so a
//   run still active then is abnormal, but it is a threshold for a human to look, not a proven hard limit.
export const POLICY = Object.freeze({
  production_in_progress_minutes: 45,
  production_waiting_minutes: 30,
  control_plane_active_minutes: 20,
  heartbeat_minutes: Object.freeze({
    deploy_health: 45,
    release_audit: 7 * 60,
    recovery_readiness: 26 * 60,
    resilience_drill: 8 * 24 * 60,
  }),
  max_future_skew_minutes: 5,
})

const wf = (file, workflow) => Object.freeze({ file, path: `.github/workflows/${file}`, workflow })

export const PRODUCTION_MUTATION_WORKFLOWS = Object.freeze([
  wf('production-release.yml', 'Production Release'),
  wf('production-rollback.yml', 'Production Rollback'),
])

export const CONTROL_PLANE_WORKFLOWS = Object.freeze([
  wf('production-release-stabilization.yml', 'Production Release Stabilization'),
  wf('production-auto-rollback-request.yml', 'Production Auto-Rollback Request'),
  wf('production-incident-reentry.yml', 'Production Incident Re-entry'),
  wf('production-operations-notify.yml', 'Production Operations Notify'),
  wf('production-release-audit.yml', 'Production Release Audit'),
  wf('production-recovery-readiness.yml', 'Production Recovery Readiness'),
])

export const HEARTBEAT_WORKFLOWS = Object.freeze([
  Object.freeze({ ...wf('deploy-check.yml', 'Deploy Health Check'), key: 'deploy_health', code: 'deploy_health_heartbeat_stale' }),
  Object.freeze({ ...wf('production-release-audit.yml', 'Production Release Audit'), key: 'release_audit', code: 'release_audit_heartbeat_stale' }),
  Object.freeze({ ...wf('production-recovery-readiness.yml', 'Production Recovery Readiness'), key: 'recovery_readiness', code: 'recovery_readiness_heartbeat_stale' }),
  Object.freeze({ ...wf('release-resilience-drill.yml', 'Release Resilience Drill'), key: 'resilience_drill', code: 'resilience_drill_heartbeat_stale' }),
])

export const FINDING_SEVERITY = Object.freeze({
  production_operation_stuck: 'critical',
  production_operation_waiting_too_long: 'warning',
  control_plane_run_stuck: 'critical',
  deploy_health_heartbeat_stale: 'warning',
  release_audit_heartbeat_stale: 'warning',
  recovery_readiness_heartbeat_stale: 'warning',
  resilience_drill_heartbeat_stale: 'warning',
  github_actions_state_unproven: 'critical',
})

export const STATES = Object.freeze(['healthy', 'active_within_budget', 'degraded', 'critical', 'unproven'])
export const MONITORED_WORKFLOW_PATHS = Object.freeze(new Set([
  ...PRODUCTION_MUTATION_WORKFLOWS.map((item) => item.path),
  ...CONTROL_PLANE_WORKFLOWS.map((item) => item.path),
  ...HEARTBEAT_WORKFLOWS.map((item) => item.path),
  WATCHDOG_WORKFLOW_PATH,
]))

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const MS_PER_MINUTE = 60_000
const clean = (value) => String(value ?? '').trim()

class Unproven extends Error {}
const unproven = (message) => new Unproven(message)

function parseTimestamp(value, label) {
  const text = clean(value)
  const ms = ISO_UTC.test(text) ? Date.parse(text) : Number.NaN
  if (!Number.isFinite(ms)) throw unproven(`${label} timestamp is malformed`)
  return ms
}

function ageMinutes(thenMs, nowMs, label) {
  const minutes = (nowMs - thenMs) / MS_PER_MINUTE
  if (minutes < -POLICY.max_future_skew_minutes) throw unproven(`${label} timestamp is in the future`)
  return Math.max(0, minutes)
}

/** Provenance gate shared by every run this watchdog reads. Throws Unproven; never trusts display names. */
function validateRun(run, { repo, workflowPath, workflowId }) {
  if (!run || typeof run !== 'object') throw unproven('run is malformed')
  if (run.path !== workflowPath) throw unproven('run workflow path does not match the monitored workflow file')
  if (Number(run.workflow_id) !== workflowId) throw unproven('run workflow id does not match the resolved workflow record')
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) throw unproven('run repository provenance mismatch')
  const id = clean(run.id)
  if (!RUN_ID.test(id)) throw unproven('run id is malformed')
  const attempt = Number(run.run_attempt)
  if (!Number.isInteger(attempt) || attempt < 1) throw unproven('run attempt is malformed')
  const headSha = clean(run.head_sha)
  if (!SHA.test(headSha)) throw unproven('run head SHA is malformed')
  return { id, attempt, headSha }
}

function activeOperation({ run, identity, spec, kind, nowMs, repo }) {
  const status = clean(run.status)
  if (!ACTIVE_RUN_STATUSES.includes(status)) throw unproven('run is not in an active status')
  const createdMs = parseTimestamp(run.created_at, 'created_at')
  let startedMs = createdMs
  let startedAt = null
  if (run.run_started_at !== null && run.run_started_at !== undefined && clean(run.run_started_at) !== '') {
    startedMs = parseTimestamp(run.run_started_at, 'run_started_at')
    startedAt = clean(run.run_started_at)
  }
  const running = status === 'in_progress'
  const age = ageMinutes(running ? startedMs : createdMs, nowMs, 'active run')
  const budget = kind === 'production_mutation'
    ? (running ? POLICY.production_in_progress_minutes : POLICY.production_waiting_minutes)
    : POLICY.control_plane_active_minutes
  return {
    kind,
    run_id: identity.id,
    run_attempt: identity.attempt,
    workflow_path: spec.path,
    workflow: spec.workflow,
    status,
    created_at: clean(run.created_at),
    run_started_at: startedAt,
    head_sha: identity.headSha,
    repository: repo,
    age_minutes: Math.floor(age),
    budget_minutes: budget,
    within_budget: age <= budget,
  }
}

function findingForOperation(op) {
  if (op.within_budget) return null
  const code = op.kind === 'control_plane'
    ? 'control_plane_run_stuck'
    : (op.status === 'in_progress' ? 'production_operation_stuck' : 'production_operation_waiting_too_long')
  return {
    code,
    severity: FINDING_SEVERITY[code],
    subject: {
      workflow_path: op.workflow_path,
      run_id: op.run_id,
      run_attempt: op.run_attempt,
      status: op.status,
      head_sha: op.head_sha,
    },
    age_minutes: op.age_minutes,
    budget_minutes: op.budget_minutes,
  }
}

const unprovenFinding = (workflowPath, reason) => ({
  code: 'github_actions_state_unproven',
  severity: 'critical',
  subject: { workflow_path: workflowPath, run_id: null, run_attempt: null, status: null, head_sha: null },
  age_minutes: null,
  budget_minutes: null,
  reason,
})

const findingOrder = (a, b) =>
  a.code.localeCompare(b.code) ||
  a.subject.workflow_path.localeCompare(b.subject.workflow_path) ||
  String(a.subject.run_id ?? '').localeCompare(String(b.subject.run_id ?? '')) ||
  String(a.reason ?? '').localeCompare(String(b.reason ?? ''))

/** Deterministic state from findings: known-bad > unproven > degraded > active > healthy. */
export function deriveState(findings, activeOperationCount) {
  const codes = findings.map((finding) => finding.code)
  if (codes.some((code) => FINDING_SEVERITY[code] === 'critical' && code !== 'github_actions_state_unproven')) return 'critical'
  if (codes.includes('github_actions_state_unproven')) return 'unproven'
  if (findings.length > 0) return 'degraded'
  return activeOperationCount > 0 ? 'active_within_budget' : 'healthy'
}

export const severityForState = (state) =>
  state === 'critical' || state === 'unproven' ? 'critical' : state === 'degraded' ? 'warning' : 'none'

/**
 * Stable fingerprint of the alert-relevant condition. Excludes ages and timestamps so an unchanged condition keeps
 * the same fingerprint run after run; healthy and active-within-budget collapse to one "ok" condition.
 */
export function fingerprintFindings(findings) {
  const canonical = [...findings].sort(findingOrder).map((finding) => [
    finding.code,
    finding.severity,
    finding.subject.workflow_path,
    finding.subject.run_id ?? null,
    finding.subject.run_attempt ?? null,
    finding.subject.status ?? null,
  ])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}

// Exactly one CURRENT (active) workflow record must exist for a monitored path; its numeric id is then used for run
// queries. Inactive or duplicate records can never silently win, and display names are never consulted.
function resolveWorkflowId(records, spec) {
  if (!Array.isArray(records)) throw unproven('workflow metadata is malformed')
  const current = records.filter((record) => record && record.path === spec.path && record.state === 'active')
  if (current.length === 0) throw unproven('no current workflow record for the monitored path')
  if (current.length > 1) throw unproven('ambiguous current workflow records for the monitored path')
  const id = Number(current[0].id)
  if (!Number.isInteger(id) || id < 1) throw unproven('workflow id is malformed')
  return id
}

const asRunList = (runs) => {
  if (!Array.isArray(runs)) throw unproven('workflow run list is malformed')
  return runs
}

/** Newest completed run on main, with full provenance validation of every returned run. */
function newestCompletedMainRun(runs, { repo, spec, workflowId }) {
  let newest = null
  for (const run of runs) {
    const identity = validateRun(run, { repo, workflowPath: spec.path, workflowId })
    if (clean(run.status) !== 'completed' || run.head_branch !== 'main') continue
    const completedMs = parseTimestamp(run.updated_at, 'updated_at')
    if (!newest || completedMs > newest.completedMs) newest = { identity, completedMs, completedAt: clean(run.updated_at) }
  }
  return newest
}

/**
 * Pure given deps and an injected `now`; the only I/O is read-only GETs through deps.
 *
 * Why unfiltered reads: GitHub's filtered run listings (status/branch) were observed returning stale snapshots
 * (older total_count and runs from days or weeks earlier) while the unfiltered newest-first listing was current.
 * Stale reads can only HIDE runs, never invent recent ones, so heartbeat staleness is corroborated with a second
 * created-window read before it is reported, and active runs are filtered locally from one bounded newest-first page.
 */
export async function evaluateWatchdog({ repo, now }, deps) {
  if (!repo) throw new Error('production automation watchdog: repository is required')
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(nowMs)) throw new Error('production automation watchdog: now must be a valid Date')

  const findings = []
  const activeOperations = []
  const seenRuns = new Set()
  const seenUnproven = new Set()
  const addUnproven = (workflowPath, error, fallback) => {
    const reason = error instanceof Unproven ? error.message : fallback
    if (seenUnproven.has(`${workflowPath}:${reason}`)) return
    seenUnproven.add(`${workflowPath}:${reason}`)
    findings.push(unprovenFinding(workflowPath, reason))
  }

  let records = null
  try {
    records = asRunList(await deps.listWorkflows())
  } catch {
    records = null
  }

  const recentByPath = new Map()
  const recent = (spec) => {
    if (!recentByPath.has(spec.path)) {
      recentByPath.set(spec.path, (async () => {
        if (records === null) throw unproven('workflow metadata could not be read')
        const workflowId = resolveWorkflowId(records, spec)
        return { workflowId, runs: asRunList(await deps.listWorkflowRuns(workflowId, { recent: true })) }
      })())
    }
    return recentByPath.get(spec.path)
  }

  const groups = [
    ...PRODUCTION_MUTATION_WORKFLOWS.map((spec) => ({ spec, kind: 'production_mutation' })),
    ...CONTROL_PLANE_WORKFLOWS.map((spec) => ({ spec, kind: 'control_plane' })),
  ]
  for (const { spec, kind } of groups) {
    let listing
    try {
      listing = await recent(spec)
    } catch (error) {
      addUnproven(spec.path, error, 'workflow runs could not be read')
      continue
    }
    for (const run of listing.runs) {
      try {
        const identity = validateRun(run, { repo, workflowPath: spec.path, workflowId: listing.workflowId })
        if (!ACTIVE_RUN_STATUSES.includes(clean(run.status))) continue
        const op = activeOperation({ run, identity, spec, kind, nowMs, repo })
        const dedupeKey = `${op.workflow_path}:${op.run_id}:${op.run_attempt}`
        if (seenRuns.has(dedupeKey)) continue
        seenRuns.add(dedupeKey)
        activeOperations.push(op)
        const finding = findingForOperation(op)
        if (finding) findings.push(finding)
      } catch (error) {
        addUnproven(spec.path, error, 'active run could not be validated')
      }
    }
  }

  const heartbeats = {}
  for (const spec of HEARTBEAT_WORKFLOWS) {
    const budget = POLICY.heartbeat_minutes[spec.key]
    const entry = { workflow_path: spec.path, state: 'unproven', latest_run_id: null, latest_completed_at: null, age_minutes: null, budget_minutes: budget }
    try {
      const { workflowId, runs } = await recent(spec)
      let newest = newestCompletedMainRun(runs, { repo, spec, workflowId })
      if (!newest || (nowMs - newest.completedMs) / MS_PER_MINUTE > budget) {
        const since = new Date(nowMs - budget * MS_PER_MINUTE).toISOString().replace(/\.\d{3}Z$/, 'Z')
        const windowed = newestCompletedMainRun(asRunList(await deps.listWorkflowRuns(workflowId, { since })), { repo, spec, workflowId })
        if (windowed && (!newest || windowed.completedMs > newest.completedMs)) newest = windowed
      }
      if (!newest) throw unproven('no completed run exists')
      const age = ageMinutes(newest.completedMs, nowMs, 'heartbeat run')
      entry.latest_run_id = newest.identity.id
      entry.latest_completed_at = newest.completedAt
      entry.age_minutes = Math.floor(age)
      if (age > budget) {
        entry.state = 'stale'
        findings.push({
          code: spec.code,
          severity: FINDING_SEVERITY[spec.code],
          subject: { workflow_path: spec.path, run_id: newest.identity.id, run_attempt: null, status: 'completed', head_sha: null },
          age_minutes: entry.age_minutes,
          budget_minutes: budget,
        })
      } else {
        entry.state = 'fresh'
      }
    } catch (error) {
      entry.state = 'unproven'
      addUnproven(spec.path, error, 'heartbeat runs could not be read')
    }
    heartbeats[spec.key] = entry
  }

  findings.sort(findingOrder)
  activeOperations.sort((a, b) => a.workflow_path.localeCompare(b.workflow_path) || a.run_id.localeCompare(b.run_id))
  const state = deriveState(findings, activeOperations.length)
  return Object.freeze({
    schema: WATCHDOG_SCHEMA,
    workflow: WATCHDOG_WORKFLOW_NAME,
    state,
    healthy: state === 'healthy' || state === 'active_within_budget',
    severity: severityForState(state),
    findings,
    active_operations: activeOperations,
    heartbeats,
    policy: {
      production_in_progress_minutes: POLICY.production_in_progress_minutes,
      production_waiting_minutes: POLICY.production_waiting_minutes,
      control_plane_active_minutes: POLICY.control_plane_active_minutes,
      heartbeat_minutes: { ...POLICY.heartbeat_minutes },
    },
    evaluated_at: new Date(nowMs).toISOString(),
  })
}

function attachRun(result, env) {
  const runId = clean(env.RUN_ID)
  const attempt = Number(clean(env.RUN_ATTEMPT))
  const sha = clean(env.CONTROL_PLANE_SHA)
  if (!RUN_ID.test(runId)) throw new Error('production automation watchdog: invalid run id')
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('production automation watchdog: invalid run attempt')
  if (!SHA.test(sha)) throw new Error('production automation watchdog: invalid control-plane SHA')
  return { ...result, run: { id: runId, attempt, control_plane_sha: sha } }
}

function failedEvaluation(now) {
  const finding = unprovenFinding(WATCHDOG_WORKFLOW_PATH, 'watchdog evaluation failed')
  return {
    schema: WATCHDOG_SCHEMA,
    workflow: WATCHDOG_WORKFLOW_NAME,
    state: 'unproven',
    healthy: false,
    severity: 'critical',
    findings: [finding],
    active_operations: [],
    heartbeats: {},
    policy: {
      production_in_progress_minutes: POLICY.production_in_progress_minutes,
      production_waiting_minutes: POLICY.production_waiting_minutes,
      control_plane_active_minutes: POLICY.control_plane_active_minutes,
      heartbeat_minutes: { ...POLICY.heartbeat_minutes },
    },
    evaluated_at: now.toISOString(),
  }
}

async function main() {
  const env = process.env
  const repo = clean(env.REPO)
  const now = new Date()
  let result
  try {
    result = await evaluateWatchdog({ repo, now }, realProductionAutomationWatchdogDeps({ repo, readToken: env.GH_TOKEN }))
  } catch {
    result = failedEvaluation(now)
  }
  result = attachRun(result, env)

  const dir = clean(env.RESULT_DIR)
  if (!dir) throw new Error('production automation watchdog: RESULT_DIR is required')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })

  if (!env.GITHUB_OUTPUT) throw new Error('production automation watchdog: GITHUB_OUTPUT is required')
  appendFileSync(env.GITHUB_OUTPUT, `state=${result.state}\nhealthy=${result.healthy ? 'true' : 'false'}\nseverity=${result.severity}\nfindings=${result.findings.length}\n`)
  console.log(`Production automation watchdog: state=${result.state}; findings=${result.findings.length}; active=${result.active_operations.length}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
