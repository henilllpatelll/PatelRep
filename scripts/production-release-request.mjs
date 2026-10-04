#!/usr/bin/env node
// Phase 2D entry point, three modes over ONE shared policy (production-release-request-policy.mjs):
//   resolve - unprivileged resolver of the request workflow: clean no-op unless eligible
//   request - re-validation inside the request job immediately before the App token is created and the
//             existing Production Release is dispatched; also proves no duplicate/active release run exists
//   release - automated-mode verification inside Production Release itself, AFTER the human production
//             Environment approval and BEFORE any production step; every refusal fails the release
// Holds no credentials beyond the read-only workflow token. It never dispatches, approves or deploys anything.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realProductionRequestDeps } from './production-release-request-deps.mjs'
import {
  AUTOMATED_VERSION_BUMP,
  evaluateProductionRequest,
  requireAutomatedDispatch,
  validateProductionRequest,
} from './production-release-request-policy.mjs'

const SHA = /^[0-9a-f]{40}$/

function writeOutputs(env, values) {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`production request: output ${key} contains a newline`)
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

function summarize(env, line) {
  console.log(line)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line.replace(/[\r\n]+/g, ' ')}\n`)
}

async function main() {
  const env = process.env
  const mode = process.argv[2]
  if (!['resolve', 'request', 'release'].includes(mode)) throw new Error('usage: production-release-request.mjs resolve|request|release')
  const deps = realProductionRequestDeps({ repo: env.REPO, readToken: env.GH_TOKEN })
  const input = { repo: env.REPO, sourceRunId: env.SOURCE_RUN_ID, enabled: env.PRODUCTION_AUTO_RELEASE_ENABLED }

  if (mode === 'release') {
    // Automated mode: any refusal (policy or malformed data) fails the release before production is touched.
    const result = await validateProductionRequest({ ...input, mode: 'release' }, deps)
    requireAutomatedDispatch(
      {
        actor: env.GITHUB_ACTOR,
        actorId: env.GITHUB_ACTOR_ID,
        ref: env.GITHUB_REF,
        workflowSha: env.GITHUB_SHA,
        releaseSha: env.RELEASE_SHA,
        versionBump: env.VERSION_BUMP,
      },
      result,
    )
    summarize(env, `Automated production release request verified for ${result.mergeCommitSha} (recovery PR #${result.prNumber}, root ${result.root}, baseline ${result.baselineTag}, ${AUTOMATED_VERSION_BUMP} bump).`)
    return
  }

  const result = await evaluateProductionRequest({ ...input, mode }, deps)
  if (mode === 'resolve') {
    writeOutputs(env, result.eligible ? { eligible: 'true', merge_commit_sha: result.mergeCommitSha } : { eligible: 'false' })
  } else {
    if (result.eligible && (!SHA.test(result.mergeCommitSha) || result.mergeCommitSha !== env.EXPECTED_MERGE_COMMIT_SHA)) {
      throw new Error('production request: revalidated release SHA does not match the resolver expectation')
    }
    writeOutputs(env, result.eligible ? { dispatch: 'true', target_sha: result.mergeCommitSha, source_run_id: result.sourceRunId } : { dispatch: 'false' })
  }
  summarize(
    env,
    result.eligible
      ? `Production release request eligible: ${result.mergeCommitSha} (recovery PR #${result.prNumber}, root ${result.root}, baseline ${result.baselineTag}). This is a request only; production still requires human Environment approval.`
      : result.reason,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
