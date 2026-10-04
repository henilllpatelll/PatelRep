#!/usr/bin/env node
// Trusted publisher for the Claude release engineer. Claude only edits/tests locally and hands over a
// patch; this script (the only holder of the write-capable GitHub App token) creates exactly ONE commit
// per attempt, stamps the authoritative recovery-lineage trailers, pushes normally (never force) and
// creates or updates exactly one PR. Every precondition failure throws, so publishing fails closed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_AUTOMATIC_REPAIR_ATTEMPTS,
  PUBLISHER_EMAIL,
  PUBLISHER_NAME,
  RUN_ID_PATTERN,
  ROOT_PATTERN,
  formatTrailers,
  parseTrailers,
  recoveryBranchFor,
} from './recovery-lineage.mjs'

const SHA = /^[0-9a-f]{40}$/
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/
const MARK_START = '<!-- patelrep-recovery:start -->'
const MARK_END = '<!-- patelrep-recovery:end -->'
const HISTORY_HEADING = '### History'
const MAX_SUMMARY_CHARS = 6000

function fail(message) {
  throw new Error(`publish repair: ${message}`)
}

function sanitizeSummary(text) {
  return String(text ?? '').replace(/<!--/g, '&lt;!--').slice(0, MAX_SUMMARY_CHARS).trim()
}

/** Builds the single repair commit message; trailers are the authoritative lineage record. */
export function buildCommitMessage({ upstreamWorkflow, failedRunId, root, attempt }) {
  const subject = `fix: automated repair of ${upstreamWorkflow} failure (attempt ${attempt}/${MAX_AUTOMATIC_REPAIR_ATTEMPTS})`
  const body = `Automated repair by the PatelRep release engineer for ${upstreamWorkflow} run ${failedRunId}.`
  return `${subject}\n\n${body}\n\n${formatTrailers({ root, attempt, sourceRun: failedRunId })}\n`
}

/** Renders the managed recovery section, keeping prior history; PR text is never the retry counter. */
export function renderPrBody({ existingBody, root, attempt, failedRunId, upstreamWorkflow, commitSha, summary, manual }) {
  const body = existingBody ?? ''
  const start = body.indexOf(MARK_START)
  const end = body.indexOf(MARK_END)
  const outside = start >= 0 && end > start ? `${body.slice(0, start)}${body.slice(end + MARK_END.length)}`.trim() : body.trim()
  let history = []
  if (start >= 0 && end > start) {
    const section = body.slice(start, end)
    const at = section.indexOf(HISTORY_HEADING)
    if (at >= 0) history = section.slice(at + HISTORY_HEADING.length).split('\n').filter((line) => line.startsWith('- attempt '))
  }
  history.push(`- attempt ${attempt}${manual ? ' (manual)' : ''}: ${upstreamWorkflow} run ${failedRunId} → ${commitSha.slice(0, 7)}`)
  const section = [
    MARK_START,
    '## Automated recovery (PatelRep release engineer)',
    `- Root failure: run ${root}`,
    `- Latest failure: ${upstreamWorkflow} run ${failedRunId}`,
    `- Autonomous attempt: ${attempt}/${MAX_AUTOMATIC_REPAIR_ATTEMPTS}${manual ? ' (manual dispatch; not bound by the automatic cap)' : ''}`,
    `<!-- patelrep-recovery:meta root=${root} attempt=${attempt} (informational; commit trailers are authoritative) -->`,
    '',
    '### Latest repair',
    sanitizeSummary(summary) || '_The repair agent provided no summary; see the commit and workflow run._',
    '',
    '### Safety notes',
    '- Claude edited and tested locally only; this commit was created and pushed by the trusted publisher (no force push).',
    '- No production credentials, environments, migrations or releases were involved. Normal CI Gate and Staging Gate must pass before merge; nothing is auto-merged.',
    '',
    HISTORY_HEADING,
    ...history,
    MARK_END,
  ].join('\n')
  return outside ? `${outside}\n\n${section}\n` : `${section}\n`
}

function requireOpenSameRepoPr(pr, repo, expectedBranch, expectedSha) {
  if (pr.state !== 'open') fail(`PR #${pr.number} is no longer open`)
  if (pr.base?.ref !== 'main') fail(`PR #${pr.number} does not target main`)
  if (pr.head?.repo?.full_name !== repo) fail(`PR #${pr.number} is not from this repository`)
  if (pr.head.ref !== expectedBranch) fail(`PR #${pr.number} head branch changed to ${pr.head.ref}`)
  if (pr.head.sha !== expectedSha) fail(`PR #${pr.number} head moved to ${pr.head.sha} while the repair ran; refusing to overwrite`)
}

/**
 * @param {object} input repo, repairSha, repairBranch, repairPrNumber ('' for none), root, attempt, failedRunId,
 *   upstreamWorkflow, manual, summary
 * @param {object} deps headSha, applyPatch, hasStagedChanges, commit(message), commitsAhead(sha), push(branch),
 *   getPr(n), findOpenPrs(branch), remoteBranchSha(branch), createPr({title, body, head}), updatePrBody(n, body)
 */
export async function publishRepair(input, deps) {
  const { repo, repairSha, repairBranch, repairPrNumber, root, attempt, failedRunId, upstreamWorkflow, manual = false, summary = '' } = input
  if (!SHA.test(repairSha ?? '')) fail('repair SHA is invalid')
  if (!BRANCH.test(repairBranch ?? '') || repairBranch === 'main') fail('repair branch is invalid')
  if (!ROOT_PATTERN.test(root ?? '')) fail('root is invalid')
  if (!RUN_ID_PATTERN.test(String(failedRunId))) fail('failed run id is invalid')
  if (!Number.isInteger(attempt) || attempt < 1) fail('attempt is invalid')
  if (!manual && attempt > MAX_AUTOMATIC_REPAIR_ATTEMPTS) fail('automatic attempt limit exceeded')

  if ((await deps.headSha()) !== repairSha) fail('checkout HEAD is not the exact repair SHA; Claude must not change history')

  if (repairPrNumber) {
    requireOpenSameRepoPr(await deps.getPr(Number(repairPrNumber)), repo, repairBranch, repairSha)
  } else {
    if (repairBranch !== recoveryBranchFor(root)) fail('new recovery branch must be claude/recovery-<root>')
    if (await deps.remoteBranchSha(repairBranch)) fail(`recovery branch ${repairBranch} already exists; refusing to overwrite or reuse it`)
    if ((await deps.findOpenPrs(repairBranch)).length > 0) fail(`an open PR already exists for ${repairBranch}`)
  }

  await deps.applyPatch()
  if (!(await deps.hasStagedChanges())) fail('the repair produced no changes')

  const commitSha = await deps.commit(buildCommitMessage({ upstreamWorkflow, failedRunId, root, attempt }))
  if ((await deps.commitsAhead(repairSha)) !== 1) fail('expected exactly one repair commit')
  const stamped = parseTrailers(await deps.commitMessage(commitSha))
  if (!stamped || stamped.root !== root || stamped.attempt !== attempt || stamped.sourceRun !== String(failedRunId)) {
    fail('commit trailers do not match the expected lineage')
  }

  // Re-prove the remote target immediately before the (non-force) push.
  if (repairPrNumber) {
    requireOpenSameRepoPr(await deps.getPr(Number(repairPrNumber)), repo, repairBranch, repairSha)
  } else if (await deps.remoteBranchSha(repairBranch)) {
    fail(`recovery branch ${repairBranch} appeared during the repair; refusing to overwrite it`)
  }
  await deps.push(repairBranch)

  const entry = { root, attempt, failedRunId, upstreamWorkflow, commitSha, summary, manual }
  if (repairPrNumber) {
    const pr = await deps.getPr(Number(repairPrNumber))
    await deps.updatePrBody(pr.number, renderPrBody({ ...entry, existingBody: pr.body }))
    return { action: 'updated', prNumber: pr.number, commitSha }
  }
  // Another run may have opened the PR meanwhile; never create a duplicate.
  const existing = await deps.findOpenPrs(repairBranch)
  if (existing.length > 0) {
    await deps.updatePrBody(existing[0].number, renderPrBody({ ...entry, existingBody: existing[0].body }))
    return { action: 'updated', prNumber: existing[0].number, commitSha }
  }
  const prNumber = await deps.createPr({
    title: `fix: automated repair for ${upstreamWorkflow} failure (run ${root})`,
    body: renderPrBody({ ...entry, existingBody: '' }),
    head: repairBranch,
  })
  return { action: 'created', prNumber, commitSha }
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options })
}

export function realDeps({ repo, patchFile }) {
  const gh = (args) => run('gh', args)
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: PUBLISHER_NAME,
    GIT_AUTHOR_EMAIL: PUBLISHER_EMAIL,
    GIT_COMMITTER_NAME: PUBLISHER_NAME,
    GIT_COMMITTER_EMAIL: PUBLISHER_EMAIL,
  }
  return {
    headSha: async () => run('git', ['rev-parse', 'HEAD']).trim(),
    applyPatch: async () => { run('git', ['apply', '--index', '--binary', '--whitespace=nowarn', patchFile]) },
    hasStagedChanges: async () => {
      try { run('git', ['diff', '--cached', '--quiet']); return false } catch { return true }
    },
    commit: async (message) => {
      run('git', ['commit', '--quiet', '--message', message], { env: gitEnv })
      return run('git', ['rev-parse', 'HEAD']).trim()
    },
    commitMessage: async (sha) => run('git', ['log', '-1', '--format=%B', sha]),
    commitsAhead: async (sha) => Number(run('git', ['rev-list', '--count', `${sha}..HEAD`]).trim()),
    push: async (branch) => { run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`]) },
    getPr: async (number) => JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`])),
    findOpenPrs: async (branch) =>
      JSON.parse(gh(['api', `repos/${repo}/pulls?state=open&per_page=100&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}`])),
    remoteBranchSha: async (branch) => run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).split(/\s/)[0] || null,
    createPr: async ({ title, body, head }) =>
      JSON.parse(gh(['api', '--method', 'POST', `repos/${repo}/pulls`, '-f', `title=${title}`, '-f', `body=${body}`, '-f', `head=${head}`, '-f', 'base=main'])).number,
    updatePrBody: async (number, body) => { gh(['api', '--method', 'PATCH', `repos/${repo}/pulls/${number}`, '-f', `body=${body}`]) },
  }
}

async function main() {
  const env = process.env
  const patchFile = path.resolve(env.PATCH_FILE ?? '')
  if (!env.PATCH_FILE || !existsSync(patchFile) || statSync(patchFile).size === 0) fail('no repair patch was provided')
  const summaryFile = env.SUMMARY_FILE && existsSync(env.SUMMARY_FILE) ? readFileSync(env.SUMMARY_FILE, 'utf8') : ''
  const result = await publishRepair(
    {
      repo: env.REPO,
      repairSha: env.REPAIR_SHA,
      repairBranch: env.REPAIR_BRANCH,
      repairPrNumber: env.REPAIR_PR_NUMBER ?? '',
      root: env.ROOT_FAILED_RUN_ID,
      attempt: Number(env.REPAIR_ATTEMPT),
      failedRunId: env.FAILED_RUN_ID,
      upstreamWorkflow: env.UPSTREAM_WORKFLOW,
      manual: env.MANUAL === 'true',
      summary: summaryFile,
    },
    realDeps({ repo: env.REPO, patchFile }),
  )
  console.log(`Repair ${result.action}: PR #${result.prNumber} at ${result.commitSha}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
