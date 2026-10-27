#!/usr/bin/env node
// CLI for the dependency orchestrator workflow. Runs from trusted `main` code only.
//   plan             read-only token: decide the next action, write plan outputs and a report
//   execute          one bounded mutation, re-planned from fresh state and matched to the plan
//   merge            serialized exact-SHA merge, gate recomputed from fresh GitHub facts
//   record-research  merge validated Claude research into the checkpoint
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deriveFlags } from './dependency-orchestrator-flags.mjs'
import { realDeps } from './dependency-orchestrator-deps.mjs'
import { SHA_PATTERN } from './dependency-orchestrator-policy.mjs'
import { runExecute, runMerge, runPlan, runRecordResearch } from './dependency-orchestrator-run.mjs'

const ACTION_TYPES = new Set(['update_branch', 'dependabot_rebase', 'dispatch_staging', 'request_repair', 'merge'])
const env = process.env
const out = (key, value) => env.GITHUB_OUTPUT && appendFileSync(env.GITHUB_OUTPUT, `${key}=${String(value).replace(/[\r\n]/g, ' ')}\n`)
const summary = (markdown) => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`)

function expectedAction() {
  if (!env.EXPECTED_TYPE) return null
  const pr = Number(env.EXPECTED_PR)
  if (!ACTION_TYPES.has(env.EXPECTED_TYPE) || !Number.isInteger(pr) || pr < 1 || !SHA_PATTERN.test(env.EXPECTED_HEAD_SHA ?? '')) throw new Error('invalid expected action')
  return { type: env.EXPECTED_TYPE, pr, head_sha: env.EXPECTED_HEAD_SHA }
}

async function main(command) {
  const now = new Date().toISOString()
  const deps = realDeps({ repo: env.REPO, readToken: env.GH_TOKEN, writeToken: env.GH_WRITE_TOKEN || null, policyPath: env.POLICY_PATH, stateFile: env.STATE_FILE || null })
  const ctx = { now, flagsFor: (policy, prior) => deriveFlags({ env, policy, prior, now }) }

  if (command === 'plan') {
    const plan = await runPlan({ deps, ctx })
    const dir = env.OUT_DIR || '.dependency-orchestrator'
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'research-input.json'), JSON.stringify(plan.research_input))
    writeFileSync(path.join(dir, 'report.md'), plan.report)
    for (const [key, value] of Object.entries(plan.outputs)) out(key, value)
    summary(plan.report.replace(/<!--[\s\S]*?-->/g, ''))
    console.log(`plan: action=${plan.outputs.action_type || 'none'} batch=${plan.outputs.batch_status}`)
    return
  }
  if (command === 'execute') {
    const result = await runExecute({ deps, ctx, expected: expectedAction() })
    summary(`### Execute\n${result.summary}`)
    if (result.report) summary(result.report.replace(/<!--[\s\S]*?-->/g, ''))
    if (result.executed?.outcome === 'failed') console.log(`::warning::${result.executed.type} #${result.executed.pr} failed: ${result.executed.error}`)
    console.log(`execute: ${result.summary}`)
    return
  }
  if (command === 'merge') {
    const expected = expectedAction()
    if (expected?.type !== 'merge') throw new Error('merge requires EXPECTED_TYPE=merge')
    if (env.PAUSED_VAR === 'true') {
      summary('### Merge refused\n- orchestrator is paused (DEPENDENCY_ORCHESTRATOR_PAUSED)')
      console.log('refused: paused')
      return
    }
    const result = await runMerge({ deps, ctx, expected })
    summary(result.merged ? `### Merged #${expected.pr}\nMerge commit \`${result.merge_commit_sha}\`` : `### Merge refused for #${expected.pr}\n${result.reasons.map((r) => `- ${r}`).join('\n')}`)
    console.log(result.merged ? `merged #${expected.pr}` : `refused: ${result.reasons.join('; ')}`)
    return
  }
  if (command === 'record-research') {
    const requested = JSON.parse(readFileSync(path.join(env.OUT_DIR, 'research-input.json'), 'utf8'))
    let results = {}
    try { results = JSON.parse(readFileSync(env.RESEARCH_FILE, 'utf8')) } catch { /* no research produced */ }
    const result = await runRecordResearch({ deps, ctx, requested, results, costUsd: Number(env.CLAUDE_COST_USD) })
    console.log(`research recorded for ${result.recorded} PR(s)`)
    return
  }
  throw new Error(`unknown command ${command}`)
}

main(process.argv[2]).catch((error) => {
  console.error(`dependency orchestrator: ${String(error.message).split('\n')[0]}`)
  process.exit(1)
})
