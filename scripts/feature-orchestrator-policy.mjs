// Pure, I/O-free policy for the Claude Feature Orchestrator.
//
// The orchestrator composes existing systems (Autonomous Feature Builder -> PR -> CI -> Staging Candidate)
// and only ever *observes* them. Every decision about whether a candidate may be reported as
// `ready_for_human_review` is made here, deterministically, from GitHub evidence. Nothing in this module
// merges, deploys, or dispatches anything.
import { PUBLISHER_EMAIL, MAX_AUTOMATIC_REPAIR_ATTEMPTS, parseTrailers } from './recovery-lineage.mjs'
import { featureSlug } from './feature-builder-context.mjs'

export const FEATURE_BUILDER_WORKFLOW_PATH = '.github/workflows/autonomous-feature-builder.yml'
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'
export const STAGING_WORKFLOW_PATH = '.github/workflows/staging-candidate.yml'
export const DEFAULT_BRANCH = 'main'
export const FEATURE_BUILDER_EMAIL = 'patelrep-feature-builder[bot]@users.noreply.github.com'
export const GITHUB_ACTIONS_APP_SLUG = 'github-actions'

// The only inputs the Feature Builder accepts; the orchestrator may pass nothing else.
export const DISPATCH_INPUT_KEYS = Object.freeze(['feature_name', 'requirements'])
export const MIN_NAME = 3
export const MAX_NAME = 120
export const MIN_REQUIREMENTS = 10
export const MAX_REQUIREMENTS = 12000

export const STATES = Object.freeze([
  'building',
  'ci_running',
  'ci_failed',
  'staging_running',
  'staging_failed',
  'ready_for_human_review',
  'blocked',
  'unproven',
])

// How long a missing downstream run is treated as "not started yet" before it becomes unproven.
export const CI_START_WINDOW_MS = 15 * 60 * 1000
export const STAGING_WAIT_WINDOW_MS = 90 * 60 * 1000

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const BRANCH = /^feature\/ai-([1-9][0-9]{0,19})-[a-z0-9][a-z0-9-]{0,59}$/
const TRAILER_RUN = 'PatelRep-Feature-Builder-Run'
const TRAILER_BASE = 'PatelRep-Feature-Base-SHA'
const CONTEXT_KEYS = ['candidate_branch', 'candidate_sha', 'ci_run_id', 'pr_number']

function fail(message) {
  throw new Error(`feature orchestrator: ${message}`)
}

export function parseRunId(value) {
  const text = String(value ?? '').trim()
  if (!RUN_ID.test(text)) fail('run id is invalid')
  return text
}

export function isSha(value) {
  return typeof value === 'string' && SHA.test(value)
}

/** Strips control characters and caps length so untrusted text is safe to print. */
export function sanitizeText(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function stripPath(path) {
  return String(path ?? '').split('@')[0]
}

/** Validates a start request. Returns the only two values that may ever be dispatched. */
export function validateDispatchRequest({ featureName, requirements }) {
  const name = String(featureName ?? '').trim()
  const text = String(requirements ?? '').trim()
  if (name.length < MIN_NAME || name.length > MAX_NAME) fail(`feature name must be ${MIN_NAME}-${MAX_NAME} characters`)
  if (text.length < MIN_REQUIREMENTS || text.length > MAX_REQUIREMENTS) {
    fail(`requirements must be ${MIN_REQUIREMENTS}-${MAX_REQUIREMENTS} characters`)
  }
  featureSlug(name) // the builder derives its branch from this; refuse names that cannot produce one
  return Object.freeze({ featureName: name, requirements: text })
}

/**
 * The dispatch body is built here and nowhere else: the ref is hard-wired to main and the inputs are the
 * builder's two documented inputs. There is no parameter for a workflow id, file, or ref.
 */
export function buildDispatchBody({ featureName, requirements }) {
  const valid = validateDispatchRequest({ featureName, requirements })
  return { ref: DEFAULT_BRANCH, inputs: { feature_name: valid.featureName, requirements: valid.requirements } }
}

/** The workflow must be identified by its stable file path, never by its display name. */
export function assertTrustedBuilderWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object') fail('Autonomous Feature Builder workflow could not be resolved')
  if (stripPath(workflow.path) !== FEATURE_BUILDER_WORKFLOW_PATH) {
    fail(`workflow path ${sanitizeText(workflow.path)} is not ${FEATURE_BUILDER_WORKFLOW_PATH}`)
  }
  if (workflow.state !== 'active') fail('Autonomous Feature Builder workflow is not active')
  if (!Number.isSafeInteger(workflow.id) || workflow.id < 1) fail('workflow id is invalid')
  return workflow.id
}

/** Dispatch is only permitted from the workflow-run context of current main. */
export function assertDispatchContext({ repo, ref, sha, mainSha }) {
  if (!REPO.test(repo ?? '')) fail('repository is invalid')
  if (ref !== `refs/heads/${DEFAULT_BRANCH}`) fail('the orchestrator may only run from refs/heads/main')
  if (!isSha(sha)) fail('orchestrator SHA is invalid')
  if (!isSha(mainSha)) fail('current main SHA could not be proven')
  if (sha !== mainSha) fail(`main moved from ${sha} to ${mainSha}; refusing to dispatch on a stale base`)
}

/** Picks the one new builder run that was created by our dispatch. Zero or several matches fail closed. */
export function selectDispatchedRun({ runs, knownRunIds, workflowId, mainSha, repo }) {
  const fresh = (runs ?? []).filter((run) => {
    if (knownRunIds.has(String(run.id))) return false
    return (
      run.workflow_id === workflowId &&
      stripPath(run.path) === FEATURE_BUILDER_WORKFLOW_PATH &&
      run.event === 'workflow_dispatch' &&
      run.head_branch === DEFAULT_BRANCH &&
      run.head_sha === mainSha &&
      run.repository?.full_name === repo
    )
  })
  if (fresh.length === 0) return null
  if (fresh.length > 1) fail('dispatch is ambiguous: several new Autonomous Feature Builder runs match')
  return String(fresh[0].id)
}

/** Exact-key sanitized provenance recorded by the dispatcher and read back by status checks. */
export const DISPATCH_RECORD_KEYS = Object.freeze([
  'base_sha',
  'builder_run_id',
  'feature_name',
  'orchestrator_run_id',
  'requested_by',
  'requirements_sha256',
  'workflow_path',
])

export function validateDispatchRecord(record, builderRun) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('dispatch record is not an object')
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(DISPATCH_RECORD_KEYS)) {
    fail('dispatch record has unexpected fields')
  }
  if (record.workflow_path !== FEATURE_BUILDER_WORKFLOW_PATH) fail('dispatch record names a different workflow')
  if (!RUN_ID.test(String(record.builder_run_id)) || !RUN_ID.test(String(record.orchestrator_run_id))) {
    fail('dispatch record run ids are invalid')
  }
  if (!isSha(record.base_sha)) fail('dispatch record base SHA is invalid')
  if (builderRun && (String(builderRun.id) !== String(record.builder_run_id) || builderRun.head_sha !== record.base_sha)) {
    fail('dispatch record does not match the builder run')
  }
  return record
}

/** The builder run must be this repository's trusted workflow, dispatched from main. */
export function validateBuilderRun(run, repo) {
  const problems = []
  if (!run || typeof run !== 'object') return ['builder run could not be read']
  if (stripPath(run.path) !== FEATURE_BUILDER_WORKFLOW_PATH) problems.push('run is not the Autonomous Feature Builder workflow')
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) problems.push('run belongs to a different repository')
  if (run.event !== 'workflow_dispatch') problems.push('run was not manually dispatched')
  if (run.head_branch !== DEFAULT_BRANCH) problems.push('run did not start from main')
  if (!isSha(run.head_sha)) problems.push('run base SHA is invalid')
  return problems
}

export function builderBranchPrefix(runId) {
  return `feature/ai-${parseRunId(runId)}-`
}

export function validateBuilderBranch(branch, runId) {
  const match = BRANCH.exec(branch ?? '')
  return Boolean(match) && match[1] === String(runId)
}

/** The PR must be the builder's own same-repository PR into main. Returns a list of problems. */
export function validatePr(pr, { repo, branch }) {
  const problems = []
  if (!pr) return ['PR could not be read']
  if (pr.base?.ref !== DEFAULT_BRANCH) problems.push(`PR #${pr.number} does not target main`)
  if (pr.base?.repo?.full_name !== repo) problems.push(`PR #${pr.number} base is not this repository`)
  if (pr.head?.repo?.full_name !== repo) problems.push(`PR #${pr.number} is not from this repository`)
  if (pr.head?.ref !== branch) problems.push(`PR #${pr.number} head branch ${sanitizeText(pr.head?.ref)} is not ${branch}`)
  if (!isSha(pr.head?.sha)) problems.push(`PR #${pr.number} head SHA is invalid`)
  return problems
}

function parseFeatureTrailers(message) {
  const found = {}
  for (const line of String(message ?? '').split('\n')) {
    const match = /^(PatelRep-Feature-Builder-Run|PatelRep-Feature-Base-SHA):\s*(\S+)\s*$/.exec(line)
    if (!match) continue
    if (found[match[1]] !== undefined) return null
    found[match[1]] = match[2]
  }
  return found[TRAILER_RUN] !== undefined && found[TRAILER_BASE] !== undefined ? found : null
}

/**
 * Proves the PR head descends from the builder's original commit through a linear chain whose later commits
 * are only trusted Release Engineer repairs. `commits` is the PR commit list in order (oldest first).
 */
export function validateLineage({ commits, runId, baseSha, headSha }) {
  if (!Array.isArray(commits) || commits.length === 0) return { ok: false, reason: 'PR has no commits' }
  const first = commits[0]
  const trailers = parseFeatureTrailers(first.commit?.message)
  if (!trailers) return { ok: false, reason: 'first PR commit has no Feature Builder trailers' }
  if (trailers[TRAILER_RUN] !== String(runId)) return { ok: false, reason: 'first PR commit belongs to a different builder run' }
  if (trailers[TRAILER_BASE] !== baseSha) return { ok: false, reason: 'first PR commit records a different base SHA' }
  if ((first.parents ?? []).length !== 1 || first.parents[0].sha !== baseSha) {
    return { ok: false, reason: 'first PR commit is not parented on the exact builder base' }
  }
  if (first.commit?.author?.email !== FEATURE_BUILDER_EMAIL) return { ok: false, reason: 'first PR commit was not published by the Feature Builder' }

  let repairs = 0
  let previous = first
  for (const commit of commits.slice(1)) {
    if ((commit.parents ?? []).length !== 1 || commit.parents[0].sha !== previous.sha) {
      return { ok: false, reason: `commit ${String(commit.sha).slice(0, 7)} is not a linear continuation (merge or rewrite)` }
    }
    let lineage = null
    try {
      lineage = parseTrailers(commit.commit?.message)
    } catch {
      lineage = null
    }
    if (commit.commit?.author?.email !== PUBLISHER_EMAIL || !lineage) {
      return { ok: false, reason: `commit ${String(commit.sha).slice(0, 7)} is neither the builder commit nor a trusted Release Engineer repair` }
    }
    repairs += 1
    previous = commit
  }
  if (repairs > MAX_AUTOMATIC_REPAIR_ATTEMPTS) return { ok: false, reason: 'more repair commits than the Release Engineer policy permits' }
  if (previous.sha !== headSha) return { ok: false, reason: 'PR head is not the end of the proven commit chain' }
  return { ok: true, repairs }
}

/** Binds a GitHub Actions check run to one specific workflow run by its details URL. */
export function checkRunId(check) {
  const match = /\/actions\/runs\/([0-9]+)(?:\/|$)/.exec(check?.details_url ?? '')
  return match ? match[1] : null
}

export function isActionsCheck(check, name, runId) {
  return check?.name === name && check?.app?.slug === GITHUB_ACTIONS_APP_SLUG && checkRunId(check) === String(runId)
}

export function latestBy(items, key) {
  return [...items].sort((a, b) => Number(b[key]) - Number(a[key]))[0] ?? null
}

/** Maps one workflow run + its bound gate check to a small vocabulary. */
export function classifyGate({ run, gate }) {
  if (!run) return { state: 'missing' }
  if (run.status !== 'completed') return { state: run.status === 'queued' ? 'queued' : 'running' }
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return { state: 'failure' }
  if (run.conclusion === 'cancelled') return { state: 'cancelled' }
  if (run.conclusion === 'skipped') return { state: 'skipped' }
  if (run.conclusion !== 'success') return { state: 'unproven' }
  if (!gate) return { state: 'unproven' }
  if (gate.status !== 'completed') return { state: 'running' }
  if (gate.conclusion === 'success') return { state: 'success' }
  if (gate.conclusion === 'failure' || gate.conclusion === 'timed_out') return { state: 'failure' }
  return { state: 'unproven' }
}

/** A staging context artifact must name exactly this candidate; anything else is somebody else's run. */
export function stagingContextMatches(context, { prNumber, branch, headSha, ciRunId }) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return false
  if (JSON.stringify(Object.keys(context).sort()) !== JSON.stringify(CONTEXT_KEYS)) return false
  return (
    context.pr_number === String(prNumber) &&
    context.candidate_branch === branch &&
    context.candidate_sha === headSha &&
    context.ci_run_id === String(ciRunId)
  )
}

const ICON = { ok: '✅', bad: '❌', wait: '⏳', unknown: '❔' }
function gateLine(gate) {
  if (!gate) return `${ICON.unknown} Not started`
  const label = {
    success: `${ICON.ok} Passed`,
    failure: `${ICON.bad} Failed`,
    queued: `${ICON.wait} Queued`,
    running: `${ICON.wait} Running`,
    missing: `${ICON.wait} Not started`,
    cancelled: `${ICON.unknown} Cancelled`,
    skipped: `${ICON.unknown} Skipped`,
    unproven: `${ICON.unknown} Unproven`,
  }
  return label[gate.state] ?? `${ICON.unknown} ${gate.state}`
}

const HEADLINE = {
  building: '🟡 BUILDING',
  ci_running: '🟡 CI RUNNING',
  ci_failed: '🔴 CI FAILED',
  staging_running: '🟡 STAGING RUNNING',
  staging_failed: '🔴 STAGING FAILED',
  ready_for_human_review: '🟢 READY FOR HUMAN REVIEW',
  blocked: '🔴 BLOCKED',
  unproven: '⚪ UNPROVEN',
}

const NEXT = {
  building: 'The Feature Builder is still working. Do not merge anything.',
  ci_running: 'CI is running. Do not merge yet.',
  ci_failed: 'The feature is not ready to merge. The existing Release Engineer may attempt a bounded repair according to its current policy; check again afterwards.',
  staging_running: 'CI passed. Staging is running. Do not merge yet.',
  staging_failed: 'The feature is not ready to merge. The existing Release Engineer may attempt a bounded repair according to its current policy; check again afterwards.',
  blocked: 'Do not merge. Resolve the blocker above, then check again.',
  unproven: 'The state could not be proven from GitHub. Treat it as NOT ready; check again or inspect the runs manually.',
}

/** Human-readable report. Never includes requirement text or secrets. */
export function renderStatus(result) {
  const lines = [HEADLINE[result.state] ?? HEADLINE.unproven, '']
  if (result.feature_name) lines.push('Feature:', result.feature_name, '')
  lines.push(`Builder run:`, String(result.builder_run_id ?? 'unknown'), '')
  if (result.pr) lines.push('PR:', `#${result.pr.number}`, '')
  if (result.head_sha) lines.push('Candidate:', result.head_sha, '')
  if (result.state === 'ci_failed' || result.state === 'staging_failed') {
    const failed = result.failed_checks?.length ? result.failed_checks.join(', ') : result.state === 'ci_failed' ? 'CI Gate' : 'Staging Gate'
    lines.push('Failed gate:', failed, '')
  }
  if (result.ci || result.staging) {
    lines.push('CI Gate:', gateLine(result.ci), '')
    lines.push('Staging Gate:', gateLine(result.staging), '')
  }
  if (result.reason) lines.push('Detail:', result.reason, '')
  lines.push('Next action:')
  if (result.state === 'ready_for_human_review') {
    lines.push(`Review the feature in staging. If it looks correct, manually merge PR #${result.pr.number}.`)
    lines.push('This is NOT merge approval and does NOT authorize a production release.')
  } else {
    lines.push(NEXT[result.state] ?? NEXT.unproven)
  }
  return lines.join('\n')
}

/**
 * Final readiness gate. `ready_for_human_review` is reachable only through this function, and only when every
 * piece of exact-candidate evidence is present and green. Anything else collapses to a non-ready state.
 */
export function finalizeReadiness(evidence) {
  const { builder, pr, lineage, ci, staging, headStable } = evidence
  const ready =
    builder?.status === 'completed' &&
    builder.conclusion === 'success' &&
    pr?.state === 'open' &&
    pr.merged !== true &&
    lineage?.ok === true &&
    ci?.state === 'success' &&
    staging?.state === 'success' &&
    headStable === true
  return ready ? 'ready_for_human_review' : null
}
