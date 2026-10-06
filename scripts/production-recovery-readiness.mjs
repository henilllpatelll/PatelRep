#!/usr/bin/env node
// Phase 5B: live, read-only production recovery readiness drill.
// Reads public production identity and trusted GitHub evidence/control-plane source only.
// Never receives production Environment/secrets and never mutates GitHub or production.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditProductionReleaseState } from './production-release-audit.mjs'
import { realProductionReleaseAuditDeps } from './production-release-audit-deps.mjs'
import { findLatestOpenAutomatedRollback } from './production-incident-reentry.mjs'
import { requireRollbackExecutionContract } from './production-auto-rollback-policy.mjs'
import { completedReleases, resolveProductionBaseline } from './release-version.mjs'

export const RECOVERY_READINESS_SCHEMA = 'patelrep.production-recovery-readiness.v1'
export const RECOVERY_READINESS_WORKFLOW = 'Production Recovery Readiness'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const clean = (value) => String(value ?? '').trim()

function requireMatch(name, value, pattern) {
  const normalized = clean(value)
  if (!pattern.test(normalized)) throw new Error(`production recovery readiness: invalid ${name}`)
  return normalized
}

function shell() {
  return {
    schema: RECOVERY_READINESS_SCHEMA,
    workflow: RECOVERY_READINESS_WORKFLOW,
    state: 'ready',
    pass: true,
    reason_code: null,
    control_plane: {
      requested_sha: null,
      current_main_sha: null,
      exact_main: false,
      rollback_contract_proven: false,
    },
    audit: {
      state: null,
      consistent: null,
      reason_code: null,
      incident_open: false,
      quarantine_mode: null,
      reentry_state: null,
    },
    runtime: { proven: false, version: null, sha: null, strict_smoke: false },
    managed_release: { proven: false, tag: null, sha: null },
    rollback_target: { available: false, source: null, tag: null, sha: null, main_ancestor: false },
    database_compatibility: 'not_exercised_read_only_no_secret',
    limitations: [],
  }
}

function fail(result, reasonCode) {
  result.state = 'failed'
  result.pass = false
  result.reason_code = reasonCode
  return Object.freeze(result)
}

async function validateRollbackTarget({ target, source, deps, result }) {
  if (!target || !VERSION.test(target.tag ?? '') || !SHA.test(target.sha ?? '')) {
    return fail(result, 'rollback_target_malformed')
  }
  const releases = await deps.listReleases()
  const matches = releases.filter((release) =>
    release?.tag_name === target.tag && release.draft !== true && release.prerelease !== true)
  if (matches.length !== 1) return fail(result, 'rollback_target_release_unproven')

  let resolved
  try {
    resolved = await deps.resolveTagCommit(target.tag)
  } catch {
    return fail(result, 'rollback_target_tag_unproven')
  }
  if (resolved !== target.sha) return fail(result, 'rollback_target_tag_mismatch')

  let ancestor
  try {
    ancestor = await deps.isAncestorOfMain(target.sha)
  } catch {
    return fail(result, 'rollback_target_lineage_unproven')
  }
  if (ancestor !== true) return fail(result, 'rollback_target_not_on_main')

  result.rollback_target = {
    available: true,
    source,
    tag: target.tag,
    sha: target.sha,
    main_ancestor: true,
  }
  return null
}

export async function evaluateProductionRecoveryReadiness(
  { repo, controlPlaneSha },
  deps,
  helpers = { auditProductionReleaseState, findLatestOpenAutomatedRollback },
) {
  if (!repo) throw new Error('production recovery readiness: repository is required')
  controlPlaneSha = requireMatch('control-plane SHA', controlPlaneSha, SHA)
  const result = shell()
  result.control_plane.requested_sha = controlPlaneSha

  let currentMain
  try {
    currentMain = requireMatch('current main SHA', await deps.getMainSha(), SHA)
  } catch {
    return fail(result, 'current_main_unproven')
  }
  result.control_plane.current_main_sha = currentMain
  if (currentMain !== controlPlaneSha) {
    result.state = 'deferred_main_moved_during_drill'
    result.limitations.push('main_moved_during_drill')
    return Object.freeze(result)
  }
  result.control_plane.exact_main = true

  let audit
  try {
    audit = await helpers.auditProductionReleaseState({ repo }, deps)
  } catch {
    return fail(result, 'production_audit_unproven')
  }
  result.audit = {
    state: audit.state,
    consistent: audit.consistent,
    reason_code: audit.reason_code,
    incident_open: audit.incident?.open === true,
    quarantine_mode: audit.incident?.quarantine_mode ?? null,
    reentry_state: audit.reentry?.state ?? null,
  }

  if (audit.state === 'deferred_active_production_operation') {
    result.state = 'deferred_active_production_operation'
    result.limitations.push('active_production_operation')
    return Object.freeze(result)
  }
  if (audit.consistent !== true) return fail(result, `audit_${audit.reason_code ?? 'inconsistent'}`)

  if (audit.runtime?.proven !== true || !VERSION.test(audit.runtime.version ?? '') || !SHA.test(audit.runtime.sha ?? '')) {
    return fail(result, 'runtime_identity_unproven')
  }
  result.runtime = {
    proven: true,
    version: audit.runtime.version,
    sha: audit.runtime.sha,
    strict_smoke: false,
  }

  if (audit.managed_release?.proven !== true || !VERSION.test(audit.managed_release.tag ?? '') || !SHA.test(audit.managed_release.sha ?? '')) {
    return fail(result, 'managed_release_unproven')
  }
  result.managed_release = {
    proven: true,
    tag: audit.managed_release.tag,
    sha: audit.managed_release.sha,
  }

  try {
    const baseline = await resolveProductionBaseline(deps)
    if (!baseline || baseline.tag !== audit.managed_release.tag || baseline.sha !== audit.managed_release.sha) {
      return fail(result, 'managed_release_reproof_mismatch')
    }
  } catch {
    return fail(result, 'managed_release_reproof_unproven')
  }

  let strictHealthy
  try {
    strictHealthy = await deps.isExactCandidateHealthy({ sha: audit.runtime.sha, version: audit.runtime.version })
  } catch {
    return fail(result, 'strict_public_smoke_unproven')
  }
  if (strictHealthy !== true) return fail(result, 'strict_public_smoke_failed')
  result.runtime.strict_smoke = true

  let rollbackSource
  try {
    rollbackSource = await deps.readRollbackWorkflowAt(controlPlaneSha)
    requireRollbackExecutionContract(rollbackSource)
  } catch {
    return fail(result, 'rollback_execution_contract_unproven')
  }
  result.control_plane.rollback_contract_proven = true

  if (audit.incident?.open === true) {
    let open
    try {
      open = await helpers.findLatestOpenAutomatedRollback({ repo, deps })
    } catch {
      return fail(result, 'open_incident_reproof_unproven')
    }
    if (!open || String(open.run?.id ?? '') !== String(audit.incident.rollback_run_id ?? '')) {
      return fail(result, 'open_incident_reproof_mismatch')
    }
    const targetFailure = await validateRollbackTarget({
      target: { tag: open.evidence?.target?.version, sha: open.evidence?.target?.sha },
      source: 'open_incident',
      deps,
      result,
    })
    if (targetFailure) return targetFailure

    result.state = audit.state === 'quarantined_post_release_regression'
      ? 'ready_quarantined_post_release_regression'
      : 'ready_quarantined_partial_release_failure'
    return Object.freeze(result)
  }

  let releases
  try {
    releases = completedReleases(await deps.listReleases())
  } catch {
    return fail(result, 'release_history_unproven')
  }
  if (releases.length === 0) return fail(result, 'managed_release_missing')

  const current = releases[0]
  if (current.tag !== audit.managed_release.tag) return fail(result, 'release_history_baseline_mismatch')
  if (releases.length === 1) {
    result.state = 'limited_bootstrap_no_previous_release'
    result.limitations.push('no_previous_managed_release')
    return Object.freeze(result)
  }

  const previous = releases[1]
  let previousSha
  try {
    previousSha = await deps.resolveTagCommit(previous.tag)
  } catch {
    return fail(result, 'previous_managed_release_unproven')
  }
  const targetFailure = await validateRollbackTarget({
    target: { tag: previous.tag, sha: previousSha },
    source: 'previous_managed_release',
    deps,
    result,
  })
  if (targetFailure) return targetFailure

  result.state = 'ready'
  return Object.freeze(result)
}

function attachRun(result, env) {
  const runId = requireMatch('run id', env.RUN_ID, RUN_ID)
  const attempt = Number(clean(env.RUN_ATTEMPT))
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('production recovery readiness: invalid run attempt')
  return { ...result, run: { id: runId, attempt, control_plane_sha: requireMatch('run control-plane SHA', env.CONTROL_PLANE_SHA, SHA) } }
}

async function main() {
  const env = process.env
  const repo = clean(env.REPO)
  const controlPlaneSha = requireMatch('control-plane SHA', env.CONTROL_PLANE_SHA, SHA)
  const deps = realProductionReleaseAuditDeps({ repo, readToken: env.GH_TOKEN })

  let result
  try {
    result = await evaluateProductionRecoveryReadiness({ repo, controlPlaneSha }, deps)
  } catch {
    result = fail(shell(), 'readiness_state_unproven')
    result.control_plane.requested_sha = controlPlaneSha
  }
  result = attachRun(result, env)

  const dir = clean(env.RESULT_DIR)
  if (!dir) throw new Error('production recovery readiness: RESULT_DIR is required')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })

  if (!env.GITHUB_OUTPUT) throw new Error('production recovery readiness: GITHUB_OUTPUT is required')
  appendFileSync(env.GITHUB_OUTPUT, `pass=${result.pass ? 'true' : 'false'}\nstate=${result.state}\nreason_code=${result.reason_code ?? ''}\n`)
  console.log(`Production recovery readiness: state=${result.state}; pass=${result.pass}; reason=${result.reason_code ?? 'none'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
