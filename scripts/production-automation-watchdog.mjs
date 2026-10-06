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
// Production Release/Rollback jobs are bounded well under these by their own timeout-minutes; an operation that is
// still running 45 minutes after it started is stuck, not slow. Approval/queue waits of 30 minutes need a human.
// Control-plane jobs carry timeout-minutes of 10, so 20 minutes is twice their hard ceiling.
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
function validateRun(run, { repo, workflowPath }) {
  if (!run || typeof run !== 'object') throw unproven('run is malformed')
  if (run.path !== workflowPath) throw unproven('run workflow path does not match the monitored workflow file')
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) throw unproven('run repository provenance mismatch')
  const id = clean(run.id)
  if (!RUN_ID.test(id)) throw unproven('run id is malformed')
  const attempt = Number(run.run_attempt)
  if (!Number.isInteger(attempt) || attempt < 1) throw unproven('run attempt is malformed')
  const headSha = clean(run.head_sha)
  if (!SHA.test(headSha)) throw unproven('run head SHA is malformed')
  return { id, attempt, headSha }
}

function activeOperation({ run, spec, kind, nowMs, repo }) {
  const identity = validateRun(run, { repo, workflowPath: spec.path })
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

async function listRuns(deps, spec, query) {
  const runs = await deps.listWorkflowRuns(spec.file, query)
  if (!Array.isArray(runs)) throw unproven('workflow run list is malformed')
  return runs
}

/** Pure given deps and an injected `now`; the only I/O is deps.listWorkflowRuns (GET). */
export async function evaluateWatchdog({ repo, now }, deps) {
  if (!repo) throw new Error('production automation watchdog: repository is required')
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(nowMs)) throw new Error('production automation watchdog: now must be a valid Date')

  const findings = []
  const activeOperations = []
  const seenRuns = new Set()

  const groups = [
    ...PRODUCTION_MUTATION_WORKFLOWS.map((spec) => ({ spec, kind: 'production_mutation' })),
    ...CONTROL_PLANE_WORKFLOWS.map((spec) => ({ spec, kind: 'control_plane' })),
  ]
  for (const { spec, kind } of groups) {
    for (const status of ACTIVE_RUN_STATUSES) {
      let runs
      try {
        runs = await listRuns(deps, spec, { status })
      } catch (error) {
        findings.push(unprovenFinding(spec.path, error instanceof Unproven ? error.message : 'workflow runs could not be read'))
        continue
      }
      for (const run of runs) {
        try {
          const op = activeOperation({ run, spec, kind, nowMs, repo })
          const dedupeKey = `${op.workflow_path}:${op.run_id}:${op.run_attempt}`
          if (seenRuns.has(dedupeKey)) continue
          seenRuns.add(dedupeKey)
          activeOperations.push(op)
          const finding = findingForOperation(op)
          if (finding) findings.push(finding)
        } catch (error) {
          findings.push(unprovenFinding(spec.path, error instanceof Unproven ? error.message : 'active run could not be validated'))
        }
      }
    }
  }

  const heartbeats = {}
  for (const spec of HEARTBEAT_WORKFLOWS) {
    const budget = POLICY.heartbeat_minutes[spec.key]
    const entry = { workflow_path: spec.path, state: 'unproven', latest_run_id: null, latest_completed_at: null, age_minutes: null, budget_minutes: budget }
    try {
      const runs = await listRuns(deps, spec, { status: 'completed', branch: 'main' })
      if (runs.length === 0) throw unproven('no completed run exists')
      let newest = null
      for (const run of runs) {
        const identity = validateRun(run, { repo, workflowPath: spec.path })
        if (run.head_branch !== 'main') throw unproven('heartbeat run is not from main')
        if (clean(run.status) !== 'completed') throw unproven('heartbeat run is not completed')
        const completedMs = parseTimestamp(run.updated_at, 'updated_at')
        if (!newest || completedMs > newest.completedMs) newest = { identity, completedMs, completedAt: clean(run.updated_at) }
      }
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
      findings.push(unprovenFinding(spec.path, error instanceof Unproven ? error.message : 'heartbeat runs could not be read'))
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
