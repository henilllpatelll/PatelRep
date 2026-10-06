#!/usr/bin/env node
// Phase 4A: sanitized, read-only evidence for one Production Rollback run.
// Records trusted GitHub job outcomes and exact release identities only. No secrets, URLs,
// database credentials, Railway identifiers, or free-form error text belong in this artifact.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROLLBACK_EVIDENCE_ARTIFACT = 'production-rollback-evidence'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const ATTEMPT = /^[1-9][0-9]{0,8}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const JOB_RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped'])

const clean = (value) => String(value ?? '').trim()

function requireMatch(name, value, pattern) {
  const normalized = clean(value)
  if (!pattern.test(normalized)) throw new Error(`production rollback evidence: invalid ${name}`)
  return normalized
}

function jobResult(name, value) {
  const normalized = clean(value)
  if (!JOB_RESULTS.has(normalized)) throw new Error(`production rollback evidence: invalid ${name} result`)
  return normalized
}

function deploymentState(result) {
  if (result === 'success') return 'deployed_and_verified'
  if (result === 'skipped') return 'not_started'
  return 'unknown_after_attempt'
}

function preRuntimeState({ job, status, sha, version }) {
  if (job === 'skipped') return Object.freeze({ state: 'not_started', sha: null, version: null })
  if (job === 'failure' || job === 'cancelled') return Object.freeze({ state: 'capture_failed', sha: null, version: null })
  if (status === 'unproven') return Object.freeze({ state: 'unproven', sha: null, version: null })
  if (status !== 'proven') throw new Error('production rollback evidence: invalid pre-runtime status')
  if (!SHA.test(clean(sha)) || !VERSION.test(clean(version))) {
    throw new Error('production rollback evidence: malformed proven pre-runtime identity')
  }
  return Object.freeze({ state: 'proven', sha: clean(sha), version: clean(version) })
}

function quarantineState({ automated, result }) {
  if (!automated) {
    if (result !== 'skipped') throw new Error('production rollback evidence: manual rollback unexpectedly ran circuit breaker')
    return 'not_applicable'
  }
  if (result === 'success') return 'verified'
  if (result === 'skipped') return 'not_run'
  return 'unproven'
}

export async function buildProductionRollbackEvidence(input, deps = {}) {
  const runId = requireMatch('run id', input.runId, RUN_ID)
  const runAttempt = requireMatch('run attempt', input.runAttempt, ATTEMPT)
  const controlPlaneSha = requireMatch('control-plane SHA', input.controlPlaneSha, SHA)

  const requestedRaw = clean(input.requestedTargetVersion)
  const requestedTargetVersion = VERSION.test(requestedRaw) ? requestedRaw : null
  const automationRaw = clean(input.automationSourceRunId)
  const automationSourceRunId = RUN_ID.test(automationRaw) ? automationRaw : null
  const automationSourcePresent = automationRaw !== ''

  const jobs = Object.freeze({
    automation_provenance: jobResult('automation provenance', input.provenanceResult),
    pre_runtime_capture: jobResult('pre-runtime capture', input.preRuntimeResult),
    target_resolution: jobResult('target resolution', input.resolveResult),
    database_compatibility: jobResult('database compatibility', input.compatibilityResult),
    api_deploy: jobResult('API deploy', input.apiResult),
    web_deploy: jobResult('Web deploy', input.webResult),
    rollback_verification: jobResult('rollback verification', input.verifyResult),
    circuit_breaker: jobResult('circuit breaker', input.circuitResult),
  })

  const beforeRuntime = preRuntimeState({
    job: jobs.pre_runtime_capture,
    status: clean(input.preRuntimeStatus),
    sha: input.preRuntimeSha,
    version: input.preRuntimeVersion,
  })

  let target = Object.freeze({
    requested_version: requestedTargetVersion,
    requested_version_valid: requestedRaw !== '' && requestedTargetVersion !== null,
    resolved: false,
    version: null,
    sha: null,
  })

  if (jobs.target_resolution === 'success') {
    const resolvedVersion = requireMatch('resolved target version', input.resolvedTargetVersion, VERSION)
    const resolvedSha = requireMatch('resolved target SHA', input.resolvedTargetSha, SHA)
    if (!requestedTargetVersion || resolvedVersion !== requestedTargetVersion) {
      throw new Error('production rollback evidence: resolved target does not match sanitized request')
    }
    if (typeof deps.resolveTagCommit !== 'function') throw new Error('production rollback evidence: tag resolver unavailable')
    const liveTagSha = await deps.resolveTagCommit(resolvedVersion)
    if (clean(liveTagSha) !== resolvedSha) throw new Error('production rollback evidence: rollback target tag identity changed')
    target = Object.freeze({
      requested_version: requestedTargetVersion,
      requested_version_valid: true,
      resolved: true,
      version: resolvedVersion,
      sha: resolvedSha,
    })
  }

  const mutations = Object.freeze({
    database: 'not_mutated_by_workflow',
    api: deploymentState(jobs.api_deploy),
    web: deploymentState(jobs.web_deploy),
    release_record: 'not_created_by_workflow',
  })

  const productionVerified = jobs.rollback_verification === 'success'
  const quarantine = quarantineState({ automated: automationSourcePresent, result: jobs.circuit_breaker })
  const afterRuntime = productionVerified && target.resolved
    ? Object.freeze({ state: 'verified_target', sha: target.sha, version: target.version })
    : Object.freeze({ state: 'unproven', sha: null, version: null })

  let disposition
  if (productionVerified) {
    disposition = automationSourcePresent && quarantine !== 'verified'
      ? 'restored_quarantine_unproven'
      : 'restored'
  } else if (jobs.automation_provenance !== 'success') {
    disposition = 'refused_before_production_access'
  } else if (jobs.pre_runtime_capture !== 'success') {
    disposition = 'failed_before_production_access'
  } else if (jobs.target_resolution !== 'success') {
    disposition = 'refused_before_target_resolution'
  } else if (jobs.database_compatibility !== 'success') {
    disposition = 'refused_before_deployment'
  } else {
    disposition = 'failed_or_partial'
  }

  return Object.freeze({
    schema: 'patelrep.production-rollback-evidence.v1',
    workflow: 'Production Rollback',
    run: { id: runId, attempt: Number(runAttempt), control_plane_sha: controlPlaneSha },
    source: {
      mode: automationSourcePresent ? 'automated_incident' : 'manual',
      automation_source_present: automationSourcePresent,
      automation_source_valid: !automationSourcePresent || automationSourceRunId !== null,
      automation_source_run_id: automationSourceRunId,
    },
    before_runtime: beforeRuntime,
    target,
    jobs,
    mutations,
    after_runtime: afterRuntime,
    production_verified: productionVerified,
    quarantine,
    disposition,
  })
}

async function main() {
  const env = process.env
  const evidence = await buildProductionRollbackEvidence(
    {
      runId: env.RUN_ID,
      runAttempt: env.RUN_ATTEMPT,
      controlPlaneSha: env.CONTROL_PLANE_SHA,
      requestedTargetVersion: env.REQUESTED_TARGET_VERSION,
      automationSourceRunId: env.AUTOMATION_SOURCE_RUN_ID,
      provenanceResult: env.PROVENANCE_RESULT,
      preRuntimeResult: env.PRE_RUNTIME_RESULT,
      preRuntimeStatus: env.PRE_RUNTIME_STATUS,
      preRuntimeSha: env.PRE_RUNTIME_SHA,
      preRuntimeVersion: env.PRE_RUNTIME_VERSION,
      resolveResult: env.RESOLVE_RESULT,
      resolvedTargetSha: env.RESOLVED_TARGET_SHA,
      resolvedTargetVersion: env.RESOLVED_TARGET_VERSION,
      compatibilityResult: env.COMPATIBILITY_RESULT,
      apiResult: env.API_RESULT,
      webResult: env.WEB_RESULT,
      verifyResult: env.VERIFY_RESULT,
      circuitResult: env.CIRCUIT_RESULT,
    },
    {
      resolveTagCommit: async (tag) => {
        const { realReleaseDeps } = await import('./production-release-request-deps.mjs')
        const deps = realReleaseDeps({ repo: env.REPO, readToken: env.GH_TOKEN })
        return deps.resolveTagCommit(tag)
      },
    },
  )

  const resultDir = clean(env.RESULT_DIR)
  if (!resultDir) throw new Error('production rollback evidence: RESULT_DIR is required')
  mkdirSync(resultDir, { recursive: true })
  writeFileSync(path.join(resultDir, 'context.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(
    `Production rollback evidence: ${evidence.disposition}; before=${evidence.before_runtime.state}; API=${evidence.mutations.api}; Web=${evidence.mutations.web}; quarantine=${evidence.quarantine}`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
