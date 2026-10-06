#!/usr/bin/env node
// Phase 4B: human-authorized incident closeout/re-entry policy.
// This script is read-only. It never deploys, migrates, tags, releases, rolls back, dispatches,
// changes repository variables, or creates a write-capable token.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAutoRollbackCircuitBreaker } from './production-auto-rollback-circuit-breaker.mjs'
import { CLOSEOUT_ARTIFACT, REENTRY_ARTIFACT, realProductionIncidentReentryDeps } from './production-incident-reentry-deps.mjs'

export { CLOSEOUT_ARTIFACT, REENTRY_ARTIFACT }
export const REENTRY_WORKFLOW_NAME = 'Production Incident Re-entry'
export const REENTRY_WORKFLOW_PATH = '.github/workflows/production-incident-reentry.yml'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const BUMPS = new Set(['patch', 'minor', 'major'])
const clean = (value) => String(value ?? '').trim()

function fail(message) {
  throw new Error(`incident re-entry: ${message}`)
}

function requireMatch(name, value, pattern) {
  const normalized = clean(value)
  if (!pattern.test(normalized)) fail(`invalid ${name}`)
  return normalized
}

function validateRepoRun(run, { repo, runId, name, path: workflowPath, event = 'workflow_dispatch', requireSuccess = false }) {
  if (!run || String(run.id) !== String(runId)) fail(`${name} run id mismatch`)
  if (run.name !== name || run.path !== workflowPath) fail(`run ${runId} is not trusted ${name}`)
  if (run.event !== event || run.status !== 'completed') fail(`${name} run ${runId} is not a completed ${event}`)
  if (requireSuccess && run.conclusion !== 'success') fail(`${name} run ${runId} did not succeed`)
  if (run.head_branch !== 'main') fail(`${name} run ${runId} did not run from main`)
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) fail(`${name} repository provenance mismatch`)
  requireMatch(`${name} control-plane SHA`, run.head_sha, SHA)
  return run
}

export function validateRollbackEvidence(evidence, run) {
  if (!evidence || evidence.schema !== 'patelrep.production-rollback-evidence.v1' || evidence.workflow !== 'Production Rollback') {
    fail('malformed Production Rollback evidence')
  }
  if (String(evidence.run?.id ?? '') !== String(run.id)) fail('rollback evidence run id mismatch')
  if (Number(evidence.run?.attempt) !== Number(run.run_attempt)) fail('rollback evidence attempt mismatch')
  if (evidence.run?.control_plane_sha !== run.head_sha) fail('rollback evidence control-plane SHA mismatch')

  if (evidence.source?.mode !== 'automated_incident' || evidence.source?.automation_source_present !== true || evidence.source?.automation_source_valid !== true) {
    return null
  }
  const incidentRunId = requireMatch('rollback incident source run id', evidence.source?.automation_source_run_id, RUN_ID)
  if (evidence.target?.resolved !== true) fail('automated rollback evidence has no exact resolved target')
  const targetVersion = requireMatch('rollback target version', evidence.target?.version, VERSION)
  const targetSha = requireMatch('rollback target SHA', evidence.target?.sha, SHA)
  if (evidence.after_runtime?.state !== 'verified_target' || evidence.after_runtime?.version !== targetVersion || evidence.after_runtime?.sha !== targetSha) {
    return null
  }
  if (evidence.production_verified !== true) return null
  if (!['restored', 'restored_quarantine_unproven'].includes(evidence.disposition)) fail('automated rollback has invalid restored disposition')
  if (evidence.mutations?.database !== 'not_mutated_by_workflow') fail('rollback evidence claims an impossible database mutation state')
  if (evidence.mutations?.api !== 'deployed_and_verified' || evidence.mutations?.web !== 'deployed_and_verified') {
    fail('restored rollback evidence lacks verified API/Web deployment state')
  }
  if (evidence.mutations?.release_record !== 'not_created_by_workflow') fail('rollback evidence claims an impossible release-record mutation')

  return Object.freeze({
    incident_run_id: incidentRunId,
    target: Object.freeze({ version: targetVersion, sha: targetSha }),
    quarantine: clean(evidence.quarantine),
    disposition: evidence.disposition,
  })
}

export function validateReentryAuthorizationRun(run, { repo, runId }) {
  return validateRepoRun(run, {
    repo,
    runId,
    name: REENTRY_WORKFLOW_NAME,
    path: REENTRY_WORKFLOW_PATH,
    event: 'workflow_dispatch',
    requireSuccess: true,
  })
}

export function validateReentryAuthorization(authorization, sourceRun) {
  if (!authorization || authorization.schema !== 'patelrep.production-incident-reentry.v1' || authorization.workflow !== REENTRY_WORKFLOW_NAME) {
    fail('malformed re-entry authorization artifact')
  }
  if (String(authorization.run?.id ?? '') !== String(sourceRun.id)) fail('re-entry authorization run id mismatch')
  if (Number(authorization.run?.attempt) !== Number(sourceRun.run_attempt)) fail('re-entry authorization attempt mismatch')
  if (authorization.run?.control_plane_sha !== sourceRun.head_sha) fail('re-entry authorization control-plane SHA mismatch')

  const rollbackRunId = requireMatch('authorized rollback run id', authorization.rollback?.run_id, RUN_ID)
  const incidentRunId = requireMatch('authorized incident run id', authorization.rollback?.incident_run_id, RUN_ID)
  const targetVersion = requireMatch('authorized rollback target version', authorization.rollback?.target?.version, VERSION)
  const targetSha = requireMatch('authorized rollback target SHA', authorization.rollback?.target?.sha, SHA)
  const failedVersion = requireMatch('authorized failed candidate version', authorization.failed_candidate?.version, VERSION)
  const failedSha = requireMatch('authorized failed candidate SHA', authorization.failed_candidate?.sha, SHA)
  const releaseSha = requireMatch('authorized release SHA', authorization.authorized_release?.sha, SHA)
  const prNumber = Number(authorization.authorized_release?.pr_number)
  const prHeadSha = requireMatch('authorized PR head SHA', authorization.authorized_release?.pr_head_sha, SHA)
  const versionBump = clean(authorization.authorized_release?.version_bump)
  if (!Number.isInteger(prNumber) || prNumber < 1) fail('invalid authorized PR number')
  if (!BUMPS.has(versionBump)) fail('invalid authorized version bump')

  return Object.freeze({
    rollback_run_id: rollbackRunId,
    incident_run_id: incidentRunId,
    target: Object.freeze({ version: targetVersion, sha: targetSha }),
    failed_candidate: Object.freeze({ version: failedVersion, sha: failedSha }),
    authorized_release: Object.freeze({ sha: releaseSha, pr_number: prNumber, pr_head_sha: prHeadSha, version_bump: versionBump }),
  })
}

function validateClosingReleaseEvidence(evidence, run, rollbackRunId) {
  if (!evidence || evidence.schema !== 'patelrep.production-release-evidence.v1' || evidence.workflow !== 'Production Release') return null
  if (String(evidence.run?.id ?? '') !== String(run.id) || Number(evidence.run?.attempt) !== Number(run.run_attempt) || evidence.run?.control_plane_sha !== run.head_sha) {
    fail('closing release evidence provenance mismatch')
  }
  const reentry = evidence.source?.reentry
  if (reentry?.present !== true || reentry?.valid !== true) return null
  if (String(reentry.rollback_run_id ?? '') !== String(rollbackRunId)) return null
  const authorizationRunId = requireMatch('closing release authorization run id', reentry.authorization_run_id, RUN_ID)
  if (evidence.disposition !== 'released' || evidence.production_verified !== true) return null
  const releaseSha = requireMatch('closing release SHA', evidence.candidate?.release_sha, SHA)
  const releaseVersion = requireMatch('closing release version', evidence.candidate?.version, VERSION)
  return { authorization_run_id: authorizationRunId, release_sha: releaseSha, release_version: releaseVersion }
}

async function hasVerifiedCloseout({ repo, rollbackRun, deps }) {
  const runs = await deps.listStabilizationRuns()
  if (!Array.isArray(runs)) fail('stabilization run list is malformed')

  for (const run of runs) {
    if (Date.parse(run.created_at ?? '') <= Date.parse(rollbackRun.created_at ?? '')) continue
    validateRepoRun(run, {
      repo,
      runId: String(run.id),
      name: 'Production Release Stabilization',
      path: '.github/workflows/production-release-stabilization.yml',
      event: 'workflow_run',
      requireSuccess: true,
    })
    const closeout = await deps.readCloseout(String(run.id))
    if (closeout === null) continue
    if (closeout.schema !== 'patelrep.production-incident-closeout.v1' || closeout.workflow !== 'Production Release Stabilization' || closeout.closed !== true) {
      fail('malformed production incident closeout')
    }
    if (String(closeout.classifier?.run_id ?? '') !== String(run.id) ||
        Number(closeout.classifier?.run_attempt) !== Number(run.run_attempt) ||
        closeout.classifier?.control_plane_sha !== run.head_sha) {
      fail('incident closeout classifier provenance mismatch')
    }
    if (!['stable', 'transient_unconfirmed'].includes(closeout.classification)) fail('incident closeout has invalid stabilization classification')
    if (String(closeout.reentry?.rollback_run_id ?? '') !== String(rollbackRun.id)) continue
    const authorizationRunId = requireMatch('closeout authorization run id', closeout.reentry?.authorization_run_id, RUN_ID)
    const sourceReleaseRunId = requireMatch('closeout source release run id', closeout.source_release?.run_id, RUN_ID)

    const releaseRun = validateRepoRun(await deps.getRun(sourceReleaseRunId), {
      repo,
      runId: sourceReleaseRunId,
      name: 'Production Release',
      path: '.github/workflows/production-release.yml',
      event: 'workflow_dispatch',
      requireSuccess: true,
    })
    const releaseEvidence = await deps.readReleaseEvidence(sourceReleaseRunId)
    const closing = validateClosingReleaseEvidence(releaseEvidence, releaseRun, String(rollbackRun.id))
    if (!closing) fail('incident closeout source release does not carry matching re-entry provenance')
    if (closing.authorization_run_id !== authorizationRunId) fail('incident closeout authorization run mismatch')
    if (closeout.candidate?.release_sha !== closing.release_sha || closeout.candidate?.version !== closing.release_version) {
      fail('incident closeout candidate identity mismatch')
    }

    const authRun = validateReentryAuthorizationRun(await deps.getRun(authorizationRunId), { repo, runId: authorizationRunId })
    const authRaw = await deps.readReentryAuthorization(authorizationRunId)
    if (authRaw === null) fail('incident closeout authorization artifact is missing')
    const auth = validateReentryAuthorization(authRaw, authRun)
    if (auth.rollback_run_id !== String(rollbackRun.id) || auth.authorized_release.sha !== closing.release_sha) {
      fail('incident closeout authorization does not match rollback and closing release')
    }
    return true
  }
  return false
}

export async function findLatestOpenAutomatedRollback({ repo, deps }) {
  const runs = await deps.listRollbackRuns()
  if (!Array.isArray(runs)) fail('rollback run list is malformed')

  for (const run of runs) {
    validateRepoRun(run, {
      repo,
      runId: String(run.id),
      name: 'Production Rollback',
      path: '.github/workflows/production-rollback.yml',
      event: 'workflow_dispatch',
    })
    const raw = await deps.readRollbackEvidence(String(run.id))
    if (raw === null) {
      if (/automated request from run/i.test(run.display_title ?? '')) fail(`automated rollback run ${run.id} has no Phase 4A evidence`)
      continue
    }
    const rollback = validateRollbackEvidence(raw, run)
    if (!rollback) continue

    if (await hasVerifiedCloseout({ repo, rollbackRun: run, deps })) return null
    return Object.freeze({ run, evidence: rollback })
  }
  return null
}

async function requireReleaseCandidate({ repo, releaseSha, failedSha, deps }) {
  const currentMainSha = await deps.getMainSha()
  if (currentMainSha !== releaseSha) fail(`authorized re-entry must pin the current main tip exactly (main is ${currentMainSha})`)
  if (releaseSha === failedSha) fail('the failed production candidate cannot authorize itself for re-entry')
  if ((await deps.isAncestor(failedSha, releaseSha)) !== true) fail('re-entry candidate does not descend from the failed production candidate')

  const ci = await deps.listCheckRuns(releaseSha, 'CI Gate')
  if (!ci.some((check) => check?.name === 'CI Gate' && check?.conclusion === 'success')) fail('re-entry candidate has no successful CI Gate')

  const prs = await deps.listAssociatedPullRequests(releaseSha)
  if (!Array.isArray(prs)) fail('re-entry candidate associated PR response is malformed')
  const mergedPr = prs.find((pr) => pr?.merged_at && pr?.base?.ref === 'main')
  if (!mergedPr) fail('re-entry candidate has no merged PR targeting main')
  if (mergedPr.head?.repo?.full_name !== repo) fail('re-entry candidate PR is not from this repository')
  const prHeadSha = requireMatch('re-entry candidate PR head SHA', mergedPr.head?.sha, SHA)

  const staging = await deps.listCheckRuns(prHeadSha, 'Staging Gate')
  if (!staging.some((check) => check?.name === 'Staging Gate' && check?.conclusion === 'success')) fail('re-entry candidate PR head has no successful Staging Gate')

  const [releaseTree, stagedTree] = await Promise.all([deps.getCommitTree(releaseSha), deps.getCommitTree(prHeadSha)])
  if (!SHA.test(releaseTree ?? '') || !SHA.test(stagedTree ?? '') || releaseTree !== stagedTree) {
    fail('re-entry candidate tree does not match the staging-verified PR head')
  }
  return { pr_number: Number(mergedPr.number), pr_head_sha: prHeadSha }
}

async function reproveRollbackQuarantine(open, deps) {
  return verifyAutoRollbackCircuitBreaker(
    {
      repo: open.run.repository.full_name,
      sourceRunId: open.evidence.incident_run_id,
      targetVersion: open.evidence.target.version,
      targetSha: open.evidence.target.sha,
    },
    deps,
  )
}

export async function authorizeProductionIncidentReentry(input, deps) {
  const repo = clean(input.repo)
  if (!repo) fail('repository is required')
  const runId = requireMatch('authorization run id', input.runId, RUN_ID)
  const runAttempt = Number(clean(input.runAttempt))
  const controlPlaneSha = requireMatch('authorization control-plane SHA', input.controlPlaneSha, SHA)
  const rollbackRunId = requireMatch('rollback run id', input.rollbackRunId, RUN_ID)
  const releaseSha = requireMatch('release SHA', input.releaseSha, SHA)
  const versionBump = clean(input.versionBump)
  if (!Number.isInteger(runAttempt) || runAttempt < 1) fail('invalid authorization run attempt')
  if (!BUMPS.has(versionBump)) fail('invalid version bump')

  const open = await findLatestOpenAutomatedRollback({ repo, deps })
  if (!open) fail('there is no unresolved automated rollback incident requiring re-entry')
  if (String(open.run.id) !== rollbackRunId) fail(`rollback run ${rollbackRunId} is not the latest unresolved automated rollback`)

  const active = await deps.listActiveProductionRuns()
  if (active.length > 0) fail('a Production Release or Production Rollback is currently active')

  const quarantine = await reproveRollbackQuarantine(open, deps)
  const failedSha = requireMatch('failed candidate SHA', quarantine.failed_candidate?.sha, SHA)
  const failedVersion = requireMatch('failed candidate version', quarantine.failed_candidate?.version, VERSION)
  const candidate = await requireReleaseCandidate({ repo, releaseSha, failedSha, deps })

  return Object.freeze({
    schema: 'patelrep.production-incident-reentry.v1',
    workflow: REENTRY_WORKFLOW_NAME,
    run: { id: runId, attempt: runAttempt, control_plane_sha: controlPlaneSha },
    rollback: {
      run_id: rollbackRunId,
      incident_run_id: open.evidence.incident_run_id,
      target: open.evidence.target,
      quarantine_mode: quarantine.mode,
    },
    failed_candidate: { version: failedVersion, sha: failedSha },
    authorized_release: {
      sha: releaseSha,
      pr_number: candidate.pr_number,
      pr_head_sha: candidate.pr_head_sha,
      version_bump: versionBump,
    },
    runtime_at_authorization: { version: quarantine.runtime.version, sha: quarantine.runtime.sha },
    managed_release_at_authorization: { tag: quarantine.managed_release.tag, sha: quarantine.managed_release.sha },
  })
}

export async function verifyProductionReleaseReentry(input, deps) {
  const repo = clean(input.repo)
  if (!repo) fail('repository is required')
  const releaseSha = clean(input.releaseSha)
  const versionBump = clean(input.versionBump)
  const reentryRunId = clean(input.reentrySourceRunId)
  const automationSourceRunId = clean(input.automationSourceRunId)
  if (!BUMPS.has(versionBump)) fail('invalid version bump')

  const open = await findLatestOpenAutomatedRollback({ repo, deps })
  if (!open) {
    if (reentryRunId) fail('re-entry authorization was supplied but no automated rollback incident is open')
    return Object.freeze({ required: false, rollback_run_id: null, authorization_run_id: null })
  }

  if (automationSourceRunId) fail('automatic Production Release requests cannot re-enter an unresolved rollback incident')
  requireMatch('explicit re-entry release SHA', releaseSha, SHA)
  requireMatch('re-entry authorization run id', reentryRunId, RUN_ID)

  const sourceRun = validateReentryAuthorizationRun(await deps.getRun(reentryRunId), { repo, runId: reentryRunId })
  const raw = await deps.readReentryAuthorization(reentryRunId)
  if (raw === null) fail(`re-entry authorization run ${reentryRunId} has no ${REENTRY_ARTIFACT} artifact`)
  const authorization = validateReentryAuthorization(raw, sourceRun)

  if (authorization.rollback_run_id !== String(open.run.id)) fail('re-entry authorization belongs to a stale rollback incident')
  if (authorization.incident_run_id !== open.evidence.incident_run_id) fail('re-entry authorization incident provenance changed')
  if (authorization.target.version !== open.evidence.target.version || authorization.target.sha !== open.evidence.target.sha) {
    fail('re-entry authorization rollback target changed')
  }
  if (authorization.authorized_release.sha !== releaseSha) fail('Production Release SHA does not match the exact authorized re-entry SHA')
  if (authorization.authorized_release.version_bump !== versionBump) fail('Production Release version bump does not match re-entry authorization')
  if ((await deps.getMainSha()) !== releaseSha) fail('main moved after re-entry authorization; authorize the new exact main tip again')

  const quarantine = await reproveRollbackQuarantine(open, deps)
  if (authorization.failed_candidate.sha !== quarantine.failed_candidate?.sha || authorization.failed_candidate.version !== quarantine.failed_candidate?.version) {
    fail('failed candidate identity changed since re-entry authorization')
  }

  return Object.freeze({
    required: true,
    rollback_run_id: String(open.run.id),
    authorization_run_id: reentryRunId,
  })
}

async function main() {
  const env = process.env
  const repo = clean(env.REPO)
  const deps = realProductionIncidentReentryDeps({ repo, readToken: env.GH_TOKEN })
  const mode = clean(process.argv[2])

  if (mode === 'authorize') {
    const result = await authorizeProductionIncidentReentry(
      {
        repo,
        runId: env.RUN_ID,
        runAttempt: env.RUN_ATTEMPT,
        controlPlaneSha: env.CONTROL_PLANE_SHA,
        rollbackRunId: env.ROLLBACK_RUN_ID,
        releaseSha: env.RELEASE_SHA,
        versionBump: env.VERSION_BUMP,
      },
      deps,
    )
    const dir = clean(env.RESULT_DIR)
    if (!dir) fail('RESULT_DIR is required')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
    console.log(`Production incident re-entry authorized: rollback=${result.rollback.run_id}; release=${result.authorized_release.sha}; bump=${result.authorized_release.version_bump}`)
    return
  }

  if (mode === 'release') {
    const result = await verifyProductionReleaseReentry(
      {
        repo,
        releaseSha: env.RELEASE_SHA,
        versionBump: env.VERSION_BUMP,
        reentrySourceRunId: env.REENTRY_SOURCE_RUN_ID,
        automationSourceRunId: env.AUTOMATION_SOURCE_RUN_ID,
      },
      deps,
    )
    if (!env.GITHUB_OUTPUT) fail('GITHUB_OUTPUT is required')
    appendFileSync(env.GITHUB_OUTPUT, `required=${result.required ? 'true' : 'false'}\nrollback_run_id=${result.rollback_run_id ?? ''}\nauthorization_run_id=${result.authorization_run_id ?? ''}\n`)
    console.log(result.required
      ? `Production incident re-entry verified: rollback=${result.rollback_run_id}; authorization=${result.authorization_run_id}`
      : 'Production incident re-entry: no unresolved automated rollback incident.')
    return
  }

  fail('mode must be authorize or release')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
