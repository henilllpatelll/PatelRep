#!/usr/bin/env node
// Phase 3B: read-only classification of a completed Production Release plus a short exact-release
// stabilization window after successful releases. This script never dispatches, deploys, migrates,
// tags, releases, changes feature flags, or rolls back production.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPublicSmoke } from './public-smoke.mjs'
import { PRODUCTION_API_URL, PRODUCTION_WEB_URL } from './production-runtime-identity.mjs'

export const RELEASE_EVIDENCE_ARTIFACT = 'production-release-evidence'
export const STABILIZATION_RESULT_ARTIFACT = 'production-release-stabilization'
export const INCIDENT_ARTIFACT = 'production-release-incident'
export const CLOSEOUT_ARTIFACT = 'production-incident-closeout'
export const STABILIZATION_ATTEMPTS = 3
export const INITIAL_DELAY_MS = 30_000
export const BETWEEN_PROBES_MS = 60_000
export const CONSECUTIVE_FAILURES_REQUIRED = 2

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const MUTATION_STATES = Object.freeze({
  database: new Set(['not_proven', 'no_change', 'verified_applied', 'unknown_after_attempt']),
  api: new Set(['not_started', 'deployed_and_verified', 'unknown_after_attempt']),
  web: new Set(['not_started', 'deployed_and_verified', 'unknown_after_attempt']),
  release_record: new Set(['not_created', 'created', 'unknown_after_attempt']),
})

const clean = (value) => String(value ?? '').trim()
const requireMatch = (name, value, pattern) => {
  const normalized = clean(value)
  if (!pattern.test(normalized)) throw new Error(`release stabilization: invalid ${name}`)
  return normalized
}
const requireState = (kind, value) => {
  if (!MUTATION_STATES[kind].has(value)) throw new Error(`release stabilization: invalid ${kind} mutation state`)
  return value
}

export function validateSourceRun(run, { repo, sourceRunId }) {
  if (!run || String(run.id) !== sourceRunId) throw new Error('release stabilization: source run id mismatch')
  if (run.name !== 'Production Release' || run.path !== '.github/workflows/production-release.yml') {
    throw new Error('release stabilization: source is not the trusted Production Release workflow')
  }
  if (run.event !== 'workflow_dispatch' || run.status !== 'completed') {
    throw new Error('release stabilization: source Production Release is not a completed workflow_dispatch')
  }
  if (run.head_branch !== 'main') throw new Error('release stabilization: source Production Release did not run from main')
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) {
    throw new Error('release stabilization: source Production Release repository provenance mismatch')
  }
  requireMatch('source control-plane SHA', run.head_sha, SHA)
  return run
}

export function validateReleaseEvidence(evidence, sourceRun) {
  if (!evidence || evidence.schema !== 'patelrep.production-release-evidence.v1' || evidence.workflow !== 'Production Release') {
    throw new Error('release stabilization: malformed production release evidence')
  }
  if (String(evidence.run?.id ?? '') !== String(sourceRun.id)) throw new Error('release stabilization: evidence run id mismatch')
  if (Number(evidence.run?.attempt) !== Number(sourceRun.run_attempt)) throw new Error('release stabilization: evidence run attempt mismatch')
  if (evidence.run?.control_plane_sha !== sourceRun.head_sha) throw new Error('release stabilization: evidence control-plane SHA mismatch')
  requireMatch('evidence control-plane SHA', evidence.run.control_plane_sha, SHA)

  const disposition = evidence.disposition
  if (!['released', 'failed_or_partial', 'refused_before_release_eligibility'].includes(disposition)) {
    throw new Error('release stabilization: unknown evidence disposition')
  }

  const mutations = {
    database: requireState('database', evidence.mutations?.database),
    api: requireState('api', evidence.mutations?.api),
    web: requireState('web', evidence.mutations?.web),
    release_record: requireState('release_record', evidence.mutations?.release_record),
  }

  const candidate = {
    eligible: evidence.candidate?.eligible === true,
    release_sha: evidence.candidate?.release_sha ?? null,
    pr_number: Number.isInteger(evidence.candidate?.pr_number) ? evidence.candidate.pr_number : null,
    version: evidence.candidate?.version ?? null,
  }
  if (candidate.release_sha !== null) requireMatch('candidate release SHA', candidate.release_sha, SHA)
  if (candidate.version !== null && !VERSION.test(candidate.version)) throw new Error('release stabilization: invalid candidate release version')

  const previous = evidence.previous_release ?? null
  if (previous !== null) {
    if (!VERSION.test(previous.tag ?? '') || !SHA.test(previous.sha ?? '')) throw new Error('release stabilization: invalid previous release identity')
  }

  let reentry = null
  const rawReentry = evidence.source?.reentry
  if (rawReentry?.present === true) {
    if (rawReentry.valid !== true) throw new Error('release stabilization: release evidence has invalid re-entry provenance')
    const authorizationRunId = requireMatch('re-entry authorization run id', rawReentry.authorization_run_id, RUN_ID)
    const rollbackRunId = requireMatch('re-entry rollback run id', rawReentry.rollback_run_id, RUN_ID)
    reentry = { authorization_run_id: authorizationRunId, rollback_run_id: rollbackRunId }
  }

  if (disposition === 'released') {
    if (sourceRun.conclusion !== 'success') throw new Error('release stabilization: released evidence came from a non-successful source run')
    if (!candidate.eligible || !candidate.release_sha || !candidate.version || evidence.production_verified !== true) {
      throw new Error('release stabilization: released evidence lacks exact verified candidate identity')
    }
    if (mutations.api !== 'deployed_and_verified' || mutations.web !== 'deployed_and_verified' || mutations.release_record !== 'created') {
      throw new Error('release stabilization: released evidence has inconsistent mutation state')
    }
  } else if (sourceRun.conclusion === 'success') {
    throw new Error('release stabilization: non-released evidence came from a successful source run')
  }

  return {
    disposition,
    candidate,
    previous_release: previous,
    production_verified: evidence.production_verified === true,
    mutations,
    reentry,
  }
}

export function classifyReleaseEvidence(validated) {
  if (validated.disposition === 'released') return 'stabilize_released'
  if (validated.disposition === 'refused_before_release_eligibility') return 'refused_no_incident'

  if (validated.production_verified) {
    // The runtime passed exact final verification. A later tag/Release bookkeeping failure needs a human
    // release-ledger decision, not an application rollback.
    return 'release_record_failure_no_runtime_incident'
  }

  const runtimeMutation =
    ['verified_applied', 'unknown_after_attempt'].includes(validated.mutations.database) ||
    validated.mutations.api !== 'not_started' ||
    validated.mutations.web !== 'not_started'

  return runtimeMutation ? 'partial_release_failure' : 'pre_production_failure_no_incident'
}

function consecutiveFailureCount(probes) {
  let longest = 0
  let current = 0
  for (const probe of probes) {
    current = probe.ok ? 0 : current + 1
    longest = Math.max(longest, current)
  }
  return longest
}

export async function stabilizeExactRelease({
  releaseSha,
  releaseVersion,
  probe = async () =>
    runPublicSmoke({
      webUrl: PRODUCTION_WEB_URL,
      apiUrl: PRODUCTION_API_URL,
      expectedEnvironment: 'production',
      expectedReleaseSha: releaseSha,
      expectedReleaseVersion: releaseVersion,
    }),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  initialDelayMs = INITIAL_DELAY_MS,
  betweenProbesMs = BETWEEN_PROBES_MS,
  attempts = STABILIZATION_ATTEMPTS,
  consecutiveFailuresRequired = CONSECUTIVE_FAILURES_REQUIRED,
} = {}) {
  requireMatch('stabilization release SHA', releaseSha, SHA)
  if (!VERSION.test(releaseVersion ?? '')) throw new Error('release stabilization: invalid stabilization release version')
  if (!Number.isInteger(attempts) || attempts < consecutiveFailuresRequired || consecutiveFailuresRequired < 2) {
    throw new Error('release stabilization: invalid stabilization policy')
  }

  const probes = []
  if (initialDelayMs > 0) await sleep(initialDelayMs)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let ok = false
    try {
      await probe()
      ok = true
    } catch (error) {
      // The full trusted probe error stays in Actions logs for humans. The handoff artifact intentionally
      // records only categorical success/failure so future privileged code never consumes remote text.
      console.error(`Stabilization probe ${attempt} failed: ${String(error.message).split('\n')[0].slice(0, 240)}`)
    }
    probes.push({ attempt, ok })

    if (consecutiveFailureCount(probes) >= consecutiveFailuresRequired) {
      return { outcome: 'post_release_regression', probes }
    }
    if (attempt < attempts && betweenProbesMs > 0) await sleep(betweenProbesMs)
  }

  if (probes.some((probeResult) => !probeResult.ok)) {
    return { outcome: 'transient_unconfirmed', probes }
  }
  return { outcome: 'stable', probes }
}

function buildBaseResult({ classifier, sourceRun, validated, classification, stabilization }) {
  return {
    schema: 'patelrep.production-release-stabilization.v1',
    workflow: 'Production Release Stabilization',
    classifier,
    source_release: {
      run_id: String(sourceRun.id),
      run_attempt: Number(sourceRun.run_attempt),
      control_plane_sha: sourceRun.head_sha,
      conclusion: sourceRun.conclusion,
    },
    candidate: validated.candidate,
    previous_release: validated.previous_release,
    release_state: {
      disposition: validated.disposition,
      production_verified: validated.production_verified,
      mutations: validated.mutations,
    },
    reentry: validated.reentry,
    classification,
    stabilization,
  }
}

function buildIncident(result) {
  if (!['partial_release_failure', 'post_release_regression'].includes(result.classification)) return null
  return {
    schema: 'patelrep.production-incident.v1',
    workflow: 'Production Release Stabilization',
    classifier: result.classifier,
    source_release: result.source_release,
    classification: result.classification,
    candidate: result.candidate,
    previous_release: result.previous_release,
    release_state: result.release_state,
    stabilization: result.stabilization,
  }
}


function buildCloseout(result) {
  if (!result.reentry) return null
  if (!['stable', 'transient_unconfirmed'].includes(result.classification)) return null
  if (result.release_state.disposition !== 'released' || result.release_state.production_verified !== true) return null
  return {
    schema: 'patelrep.production-incident-closeout.v1',
    workflow: 'Production Release Stabilization',
    classifier: result.classifier,
    source_release: result.source_release,
    reentry: result.reentry,
    candidate: result.candidate,
    classification: result.classification,
    closed: true,
  }
}

export async function classifyProductionRelease({
  sourceRun,
  evidence,
  classifier,
  deps,
  stabilize = stabilizeExactRelease,
}) {
  const validated = validateReleaseEvidence(evidence, sourceRun)

  if (validated.previous_release) {
    const previousSha = await deps.resolveTagCommit(validated.previous_release.tag)
    if (previousSha !== validated.previous_release.sha) throw new Error('release stabilization: previous release tag identity changed')
  }

  let classification = classifyReleaseEvidence(validated)
  let stabilization = null

  if (classification === 'stabilize_released') {
    const releases = await deps.listReleases()
    const matches = releases.filter((release) => release?.tag_name === validated.candidate.version && release.draft !== true && release.prerelease !== true)
    if (matches.length !== 1) throw new Error('release stabilization: candidate completed GitHub Release is missing or ambiguous')
    const candidateTagSha = await deps.resolveTagCommit(validated.candidate.version)
    if (candidateTagSha !== validated.candidate.release_sha) throw new Error('release stabilization: candidate release tag does not resolve to the released SHA')

    stabilization = await stabilize({
      releaseSha: validated.candidate.release_sha,
      releaseVersion: validated.candidate.version,
    })
    classification = stabilization.outcome === 'post_release_regression' ? 'post_release_regression' : stabilization.outcome
  }

  const result = buildBaseResult({ classifier, sourceRun, validated, classification, stabilization })
  return { result, incident: buildIncident(result), closeout: buildCloseout(result) }
}

async function main() {
  const env = process.env
  const repo = clean(env.REPO)
  const sourceRunId = requireMatch('source run id', env.SOURCE_RUN_ID, RUN_ID)
  const classifierRunId = requireMatch('classifier run id', env.CLASSIFIER_RUN_ID, RUN_ID)
  const classifierAttempt = Number(clean(env.CLASSIFIER_RUN_ATTEMPT))
  const classifierSha = requireMatch('classifier control-plane SHA', env.TRUSTED_CONTROL_PLANE_SHA, SHA)
  if (!repo || !Number.isInteger(classifierAttempt) || classifierAttempt < 1) throw new Error('release stabilization: invalid classifier context')

  const { realAutoMergeDeps } = await import('./release-engineer-auto-merge-deps.mjs')
  const { realReleaseDeps } = await import('./production-release-request-deps.mjs')
  const artifactDeps = realAutoMergeDeps({ repo, readToken: env.GH_TOKEN })
  const releaseDeps = realReleaseDeps({ repo, readToken: env.GH_TOKEN })

  const sourceRun = validateSourceRun(await artifactDeps.getRun(sourceRunId), { repo, sourceRunId })
  if ((await releaseDeps.isAncestorOfMain(sourceRun.head_sha)) !== true) {
    throw new Error('release stabilization: source control-plane SHA is no longer an ancestor of main')
  }
  const evidence = await artifactDeps.readNamedContext(sourceRunId, RELEASE_EVIDENCE_ARTIFACT)
  if (!evidence) throw new Error('release stabilization: source Production Release has no evidence artifact')

  const classifier = { run_id: classifierRunId, run_attempt: classifierAttempt, control_plane_sha: classifierSha }
  const { result, incident, closeout } = await classifyProductionRelease({
    sourceRun,
    evidence,
    classifier,
    deps: releaseDeps,
  })

  const resultDir = clean(env.RESULT_DIR)
  const incidentDir = clean(env.INCIDENT_DIR)
  const closeoutDir = clean(env.CLOSEOUT_DIR)
  if (!resultDir || !incidentDir || !closeoutDir) throw new Error('release stabilization: result directories are required')
  mkdirSync(resultDir, { recursive: true })
  writeFileSync(path.join(resultDir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })

  if (incident) {
    mkdirSync(incidentDir, { recursive: true })
    writeFileSync(path.join(incidentDir, 'context.json'), `${JSON.stringify(incident, null, 2)}\n`, { mode: 0o600 })
  }
  if (closeout) {
    mkdirSync(closeoutDir, { recursive: true })
    writeFileSync(path.join(closeoutDir, 'context.json'), `${JSON.stringify(closeout, null, 2)}\n`, { mode: 0o600 })
  }

  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `incident=${incident ? 'true' : 'false'}\ncloseout=${closeout ? 'true' : 'false'}\nclassification=${result.classification}\n`)
  }
  console.log(`Production release stabilization: classification=${result.classification}; incident=${incident ? 'true' : 'false'}; closeout=${closeout ? 'true' : 'false'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
