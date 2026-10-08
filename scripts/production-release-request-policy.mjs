// Phase 2D: eligibility for an AUTOMATED production-release REQUEST. One strict policy, evaluated three times
// from fresh GitHub state: by the read-only resolver, again by the request job right before it dispatches, and
// a third time by Production Release itself (before any production step). Automatic request != automatic
// production approval: this code can only decide whether the existing Production Release workflow may be
// dispatched; it never touches production credentials or the `production` Environment. No separate human
// deployment approval exists, so these checks (and every refusal failing closed) ARE the safety boundary.
//
// Scope is deliberately narrow: ONLY a low-risk Phase 2C recovery PR that repaired a failed Deploy Health Check
// of the exact currently released production baseline. Everything else stays a manual release decision.
import { AUTO_MERGE_RESULT_ARTIFACT, parseAutoMergeResult } from './auto-merge-result.mjs'
import { RUN_ID_PATTERN } from './recovery-lineage.mjs'
import {
  Ineligible,
  TRUSTED_BOT,
  dedicatedRecoveryRoot,
  fail,
  findHighRiskChange,
  refuse,
  requirePublisherHistory,
  requirePublisherOnlyRecoveryBranches,
  requireSuccessfulRun,
  requireTrustedCreator,
} from './release-engineer-auto-merge-policy.mjs'
import { resolveProductionBaseline } from './release-version.mjs'

export { Ineligible }
export const ACTIVATION_VARIABLE = 'PRODUCTION_AUTO_RELEASE_ENABLED'
export const SOURCE_WORKFLOW_NAME = 'Claude Release Engineer Auto-Merge'
export const ROOT_WORKFLOW_NAME = 'Deploy Health Check'
// A health failure may come from the schedule or a push to main; a manual dispatch is never an automatic root.
export const ROOT_EVENTS = Object.freeze(['schedule', 'push'])
const WORKFLOW_BOT = 'github-actions[bot]'
const HEALTH_WORKFLOW_PATH = '.github/workflows/deploy-check.yml'

// Deploy Health Check keeps its cadence through a relay (see deploy-check.yml): a run the workflow itself
// dispatched with GITHUB_TOKEN on main is the same trusted monitor as a scheduled run. A human's manual
// workflow_dispatch (any other actor, or any other branch) is still NOT root or recovery evidence.
// The run `name` alone is NOT identity (a run-name can be anything), so the exact workflow file is required too:
// an unrelated bot-dispatched workflow that merely calls itself "Deploy Health Check" must never qualify.
export function isTrustedHealthEvent(run) {
  if (ROOT_EVENTS.includes(run?.event)) return true
  return (
    run?.event === 'workflow_dispatch' &&
    run.head_branch === 'main' &&
    typeof run.path === 'string' &&
    run.path.split('@')[0] === HEALTH_WORKFLOW_PATH &&
    run.actor?.login === WORKFLOW_BOT &&
    run.triggering_actor?.login === WORKFLOW_BOT
  )
}
// resolve: read-only first look; request: fresh revalidation right before dispatch (same security eligibility);
// release: re-verification inside Production Release before any production step (refusals FAIL the release).
export const VALIDATION_MODES = Object.freeze(['resolve', 'request', 'release'])
export const AUTOMATED_VERSION_BUMP = 'patch'
export const NO_BASELINE_MESSAGE = 'Production release request ineligible: no managed production release baseline exists; seed the first release manually.'
export const REQUIRED_MAIN_CHECKS = Object.freeze(['CI Gate', 'Staging Gate'])
export const ACTIVE_RUN_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting', 'requested', 'pending'])

/** Main ruleset (pinned by contract, not by id): active, strict gates, thread resolution, NO bypass actors. */
export async function requireUnbypassableMainRuleset(deps) {
  const MAIN = 'the main branch ruleset no longer matches the contract (CI Gate + Staging Gate, strict, thread resolution, no bypass actors)'
  let rulesets
  try {
    rulesets = await deps.listBranchRulesets()
  } catch (error) {
    refuse(`${MAIN} (could not read the repository rulesets: ${String(error.message).split('\n')[0].slice(0, 120)})`)
  }
  if (!Array.isArray(rulesets)) refuse(`${MAIN} (malformed ruleset response)`)
  const targetsMain = (ruleset) => {
    const include = ruleset?.conditions?.ref_name?.include
    return ruleset?.target === 'branch' && ruleset.enforcement === 'active' && Array.isArray(include) && (include.includes('refs/heads/main') || include.includes('~DEFAULT_BRANCH'))
  }
  const mainRulesets = rulesets.filter(targetsMain)
  // Every active ruleset that applies to main must be free of bypass actors.
  if (mainRulesets.length === 0 || mainRulesets.some((ruleset) => !Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length !== 0)) refuse(MAIN)
  const satisfies = (ruleset) => {
    const rules = Array.isArray(ruleset.rules) ? ruleset.rules : []
    const byType = (type) => rules.find((rule) => rule?.type === type)
    const checks = byType('required_status_checks')?.parameters
    const contexts = (checks?.required_status_checks ?? []).map((check) => check?.context)
    return (
      REQUIRED_MAIN_CHECKS.every((name) => contexts.includes(name)) &&
      checks?.strict_required_status_checks_policy === true &&
      byType('pull_request')?.parameters?.required_review_thread_resolution === true &&
      Boolean(byType('non_fast_forward')) &&
      Boolean(byType('deletion'))
    )
  }
  if (!mainRulesets.some(satisfies)) refuse(MAIN)
}

/** Production Release must have been dispatched by the trusted publisher bot, from main, at the release SHA, as a patch. */
export function requireAutomatedDispatch({ actor, actorId, ref, workflowSha, releaseSha, versionBump }, result) {
  if (actor !== TRUSTED_BOT.login || String(actorId) !== String(TRUSTED_BOT.id)) fail(`automated release was not dispatched by ${TRUSTED_BOT.login}`)
  if (ref !== 'refs/heads/main') fail('automated release must run from refs/heads/main')
  if (versionBump !== AUTOMATED_VERSION_BUMP) fail(`automated release must use version_bump=${AUTOMATED_VERSION_BUMP}`)
  if (releaseSha !== result.mergeCommitSha) fail('release_sha is not the auto-merge result merge commit')
  if (workflowSha !== result.mergeCommitSha) fail('the workflow definition is not running at the release commit')
}

/**
 * @param {{repo: string, sourceRunId: string, enabled: string|undefined, mode: 'resolve'|'request'|'release'}} input
 * @param {object} deps getRun, readAutoMergeResult(runId), getMergedPr, listPrCommits, listPrFiles, getCommit,
 *   getMainSha, listBranchRulesets, listReleases, resolveTagCommit, isAncestorOfMain, readRuntimeIdentity,
 *   listHealthRuns(headSha), listActiveProductionRuns
 * Throws Ineligible for any policy refusal (clean no-op when requesting) and Error for malformed/unprovable data.
 */
export async function validateProductionRequest({ repo, sourceRunId, enabled, mode }, deps) {
  if (!VALIDATION_MODES.includes(mode)) fail('unknown validation mode')
  if (enabled !== 'true') refuse(`${ACTIVATION_VARIABLE} is not "true"`)
  if (!RUN_ID_PATTERN.test(String(sourceRunId))) fail('source run id is invalid')

  // A. exact trusted source run and its sanitized result
  const sourceRun = await deps.getRun(sourceRunId)
  requireSuccessfulRun(sourceRun, { name: SOURCE_WORKFLOW_NAME, repo, runId: sourceRunId })
  const raw = await deps.readAutoMergeResult(sourceRunId)
  if (raw === null) refuse(`run ${sourceRunId} produced no ${AUTO_MERGE_RESULT_ARTIFACT} artifact (nothing was merged)`)
  const result = parseAutoMergeResult(raw)
  const mergeCommitSha = result.merge_commit_sha

  // B. the merged recovery PR, re-fetched; the PR body is never read
  const pr = await deps.getMergedPr(Number(result.pr_number))
  if (pr.number !== Number(result.pr_number)) fail('fetched PR does not match the artifact PR number')
  if (pr.merged !== true) refuse(`PR #${pr.number} is not merged`)
  if (pr.base?.ref !== 'main') refuse(`PR #${pr.number} did not target main`)
  if (pr.head?.repo?.full_name !== repo) refuse(`PR #${pr.number} is not from this repository`)
  requireTrustedCreator(pr)
  const root = dedicatedRecoveryRoot(pr.head?.ref)
  if (root !== result.root_run_id || pr.head.ref !== result.candidate_branch) refuse(`PR #${pr.number} branch does not match the auto-merge result`)
  if (pr.head.sha !== result.candidate_sha) refuse(`PR #${pr.number} head ${pr.head.sha} is not the candidate SHA in the auto-merge result`)
  if (pr.merge_commit_sha !== mergeCommitSha) refuse(`PR #${pr.number} merge commit ${pr.merge_commit_sha} is not the merge commit SHA in the auto-merge result`)
  const trailers = requirePublisherHistory(await deps.listPrCommits(pr.number), root, pr)
  if (String(trailers.attempt) !== result.attempt) refuse('recovery attempt does not match the auto-merge result')
  const mergeCommit = await deps.getCommit(mergeCommitSha)
  const parents = mergeCommit?.parents ?? []
  if (parents.length !== 2 || parents[0] !== result.base_main_sha || parents[1] !== result.candidate_sha) {
    refuse('merge commit parents are not the recorded base main SHA and the candidate head')
  }

  // H. provenance anchors: recovery branches publisher-only, main without bypass actors (one read, two checks)
  let rulesets
  try {
    rulesets = await deps.listBranchRulesets()
  } catch (error) {
    refuse(`rulesets could not be read (${String(error.message).split('\n')[0].slice(0, 120)}); provenance cannot be proven`)
  }
  const sameRulesets = { ...deps, listBranchRulesets: async () => rulesets }
  await requirePublisherOnlyRecoveryBranches(sameRulesets)
  await requireUnbypassableMainRuleset(sameRulesets)

  // C. nothing may have landed on main after the recovery merge
  const mainSha = await deps.getMainSha()
  if (mainSha !== mergeCommitSha) refuse(`main moved past the recovery merge (main is ${mainSha}); automatic release only ever targets the recovery merge itself`)

  // D. the managed production baseline
  const baseline = await resolveProductionBaseline(deps)
  if (!baseline) refuse(NO_BASELINE_MESSAGE)
  if (baseline.sha === mergeCommitSha) refuse(`${baseline.tag} already released ${mergeCommitSha}`)

  // The GitHub Release is only the ledger. After a human rollback (which creates no tag/Release) the newest
  // release is NOT what is deployed, so the live public runtime identity must equal the managed baseline.
  let runtime
  try {
    runtime = await deps.readRuntimeIdentity()
  } catch (error) {
    refuse(`the deployed production identity could not be proven (${String(error.message).split('\n')[0].slice(0, 160)}); a manual production decision is required`)
  }
  if (runtime?.sha !== baseline.sha || runtime?.version !== baseline.tag) {
    refuse(`runtime production (${runtime?.version} / ${runtime?.sha}) does not match the managed release baseline (${baseline.tag} / ${baseline.sha}); a manual production decision is required`)
  }

  // E. no piggybacking of unreleased main commits
  if (baseline.sha !== result.base_main_sha) {
    refuse(`main contains unreleased changes (the last release ${baseline.tag} is ${baseline.sha}, the recovery was merged onto ${result.base_main_sha}); a manual release decision is required`)
  }

  // F. the recovery root must be a failed production health check of exactly that baseline
  const rootRun = await deps.getRun(result.root_run_id)
  if (!rootRun || String(rootRun.id) !== result.root_run_id) fail(`root run ${result.root_run_id} could not be fetched`)
  if (rootRun.name !== ROOT_WORKFLOW_NAME) refuse(`recovery root ${result.root_run_id} is ${rootRun.name}, not ${ROOT_WORKFLOW_NAME}`)
  if (rootRun.repository?.full_name !== repo || rootRun.head_repository?.full_name !== repo) refuse('recovery root run is not from this repository')
  if (rootRun.status !== 'completed' || rootRun.conclusion !== 'failure') refuse(`${ROOT_WORKFLOW_NAME} root ${result.root_run_id} is ${rootRun.status}/${rootRun.conclusion}, not a failure`)
  if (!isTrustedHealthEvent(rootRun)) refuse(`${ROOT_WORKFLOW_NAME} root ${result.root_run_id} was a ${rootRun.event} run`)
  if (rootRun.head_sha !== result.base_main_sha) refuse(`${ROOT_WORKFLOW_NAME} root ${result.root_run_id} ran at ${rootRun.head_sha}, not the released baseline`)

  // A newer successful Deploy Health Check of the SAME baseline commit means production recovered after the
  // root failure, so the automatic release is no longer warranted. Unprovable history fails closed.
  const rootCreated = Date.parse(rootRun.created_at)
  if (!Number.isFinite(rootCreated)) fail(`root run ${result.root_run_id} has no valid creation time`)
  const healthRuns = await deps.listHealthRuns(result.base_main_sha)
  if (!Array.isArray(healthRuns)) fail('Deploy Health Check history could not be proven')
  for (const health of healthRuns) {
    if (!health || health.head_sha !== result.base_main_sha || health.name !== ROOT_WORKFLOW_NAME || !Number.isFinite(Date.parse(health.created_at)) || !/^[1-9][0-9]*$/.test(String(health.id))) {
      fail('Deploy Health Check history contains a malformed run')
    }
    if (health.repository?.full_name !== repo || health.head_repository?.full_name !== repo) fail('Deploy Health Check history contains a foreign run')
    if (!isTrustedHealthEvent(health) || health.status !== 'completed' || health.conclusion !== 'success') continue
    const created = Date.parse(health.created_at)
    if (created > rootCreated || (created === rootCreated && Number(health.id) > Number(result.root_run_id))) {
      refuse(`Production health recovered after root failure ${result.root_run_id} (run ${health.id} succeeded); automatic production release is no longer warranted`)
    }
  }

  // The exact gates that Phase 2C verified must still describe this candidate.
  const ciRun = await deps.getRun(result.ci_run_id)
  requireSuccessfulRun(ciRun, { name: 'CI', repo, runId: result.ci_run_id })
  if (ciRun.head_sha !== result.candidate_sha) refuse(`CI run ${result.ci_run_id} validated ${ciRun.head_sha}, not the candidate`)
  requireSuccessfulRun(await deps.getRun(result.staging_run_id), { name: 'Staging Candidate', repo, runId: result.staging_run_id })

  // G. low-risk paths only (same classifier as Phase 2C)
  const files = await deps.listPrFiles(pr.number)
  if (files.length === 0) refuse('PR changes no files')
  if (pr.changed_files !== files.length) refuse('PR changed-file count disagrees with the listed files')
  const high = findHighRiskChange(files)
  if (high) refuse(`human release decision required because changed file ${high.path} is classified as ${high.risk}`)

  // Idempotency (pre-dispatch stages resolve and request, never release): Production Release serializes in `production-deploy` and a newer pending run
  // would REPLACE an older pending one, so never dispatch while any release/rollback run is queued or waiting.
  if (mode !== 'release') {
    const active = await deps.listActiveProductionRuns()
    if (!Array.isArray(active)) fail('active production runs could not be proven')
    if (active.length > 0) {
      const duplicate = active.some((run) => run.workflow === 'production-release.yml' && String(run.displayTitle ?? '').includes(mergeCommitSha))
      refuse(duplicate ? `a Production Release for ${mergeCommitSha} is already active or queued` : 'another Production Release or Rollback run is active; not queueing an automated request behind it')
    }
  }

  return {
    sourceRunId: String(sourceRunId),
    mergeCommitSha,
    baseMainSha: result.base_main_sha,
    prNumber: pr.number,
    root,
    attempt: Number(result.attempt),
    baselineTag: baseline.tag,
  }
}

const reasonOf = (message) => (message.startsWith('Production release request ineligible') ? `${message}` : `Production release request ineligible: ${message}.`)

/** Unprivileged form: policy refusals become {eligible:false}; malformed or unprovable data still throws. */
export async function evaluateProductionRequest(input, deps) {
  try {
    return { eligible: true, ...(await validateProductionRequest(input, deps)) }
  } catch (error) {
    if (error instanceof Ineligible) return { eligible: false, reason: reasonOf(error.message) }
    throw error
  }
}
