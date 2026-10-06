#!/usr/bin/env node
// Phase 4D: read-only production release integrity audit.
// It proves normal managed-baseline state or one of the two explicitly supported automated-rollback quarantines.
// It never mutates production or GitHub state.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAutoRollbackCircuitBreaker } from './production-auto-rollback-circuit-breaker.mjs'
import {
  findLatestOpenAutomatedRollback,
  validateReentryAuthorization,
  validateReentryAuthorizationRun,
} from './production-incident-reentry.mjs'
import { PRODUCTION_RELEASE_AUDIT_ARTIFACT, realProductionReleaseAuditDeps } from './production-release-audit-deps.mjs'
import { compareVersions, completedReleases, parseStrictTag, resolveProductionBaseline } from './release-version.mjs'

export { PRODUCTION_RELEASE_AUDIT_ARTIFACT }
export const AUDIT_SCHEMA = 'patelrep.production-release-audit.v1'
export const AUDIT_WORKFLOW_NAME = 'Production Release Audit'
export const AUDIT_WORKFLOW_PATH = '.github/workflows/production-release-audit.yml'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const clean = (value) => String(value ?? '').trim()

function requireMatch(name, value, pattern) {
  const normalized = clean(value)
  if (!pattern.test(normalized)) throw new Error(`production release audit: invalid ${name}`)
  return normalized
}

function shell(state, reasonCode = null) {
  return {
    schema: AUDIT_SCHEMA,
    workflow: AUDIT_WORKFLOW_NAME,
    state,
    consistent: state !== 'inconsistent',
    reason_code: reasonCode,
    runtime: { proven: false, version: null, sha: null },
    managed_release: { proven: false, tag: null, sha: null },
    ledger: { unmanaged_strict_tags: [] },
    active_production_operations: 0,
    incident: {
      open: false,
      rollback_run_id: null,
      incident_run_id: null,
      quarantine_mode: null,
      failed_candidate_version: null,
      failed_candidate_sha: null,
    },
    reentry: {
      state: 'not_required',
      authorization_run_id: null,
      release_sha: null,
      version_bump: null,
    },
  }
}

async function auditReleaseLedger(deps, baseline, result) {
  const [releases, tagNames] = await Promise.all([deps.listReleases(), deps.listTagNames()])
  const completed = completedReleases(releases)
  const seen = new Set()
  for (const release of completed) {
    if (seen.has(release.tag)) throw new Error('production release audit: duplicate completed managed Release tag')
    seen.add(release.tag)
  }
  const completedTags = new Set(completed.map((release) => release.tag))
  const unmanaged = tagNames
    .map((tag) => ({ tag, version: parseStrictTag(tag) }))
    .filter(({ tag, version }) => version && !completedTags.has(tag) && compareVersions(version, baseline.version) >= 0)
    .map(({ tag }) => tag)
    .sort()
  result.ledger.unmanaged_strict_tags = unmanaged
  if (unmanaged.length > 0) {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'unmanaged_release_tag_conflict'
  }
}

async function findMatchingReentry({ repo, open, mainSha, deps }) {
  const runs = await deps.listReentryRuns()
  if (!Array.isArray(runs)) throw new Error('production release audit: re-entry run list is malformed')
  for (const run of runs) {
    if (Date.parse(run.created_at ?? '') <= Date.parse(open.run.created_at ?? '')) continue
    const runId = String(run.id)
    const trusted = validateReentryAuthorizationRun(run, { repo, runId })
    const raw = await deps.readReentryAuthorization(runId)
    if (raw === null) throw new Error('production release audit: successful re-entry run has no authorization artifact')
    const authorization = validateReentryAuthorization(raw, trusted)
    if (authorization.rollback_run_id !== String(open.run.id)) continue
    return {
      state: authorization.authorized_release.sha === mainSha ? 'authorized_current_main' : 'authorization_stale_main',
      authorization_run_id: runId,
      release_sha: authorization.authorized_release.sha,
      version_bump: authorization.authorized_release.version_bump,
    }
  }
  return { state: 'required', authorization_run_id: null, release_sha: null, version_bump: null }
}

export async function auditProductionReleaseState({ repo }, deps, helpers = { findLatestOpenAutomatedRollback, verifyAutoRollbackCircuitBreaker }) {
  if (!repo) throw new Error('production release audit: repository is required')
  const result = shell('consistent_managed_release')

  const active = await deps.listActiveProductionRuns()
  if (!Array.isArray(active)) throw new Error('production release audit: active production run state is malformed')
  result.active_production_operations = active.length
  if (active.length > 0) {
    result.state = 'deferred_active_production_operation'
    result.reentry.state = 'unknown_during_active_operation'
    return Object.freeze(result)
  }

  let baseline
  try {
    baseline = await resolveProductionBaseline(deps)
  } catch {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'managed_release_unproven'
    return Object.freeze(result)
  }
  if (!baseline) {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'managed_release_missing'
    return Object.freeze(result)
  }
  result.managed_release = { proven: true, tag: baseline.tag, sha: baseline.sha }

  try {
    await auditReleaseLedger(deps, baseline, result)
  } catch {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'managed_release_ledger_unproven'
    return Object.freeze(result)
  }
  if (!result.consistent) return Object.freeze(result)

  let runtime
  try {
    runtime = await deps.readRuntimeIdentity()
  } catch {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'runtime_identity_unproven'
    return Object.freeze(result)
  }
  if (!SHA.test(runtime?.sha ?? '') || !parseStrictTag(runtime?.version ?? '')) {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'runtime_identity_malformed'
    return Object.freeze(result)
  }
  result.runtime = { proven: true, version: runtime.version, sha: runtime.sha }

  let open
  try {
    open = await helpers.findLatestOpenAutomatedRollback({ repo, deps })
  } catch {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'incident_state_unproven'
    return Object.freeze(result)
  }

  if (!open) {
    if (runtime.sha !== baseline.sha || runtime.version !== baseline.tag) {
      result.state = 'inconsistent'
      result.consistent = false
      result.reason_code = 'runtime_managed_release_mismatch'
      return Object.freeze(result)
    }
    result.reentry.state = 'not_required'
    return Object.freeze(result)
  }

  result.incident.open = true
  result.incident.rollback_run_id = String(open.run.id)
  result.incident.incident_run_id = open.evidence.incident_run_id

  let quarantine
  try {
    quarantine = await helpers.verifyAutoRollbackCircuitBreaker(
      {
        repo,
        sourceRunId: open.evidence.incident_run_id,
        targetVersion: open.evidence.target.version,
        targetSha: open.evidence.target.sha,
      },
      deps,
    )
  } catch {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'rollback_quarantine_unproven'
    return Object.freeze(result)
  }

  result.incident.quarantine_mode = quarantine.mode
  result.incident.failed_candidate_version = quarantine.failed_candidate?.version ?? null
  result.incident.failed_candidate_sha = quarantine.failed_candidate?.sha ?? null

  const mainSha = requireMatch('main SHA', await deps.getMainSha(), SHA)
  try {
    result.reentry = await findMatchingReentry({ repo, open, mainSha, deps })
  } catch {
    result.state = 'inconsistent'
    result.consistent = false
    result.reason_code = 'reentry_state_unproven'
    return Object.freeze(result)
  }

  if (quarantine.mode === 'managed_release_mismatch') {
    result.state = 'quarantined_post_release_regression'
    return Object.freeze(result)
  }
  if (quarantine.mode === 'failed_candidate_unmanaged') {
    result.state = 'quarantined_partial_release_failure'
    return Object.freeze(result)
  }

  result.state = 'inconsistent'
  result.consistent = false
  result.reason_code = 'unknown_quarantine_mode'
  return Object.freeze(result)
}

function attachRun(result, env) {
  const runId = requireMatch('audit run id', env.RUN_ID, RUN_ID)
  const attempt = Number(clean(env.RUN_ATTEMPT))
  const controlPlaneSha = requireMatch('audit control-plane SHA', env.CONTROL_PLANE_SHA, SHA)
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('production release audit: invalid audit run attempt')
  return { ...result, run: { id: runId, attempt, control_plane_sha: controlPlaneSha } }
}

async function main() {
  const env = process.env
  const repo = clean(env.REPO)
  const deps = realProductionReleaseAuditDeps({ repo, readToken: env.GH_TOKEN })

  let result
  try {
    result = await auditProductionReleaseState({ repo }, deps)
  } catch {
    result = shell('inconsistent', 'audit_state_unproven')
    result.consistent = false
  }
  result = attachRun(result, env)

  const dir = clean(env.RESULT_DIR)
  if (!dir) throw new Error('production release audit: RESULT_DIR is required')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })

  if (!env.GITHUB_OUTPUT) throw new Error('production release audit: GITHUB_OUTPUT is required')
  appendFileSync(env.GITHUB_OUTPUT, `consistent=${result.consistent ? 'true' : 'false'}\nstate=${result.state}\nreason_code=${result.reason_code ?? ''}\n`)
  console.log(`Production release audit: state=${result.state}; consistent=${result.consistent}; reason=${result.reason_code ?? 'none'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
