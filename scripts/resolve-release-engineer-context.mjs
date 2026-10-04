#!/usr/bin/env node
// Resolves the exact code a failed workflow run was validating, for the Claude release engineer.
// workflow_run payloads are NOT trusted for Staging Candidate (they report the default branch, not
// the PR candidate) or Production Release (release_sha may differ from head_sha). Every failure to
// prove the target throws, so the workflow fails closed before Claude is invoked.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_AUTOMATIC_REPAIR_ATTEMPTS,
  PUBLISHER_EMAIL,
  RECOVERY_BRANCH_PREFIX,
  parseTrailers,
  recoveryBranchFor,
  rootFromRecoveryBranch,
} from './recovery-lineage.mjs'

const SHA = /^[0-9a-f]{40}$/
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/
const NUMBER = /^[1-9][0-9]{0,9}$/ // PR numbers
// GitHub Actions run ids are already 11 digits; keep them as decimal strings with generous headroom.
const RUN_ID = /^[1-9][0-9]{0,19}$/
const RECOVERY_PREFIX = RECOVERY_BRANCH_PREFIX

const STAGING_KEYS = ['candidate_branch', 'candidate_sha', 'ci_run_id', 'pr_number']
const RELEASE_KEYS = ['pr_number', 'release_sha']

function fail(message) {
  throw new Error(`release-engineer context: ${message}`)
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is not an object`)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) fail(`${label} has unexpected fields`)
}

function requireSameRepoPr(pr, repo, expectedSha, expectedBranch) {
  if (pr.state !== 'open') fail(`PR #${pr.number} is not open`)
  if (pr.base?.ref !== 'main') fail(`PR #${pr.number} does not target main`)
  if (pr.head?.repo?.full_name !== repo) fail(`PR #${pr.number} is not from this repository`)
  if (expectedSha && pr.head.sha !== expectedSha) fail(`PR #${pr.number} head ${pr.head.sha} no longer matches ${expectedSha}`)
  if (expectedBranch && pr.head.ref !== expectedBranch) fail(`PR #${pr.number} head branch ${pr.head.ref} no longer matches ${expectedBranch}`)
  if (!BRANCH.test(pr.head.ref) || pr.head.ref === 'main') fail(`PR #${pr.number} has an unusable head branch`)
}

/**
 * @param {object} input
 * @param {'workflow_run'|'workflow_dispatch'} input.eventName
 * @param {object} [input.run] failed run (workflow_run payload, or fetched run for manual dispatch)
 * @param {string} input.repo owner/name
 * @param {string} input.fallbackSha sha to use when a manual dispatch names no failed run
 * @param {string} input.currentRunId id of this workflow run
 * @param {object} deps getPr(number), listOpenPrsForBranch(branch), readArtifactJson(runId, name), commitExists(sha),
 *   getCommit(sha) -> { message, authorEmail }
 */

/**
 * Recovers lineage from the exact failed candidate head commit of a proven open PR.
 * Returns null when the head carries no recovery trailers (a fresh root); throws (fail closed) on
 * malformed/forged trailers or any disagreement between a recovery branch name and its trailers.
 */
function inheritLineage(branch, commit) {
  const encodedRoot = rootFromRecoveryBranch(branch)
  const trailers = parseTrailers(commit.message)
  if (trailers && commit.authorEmail !== PUBLISHER_EMAIL) fail('recovery trailers are not on a trusted-publisher commit')
  if (encodedRoot !== null) {
    if (!trailers) fail(`recovery branch ${branch} head has no trusted recovery lineage`)
    if (trailers.root !== encodedRoot) fail(`recovery branch root ${encodedRoot} disagrees with commit root ${trailers.root}`)
  }
  return trailers
}

function lineageResult({ eventName, upstreamWorkflow, failedRunId, root, attempt, repairSha, repairBranch, repairPrNumber }) {
  const manual = eventName === 'workflow_dispatch'
  const retryExhausted = attempt > MAX_AUTOMATIC_REPAIR_ATTEMPTS
  return {
    skip: !manual && retryExhausted,
    manual,
    retryExhausted,
    automaticRetryAllowed: manual || !retryExhausted,
    upstreamWorkflow,
    failedRunId,
    rootFailedRunId: root,
    repairAttempt: attempt,
    repairSha,
    repairBranch,
    repairPrNumber,
  }
}
export async function resolveRepairContext({ eventName, run, repo, fallbackSha, currentRunId }, deps) {
  if (!run) {
    if (!SHA.test(fallbackSha ?? '')) fail('manual run has no valid fallback SHA')
    const root = `manual-${currentRunId}`
    return lineageResult({ eventName, upstreamWorkflow: 'manual', failedRunId: String(currentRunId), root, attempt: 1, repairSha: fallbackSha, repairBranch: recoveryBranchFor(root), repairPrNumber: '' })
  }

  const rootFailedRunId = String(run.id)
  if (typeof run.id === 'number' && !Number.isSafeInteger(run.id)) fail('failed run id is not a safe integer')
  if (!RUN_ID.test(rootFailedRunId)) fail('failed run id is invalid')
  if (run.head_repository?.full_name !== repo) fail('failed run is not from this repository')
  if (eventName === 'workflow_dispatch' && (run.status !== 'completed' || run.conclusion === 'success')) {
    fail('named run did not fail')
  }

  let repairSha
  let repairPrNumber = ''
  let candidatePr = null
  // Branch the FAILED code came from; distinct from repairBranch, which may be a brand-new recovery branch.
  let failedSourceBranch = run.head_branch

  if (run.name === 'CI') {
    repairSha = run.head_sha
    if (!SHA.test(repairSha ?? '')) fail('CI run head SHA is invalid')
    let prNumber = run.pull_requests?.[0]?.number
    if (!prNumber && run.head_branch && run.head_branch !== 'main') {
      const open = await deps.listOpenPrsForBranch(run.head_branch)
      prNumber = open.find((pr) => pr.head?.sha === repairSha && pr.head?.repo?.full_name === repo)?.number
    }
    if (prNumber) {
      const pr = await deps.getPr(prNumber)
      requireSameRepoPr(pr, repo, repairSha, run.head_branch)
      candidatePr = pr
      repairPrNumber = String(pr.number)
    }
  } else if (run.name === 'Staging Candidate') {
    // Never trust head_sha/head_branch here: they describe main, not the candidate (also for retry detection).
    const context = await deps.readArtifactJson(rootFailedRunId, 'staging-candidate-context')
    exactKeys(context, STAGING_KEYS, 'staging-candidate-context')
    if (!SHA.test(context.candidate_sha)) fail('candidate SHA is not a 40-character SHA')
    if (!NUMBER.test(context.pr_number)) fail('candidate PR number is invalid')
    if (!BRANCH.test(context.candidate_branch)) fail('candidate branch is invalid')
    const pr = await deps.getPr(Number(context.pr_number))
    requireSameRepoPr(pr, repo, context.candidate_sha, context.candidate_branch)
    repairSha = context.candidate_sha
    failedSourceBranch = context.candidate_branch
    candidatePr = pr
    repairPrNumber = context.pr_number
  } else if (run.name === 'Production Migration Evidence Audit') {
    repairSha = run.head_sha
    if (!SHA.test(repairSha ?? '')) fail('audit run head SHA is invalid')
  } else if (run.name === 'Deploy Health Check') {
    // Scheduled/push monitoring runs trusted code from main; repair that exact revision.
    repairSha = run.head_sha
    if (!SHA.test(repairSha ?? '')) fail('Deploy Health Check run head SHA is invalid')
  } else if (run.name === 'Production Release') {
    // release_sha input may differ from head_sha; read the target the run itself resolved.
    const context = await deps.readArtifactJson(rootFailedRunId, 'production-release-context')
    exactKeys(context, RELEASE_KEYS, 'production-release-context')
    if (!SHA.test(context.release_sha)) fail('release SHA is not a 40-character SHA')
    if (context.pr_number !== '' && !NUMBER.test(context.pr_number)) fail('release PR number is invalid')
    if (!(await deps.commitExists(context.release_sha))) fail('release SHA is not a known commit')
    repairSha = context.release_sha
  } else {
    fail(`unsupported upstream workflow: ${run.name}`)
  }

  // Lineage is inherited only from a proven open PR candidate head; main-based failures always start a
  // NEW root at attempt 1 even if some commit reaching main carries old recovery trailers.
  let root = rootFailedRunId
  let attempt = 1
  let repairBranch
  if (candidatePr) {
    const lineage = inheritLineage(candidatePr.head.ref, await deps.getCommit(repairSha))
    if (lineage) {
      root = lineage.root
      attempt = lineage.attempt + 1
    }
    repairBranch = candidatePr.head.ref
  } else {
    if (failedSourceBranch?.startsWith(RECOVERY_PREFIX)) fail(`failed source ${failedSourceBranch} is a recovery branch without an open PR`)
    repairBranch = recoveryBranchFor(root)
  }
  return lineageResult({ eventName, upstreamWorkflow: run.name, failedRunId: rootFailedRunId, root, attempt, repairSha, repairBranch, repairPrNumber })
}

/** Validates the manual failed_run_id input; returns '' when none was given. */
export function parseFailedRunIdInput(value) {
  const trimmed = (value ?? '').trim()
  if (trimmed && !RUN_ID.test(trimmed)) fail('failed_run_id input is invalid')
  return trimmed
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function realDeps(repo) {
  return {
    getPr: async (number) => JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`])),
    listOpenPrsForBranch: async (branch) =>
      JSON.parse(gh(['api', `repos/${repo}/pulls?state=open&per_page=100&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}`])),
    readArtifactJson: async (runId, name) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'ctx-'))
      try {
        gh(['run', 'download', String(runId), '--repo', repo, '--name', name, '--dir', dir])
      } catch {
        fail(`artifact ${name} is missing from run ${runId}`)
      }
      const files = readdirSync(dir)
      if (files.length !== 1 || files[0] !== 'context.json') fail(`artifact ${name} has unexpected files`)
      return JSON.parse(readFileSync(path.join(dir, 'context.json'), 'utf8'))
    },
    getCommit: async (sha) => {
      const data = JSON.parse(gh(['api', `repos/${repo}/commits/${sha}`]))
      return { message: data.commit?.message ?? '', authorEmail: data.commit?.author?.email ?? '' }
    },
    commitExists: async (sha) => {
      try {
        gh(['api', `repos/${repo}/commits/${sha}`])
        return true
      } catch {
        return false
      }
    },
  }
}

async function main() {
  const { EVENT_NAME, REPO, RUN_JSON, INPUT_RUN_ID, GITHUB_RUN_ID, GITHUB_SHA, GITHUB_OUTPUT } = process.env
  let run = RUN_JSON ? JSON.parse(RUN_JSON) : undefined
  const inputRunId = EVENT_NAME === 'workflow_dispatch' ? parseFailedRunIdInput(INPUT_RUN_ID) : ''
  if (inputRunId) {
    run = JSON.parse(gh(['api', `repos/${REPO}/actions/runs/${inputRunId}`]))
  } else if (EVENT_NAME === 'workflow_dispatch') {
    run = undefined
  }
  const result = await resolveRepairContext(
    { eventName: EVENT_NAME, run, repo: REPO, fallbackSha: GITHUB_SHA, currentRunId: GITHUB_RUN_ID },
    realDeps(REPO),
  )
  const lines = {
    skip: String(result.skip),
    manual: String(result.manual),
    retry_exhausted: String(result.retryExhausted),
    automatic_retry_allowed: String(result.automaticRetryAllowed),
    max_automatic_attempts: String(MAX_AUTOMATIC_REPAIR_ATTEMPTS),
    failed_run_id: result.failedRunId,
    repair_attempt: String(result.repairAttempt),
    repair_sha: result.repairSha,
    repair_branch: result.repairBranch,
    repair_pr_number: result.repairPrNumber,
    root_failed_run_id: result.rootFailedRunId,
    upstream_workflow: result.upstreamWorkflow,
  }
  for (const [key, value] of Object.entries(lines)) {
    if (/[\r\n]/.test(value)) fail(`output ${key} contains a newline`)
    appendFileSync(GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
