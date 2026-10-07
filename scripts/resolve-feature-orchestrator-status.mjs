#!/usr/bin/env node
// Read-only resolver: GitHub state -> one of the orchestrator states. GitHub is the source of truth; this
// script holds no state of its own and can be re-run by any session. It performs GET requests only.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CI_START_WINDOW_MS,
  CI_WORKFLOW_PATH,
  FEATURE_BUILDER_WORKFLOW_PATH,
  STAGING_WAIT_WINDOW_MS,
  STAGING_WORKFLOW_PATH,
  builderBranchPrefix,
  classifyGate,
  finalizeReadiness,
  isActionsCheck,
  latestBy,
  parseRunId,
  renderStatus,
  sanitizeText,
  stagingContextMatches,
  stripPath,
  validateBuilderBranch,
  validateBuilderRun,
  validateDispatchRecord,
  validateLineage,
  validatePr,
} from './feature-orchestrator-policy.mjs'

function result(state, base, extra = {}) {
  return { state, ...base, ...extra, merge_authorized: false, production_authorized: false }
}

function featureNameOf(pr) {
  return sanitizeText(String(pr?.title ?? '').replace(/^feat:\s*/i, ''))
}

function prFacts(pr) {
  return { number: pr.number, url: pr.html_url, state: pr.merged_at || pr.merged ? 'merged' : pr.state }
}

async function resolveCi({ repo, pr, headSha, deps, now }) {
  const runs = (await deps.listWorkflowRuns(CI_WORKFLOW_PATH, { headSha })).filter(
    (run) =>
      stripPath(run.path) === CI_WORKFLOW_PATH &&
      run.event === 'pull_request' &&
      run.head_sha === headSha &&
      run.head_repository?.full_name === repo &&
      (run.pull_requests ?? []).some((candidate) => candidate.number === pr.number),
  )
  const run = latestBy(runs, 'id')
  if (!run) {
    const age = now - Date.parse(pr.updated_at ?? pr.created_at ?? 0)
    return { state: Number.isFinite(age) && age <= CI_START_WINDOW_MS ? 'missing' : 'unproven', failed: [] }
  }
  const checks = await deps.listCheckRuns(headSha)
  const gate = latestBy(checks.filter((check) => isActionsCheck(check, 'CI Gate', run.id)), 'id')
  const failed = checks
    .filter((check) => check.app?.slug === 'github-actions' && /\/actions\/runs\/(\d+)/.exec(check.details_url ?? '')?.[1] === String(run.id))
    .filter((check) => ['failure', 'timed_out'].includes(check.conclusion) && check.name !== 'CI Gate')
    .map((check) => sanitizeText(check.name, 80))
  return { ...classifyGate({ run, gate }), run, failed }
}

async function resolveStaging({ repo, pr, headSha, branch, ciRun, deps, now }) {
  const since = Date.parse(ciRun.updated_at ?? ciRun.created_at ?? 0)
  const candidates = (await deps.listWorkflowRuns(STAGING_WORKFLOW_PATH, {})).filter(
    (run) =>
      stripPath(run.path) === STAGING_WORKFLOW_PATH &&
      ['workflow_run', 'workflow_dispatch'].includes(run.event) &&
      run.head_repository?.full_name === repo &&
      Date.parse(run.created_at) >= since - 1000,
  )
  const matched = []
  // `head_branch: main` on a staging run describes main, not the candidate, so identity comes only from the
  // trusted staging-candidate-context artifact the staging workflow itself publishes.
  for (const run of candidates.slice(0, 40)) {
    const artifacts = await deps.listRunArtifacts(run.id)
    if (!artifacts.some((artifact) => artifact.name === 'staging-candidate-context' && !artifact.expired)) continue
    let context
    try {
      context = await deps.readArtifactJson(run.id, 'staging-candidate-context')
    } catch {
      continue
    }
    if (stagingContextMatches(context, { prNumber: pr.number, branch, headSha, ciRunId: ciRun.id })) matched.push(run)
  }
  const run = latestBy(matched, 'id')
  if (!run) {
    const waited = now - since
    return { state: waited <= STAGING_WAIT_WINDOW_MS ? 'missing' : 'unproven', failed: [] }
  }
  const checks = await deps.listCheckRuns(headSha)
  const gate = latestBy(checks.filter((check) => isActionsCheck(check, 'Staging Gate', run.id)), 'id')
  return { ...classifyGate({ run, gate }), run, failed: [] }
}

/**
 * @param {{repo: string, builderRunId: string|number, now?: number}} input
 * @param {object} deps read-only GitHub accessors (see realDeps)
 */
export async function resolveFeatureStatus({ repo, builderRunId, dispatchRecord, now = Date.now() }, deps) {
  const runId = parseRunId(builderRunId)
  const base = { builder_run_id: runId }
  const run = await deps.getWorkflowRun(runId)

  const runProblems = validateBuilderRun(run, repo)
  if (runProblems.length) return result('unproven', base, { reason: runProblems.join('; ') })
  base.base_sha = run.head_sha
  if (dispatchRecord) {
    try {
      validateDispatchRecord(dispatchRecord, run)
    } catch (error) {
      return result('unproven', base, { reason: sanitizeText(error.message, 200) })
    }
  }

  if (run.status !== 'completed') return result('building', base, { reason: `Feature Builder run is ${run.status}` })
  if (run.conclusion !== 'success') {
    return result('blocked', base, { reason: `Feature Builder run finished with '${sanitizeText(run.conclusion, 40)}'; no feature was published` })
  }

  const refs = (await deps.listRefs(`heads/${builderBranchPrefix(runId)}`)).filter((ref) =>
    validateBuilderBranch(String(ref.ref ?? '').replace(/^refs\/heads\//, ''), runId),
  )
  if (refs.length !== 1) return result('unproven', base, { reason: `expected exactly one feature branch for run ${runId}, found ${refs.length}` })
  const branch = refs[0].ref.replace(/^refs\/heads\//, '')
  base.branch = branch

  const listed = await deps.listPrsForHead(branch)
  if (listed.length !== 1) return result('unproven', base, { reason: `expected exactly one PR for ${branch}, found ${listed.length}` })
  const pr = await deps.getPr(listed[0].number)
  base.feature_name = featureNameOf(pr)
  base.pr = prFacts(pr)
  const prProblems = validatePr(pr, { repo, branch })
  if (prProblems.length) return result('unproven', base, { reason: prProblems.join('; ') })
  if (pr.state !== 'open') {
    return result('blocked', base, { reason: `PR #${pr.number} is ${prFacts(pr).state}; the orchestrator only follows open PRs` })
  }
  const headSha = pr.head.sha
  base.head_sha = headSha

  const commits = await deps.listPrCommits(pr.number)
  const lineage = validateLineage({ commits, runId, baseSha: run.head_sha, headSha })
  if (!lineage.ok) return result('blocked', base, { reason: `Head ${headSha.slice(0, 7)} is outside the proven feature lineage: ${lineage.reason}` })
  base.repair_commits = lineage.repairs

  const ci = await resolveCi({ repo, pr, headSha, deps, now })
  base.ci = { state: ci.state, run_id: ci.run ? String(ci.run.id) : null }
  if (ci.failed?.length) base.failed_checks = ci.failed
  const withHead = async (state, extra) => {
    const fresh = await deps.getPr(pr.number)
    if (fresh.head?.sha !== headSha) {
      return result('unproven', { ...base, ci: undefined, staging: undefined }, {
        reason: `PR head moved from ${headSha.slice(0, 7)} to ${String(fresh.head?.sha).slice(0, 7)} while resolving; check again`,
      })
    }
    return result(state, base, extra)
  }

  if (['missing', 'queued', 'running'].includes(ci.state)) return withHead('ci_running', { reason: ci.state === 'missing' ? 'CI has not started for this exact head yet' : undefined })
  if (ci.state === 'failure') return withHead('ci_failed')
  if (ci.state !== 'success') return withHead('unproven', { reason: `CI Gate for this exact head is ${ci.state}` })

  const staging = await resolveStaging({ repo, pr, headSha, branch, ciRun: ci.run, deps, now })
  base.staging = { state: staging.state, run_id: staging.run ? String(staging.run.id) : null }
  if (['missing', 'queued', 'running'].includes(staging.state)) {
    return withHead('staging_running', { reason: staging.state === 'missing' ? 'Staging Candidate has not started for this exact candidate yet' : undefined })
  }
  if (staging.state === 'failure') return withHead('staging_failed')
  if (staging.state !== 'success') return withHead('unproven', { reason: `Staging Gate for this exact candidate is ${staging.state}` })

  const fresh = await deps.getPr(pr.number)
  const state = finalizeReadiness({
    builder: run,
    pr: { ...fresh, merged: Boolean(fresh.merged_at || fresh.merged) },
    lineage,
    ci,
    staging,
    headStable: fresh.head?.sha === headSha && fresh.state === 'open',
  })
  if (!state) return result('unproven', base, { reason: 'candidate changed while resolving; check again' })
  return result(state, base)
}

/** Read-only GitHub accessors. Every call goes through ghGet, which can only issue GET requests. */
export function realDeps(repo, { gh = defaultGh } = {}) {
  const get = (endpoint) => JSON.parse(gh(['api', '--method', 'GET', endpoint]))
  const pages = (endpoint, key, max = 5) => {
    const items = []
    for (let page = 1; page <= max; page += 1) {
      const data = get(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      const batch = key ? data[key] : data
      items.push(...batch)
      if (batch.length < 100) break
    }
    return items
  }
  const workflowFile = (workflowPath) => path.posix.basename(workflowPath)
  return {
    getWorkflowRun: async (id) => get(`repos/${repo}/actions/runs/${id}`),
    listRefs: async (prefix) => get(`repos/${repo}/git/matching-refs/${prefix}`),
    listPrsForHead: async (branch) =>
      pages(`repos/${repo}/pulls?state=all&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}`, null, 1),
    getPr: async (number) => get(`repos/${repo}/pulls/${number}`),
    listPrCommits: async (number) => pages(`repos/${repo}/pulls/${number}/commits`, null, 3),
    listWorkflowRuns: async (workflowPath, { headSha } = {}) =>
      pages(`repos/${repo}/actions/workflows/${workflowFile(workflowPath)}/runs${headSha ? `?head_sha=${headSha}` : ''}`, 'workflow_runs', headSha ? 2 : 1),
    listCheckRuns: async (sha) => pages(`repos/${repo}/commits/${sha}/check-runs`, 'check_runs', 5),
    listRunArtifacts: async (runId) => get(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`).artifacts,
    readArtifactJson: async (runId, name) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'orch-'))
      try {
        gh(['run', 'download', String(runId), '--repo', repo, '--name', name, '--dir', dir])
        const files = readdirSync(dir)
        if (files.length !== 1 || files[0] !== 'context.json') throw new Error(`artifact ${name} has unexpected files`)
        return JSON.parse(readFileSync(path.join(dir, 'context.json'), 'utf8'))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    listBuilderRuns: async () =>
      get(`repos/${repo}/actions/workflows/${workflowFile(FEATURE_BUILDER_WORKFLOW_PATH)}/runs?event=workflow_dispatch&per_page=10`).workflow_runs,
  }
}

function defaultGh(args) {
  if (args[0] === 'api' && args[1] === '--method' && args[2] !== 'GET') throw new Error('read-only resolver refuses non-GET requests')
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (['--builder-run', '--orchestrator-run', '--repo'].includes(flag)) out[flag.slice(2)] = argv[++i]
    else if (flag === '--latest') out.latest = true
    else if (flag === '--json') out.json = true
    else throw new Error(`unknown argument ${flag}`)
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = args.repo ?? process.env.REPO ?? JSON.parse(execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { encoding: 'utf8' })).nameWithOwner
  const deps = realDeps(repo)
  let builderRunId = args['builder-run']
  let dispatchRecord
  if (args['orchestrator-run']) {
    dispatchRecord = await deps.readArtifactJson(parseRunId(args['orchestrator-run']), 'feature-orchestrator-dispatch')
    builderRunId = dispatchRecord.builder_run_id
  } else if (args.latest) {
    const latest = latestBy(await deps.listBuilderRuns(), 'id')
    if (!latest) throw new Error('no Autonomous Feature Builder runs found')
    builderRunId = String(latest.id)
  }
  if (!builderRunId) throw new Error('provide --builder-run <id>, --orchestrator-run <id>, or --latest')
  const status = await resolveFeatureStatus({ repo, builderRunId, dispatchRecord }, deps)
  console.log(args.json ? JSON.stringify(status, null, 2) : renderStatus(status))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`feature orchestrator status: ${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  })
}
