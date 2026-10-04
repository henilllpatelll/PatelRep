#!/usr/bin/env node
// Phase 2C unprivileged resolver: decides whether a successful Staging Candidate run is an auto-merge
// candidate. Read-only token, trusted code from main. The privileged merge job never trusts these outputs.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realAutoMergeDeps } from './release-engineer-auto-merge-deps.mjs'
import { evaluateAutoMerge } from './release-engineer-auto-merge-policy.mjs'

async function main() {
  const env = process.env
  const deps = realAutoMergeDeps({ repo: env.REPO, readToken: env.GH_TOKEN })
  const result = await evaluateAutoMerge({ repo: env.REPO, stagingRunId: env.STAGING_RUN_ID }, deps)
  const lines = result.eligible
    ? {
        eligible: 'true',
        pr_number: String(result.prNumber),
        candidate_sha: result.sha,
        candidate_branch: result.branch,
        ci_run_id: result.ciRunId,
      }
    : { eligible: 'false' }
  for (const [key, value] of Object.entries(lines)) {
    if (/[\r\n]/.test(value)) throw new Error(`auto-merge: output ${key} contains a newline`)
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
  const summary = result.eligible
    ? `Auto-merge eligible: recovery PR #${result.prNumber} (root ${result.root}, attempt ${result.attempt}) at ${result.sha}.`
    : result.reason
  console.log(summary)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.replace(/[\r\n]+/g, ' ')}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
