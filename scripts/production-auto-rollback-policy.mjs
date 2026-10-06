// Phase 3C: deterministic policy for an AUTOMATED Production Rollback REQUEST.
// This policy is evaluated by a read-only resolver, again immediately before the request workflow
// obtains its actions:write App token, and a third time by Production Rollback in automated mode BEFORE
// any production Environment job. Missing/changed rollback-side revalidation fails closed.
import {
  Ineligible,
  TRUSTED_BOT,
  fail,
  findHighRiskChange,
  refuse,
} from './release-engineer-auto-merge-policy.mjs'
import {
  classifyReleaseEvidence,
  validateReleaseEvidence,
} from './production-release-stabilization.mjs'

export { Ineligible }
export const ACTIVATION_VARIABLE = 'PRODUCTION_AUTO_ROLLBACK_ENABLED'
export const SOURCE_WORKFLOW_NAME = 'Production Release Stabilization'
export const SOURCE_WORKFLOW_PATH = '.github/workflows/production-release-stabilization.yml'
export const ROLLBACK_WORKFLOW_PATH = '.github/workflows/production-rollback.yml'
export const AUTOMATION_SOURCE_INPUT = 'automation_source_run_id'
export const VALIDATION_MODES = Object.freeze(['resolve', 'request', 'rollback'])

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

const clean = (value) => String(value ?? '').trim()
const sameRelease = (a, b) => a?.tag === b?.tag && a?.sha === b?.sha
const sameCandidate = (a, b) =>
  a?.eligible === b?.eligible &&
  a?.release_sha === b?.release_sha &&
  a?.pr_number === b?.pr_number &&
  a?.version === b?.version

function requireRunId(name, value) {
  const normalized = clean(value)
  if (!RUN_ID.test(normalized)) fail(`invalid ${name}`)
  return normalized
}

function requireSourceRun(run, { repo, sourceRunId }) {
  if (!run || String(run.id) !== sourceRunId) fail('stabilization source run id mismatch')
  if (run.name !== SOURCE_WORKFLOW_NAME || run.path !== SOURCE_WORKFLOW_PATH) refuse('source is not the trusted Production Release Stabilization workflow')
  if (run.event !== 'workflow_run' || run.status !== 'completed' || run.conclusion !== 'success') {
    refuse('source Production Release Stabilization run is not a completed success')
  }
  if (run.head_branch !== 'main') refuse('source Production Release Stabilization did not run from main')
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) refuse('source stabilization run is not from this repository')
  if (!SHA.test(run.head_sha ?? '')) fail('source stabilization control-plane SHA is malformed')
  return run
}

function requireIncident(incident, sourceRun) {
  if (!incident || incident.schema !== 'patelrep.production-incident.v1' || incident.workflow !== SOURCE_WORKFLOW_NAME) {
    fail('malformed production incident artifact')
  }
  if (String(incident.classifier?.run_id ?? '') !== String(sourceRun.id)) fail('incident classifier run id mismatch')
  if (Number(incident.classifier?.run_attempt) !== Number(sourceRun.run_attempt)) fail('incident classifier run attempt mismatch')
  if (incident.classifier?.control_plane_sha !== sourceRun.head_sha) fail('incident classifier control-plane SHA mismatch')
  if (!['partial_release_failure', 'post_release_regression'].includes(incident.classification)) {
    refuse('artifact is not a confirmed rollback-class production incident')
  }
  if (!incident.candidate?.eligible || !SHA.test(incident.candidate.release_sha ?? '') || !VERSION.test(incident.candidate.version ?? '') || !Number.isInteger(incident.candidate.pr_number)) {
    fail('incident lacks an exact eligible release candidate')
  }
  if (!incident.previous_release || !VERSION.test(incident.previous_release.tag ?? '') || !SHA.test(incident.previous_release.sha ?? '')) {
    fail('incident lacks an exact previous release')
  }
  if (incident.release_state?.mutations?.database !== 'no_change') {
    refuse('automatic rollback requires proof that the failing release applied zero production migrations')
  }

  if (incident.classification === 'post_release_regression') {
    const probes = incident.stabilization?.probes
    if (incident.stabilization?.outcome !== 'post_release_regression' || !Array.isArray(probes)) {
      fail('post-release incident lacks stabilization evidence')
    }
    let consecutive = 0
    let confirmed = false
    for (const probe of probes) {
      if (!probe || !Number.isInteger(probe.attempt) || typeof probe.ok !== 'boolean') fail('malformed stabilization probe evidence')
      consecutive = probe.ok ? 0 : consecutive + 1
      if (consecutive >= 2) confirmed = true
    }
    if (!confirmed) fail('post-release incident does not contain two consecutive failed probes')
  }

  return incident
}

export function requireRollbackExecutionContract(source) {
  if (typeof source !== 'string') fail('rollback workflow contract could not be read')
  const markers = [
    /automation_source_run_id:\n {8}description:/,
    /node scripts\/production-auto-rollback-request\.mjs rollback/,
    /PRODUCTION_AUTO_ROLLBACK_ENABLED/,
    /run-name: Production Rollback .*automation_source_run_id/,
  ]
  if (!markers.every((marker) => marker.test(source))) {
    refuse('Production Rollback automated execution contract is not installed; Phase 3D must land before auto-rollback requests can dispatch')
  }
}

function requireReleaseRun(run, { repo, incident }) {
  if (!run || String(run.id) !== String(incident.source_release?.run_id)) fail('incident source Production Release run id mismatch')
  // run.name is a dynamic display title (run-name); the exact workflow path is the trusted identity.
  if (run.path !== '.github/workflows/production-release.yml') fail('incident source is not Production Release')
  if (run.event !== 'workflow_dispatch' || run.status !== 'completed') fail('incident source Production Release is not completed')
  if (run.head_branch !== 'main') fail('incident source Production Release did not run from main')
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) fail('incident source Production Release repository mismatch')
  if (Number(run.run_attempt) !== Number(incident.source_release?.run_attempt)) fail('incident source Production Release attempt mismatch')
  if (run.head_sha !== incident.source_release?.control_plane_sha) fail('incident source Production Release control-plane SHA mismatch')
  return run
}

function requireIncidentMatchesEvidence(incident, validated) {
  if (!sameCandidate(incident.candidate, validated.candidate)) fail('incident candidate disagrees with source release evidence')
  if (!sameRelease(incident.previous_release, validated.previous_release)) fail('incident previous release disagrees with source release evidence')
  if (incident.release_state?.production_verified !== validated.production_verified) fail('incident verification state disagrees with source release evidence')
  for (const key of ['database', 'api', 'web', 'release_record']) {
    if (incident.release_state?.mutations?.[key] !== validated.mutations[key]) fail(`incident ${key} mutation state disagrees with source release evidence`)
  }

  if (incident.classification === 'partial_release_failure' && classifyReleaseEvidence(validated) !== 'partial_release_failure') {
    fail('incident classification disagrees with source release evidence')
  }
  if (incident.classification === 'post_release_regression' && validated.disposition !== 'released') {
    fail('post-release regression did not originate from a completed released candidate')
  }
}

function requireCandidatePr(pr, incident, repo) {
  if (!pr || pr.number !== incident.candidate.pr_number) fail('candidate PR could not be proven')
  if (!pr.merged_at || pr.base?.ref !== 'main' || pr.head?.repo?.full_name !== repo) refuse('candidate PR is not a merged same-repository PR to main')
  if (pr.merge_commit_sha !== incident.candidate.release_sha) refuse('candidate PR merge commit no longer matches the incident release SHA')
}

export function requireAutomatedRollbackDispatch({ actor, actorId, ref, workflowSha, targetVersion, automationSourceRunId }, result) {
  if (actor !== TRUSTED_BOT.login || String(actorId) !== String(TRUSTED_BOT.id)) fail(`automated rollback was not dispatched by ${TRUSTED_BOT.login}`)
  if (ref !== 'refs/heads/main') fail('automated rollback must run from refs/heads/main')
  if (workflowSha !== result.controlPlaneSha) fail('rollback workflow SHA does not match the revalidated control plane')
  if (targetVersion !== result.targetVersion) fail('rollback target_version does not match the revalidated known-good release')
  if (automationSourceRunId !== result.sourceRunId) fail('rollback automation source run id mismatch')
}

export async function validateAutoRollbackRequest({ repo, sourceRunId, enabled, mode }, deps) {
  if (!VALIDATION_MODES.includes(mode)) fail('invalid validation mode')
  if (!repo) fail('repository is required')
  sourceRunId = requireRunId('source run id', sourceRunId)
  if (enabled !== 'true') refuse(`${ACTIVATION_VARIABLE} is not exactly true`)

  const sourceRun = requireSourceRun(await deps.getRun(sourceRunId), { repo, sourceRunId })
  if ((await deps.isAncestorOfMain(sourceRun.head_sha)) !== true) refuse('stabilization control-plane SHA is no longer an ancestor of main')

  const incident = requireIncident(await deps.readIncident(sourceRunId), sourceRun)

  const releaseRun = requireReleaseRun(await deps.getRun(String(incident.source_release.run_id)), { repo, incident })
  const evidence = await deps.readReleaseEvidence(String(releaseRun.id))
  if (!evidence) fail('source Production Release evidence artifact is missing')
  let validated
  try {
    validated = validateReleaseEvidence(evidence, releaseRun)
  } catch (error) {
    fail(`source release evidence failed validation: ${String(error.message).split('\n')[0].slice(0, 160)}`)
  }
  requireIncidentMatchesEvidence(incident, validated)

  if ((await deps.isAncestorOfMain(incident.candidate.release_sha)) !== true) refuse('failing release SHA is no longer an ancestor of main')
  if ((await deps.isAncestorOfMain(incident.previous_release.sha)) !== true) refuse('previous release SHA is no longer an ancestor of main')
  if (incident.previous_release.sha === incident.candidate.release_sha) fail('previous release equals the failing candidate')

  const releases = await deps.listReleases()
  if (!Array.isArray(releases)) fail('completed release history could not be proven')
  const previousMatches = releases.filter((release) => release?.tag_name === incident.previous_release.tag && release.draft !== true && release.prerelease !== true)
  if (previousMatches.length !== 1) refuse('previous rollback target is missing or ambiguous in completed GitHub Releases')
  if (await deps.resolveTagCommit(incident.previous_release.tag) !== incident.previous_release.sha) refuse('previous release tag no longer resolves to the recorded known-good SHA')

  const candidateReleaseMatches = releases.filter((release) => release?.tag_name === incident.candidate.version && release.draft !== true && release.prerelease !== true)
  if (incident.classification === 'post_release_regression') {
    if (candidateReleaseMatches.length !== 1) fail('post-release regression candidate no longer has exactly one completed GitHub Release')
    if (await deps.resolveTagCommit(incident.candidate.version) !== incident.candidate.release_sha) fail('failing release tag no longer resolves to the incident candidate SHA')
  } else if (candidateReleaseMatches.length > 0) {
    fail('partial-release incident unexpectedly has a completed GitHub Release')
  }

  const pr = await deps.getPr(incident.candidate.pr_number)
  requireCandidatePr(pr, incident, repo)
  const files = await deps.listPrFiles(pr.number)
  if (!Array.isArray(files) || files.length === 0 || pr.changed_files !== files.length) refuse('candidate changed files cannot be proven')
  const high = findHighRiskChange(files)
  if (high) refuse(`candidate change ${high.path} is classified as ${high.risk}; automatic rollback stays human-only for high-risk releases`)

  let runtime
  try {
    runtime = await deps.readRuntimeIdentity()
  } catch {
    refuse('live production identity cannot be proven exactly; a human rollback decision is required')
  }
  if (runtime?.sha !== incident.candidate.release_sha || runtime?.version !== incident.candidate.version) {
    refuse('live production no longer runs the exact failing release; automatic rollback is stale')
  }
  if (await deps.isExactCandidateHealthy({ sha: incident.candidate.release_sha, version: incident.candidate.version })) {
    refuse('the exact failing release now passes strict production smoke; automatic rollback is no longer warranted')
  }

  const controlPlaneSha = await deps.getMainSha()
  if (!SHA.test(controlPlaneSha ?? '')) fail('main control-plane SHA could not be proven')
  const rollbackWorkflow = await deps.readRollbackWorkflowAt(controlPlaneSha)
  requireRollbackExecutionContract(rollbackWorkflow)

  if (mode !== 'rollback') {
    const active = await deps.listActiveProductionRuns()
    if (!Array.isArray(active)) fail('active production runs could not be proven')
    if (active.length > 0) refuse('another Production Release or Rollback run is active; not queueing an automated rollback request')
  }

  return {
    sourceRunId,
    sourceReleaseRunId: String(releaseRun.id),
    incidentClassification: incident.classification,
    candidateSha: incident.candidate.release_sha,
    candidateVersion: incident.candidate.version,
    prNumber: incident.candidate.pr_number,
    targetVersion: incident.previous_release.tag,
    targetSha: incident.previous_release.sha,
    controlPlaneSha,
  }
}

const reasonOf = (message) => (message.startsWith('Automatic rollback request ineligible:') ? message : `Automatic rollback request ineligible: ${message}.`)

export async function evaluateAutoRollbackRequest(input, deps) {
  try {
    return { eligible: true, ...(await validateAutoRollbackRequest(input, deps)) }
  } catch (error) {
    if (error instanceof Ineligible) return { eligible: false, reason: reasonOf(error.message) }
    throw error
  }
}
