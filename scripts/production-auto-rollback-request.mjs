#!/usr/bin/env node
// Phase 3C entry point over one shared fail-closed policy:
//   resolve  - read-only first decision after Production Release Stabilization
//   request  - fresh read-only revalidation immediately before the App token exists
//   rollback - Phase 3D hook: independent revalidation inside Production Rollback before production access
// This script never dispatches, deploys, migrates, or rolls back anything itself.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realAutoRollbackRequestDeps } from './production-auto-rollback-deps.mjs'
import {
  evaluateAutoRollbackRequest,
  requireAutomatedRollbackDispatch,
  validateAutoRollbackRequest,
} from './production-auto-rollback-policy.mjs'

const SHA = /^[0-9a-f]{40}$/

function writeOutputs(env, values) {
  if (!env.GITHUB_OUTPUT) throw new Error('auto-rollback request: GITHUB_OUTPUT is required')
  for (const [key, value] of Object.entries(values)) {
    const text = String(value)
    if (/[\r\n]/.test(text)) throw new Error(`auto-rollback request: output ${key} contains a newline`)
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${text}\n`)
  }
}

function summarize(env, line) {
  console.log(line)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line.replace(/[\r\n]+/g, ' ')}\n`)
}

async function main() {
  const env = process.env
  const mode = process.argv[2]
  if (!['resolve', 'request', 'rollback'].includes(mode)) {
    throw new Error('usage: production-auto-rollback-request.mjs resolve|request|rollback')
  }

  const deps = realAutoRollbackRequestDeps({ repo: env.REPO, readToken: env.GH_TOKEN })
  const input = {
    repo: env.REPO,
    sourceRunId: env.SOURCE_RUN_ID,
    enabled: env.PRODUCTION_AUTO_ROLLBACK_ENABLED,
  }

  if (mode === 'rollback') {
    const result = await validateAutoRollbackRequest({ ...input, mode }, deps)
    requireAutomatedRollbackDispatch(
      {
        actor: env.GITHUB_ACTOR,
        actorId: env.GITHUB_ACTOR_ID,
        ref: env.GITHUB_REF,
        workflowSha: env.GITHUB_SHA,
        targetVersion: env.TARGET_VERSION,
        automationSourceRunId: env.SOURCE_RUN_ID,
      },
      result,
    )
    summarize(
      env,
      `Automated rollback provenance verified: incident ${result.sourceRunId}, failing ${result.candidateVersion}/${result.candidateSha}, target ${result.targetVersion}/${result.targetSha}.`,
    )
    return
  }

  const result = await evaluateAutoRollbackRequest({ ...input, mode }, deps)

  if (mode === 'resolve') {
    writeOutputs(
      env,
      result.eligible
        ? {
            eligible: 'true',
            target_version: result.targetVersion,
            target_sha: result.targetSha,
            control_plane_sha: result.controlPlaneSha,
          }
        : { eligible: 'false' },
    )
  } else {
    if (result.eligible) {
      if (!SHA.test(result.controlPlaneSha) || result.controlPlaneSha !== env.EXPECTED_CONTROL_PLANE_SHA) {
        throw new Error('auto-rollback request: revalidated control-plane SHA differs from the resolver')
      }
      if (result.targetVersion !== env.EXPECTED_TARGET_VERSION) {
        throw new Error('auto-rollback request: revalidated rollback target differs from the resolver')
      }
    }
    writeOutputs(
      env,
      result.eligible
        ? { dispatch: 'true', target_version: result.targetVersion, source_run_id: result.sourceRunId }
        : { dispatch: 'false' },
    )
  }

  summarize(
    env,
    result.eligible
      ? `Automatic rollback request eligible: incident ${result.sourceRunId}, failing ${result.candidateVersion}/${result.candidateSha}, target ${result.targetVersion}/${result.targetSha}. Production Rollback must independently re-verify this provenance before production access.`
      : result.reason,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error.message).split('\n')[0]}`)
    process.exit(1)
  })
}
