#!/usr/bin/env node
// Trusted dispatcher: starts the Autonomous Feature Builder on exact current main and nothing else.
//
// This is the only write-capable step in the orchestration layer, and it can issue exactly one kind of write:
// a workflow_dispatch for the workflow whose stable path is .github/workflows/autonomous-feature-builder.yml.
// There is no parameter for a workflow id, workflow file, or ref; the ref is fixed to main by the policy module.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FEATURE_BUILDER_WORKFLOW_PATH,
  assertDispatchContext,
  assertTrustedBuilderWorkflow,
  buildDispatchBody,
  sanitizeText,
  selectDispatchedRun,
  validateDispatchRecord,
} from './feature-orchestrator-policy.mjs'

const POLL_ATTEMPTS = 12
const POLL_INTERVAL_MS = 5000
const BUILDER_WORKFLOW_FILE = path.posix.basename(FEATURE_BUILDER_WORKFLOW_PATH)

function fail(message) {
  throw new Error(`dispatch feature builder: ${message}`)
}

/**
 * @param {object} input repo, ref, sha, orchestratorRunId, actor, featureName, requirements
 * @param {object} deps getMainSha(), getWorkflow(file), listBuilderRuns(workflowId), dispatch(workflowId, body),
 *   sleep(ms)
 */
export async function dispatchFeatureBuilder(input, deps) {
  const { repo, ref, sha, orchestratorRunId, actor, featureName, requirements } = input
  const body = buildDispatchBody({ featureName, requirements })

  const mainSha = await deps.getMainSha()
  assertDispatchContext({ repo, ref, sha, mainSha })

  const workflowId = assertTrustedBuilderWorkflow(await deps.getWorkflow(BUILDER_WORKFLOW_FILE))

  const known = new Set((await deps.listBuilderRuns(workflowId)).map((run) => String(run.id)))
  await deps.dispatch(workflowId, body)

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await deps.sleep(POLL_INTERVAL_MS)
    const runId = selectDispatchedRun({
      runs: await deps.listBuilderRuns(workflowId),
      knownRunIds: known,
      workflowId,
      mainSha,
      repo,
    })
    if (runId) {
      return validateDispatchRecord({
        base_sha: mainSha,
        builder_run_id: runId,
        feature_name: sanitizeText(body.inputs.feature_name),
        orchestrator_run_id: String(orchestratorRunId),
        requested_by: sanitizeText(actor, 80),
        requirements_sha256: createHash('sha256').update(body.inputs.requirements).digest('hex'),
        workflow_path: FEATURE_BUILDER_WORKFLOW_PATH,
      })
    }
  }
  return fail('the builder was dispatched but its run could not be proven; find it under Actions → Autonomous Feature Builder')
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] })
}

function realDeps(repo) {
  return {
    getMainSha: async () => JSON.parse(gh(['api', '--method', 'GET', `repos/${repo}/git/ref/heads/main`])).object.sha,
    getWorkflow: async (file) => JSON.parse(gh(['api', '--method', 'GET', `repos/${repo}/actions/workflows/${file}`])),
    listBuilderRuns: async (workflowId) =>
      JSON.parse(gh(['api', '--method', 'GET', `repos/${repo}/actions/workflows/${workflowId}/runs?event=workflow_dispatch&branch=main&per_page=50`])).workflow_runs,
    dispatch: async (workflowId, body) => {
      gh(['api', '--method', 'POST', `repos/${repo}/actions/workflows/${workflowId}/dispatches`, '--input', '-'], JSON.stringify(body))
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

async function main() {
  const env = process.env
  const record = await dispatchFeatureBuilder(
    {
      repo: env.REPO,
      ref: env.GITHUB_REF,
      sha: env.GITHUB_SHA,
      orchestratorRunId: env.GITHUB_RUN_ID,
      actor: env.GITHUB_TRIGGERING_ACTOR || env.GITHUB_ACTOR,
      featureName: env.FEATURE_NAME,
      requirements: env.FEATURE_REQUIREMENTS,
    },
    realDeps(env.REPO),
  )
  const outDir = env.DISPATCH_OUTPUT_DIR
  if (!outDir) fail('DISPATCH_OUTPUT_DIR is required')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'context.json'), `${JSON.stringify(record, null, 2)}\n`)
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `## Feature Builder dispatched\n\n- Builder run: \`${record.builder_run_id}\`\n- Exact main SHA: \`${record.base_sha}\`\n- Check status with: \`node scripts/resolve-feature-orchestrator-status.mjs --builder-run ${record.builder_run_id}\`\n- Merge authority: none. Production authority: none.\n`,
    )
  }
  console.log(`Feature Builder dispatched: run ${record.builder_run_id} on ${record.base_sha}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  })
}
