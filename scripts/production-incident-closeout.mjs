#!/usr/bin/env node
// Phase 4B: read-only incident closeout and Production Release re-entry gate.
// An automatic rollback opens quarantine. Only a repository-owner workflow_dispatch can create an immutable
// closeout artifact for one exact fixed main SHA. Production Release independently revalidates that artifact.
// This script never dispatches, deploys, migrates, tags, releases, or mutates repository settings.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INCIDENT_CLOSEOUT_ARTIFACT, realIncidentCloseoutDeps } from './production-incident-closeout-deps.mjs'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const ATTEMPT = /^[1-9][0-9]{0,8}$/
const INCIDENT_CLASSES = new Set(['partial_release_failure', 'post_release_regression'])

const clean = (value) => String(value ?? '').trim()
const fail = (message) => {
  throw new Error(`production incident closeout: ${message}`)
}
const requireMatch = (name, value, pattern) => {
  const normalized = clean(value)
  if (!pattern.test(normalized)) fail(`invalid ${name}`)
  return normalized
}
const runIdNumber = (value) => {
  const id = requireMatch('run id', value, RUN_ID)
  const n = Number(id)
  if (!Number.isSafeInteger(n)) fail('run id exceeds safe integer range')
  return n
}

function sameRepository(run, repo) {
  return run?.repository?.full_name === repo && run?.head_repository?.full_name === repo
}

function validateRollbackRun(run, { repo, runId }) {
  if (!run || String(run.id) !== String(runId)) fail('rollback run id mismatch')
  if (run.name !== 'Production Rollback' || run.path !== '.github/workflows/production-rollback.yml') {
    fail('source is not the trusted Production Rollback workflow')
  }
  if (run.event !== 'workflow_dispatch' || run.status !== 'completed' ||
      !['success', 'failure', 'cancelled'].includes(run.conclusion)) {
    fail('rollback run is not completed')
  }
  if (run.head_branch !== 'main' || !sameRepository(run, repo)) fail('rollback run provenance mismatch')
  requireMatch('rollback control-plane SHA', run.head_sha, SHA)
  return run
}

function validateRollbackEvidence(evidence, rollbackRun) {
  if (!evidence || evidence.schema !== 'patelrep.production-rollback-evidence.v1' || evidence.workflow !== 'Production Rollback') {
    fail('rollback evidence is missing or malformed')
  }
  if (String(evidence.run?.id ?? '') !== String(rollbackRun.id)) fail('rollback evidence run id mismatch')
  if (Number(evidence.run?.attempt) !== Number(rollbackRun.run_attempt)) fail('rollback evidence attempt mismatch')
  if (evidence.run?.control_plane_sha !== rollbackRun.head_sha) fail('rollback evidence control-plane SHA mismatch')
  if (evidence.source?.mode !== 'automated_incident' ||
      evidence.source?.automation_source_present !== true ||
      evidence.source?.automation_source_valid !== true ||
      !RUN_ID.test(String(evidence.source?.automation_source_run_id ?? ''))) {
    fail('rollback evidence does not prove an automated incident source')
  }
  if (evidence.production_verified !== true || evidence.jobs?.rollback_verification !== 'success') {
    fail('rollback evidence does not prove a verified restored runtime')
  }
  const verifiedQuarantine =
    evidence.quarantine === 'verified' &&
    evidence.disposition === 'restored' &&
    evidence.jobs?.circuit_breaker === 'success'
  const unprovenQuarantine =
    evidence.quarantine === 'unproven' &&
    evidence.disposition === 'restored_quarantine_unproven' &&
    ['failure', 'cancelled'].includes(evidence.jobs?.circuit_breaker)
  if (!verifiedQuarantine && !unprovenQuarantine) {
    fail('rollback evidence has an invalid post-restore quarantine state')
  }
  if (evidence.mutations?.database !== 'not_mutated_by_workflow' ||
      evidence.mutations?.release_record !== 'not_created_by_workflow') {
    fail('rollback evidence violates the rollback mutation contract')
  }
  const version = requireMatch('rollback target version', evidence.target?.version, VERSION)
  const sha = requireMatch('rollback target SHA', evidence.target?.sha, SHA)
  if (evidence.target?.resolved !== true ||
      evidence.after_runtime?.state !== 'verified_target' ||
      evidence.after_runtime?.version !== version ||
      evidence.after_runtime?.sha !== sha) {
    fail('rollback evidence does not prove the exact restored runtime')
  }
  return {
    incidentRunId: String(evidence.source.automation_source_run_id),
    target: { version, sha },
    quarantine: evidence.quarantine,
  }
}

function validateIncidentRun(run, { repo, runId }) {
  if (!run || String(run.id) !== String(runId)) fail('incident run id mismatch')
  if (run.name !== 'Production Release Stabilization' || run.path !== '.github/workflows/production-release-stabilization.yml') {
    fail('incident source is not Production Release Stabilization')
  }
  if (run.event !== 'workflow_run' || run.status !== 'completed' || run.conclusion !== 'success') {
    fail('incident source run is not a completed success')
  }
  if (run.head_branch !== 'main' || !sameRepository(run, repo)) fail('incident source provenance mismatch')
  requireMatch('incident control-plane SHA', run.head_sha, SHA)
  return run
}

function validateIncident(incident, incidentRun, rollbackTarget) {
  if (!incident || incident.schema !== 'patelrep.production-incident.v1' || incident.workflow !== 'Production Release Stabilization') {
    fail('production incident is missing or malformed')
  }
  if (String(incident.classifier?.run_id ?? '') !== String(incidentRun.id) ||
      Number(incident.classifier?.run_attempt) !== Number(incidentRun.run_attempt) ||
      incident.classifier?.control_plane_sha !== incidentRun.head_sha) {
    fail('production incident classifier provenance mismatch')
  }
  if (!INCIDENT_CLASSES.has(incident.classification)) fail('incident is not an automatic-rollback class')
  const candidateSha = requireMatch('failed candidate SHA', incident.candidate?.release_sha, SHA)
  const candidateVersion = requireMatch('failed candidate version', incident.candidate?.version, VERSION)
  const previousTag = requireMatch('incident previous release tag', incident.previous_release?.tag, VERSION)
  const previousSha = requireMatch('incident previous release SHA', incident.previous_release?.sha, SHA)
  if (previousTag !== rollbackTarget.version || previousSha !== rollbackTarget.sha) {
    fail('rollback target does not match the incident previous release')
  }
  return {
    runId: String(incidentRun.id),
    classification: incident.classification,
    candidate: {
      sha: candidateSha,
      version: candidateVersion,
      prNumber: Number.isInteger(incident.candidate?.pr_number) ? incident.candidate.pr_number : null,
    },
    previousRelease: { version: previousTag, sha: previousSha },
  }
}

function validateCloseoutRun(run, { repo, runId, repositoryOwner }) {
  if (!run || String(run.id) !== String(runId)) fail('closeout run id mismatch')
  if (run.name !== 'Production Incident Closeout' || run.path !== '.github/workflows/production-incident-closeout.yml') {
    fail('closeout source is not the trusted Production Incident Closeout workflow')
  }
  if (run.event !== 'workflow_dispatch' || run.status !== 'completed' || run.conclusion !== 'success') {
    fail('closeout run is not a completed success')
  }
  if (run.head_branch !== 'main' || !sameRepository(run, repo)) fail('closeout run provenance mismatch')
  requireMatch('closeout control-plane SHA', run.head_sha, SHA)
  if (run.actor?.login !== repositoryOwner) fail('closeout was not dispatched by the repository owner')
  return run
}

function validateCloseoutArtifact(artifact, closeoutRun, { rollback, incident, targetSha, repositoryOwner }) {
  if (!artifact || artifact.schema !== 'patelrep.production-incident-closeout.v1' || artifact.workflow !== 'Production Incident Closeout') {
    fail('closeout artifact is missing or malformed')
  }
  if (String(artifact.run?.id ?? '') !== String(closeoutRun.id) ||
      Number(artifact.run?.attempt) !== Number(closeoutRun.run_attempt) ||
      artifact.run?.control_plane_sha !== closeoutRun.head_sha ||
      artifact.run?.actor !== repositoryOwner) {
    fail('closeout artifact run provenance mismatch')
  }
  if (artifact.decision !== 'approved_for_exact_sha') fail('closeout artifact has no exact-SHA approval')
  if (String(artifact.rollback?.run_id ?? '') !== String(rollback.run.id) ||
      artifact.rollback?.target?.version !== rollback.target.version ||
      artifact.rollback?.target?.sha !== rollback.target.sha) {
    fail('closeout artifact does not match the active rollback')
  }
  if (String(artifact.incident?.run_id ?? '') !== incident.runId ||
      artifact.incident?.classification !== incident.classification ||
      artifact.failed_candidate?.sha !== incident.candidate.sha ||
      artifact.failed_candidate?.version !== incident.candidate.version) {
    fail('closeout artifact does not match the active incident')
  }
  if (artifact.reentry?.sha !== targetSha || artifact.reentry?.main_sha_at_closeout !== targetSha) {
    fail('closeout artifact does not authorize this exact release SHA')
  }
  return artifact
}

export async function resolveActiveAutomatedRollbackQuarantine({ repo }, deps) {
  if (!repo) fail('repository is required')
  const [rollbackRuns, releaseRuns] = await Promise.all([
    deps.listCompletedRollbackRuns(),
    deps.listSuccessfulReleaseRuns(),
  ])
  if (!Array.isArray(rollbackRuns) || !Array.isArray(releaseRuns)) fail('production run history could not be proven')

  const automated = rollbackRuns
    .filter((run) => deps.isAutomatedRollbackRun(run))
    .sort((a, b) => runIdNumber(b.id) - runIdNumber(a.id))
  if (automated.length === 0) return null

  const rollbackRun = validateRollbackRun(automated[0], { repo, runId: automated[0].id })
  const rollbackId = runIdNumber(rollbackRun.id)

  for (const releaseRun of releaseRuns) {
    if (runIdNumber(releaseRun.id) <= rollbackId) continue
    if (releaseRun.name !== 'Production Release' || releaseRun.path !== '.github/workflows/production-release.yml' ||
        releaseRun.event !== 'workflow_dispatch' || releaseRun.status !== 'completed' || releaseRun.conclusion !== 'success' ||
        releaseRun.head_branch !== 'main' || !sameRepository(releaseRun, repo)) {
      fail('newer successful Production Release history contains malformed provenance')
    }
    // A successful Production Release after this rollback is the deliberate re-entry that closes quarantine.
    return null
  }

  const evidence = await deps.readRollbackEvidence(String(rollbackRun.id))
  // Phase 4B only owns re-entry after production was actually restored to a known target.
  // An automated rollback that failed before exact final verification remains a general human recovery case.
  if (!evidence || evidence.production_verified !== true || evidence.jobs?.rollback_verification !== 'success') return null
  const rollbackEvidence = validateRollbackEvidence(evidence, rollbackRun)
  const incidentRun = validateIncidentRun(await deps.getRun(rollbackEvidence.incidentRunId), {
    repo,
    runId: rollbackEvidence.incidentRunId,
  })
  const incident = validateIncident(await deps.readIncident(rollbackEvidence.incidentRunId), incidentRun, rollbackEvidence.target)

  return Object.freeze({
    run: {
      id: String(rollbackRun.id),
      attempt: Number(rollbackRun.run_attempt),
      controlPlaneSha: rollbackRun.head_sha,
    },
    target: rollbackEvidence.target,
    quarantine: rollbackEvidence.quarantine,
    incident,
  })
}

export async function createIncidentCloseout(input, deps) {
  const repo = clean(input.repo)
  const repositoryOwner = clean(input.repositoryOwner)
  const actor = clean(input.actor)
  const runId = requireMatch('closeout run id', input.runId, RUN_ID)
  const runAttempt = requireMatch('closeout run attempt', input.runAttempt, ATTEMPT)
  const controlPlaneSha = requireMatch('closeout control-plane SHA', input.controlPlaneSha, SHA)
  const rollbackRunId = requireMatch('rollback run id', input.rollbackRunId, RUN_ID)
  const reentrySha = requireMatch('re-entry SHA', input.reentrySha, SHA)
  if (!repo || !repositoryOwner) fail('repository context is required')
  if (actor !== repositoryOwner) fail('only the repository owner may close a production incident')

  const mainSha = requireMatch('current main SHA', await deps.getMainSha(), SHA)
  if (reentrySha !== mainSha || controlPlaneSha !== mainSha) {
    fail('closeout must run from main and bind the exact current main SHA')
  }

  const quarantine = await resolveActiveAutomatedRollbackQuarantine({ repo }, deps)
  if (!quarantine) fail('there is no active automatic-rollback quarantine to close')
  if (quarantine.run.id !== rollbackRunId) fail('requested rollback run is not the active quarantine')

  const runtime = await deps.readRuntimeIdentity()
  if (runtime?.sha !== quarantine.target.sha || runtime?.version !== quarantine.target.version) {
    fail('production no longer runs the verified rollback target')
  }
  if (reentrySha === quarantine.incident.candidate.sha || reentrySha === quarantine.target.sha) {
    fail('re-entry must be a new fixed commit, not the failed candidate or rollback target')
  }
  if ((await deps.isAncestorOfMain(quarantine.incident.candidate.sha)) !== true) {
    fail('failed candidate is no longer an ancestor of current main')
  }

  const checks = await deps.listCheckRuns(reentrySha, 'CI Gate')
  if (!Array.isArray(checks) || !checks.some((check) => check?.name === 'CI Gate' && check?.conclusion === 'success')) {
    fail('re-entry SHA does not have a successful CI Gate')
  }

  const active = await deps.listActiveProductionRuns()
  if (!Array.isArray(active)) fail('active production runs could not be proven')
  if (active.length > 0) fail('a Production Release or Rollback is active; closeout requires a quiet production lane')

  return Object.freeze({
    schema: 'patelrep.production-incident-closeout.v1',
    workflow: 'Production Incident Closeout',
    run: {
      id: runId,
      attempt: Number(runAttempt),
      control_plane_sha: controlPlaneSha,
      actor,
    },
    rollback: {
      run_id: quarantine.run.id,
      run_attempt: quarantine.run.attempt,
      control_plane_sha: quarantine.run.controlPlaneSha,
      target: { version: quarantine.target.version, sha: quarantine.target.sha },
    },
    incident: {
      run_id: quarantine.incident.runId,
      classification: quarantine.incident.classification,
    },
    failed_candidate: {
      version: quarantine.incident.candidate.version,
      sha: quarantine.incident.candidate.sha,
      pr_number: quarantine.incident.candidate.prNumber,
    },
    reentry: {
      sha: reentrySha,
      main_sha_at_closeout: mainSha,
      ci_gate: 'success',
    },
    production_runtime_at_closeout: {
      version: quarantine.target.version,
      sha: quarantine.target.sha,
    },
    decision: 'approved_for_exact_sha',
  })
}

export async function validateProductionReentry(input, deps) {
  const repo = clean(input.repo)
  const repositoryOwner = clean(input.repositoryOwner)
  const currentRunId = requireMatch('Production Release run id', input.runId, RUN_ID)
  const requestedReleaseSha = clean(input.releaseSha)
  const automationSourceRunId = clean(input.automationSourceRunId)
  const closeoutRunId = clean(input.closeoutRunId)
  if (!repo || !repositoryOwner) fail('repository context is required')
  if (requestedReleaseSha && !SHA.test(requestedReleaseSha)) fail('release_sha is not an exact 40-character SHA')
  if (automationSourceRunId && !RUN_ID.test(automationSourceRunId)) fail('automation source run id is invalid')
  if (closeoutRunId && !RUN_ID.test(closeoutRunId)) fail('incident closeout run id is invalid')

  const mainSha = requireMatch('current main SHA', await deps.getMainSha(), SHA)
  const targetSha = requestedReleaseSha || mainSha
  const quarantine = await resolveActiveAutomatedRollbackQuarantine({ repo }, deps)

  if (!quarantine) {
    if (closeoutRunId) fail('incident closeout input was supplied but no active automatic-rollback quarantine exists')
    return Object.freeze({ status: 'not_required', targetSha })
  }

  if (automationSourceRunId) fail('automated Production Release cannot re-enter an automatic-rollback quarantine')
  if (!requestedReleaseSha) fail('quarantined re-entry requires an explicit release_sha')
  if (!closeoutRunId) fail('quarantined re-entry requires incident_closeout_run_id')

  const runtime = await deps.readRuntimeIdentity()
  if (runtime?.sha !== quarantine.target.sha || runtime?.version !== quarantine.target.version) {
    fail('production changed after rollback; re-entry requires a new deliberate decision')
  }

  const closeoutRun = validateCloseoutRun(await deps.getRun(closeoutRunId), {
    repo,
    runId: closeoutRunId,
    repositoryOwner,
  })
  if (runIdNumber(closeoutRun.id) <= runIdNumber(quarantine.run.id) ||
      runIdNumber(closeoutRun.id) >= runIdNumber(currentRunId)) {
    fail('closeout run ordering is invalid for this Production Release')
  }
  const artifact = await deps.readIncidentCloseout(closeoutRunId)
  validateCloseoutArtifact(artifact, closeoutRun, {
    rollback: quarantine,
    incident: quarantine.incident,
    targetSha,
    repositoryOwner,
  })

  return Object.freeze({
    status: 'authorized_exact_sha',
    targetSha,
    closeoutRunId,
    rollbackRunId: quarantine.run.id,
    incidentRunId: quarantine.incident.runId,
  })
}

async function main() {
  const mode = clean(process.argv[2])
  const env = process.env
  const deps = realIncidentCloseoutDeps({ repo: env.REPO, readToken: env.GH_TOKEN })

  if (mode === 'closeout') {
    const artifact = await createIncidentCloseout({
      repo: env.REPO,
      repositoryOwner: env.REPOSITORY_OWNER,
      actor: env.ACTOR,
      runId: env.RUN_ID,
      runAttempt: env.RUN_ATTEMPT,
      controlPlaneSha: env.CONTROL_PLANE_SHA,
      rollbackRunId: env.ROLLBACK_RUN_ID,
      reentrySha: env.REENTRY_SHA,
    }, deps)
    const resultDir = clean(env.RESULT_DIR)
    if (!resultDir) fail('RESULT_DIR is required')
    mkdirSync(resultDir, { recursive: true })
    writeFileSync(path.join(resultDir, 'context.json'), `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 })
    console.log(`Production incident closeout approved exact re-entry SHA ${artifact.reentry.sha} for rollback run ${artifact.rollback.run_id}`)
    return
  }

  if (mode === 'release') {
    const result = await validateProductionReentry({
      repo: env.REPO,
      repositoryOwner: env.REPOSITORY_OWNER,
      runId: env.RUN_ID,
      releaseSha: env.RELEASE_SHA,
      automationSourceRunId: env.AUTOMATION_SOURCE_RUN_ID,
      closeoutRunId: env.INCIDENT_CLOSEOUT_RUN_ID,
    }, deps)
    console.log(`Production incident re-entry gate: ${result.status}; target=${result.targetSha}`)
    return
  }

  fail('mode must be closeout|release')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}

export { INCIDENT_CLOSEOUT_ARTIFACT }
