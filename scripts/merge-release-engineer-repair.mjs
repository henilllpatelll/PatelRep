#!/usr/bin/env node
// Phase 2C privileged merge step. Runs trusted code from the frozen control-plane SHA, never candidate code.
// It re-derives ALL eligibility from fresh GitHub state (resolver outputs are only expectations that must
// match), then merges the exact validated head SHA through the GitHub API. Any refusal fails the job.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realAutoMergeDeps } from './release-engineer-auto-merge-deps.mjs'
import { validateAutoMergeCandidate } from './release-engineer-auto-merge-policy.mjs'

/**
 * @param {object} input repo, stagingRunId, expected {prNumber, sha, branch, ciRunId}
 * @param {object} deps everything validateAutoMergeCandidate needs plus merge(prNumber, sha) and getMergedPr
 */
export async function mergeRepair({ repo, stagingRunId, expected }, deps) {
  if (!expected) throw new Error('auto-merge: resolver expectations are required')
  // Independent revalidation immediately before the merge call.
  const candidate = await validateAutoMergeCandidate({ repo, stagingRunId, expected }, deps)

  // The expected SHA makes GitHub reject the merge if the head moved after validation.
  const response = await deps.merge(candidate.prNumber, candidate.sha)
  if (response?.merged !== true) throw new Error(`auto-merge: GitHub did not merge PR #${candidate.prNumber}`)

  const merged = await deps.getMergedPr(candidate.prNumber)
  if (merged.merged !== true) throw new Error(`auto-merge: PR #${candidate.prNumber} is not merged after the API call`)
  if (merged.head?.sha !== candidate.sha) throw new Error('auto-merge: merged PR head is not the authorized candidate SHA')
  return { ...candidate, mergeCommitSha: response.sha ?? merged.merge_commit_sha ?? '' }
}

async function main() {
  const env = process.env
  const deps = realAutoMergeDeps({ repo: env.REPO, readToken: env.GH_READ_TOKEN, mergeToken: env.GH_MERGE_TOKEN })
  const result = await mergeRepair(
    {
      repo: env.REPO,
      stagingRunId: env.STAGING_RUN_ID,
      expected: { prNumber: env.EXPECTED_PR_NUMBER, sha: env.EXPECTED_SHA, branch: env.EXPECTED_BRANCH, ciRunId: env.EXPECTED_CI_RUN_ID },
    },
    deps,
  )
  const line = `Auto-merged recovery PR #${result.prNumber} (root ${result.root}, attempt ${result.attempt}) head ${result.sha} -> merge commit ${result.mergeCommitSha}`
  console.log(line)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
