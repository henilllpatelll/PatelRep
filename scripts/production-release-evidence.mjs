#!/usr/bin/env node
// Phase 3A: sanitized, read-only evidence for one Production Release run.
// This records what GitHub can prove from the completed job graph. Ambiguous partial
// mutations are deliberately "unknown_after_attempt" rather than guessed safe.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const ATTEMPT = /^[1-9][0-9]{0,8}$/
const PR_NUMBER = /^[1-9][0-9]{0,9}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const JOB_RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped'])

const optional = (value) => String(value ?? '').trim()

function requireMatch(name, value, pattern) {
  const normalized = optional(value)
  if (!pattern.test(normalized)) throw new Error(`production release evidence: invalid ${name}`)
  return normalized
}

function optionalMatch(name, value, pattern) {
  const normalized = optional(value)
  if (normalized && !pattern.test(normalized)) throw new Error(`production release evidence: invalid ${name}`)
  return normalized || null
}

function jobResult(name, value) {
  const normalized = optional(value)
  if (!JOB_RESULTS.has(normalized)) throw new Error(`production release evidence: invalid ${name} result`)
  return normalized
}

function databaseState(preflightResult, pending, migrateResult) {
  if (preflightResult !== 'success') return 'not_proven'
  if (pending === 'false') return 'no_change'
  if (pending !== 'true') return 'not_proven'
  if (migrateResult === 'success') return 'verified_applied'
  if (migrateResult === 'failure' || migrateResult === 'cancelled') return 'unknown_after_attempt'
  return 'not_proven'
}

function deploymentState(result) {
  if (result === 'success') return 'deployed_and_verified'
  if (result === 'skipped') return 'not_started'
  return 'unknown_after_attempt'
}

function releaseRecordState(result) {
  if (result === 'success') return 'created'
  if (result === 'skipped') return 'not_created'
  return 'unknown_after_attempt'
}

export async function buildProductionReleaseEvidence(input, deps = {}) {
  const runId = requireMatch('run id', input.runId, RUN_ID)
  const runAttempt = requireMatch('run attempt', input.runAttempt, ATTEMPT)
  const controlPlaneSha = requireMatch('control-plane SHA', input.controlPlaneSha, SHA)
  const targetSha = optionalMatch('target SHA', input.targetSha, SHA)
  const prNumber = optionalMatch('PR number', input.prNumber, PR_NUMBER)
  const previousTag = optionalMatch('previous release tag', input.previousTag, VERSION)
  const nextVersion = optionalMatch('candidate release version', input.nextVersion, VERSION)
  const automationSourceRunId = optionalMatch('automation source run id', input.automationSourceRunId, RUN_ID)
  const incidentCloseoutRunId = optionalMatch('incident closeout run id', input.incidentCloseoutRunId, RUN_ID)
  const eligible = optional(input.eligible)
  if (!['', 'true', 'false'].includes(eligible)) throw new Error('production release evidence: invalid eligible value')
  const versionBump = optional(input.versionBump)
  if (!['patch', 'minor', 'major'].includes(versionBump)) throw new Error('production release evidence: invalid version bump')

  const jobs = Object.freeze({
    incident_reentry: jobResult('incident re-entry', input.incidentReentryResult),
    eligibility: jobResult('eligibility', input.resolveResult),
    version: jobResult('version', input.computeVersionResult),
    content_summary: jobResult('content summary', input.contentSummaryResult),
    database_preflight: jobResult('database preflight', input.dbPreflightResult),
    database_migrate: jobResult('database migrate', input.dbMigrateResult),
    api_deploy: jobResult('API deploy', input.apiResult),
    web_deploy: jobResult('Web deploy', input.webResult),
    production_verification: jobResult('production verification', input.verifyResult),
    tag_and_release: jobResult('tag and release', input.tagResult),
  })

  const dbPending = optional(input.dbPending)
  if (!['', 'true', 'false'].includes(dbPending)) throw new Error('production release evidence: invalid database pending value')

  let previousRelease = null
  if (previousTag) {
    if (typeof deps.resolveTagCommit !== 'function') throw new Error('production release evidence: tag resolver unavailable')
    const sha = await deps.resolveTagCommit(previousTag)
    if (!SHA.test(optional(sha))) throw new Error(`production release evidence: ${previousTag} does not resolve to a commit`)
    previousRelease = { tag: previousTag, sha: optional(sha) }
  }

  const mutations = Object.freeze({
    database: databaseState(jobs.database_preflight, dbPending, jobs.database_migrate),
    api: deploymentState(jobs.api_deploy),
    web: deploymentState(jobs.web_deploy),
    release_record: releaseRecordState(jobs.tag_and_release),
  })

  const disposition =
    jobs.tag_and_release === 'success'
      ? 'released'
      : eligible !== 'true'
        ? 'refused_before_release_eligibility'
        : 'failed_or_partial'

  return Object.freeze({
    schema: 'patelrep.production-release-evidence.v1',
    workflow: 'Production Release',
    run: { id: runId, attempt: Number(runAttempt), control_plane_sha: controlPlaneSha },
    source: {
      mode: automationSourceRunId ? 'automated_recovery_request' : 'manual',
      automation_source_run_id: automationSourceRunId,
      incident_closeout_run_id: incidentCloseoutRunId,
      version_bump: versionBump,
    },
    candidate: {
      eligible: eligible === 'true',
      release_sha: targetSha,
      pr_number: prNumber ? Number(prNumber) : null,
      version: nextVersion,
    },
    previous_release: previousRelease,
    jobs,
    database_pending: dbPending === '' ? null : dbPending === 'true',
    mutations,
    production_verified: jobs.production_verification === 'success',
    disposition,
  })
}


async function main() {
  const env = process.env
  const evidence = await buildProductionReleaseEvidence(
    {
      runId: env.RUN_ID,
      runAttempt: env.RUN_ATTEMPT,
      controlPlaneSha: env.CONTROL_PLANE_SHA,
      eligible: env.ELIGIBLE,
      targetSha: env.TARGET_SHA,
      prNumber: env.PR_NUMBER,
      previousTag: env.PREVIOUS_TAG,
      nextVersion: env.NEXT_VERSION,
      versionBump: env.VERSION_BUMP,
      automationSourceRunId: env.AUTOMATION_SOURCE_RUN_ID,
      incidentCloseoutRunId: env.INCIDENT_CLOSEOUT_RUN_ID,
      incidentReentryResult: env.INCIDENT_REENTRY_RESULT,
      resolveResult: env.RESOLVE_RESULT,
      computeVersionResult: env.COMPUTE_VERSION_RESULT,
      contentSummaryResult: env.CONTENT_SUMMARY_RESULT,
      dbPreflightResult: env.DB_PREFLIGHT_RESULT,
      dbPending: env.DB_PENDING,
      dbMigrateResult: env.DB_MIGRATE_RESULT,
      apiResult: env.API_RESULT,
      webResult: env.WEB_RESULT,
      verifyResult: env.VERIFY_RESULT,
      tagResult: env.TAG_RESULT,
    },
    {
      resolveTagCommit: async (tag) => {
        const { realReleaseDeps } = await import('./production-release-request-deps.mjs')
        const deps = realReleaseDeps({ repo: env.REPO, readToken: env.GH_TOKEN })
        return deps.resolveTagCommit(tag)
      },
    },
  )

  const resultDir = optional(env.RESULT_DIR)
  if (!resultDir) throw new Error('production release evidence: RESULT_DIR is required')
  mkdirSync(resultDir, { recursive: true })
  writeFileSync(path.join(resultDir, 'context.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(`Production release evidence: ${evidence.disposition}; DB=${evidence.mutations.database}; API=${evidence.mutations.api}; Web=${evidence.mutations.web}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
