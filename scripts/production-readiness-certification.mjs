#!/usr/bin/env node
// Phase 5D: final, read-only production readiness certification.
// Evidence composition only: it reads GitHub metadata and previously published sanitized evidence artifacts and writes one
// sanitized result. It adds ZERO production authority: it never deploys, rolls back, migrates, tags, creates a Release,
// approves an Environment, cancels/reruns/dispatches a workflow, merges, pushes, or repairs anything.
// Identity is the exact workflow FILE path + repository + run id/attempt/SHA. run.name / display_title is never read.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATE_APP } from './release-engineer-auto-merge-policy.mjs'
import { realProductionReadinessCertificationDeps } from './production-readiness-certification-deps.mjs'

export const CERT_SCHEMA = 'patelrep.production-readiness-certification.v1'
export const CERT_WORKFLOW_NAME = 'Production Readiness Certification'
export const CERT_WORKFLOW_PATH = '.github/workflows/production-readiness-certification.yml'
export const CERT_ARTIFACT = 'production-readiness-certification'
export const CERT_STATES = Object.freeze(['certified', 'certified_with_limitations', 'not_certified', 'unproven'])

const wfPath = (file) => `.github/workflows/${file}`
export const WORKFLOW_PATHS = Object.freeze({
  ci: wfPath('ci.yml'),
  staging: wfPath('staging-candidate.yml'),
  deploy_health: wfPath('deploy-check.yml'),
  release_audit: wfPath('production-release-audit.yml'),
  recovery_readiness: wfPath('production-recovery-readiness.yml'),
  resilience_drill: wfPath('release-resilience-drill.yml'),
  watchdog: wfPath('production-automation-watchdog.yml'),
})

// Fixed policy. Deliberately NOT configurable from workflow inputs, env, or repository variables.
export const POLICY = Object.freeze({
  deploy_health_minutes: 45,
  release_audit_minutes: 7 * 60,
  recovery_readiness_minutes: 26 * 60,
  resilience_drill_minutes: 8 * 24 * 60,
  watchdog_minutes: 30,
  // staging-candidate-context is uploaded with retention-days: 3; after that only the gate check can bind staging.
  staging_artifact_window_minutes: 10,
  max_future_skew_minutes: 5,
  artifact_candidate_limit: 10,
})

export const DRILL_SCENARIOS = Object.freeze([
  'post_release_regression_full_cycle',
  'database_change_blocks_auto_rollback',
  'partial_release_quarantine',
  'runtime_drift_is_detected_and_notified',
  'stale_reentry_authorization_is_refused',
  'active_production_operation_defers_audit',
  'stuck_production_operation_is_detected_without_mutation',
])

export const DEPLOY_HEALTH_JOBS = Object.freeze(['API health', 'Web health', 'Deployment API-URL drift check', 'Public smoke verification'])
export const STAGING_STAGES = Object.freeze(['Database', 'API deploy', 'Web deploy', 'Release identity + smoke'])
export const BOOTSTRAP_LIMITATION = 'no_previous_managed_release'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const PR_NUMBER = /^[1-9][0-9]{0,9}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const MS_PER_MINUTE = 60_000
const STAGING_KEYS = ['candidate_branch', 'candidate_sha', 'ci_run_id', 'pr_number']
const clean = (value) => String(value ?? '').trim()

/** Carries a final state and a stable reason code only; never remote error text. */
class Verdict extends Error {
  constructor(state, reason) {
    super(reason)
    this.state = state
    this.reason = reason
  }
}
const notCertified = (reason) => new Verdict('not_certified', reason)
const unproven = (reason) => new Verdict('unproven', reason)

/** Runs one evidence step. Any non-Verdict failure (GitHub error, bad JSON, expired artifact) is `unproven`, never raw. */
async function step(reason, fn) {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof Verdict) throw error
    throw unproven(reason)
  }
}

function parseTimestamp(value, reason) {
  const text = clean(value)
  const ms = ISO_UTC.test(text) ? Date.parse(text) : Number.NaN
  if (!Number.isFinite(ms)) throw unproven(reason)
  return ms
}

function ageMinutes(thenMs, nowMs, reason) {
  const minutes = (nowMs - thenMs) / MS_PER_MINUTE
  if (minutes < -POLICY.max_future_skew_minutes) throw unproven(reason)
  return Math.max(0, minutes)
}

/** Exact path + repository provenance for any run. `branch`/`sha`/`event` are enforced only when supplied. */
function validateRun(run, { repo, workflowPath, branch, sha, event, reason }) {
  if (!run || typeof run !== 'object') throw unproven(`${reason}_run_malformed`)
  if (run.path !== workflowPath) throw unproven(`${reason}_run_path_mismatch`)
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) throw unproven(`${reason}_run_repository_mismatch`)
  const id = clean(run.id)
  const attempt = Number(run.run_attempt)
  if (!RUN_ID.test(id) || !Number.isInteger(attempt) || attempt < 1 || !SHA.test(clean(run.head_sha))) throw unproven(`${reason}_run_malformed`)
  if (branch !== undefined && run.head_branch !== branch) throw unproven(`${reason}_run_branch_mismatch`)
  if (sha !== undefined && run.head_sha !== sha) throw unproven(`${reason}_run_sha_mismatch`)
  if (event !== undefined && run.event !== event) throw unproven(`${reason}_run_event_mismatch`)
  return { id, attempt, headSha: run.head_sha, status: clean(run.status), conclusion: clean(run.conclusion), updatedAt: run.updated_at }
}

function requireSuccessfulRun(identity, reason) {
  if (identity.status !== 'completed') throw unproven(`${reason}_run_not_completed`)
  if (identity.conclusion !== 'success') throw notCertified(`${reason}_run_not_successful`)
}

// ---- 1. current-main provenance ------------------------------------------------------------------------------

async function proveMainIdentity(sha, deps) {
  const main = clean(await step('current_main_unproven', () => deps.getMainSha()))
  if (!SHA.test(main)) throw unproven('current_main_unproven')
  if (main !== sha) throw unproven('main_moved_during_certification')
}

async function proveProvenance({ repo, sha, deps }) {
  const mainCommit = await step('main_commit_unproven', () => deps.getCommit(sha))
  if (mainCommit?.sha !== sha || !SHA.test(clean(mainCommit.tree))) throw unproven('main_commit_unproven')

  const pulls = await step('source_pr_unproven', async () => {
    const found = await deps.listPullsForCommit(sha)
    if (!Array.isArray(found)) throw unproven('source_pr_unproven')
    return found
  })
  // GitHub's association also lists PRs that merely contain the commit; only the PR whose merge commit IS main counts.
  const producers = pulls.filter((pr) => pr && pr.merge_commit_sha === sha && pr.base?.ref === 'main')
  if (producers.length === 0) throw notCertified('source_pr_missing')
  if (producers.length > 1) throw notCertified('source_pr_ambiguous')
  const listed = producers[0]
  if (!PR_NUMBER.test(clean(listed.number))) throw unproven('source_pr_unproven')

  const pr = await step('source_pr_unproven', () => deps.getPr(Number(listed.number)))
  const merged =
    pr?.number === listed.number &&
    pr.merged === true &&
    pr.state === 'closed' &&
    ISO_UTC.test(clean(pr.merged_at)) &&
    pr.merge_commit_sha === sha &&
    pr.base?.ref === 'main' &&
    pr.base?.repo?.full_name === repo &&
    pr.head?.repo?.full_name === repo &&
    SHA.test(clean(pr.head?.sha)) &&
    BRANCH.test(clean(pr.head?.ref))
  if (!merged) throw notCertified('source_pr_not_trusted')

  const candidateCommit = await step('candidate_commit_unproven', () => deps.getCommit(pr.head.sha))
  if (candidateCommit?.sha !== pr.head.sha || !SHA.test(clean(candidateCommit.tree))) throw unproven('candidate_commit_unproven')
  // Merge commit SHA proves main's identity; exact TREE equality proves the merged content is what was staged.
  if (candidateCommit.tree !== mainCommit.tree) throw notCertified('candidate_tree_mismatch')

  return {
    sourcePr: Number(pr.number),
    candidateSha: pr.head.sha,
    candidateBranch: pr.head.ref,
    mainTree: mainCommit.tree,
    candidateTree: candidateCommit.tree,
  }
}

// ---- 2/3. CI + Staging gates ---------------------------------------------------------------------------------

/** Newest check from GitHub Actions itself (same-named checks from other Apps are ignored). */
function latestGate(checks, name, reason) {
  if (!Array.isArray(checks)) throw unproven(`${reason}_unproven`)
  const own = checks
    .filter((check) => check && check.name === name && check.app?.slug === GATE_APP.slug && check.app?.id === GATE_APP.id)
    .sort((a, b) => Number(b.id) - Number(a.id))
  if (own.length === 0) throw notCertified(`${reason}_missing`)
  const [latest] = own
  if (latest.status !== 'completed' || latest.conclusion !== 'success') throw notCertified(`${reason}_not_successful`)
  return latest
}

function runIdFromJobUrl(url, repo, reason) {
  const match = String(url ?? '').match(new RegExp(`^https://github\\.com/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/actions/runs/([1-9][0-9]{0,19})/job/[0-9]+$`))
  if (!match) throw unproven(`${reason}_run_unbound`)
  return match[1]
}

async function proveCiGate({ repo, sha, deps, label, event, branch }) {
  const gate = latestGate(await step(`${label}_gate_unproven`, () => deps.listCheckRuns(sha, 'CI Gate')), 'CI Gate', `${label}_ci_gate`)
  const runId = runIdFromJobUrl(gate.details_url, repo, `${label}_ci`)
  const run = await step(`${label}_ci_unproven`, () => deps.getRun(runId))
  const identity = validateRun(run, { repo, workflowPath: WORKFLOW_PATHS.ci, branch, sha, event, reason: `${label}_ci` })
  if (identity.id !== runId) throw unproven(`${label}_ci_run_unbound`)
  requireSuccessfulRun(identity, `${label}_ci`)
  return { run_id: identity.id, run_attempt: identity.attempt, event, head_sha: sha, gate: 'success' }
}

function parseStagingSummary(summary, prNumber, sha) {
  const text = String(summary ?? '').replace(/\r\n/g, '\n')
  const [header, , ...rows] = text.split('\n')
  if (header !== `PR #${prNumber} · ${sha}`) return false
  const stages = new Map()
  for (const row of rows.filter(Boolean)) {
    const match = row.match(/^\| (.+) \| (.+) \|$/)
    if (!match || stages.has(match[1])) return false
    stages.set(match[1], match[2])
  }
  return stages.size === STAGING_STAGES.length && STAGING_STAGES.every((stage) => stages.get(stage) === '✅ success')
}

async function loadStagingContext({ repo, provenance, ciRunId, gate, deps }) {
  const startedMs = parseTimestamp(gate.started_at, 'staging_gate_timing_unproven')
  const completedMs = parseTimestamp(gate.completed_at, 'staging_gate_timing_unproven')
  const slack = POLICY.staging_artifact_window_minutes * MS_PER_MINUTE
  const artifacts = await step('staging_context_unproven', async () => {
    const listed = await deps.listArtifacts('staging-candidate-context')
    if (!Array.isArray(listed)) throw unproven('staging_context_unproven')
    return listed
  })
  // Bounded: only artifacts uploaded during the gate's own staging window can belong to this candidate.
  const inWindow = artifacts
    .filter((artifact) => {
      if (!artifact || artifact.name !== 'staging-candidate-context' || artifact.expired !== false) return false
      const createdMs = Date.parse(clean(artifact.created_at))
      return ISO_UTC.test(clean(artifact.created_at)) && createdMs >= startedMs - slack && createdMs <= completedMs + slack
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, POLICY.artifact_candidate_limit)

  for (const artifact of inWindow) {
    const runId = clean(artifact.workflow_run?.id)
    if (!RUN_ID.test(runId)) throw unproven('staging_context_unproven')
    const run = await step('staging_context_unproven', () => deps.getRun(runId))
    const identity = validateRun(run, { repo, workflowPath: WORKFLOW_PATHS.staging, event: 'workflow_run', reason: 'staging' })
    if (identity.id !== runId) throw unproven('staging_run_unbound')
    const context = await step('staging_context_unproven', () => deps.readArtifact(runId, 'staging-candidate-context'))
    if (context === null) continue
    if (!context || typeof context !== 'object' || Array.isArray(context) ||
        JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(STAGING_KEYS)) {
      throw unproven('staging_context_malformed')
    }
    if (!SHA.test(clean(context.candidate_sha))) throw unproven('staging_context_malformed')
    if (context.candidate_sha !== provenance.candidateSha) continue // another candidate's staging run
    if (!PR_NUMBER.test(clean(context.pr_number)) || !BRANCH.test(clean(context.candidate_branch)) || !RUN_ID.test(clean(context.ci_run_id))) {
      throw unproven('staging_context_malformed')
    }
    if (context.pr_number !== String(provenance.sourcePr)) throw notCertified('staging_context_pr_mismatch')
    if (context.candidate_branch !== provenance.candidateBranch) throw notCertified('staging_context_branch_mismatch')
    if (context.ci_run_id !== ciRunId) throw notCertified('staging_context_ci_mismatch')
    requireSuccessfulRun(identity, 'staging')
    return { run_id: identity.id, run_attempt: identity.attempt, binding: 'staging_candidate_context' }
  }

  // The trusted context artifact is mandatory. Absence (including expiry) is never inferred from the gate's age and a
  // mutable gate summary can never replace it: staging provenance that cannot be proven is `unproven`.
  throw unproven('staging_candidate_context_missing')
}

async function proveStaging({ repo, provenance, ciRunId, deps }) {
  const gate = latestGate(await step('staging_gate_unproven', () => deps.listCheckRuns(provenance.candidateSha, 'Staging Gate')), 'Staging Gate', 'staging_gate')
  if (!parseStagingSummary(gate.output?.summary, provenance.sourcePr, provenance.candidateSha)) throw notCertified('staging_gate_summary_mismatch')
  const bound = await loadStagingContext({ repo, provenance, ciRunId, gate, deps })
  return { ...bound, gate: 'success', stages: [...STAGING_STAGES] }
}

// ---- artifact-first evidence ---------------------------------------------------------------------------------

/**
 * Newest COMPLETED source run, bound to this exact control-plane SHA on main, that published `artifact`.
 * Artifact metadata is only a pointer: the source run is refetched and validated independently. Runs still in progress
 * are skipped (a concurrently re-running watchdog must not make certification flaky); a newest completed failure counts.
 */
async function loadArtifactEvidence({ repo, sha, deps, nowMs, spec }) {
  const reason = spec.label
  const listed = await step(`${reason}_evidence_unproven`, async () => {
    const found = await deps.listArtifacts(spec.artifact)
    if (!Array.isArray(found)) throw unproven(`${reason}_evidence_unproven`)
    return found
  })
  const candidates = listed
    .filter((artifact) => artifact && artifact.name === spec.artifact && artifact.expired === false &&
      artifact.workflow_run?.head_sha === sha && artifact.workflow_run?.head_branch === 'main' &&
      RUN_ID.test(clean(artifact.workflow_run?.id)) && ISO_UTC.test(clean(artifact.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, POLICY.artifact_candidate_limit)
  if (candidates.length === 0) throw unproven(`${reason}_evidence_missing`)

  let chosen = null
  for (const artifact of candidates) {
    const runId = clean(artifact.workflow_run.id)
    const run = await step(`${reason}_evidence_unproven`, () => deps.getRun(runId))
    const identity = validateRun(run, { repo, workflowPath: spec.path, branch: 'main', sha, reason })
    if (identity.id !== runId) throw unproven(`${reason}_run_unbound`)
    if (identity.status !== 'completed') continue
    chosen = identity
    break
  }
  if (!chosen) throw unproven(`${reason}_evidence_incomplete`)
  if (chosen.conclusion !== 'success') throw notCertified(`${reason}_run_not_successful`)

  const completedMs = parseTimestamp(chosen.updatedAt, `${reason}_timing_unproven`)
  const age = ageMinutes(completedMs, nowMs, `${reason}_timing_unproven`)
  if (age > spec.maxMinutes) throw notCertified(`${reason}_evidence_stale`)

  const raw = await step(`${reason}_artifact_unavailable`, () => deps.readArtifact(chosen.id, spec.artifact))
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw unproven(`${reason}_artifact_unavailable`)
  if (raw.schema !== spec.schema) throw unproven(`${reason}_schema_mismatch`)
  if (spec.workflow !== undefined && raw.workflow !== spec.workflow) throw unproven(`${reason}_schema_mismatch`)
  if (spec.embedsRun) {
    if (clean(raw.run?.id) !== chosen.id || Number(raw.run?.attempt) !== chosen.attempt || raw.run?.control_plane_sha !== sha) {
      throw unproven(`${reason}_artifact_provenance_mismatch`)
    }
  }
  return { raw, run: chosen, ageMinutes: Math.floor(age), completedAt: clean(chosen.updatedAt) }
}

// ---- individual evidence validators --------------------------------------------------------------------------

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function validateAudit(raw) {
  const incident = raw.incident
  const runtime = raw.runtime
  const managed = raw.managed_release
  if (![incident, runtime, managed, raw.reentry, raw.ledger].every(isPlainObject)) throw unproven('release_audit_malformed')
  if (raw.state !== 'consistent_managed_release' || raw.consistent !== true) throw notCertified('release_audit_not_consistent')
  if (raw.active_production_operations !== 0) throw notCertified('release_audit_active_operation')
  if (incident.open !== false || incident.quarantine_mode !== null) throw notCertified('release_audit_incident_open')
  if (!Array.isArray(raw.ledger.unmanaged_strict_tags) || raw.ledger.unmanaged_strict_tags.length !== 0) throw notCertified('release_audit_unmanaged_release_tag')
  if (raw.reentry.state !== 'not_required') throw notCertified('release_audit_reentry_required')
  if (runtime.proven !== true || !VERSION.test(clean(runtime.version)) || !SHA.test(clean(runtime.sha))) throw notCertified('release_audit_runtime_unproven')
  if (managed.proven !== true || !VERSION.test(clean(managed.tag)) || !SHA.test(clean(managed.sha))) throw notCertified('release_audit_managed_release_unproven')
  if (runtime.version !== managed.tag || runtime.sha !== managed.sha) throw notCertified('release_audit_runtime_release_mismatch')
  return { version: managed.tag, sha: managed.sha }
}

function validateRecovery(raw, sha) {
  const { control_plane: cp, audit, runtime, managed_release: managed, rollback_target: target, limitations } = raw
  if (![cp, audit, runtime, managed, target].every(isPlainObject) || !Array.isArray(limitations)) throw unproven('recovery_readiness_malformed')
  // Final certification is a quiescent-system attestation: only these two states are certifiable, even when pass=true.
  if (raw.state !== 'ready' && raw.state !== 'limited_bootstrap_no_previous_release') throw notCertified('recovery_readiness_state_not_certifiable')
  if (raw.pass !== true || raw.reason_code !== null) throw notCertified('recovery_readiness_not_passing')
  if (cp.exact_main !== true || cp.requested_sha !== sha || cp.current_main_sha !== sha) throw notCertified('recovery_readiness_main_unproven')
  if (cp.rollback_contract_proven !== true) throw notCertified('recovery_readiness_rollback_contract_unproven')
  if (audit.state !== 'consistent_managed_release' || audit.consistent !== true || audit.incident_open !== false ||
      audit.quarantine_mode !== null || audit.reentry_state !== 'not_required') {
    throw notCertified('recovery_readiness_audit_not_clean')
  }
  if (runtime.proven !== true || runtime.strict_smoke !== true || !VERSION.test(clean(runtime.version)) || !SHA.test(clean(runtime.sha))) {
    throw notCertified('recovery_readiness_runtime_unproven')
  }
  if (managed.proven !== true || !VERSION.test(clean(managed.tag)) || !SHA.test(clean(managed.sha)) ||
      runtime.version !== managed.tag || runtime.sha !== managed.sha) {
    throw notCertified('recovery_readiness_managed_release_unproven')
  }
  if (raw.state === 'ready') {
    const valid = target.available === true && target.main_ancestor === true && target.source === 'previous_managed_release' &&
      VERSION.test(clean(target.tag)) && SHA.test(clean(target.sha)) && limitations.length === 0
    if (!valid) throw notCertified('recovery_readiness_rollback_target_invalid')
    return { limitations: [], version: managed.tag, sha: managed.sha, target: { available: true, tag: target.tag, sha: target.sha } }
  }
  if (target.available !== false) throw notCertified('recovery_readiness_rollback_target_invalid')
  if (limitations.length !== 1 || limitations[0] !== BOOTSTRAP_LIMITATION) throw notCertified('recovery_readiness_unknown_limitation')
  return { limitations: [BOOTSTRAP_LIMITATION], version: managed.tag, sha: managed.sha, target: { available: false, tag: null, sha: null } }
}

function validateDrill(raw) {
  if (raw.synthetic_only !== true || raw.authority_added !== false) throw notCertified('resilience_drill_authority_invalid')
  if (!Array.isArray(raw.cases)) throw unproven('resilience_drill_malformed')
  const names = raw.cases.map((item) => item?.name)
  const exact = names.length === DRILL_SCENARIOS.length && names.every((name, index) => name === DRILL_SCENARIOS[index])
  if (!exact || raw.total !== DRILL_SCENARIOS.length) throw notCertified('resilience_drill_scenario_set_invalid')
  if (raw.cases.some((item) => item.passed !== true) || raw.passed !== DRILL_SCENARIOS.length || raw.failed !== 0) {
    throw notCertified('resilience_drill_scenario_failed')
  }
  return { total: raw.total, passed: raw.passed, failed: raw.failed, scenarios: [...names] }
}

function validateWatchdog(raw) {
  if (!Array.isArray(raw.findings) || !Array.isArray(raw.active_operations)) throw unproven('watchdog_malformed')
  // Quiescence only: `active_within_budget` is healthy for monitoring but never certifiable.
  if (raw.state !== 'healthy' || raw.healthy !== true || raw.severity !== 'none') throw notCertified('watchdog_not_healthy')
  if (raw.findings.length !== 0) throw notCertified('watchdog_findings_present')
  if (raw.active_operations.length !== 0) throw notCertified('watchdog_active_operations_present')
  return { state: 'healthy', findings: 0, active_operations: 0 }
}

async function proveDeployHealth({ repo, sha, deps, nowMs }) {
  const spec = { path: WORKFLOW_PATHS.deploy_health }
  const records = await step('deploy_health_unproven', async () => {
    const listed = await deps.listWorkflows()
    if (!Array.isArray(listed)) throw unproven('deploy_health_unproven')
    return listed
  })
  const current = records.filter((record) => record && record.path === spec.path && record.state === 'active')
  if (current.length !== 1 || !Number.isInteger(Number(current[0].id)) || Number(current[0].id) < 1) throw unproven('deploy_health_workflow_unresolved')
  const workflowId = Number(current[0].id)
  const runs = await step('deploy_health_unproven', async () => {
    // Unfiltered newest-first page; status/branch filtered listings were observed returning stale snapshots.
    const listed = await deps.listWorkflowRuns(workflowId, { recent: true })
    if (!Array.isArray(listed)) throw unproven('deploy_health_unproven')
    return listed
  })

  let newest = null
  for (const run of runs) {
    const identity = validateRun(run, { repo, workflowPath: spec.path, reason: 'deploy_health' })
    if (Number(run.workflow_id) !== workflowId) throw unproven('deploy_health_workflow_unresolved')
    if (identity.status !== 'completed' || run.head_branch !== 'main' || identity.headSha !== sha) continue
    const completedMs = parseTimestamp(identity.updatedAt, 'deploy_health_timing_unproven')
    if (!newest || completedMs > newest.completedMs) newest = { identity, completedMs }
  }
  if (!newest) throw unproven('deploy_health_evidence_missing')
  if (newest.identity.conclusion !== 'success') throw notCertified('deploy_health_run_not_successful')
  const age = ageMinutes(newest.completedMs, nowMs, 'deploy_health_timing_unproven')
  if (age > POLICY.deploy_health_minutes) throw notCertified('deploy_health_evidence_stale')

  const jobs = await step('deploy_health_jobs_unproven', async () => {
    const listed = await deps.listRunJobs(newest.identity.id)
    if (!Array.isArray(listed)) throw unproven('deploy_health_jobs_unproven')
    return listed
  })
  const results = {}
  for (const name of DEPLOY_HEALTH_JOBS) {
    const matches = jobs.filter((job) => job && job.name === name)
    if (matches.length !== 1) throw unproven('deploy_health_jobs_unproven')
    if (matches[0].status !== 'completed' || matches[0].conclusion !== 'success') throw notCertified('deploy_health_job_not_successful')
    results[name] = 'success'
  }
  return { run_id: newest.identity.id, run_attempt: newest.identity.attempt, completed_at: clean(newest.identity.updatedAt), age_minutes: Math.floor(age), jobs: results }
}

// ---- orchestration -------------------------------------------------------------------------------------------

/**
 * Explicit final invariant: exactly [] -> certified and exactly [no_previous_managed_release] -> certified_with_limitations.
 * Any other limitation set can never certify, regardless of how it was accumulated.
 */
export function finalSuccessState(limitations) {
  if (!Array.isArray(limitations)) throw unproven('limitations_malformed')
  if (limitations.length === 0) return 'certified'
  if (limitations.length === 1 && limitations[0] === BOOTSTRAP_LIMITATION) return 'certified_with_limitations'
  throw notCertified('unsupported_limitations')
}

function emptyResult(controlPlaneSha) {
  return {
    schema: CERT_SCHEMA,
    workflow: CERT_WORKFLOW_NAME,
    state: 'unproven',
    certified: false,
    reason_code: null,
    limitations: [],
    control_plane: { main_sha: controlPlaneSha, main_tree: null, source_pr: null, candidate_sha: null, candidate_tree: null, tree_match: false },
    gates: { candidate_ci: null, staging: null, main_ci: null },
    production: { version: null, sha: null, release_audit: null, recovery_readiness: null, deploy_health: null },
    resilience: null,
    watchdog: null,
    evaluated_at: null,
  }
}

/**
 * Pure given deps and an injected `now`; the only I/O is read-only GETs through deps.
 * Never throws for evidence problems: every failure maps to `not_certified` or `unproven` with a stable reason code.
 */
export async function evaluateProductionReadinessCertification({ repo, controlPlaneSha, now }, deps) {
  if (!repo) throw new Error('production readiness certification: repository is required')
  if (!SHA.test(clean(controlPlaneSha))) throw new Error('production readiness certification: control-plane SHA is invalid')
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(nowMs)) throw new Error('production readiness certification: now must be a valid Date')

  const result = emptyResult(controlPlaneSha)
  result.evaluated_at = new Date(nowMs).toISOString()
  const limitations = []
  try {
    await proveMainIdentity(controlPlaneSha, deps)

    const provenance = await proveProvenance({ repo, sha: controlPlaneSha, deps })
    result.control_plane = {
      main_sha: controlPlaneSha,
      main_tree: provenance.mainTree,
      source_pr: provenance.sourcePr,
      candidate_sha: provenance.candidateSha,
      candidate_tree: provenance.candidateTree,
      tree_match: true,
    }

    result.gates.candidate_ci = await proveCiGate({ repo, sha: provenance.candidateSha, deps, label: 'candidate', event: 'pull_request', branch: provenance.candidateBranch })
    result.gates.staging = await proveStaging({ repo, provenance, ciRunId: result.gates.candidate_ci.run_id, deps })
    result.gates.main_ci = await proveCiGate({ repo, sha: controlPlaneSha, deps, label: 'main', event: 'push', branch: 'main' })

    const deployHealth = await proveDeployHealth({ repo, sha: controlPlaneSha, deps, nowMs })

    const auditEvidence = await loadArtifactEvidence({
      repo, sha: controlPlaneSha, deps, nowMs,
      spec: { label: 'release_audit', artifact: 'production-release-audit', schema: 'patelrep.production-release-audit.v1', workflow: 'Production Release Audit', path: WORKFLOW_PATHS.release_audit, maxMinutes: POLICY.release_audit_minutes, embedsRun: true },
    })
    const audit = validateAudit(auditEvidence.raw)

    const recoveryEvidence = await loadArtifactEvidence({
      repo, sha: controlPlaneSha, deps, nowMs,
      spec: { label: 'recovery_readiness', artifact: 'production-recovery-readiness', schema: 'patelrep.production-recovery-readiness.v1', workflow: 'Production Recovery Readiness', path: WORKFLOW_PATHS.recovery_readiness, maxMinutes: POLICY.recovery_readiness_minutes, embedsRun: true },
    })
    const recovery = validateRecovery(recoveryEvidence.raw, controlPlaneSha)
    if (recovery.version !== audit.version || recovery.sha !== audit.sha) throw notCertified('production_identity_mismatch')
    limitations.push(...recovery.limitations)

    // The managed production release SHA is deliberately NOT compared with main: production may legitimately remain
    // on an older managed release while the control plane on main is newer.
    result.production = {
      version: audit.version,
      sha: audit.sha,
      release_audit: { run_id: auditEvidence.run.id, run_attempt: auditEvidence.run.attempt, completed_at: auditEvidence.completedAt, age_minutes: auditEvidence.ageMinutes, state: 'consistent_managed_release' },
      recovery_readiness: {
        run_id: recoveryEvidence.run.id, run_attempt: recoveryEvidence.run.attempt, completed_at: recoveryEvidence.completedAt, age_minutes: recoveryEvidence.ageMinutes,
        state: recoveryEvidence.raw.state, rollback_target: recovery.target,
      },
      deploy_health: deployHealth,
    }

    const drillEvidence = await loadArtifactEvidence({
      repo, sha: controlPlaneSha, deps, nowMs,
      spec: { label: 'resilience_drill', artifact: 'release-resilience-drill', schema: 'patelrep.release-resilience-drill.v1', path: WORKFLOW_PATHS.resilience_drill, maxMinutes: POLICY.resilience_drill_minutes, embedsRun: false },
    })
    result.resilience = { run_id: drillEvidence.run.id, run_attempt: drillEvidence.run.attempt, completed_at: drillEvidence.completedAt, age_minutes: drillEvidence.ageMinutes, ...validateDrill(drillEvidence.raw) }

    const watchdogEvidence = await loadArtifactEvidence({
      repo, sha: controlPlaneSha, deps, nowMs,
      spec: { label: 'watchdog', artifact: 'production-automation-watchdog', schema: 'patelrep.production-automation-watchdog.v1', workflow: 'Production Automation Watchdog', path: WORKFLOW_PATHS.watchdog, maxMinutes: POLICY.watchdog_minutes, embedsRun: true },
    })
    result.watchdog = { run_id: watchdogEvidence.run.id, run_attempt: watchdogEvidence.run.attempt, completed_at: watchdogEvidence.completedAt, age_minutes: watchdogEvidence.ageMinutes, ...validateWatchdog(watchdogEvidence.raw) }

    // Never certify a stale main: prove main is still the certified SHA immediately before finalizing.
    await proveMainIdentity(controlPlaneSha, deps)

    result.limitations = [...new Set(limitations)].sort()
    result.state = finalSuccessState(result.limitations)
    result.certified = true
  } catch (error) {
    const verdict = error instanceof Verdict ? error : unproven('certification_evaluation_failed')
    result.state = verdict.state
    result.certified = false
    result.reason_code = verdict.reason
    result.limitations = []
  }
  return Object.freeze(result)
}

function attachRun(result, env) {
  const runId = clean(env.RUN_ID)
  const attempt = Number(clean(env.RUN_ATTEMPT))
  const sha = clean(env.CONTROL_PLANE_SHA)
  if (!RUN_ID.test(runId)) throw new Error('production readiness certification: invalid run id')
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('production readiness certification: invalid run attempt')
  if (!SHA.test(sha)) throw new Error('production readiness certification: invalid control-plane SHA')
  return { ...result, run: { id: runId, attempt, control_plane_sha: sha } }
}

async function main() {
  const env = process.env
  const repo = clean(env.REPO)
  const controlPlaneSha = clean(env.CONTROL_PLANE_SHA)
  const now = new Date()
  let result
  try {
    result = await evaluateProductionReadinessCertification({ repo, controlPlaneSha, now }, realProductionReadinessCertificationDeps({ repo, readToken: env.GH_TOKEN }))
  } catch {
    result = { ...emptyResult(SHA.test(controlPlaneSha) ? controlPlaneSha : null), reason_code: 'certification_evaluation_failed', evaluated_at: now.toISOString() }
  }
  result = attachRun(result, env)

  const dir = clean(env.RESULT_DIR)
  if (!dir) throw new Error('production readiness certification: RESULT_DIR is required')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })

  if (!env.GITHUB_OUTPUT) throw new Error('production readiness certification: GITHUB_OUTPUT is required')
  appendFileSync(env.GITHUB_OUTPUT, `state=${result.state}\ncertified=${result.certified ? 'true' : 'false'}\nreason_code=${result.reason_code ?? ''}\n`)
  console.log(`Production readiness certification: state=${result.state}; certified=${result.certified}; reason=${result.reason_code ?? 'none'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
