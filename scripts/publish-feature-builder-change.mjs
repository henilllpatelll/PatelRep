#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const BRANCH = /^feature\/ai-[1-9][0-9]{0,19}-[a-z0-9][a-z0-9-]{0,59}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const MAX_PATCH_BYTES = 5 * 1024 * 1024
const MAX_SUMMARY_CHARS = 7000

const BLOCKED_PATHS = [
  /^\.github\/workflows\//,
  /^scripts\/(?:production-|release-|claude-release-engineer|resolve-release-engineer|publish-release-engineer|recovery-lineage|staging-|feature-builder|publish-feature-builder|feature-orchestrator|dispatch-feature-builder|resolve-feature-orchestrator)/,
  /^docs\/(?:PRODUCTION_RUNBOOK|RELEASE_PROCESS|AUTONOMOUS_RELEASE_ENGINEER|AUTONOMOUS_FEATURE_BUILDER|CLAUDE_FEATURE_ORCHESTRATOR)\.md$/,
]

function fail(message) {
  throw new Error(`publish feature: ${message}`)
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

function safeSummary(value) {
  return String(value ?? '').replace(/<!--/g, '&lt;!--').slice(0, MAX_SUMMARY_CHARS).trim()
}

export function validateChangedPaths(nameStatusText) {
  const entries = String(nameStatusText ?? '').split('\n').filter(Boolean)
  if (entries.length === 0) fail('patch produced no staged files')

  for (const line of entries) {
    const [status, ...paths] = line.split('\t')
    if (!status || paths.length === 0) fail('could not parse changed-file status')
    for (const changedPath of paths) {
      if (BLOCKED_PATHS.some((pattern) => pattern.test(changedPath))) {
        fail(`feature builder cannot modify protected control-plane path ${changedPath}`)
      }
      if (changedPath.startsWith('supabase/migrations/') && !status.startsWith('A')) {
        fail(`existing migration history is immutable: ${changedPath} has status ${status}`)
      }
    }
  }
  return entries
}

export function buildCommitMessage({ featureName, runId, baseSha }) {
  return `feat: ${featureName}\n\nBuilt by PatelRep Autonomous Feature Builder.\n\nPatelRep-Feature-Builder-Run: ${runId}\nPatelRep-Feature-Base-SHA: ${baseSha}\n`
}

export function buildPrBody({ runId, baseSha, summary }) {
  const report = safeSummary(summary)
  return [
    '## Autonomous Feature Builder',
    '',
    `- Builder run: \`${runId}\``,
    `- Exact base SHA: \`${baseSha}\``,
    '- Target: `main`',
    '- Merge authority: **none** — human review and merge are still required.',
    '- Production authority: **none** — this workflow cannot deploy, release, roll back, or mutate production.',
    '',
    '### Builder report',
    report || '_No builder report was produced; review the diff and CI results directly._',
    '',
    '### Delivery gates',
    '- CI runs automatically on this PR.',
    '- A successful CI Gate hands the exact PR candidate to the existing Staging Candidate workflow.',
    '- Merge only after CI and Staging are green and the feature has been reviewed by a human.',
    '',
  ].join('\n')
}

export function validateInputs({ repo, baseSha, branch, runId, featureName, patchFile }) {
  if (!REPO.test(repo ?? '')) fail('repository is invalid')
  if (!SHA.test(baseSha ?? '')) fail('base SHA is invalid')
  if (!BRANCH.test(branch ?? '')) fail('branch is invalid')
  if (!RUN_ID.test(String(runId ?? ''))) fail('run id is invalid')
  if (!String(branch).startsWith(`feature/ai-${runId}-`)) fail('branch does not belong to this builder run')
  if (!String(featureName ?? '').trim()) fail('feature name is required')
  if (!patchFile || !existsSync(patchFile)) fail('patch artifact is missing')
  const size = statSync(patchFile).size
  if (size < 1) fail('patch artifact is empty')
  if (size > MAX_PATCH_BYTES) fail(`patch artifact exceeds ${MAX_PATCH_BYTES} bytes`)
}

function main() {
  const repo = String(process.env.REPO ?? '').trim()
  const baseSha = String(process.env.BASE_SHA ?? '').trim()
  const branch = String(process.env.FEATURE_BRANCH ?? '').trim()
  const runId = String(process.env.FEATURE_RUN_ID ?? '').trim()
  const featureName = String(process.env.FEATURE_NAME ?? '').trim()
  const patchFile = String(process.env.PATCH_FILE ?? '').trim()
  const summaryFile = String(process.env.SUMMARY_FILE ?? '').trim()

  validateInputs({ repo, baseSha, branch, runId, featureName, patchFile })

  const head = run('git', ['rev-parse', 'HEAD'])
  if (head !== baseSha) fail(`publisher checkout ${head} does not equal exact base ${baseSha}`)

  const remoteMain = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] || ''
  if (remoteMain !== baseSha) fail(`main moved from ${baseSha} to ${remoteMain || 'unknown'} while the feature was built`)

  const remoteBranch = run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])
  if (remoteBranch) fail(`feature branch ${branch} already exists; refusing to overwrite`)

  const existingPrJson = run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--head', branch, '--json', 'number'])
  const existingPrs = JSON.parse(existingPrJson || '[]')
  if (existingPrs.length !== 0) fail(`an open PR already exists for ${branch}`)

  run('git', ['apply', '--index', '--binary', patchFile])
  const nameStatus = run('git', ['diff', '--cached', '--name-status', baseSha])
  validateChangedPaths(nameStatus)

  run('git', ['config', 'user.name', 'patelrep-feature-builder[bot]'])
  run('git', ['config', 'user.email', 'patelrep-feature-builder[bot]@users.noreply.github.com'])
  const message = buildCommitMessage({ featureName, runId, baseSha })
  const messageFile = path.join(process.env.RUNNER_TEMP || '.', 'feature-builder-commit-message.txt')
  writeFileSync(messageFile, message)
  run('git', ['commit', '-F', messageFile])

  const commitsAhead = Number(run('git', ['rev-list', '--count', `${baseSha}..HEAD`]))
  if (commitsAhead !== 1) fail(`expected exactly one feature commit, found ${commitsAhead}`)

  run('git', ['push', 'origin', `HEAD:refs/heads/${branch}`])

  const summary = summaryFile && existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : ''
  const bodyFile = path.join(process.env.RUNNER_TEMP || '.', 'feature-builder-pr-body.md')
  writeFileSync(bodyFile, buildPrBody({ runId, baseSha, summary }))

  const title = `feat: ${featureName}`.slice(0, 240)
  const prUrl = run('gh', [
    'pr', 'create',
    '--repo', repo,
    '--base', 'main',
    '--head', branch,
    '--title', title,
    '--body-file', bodyFile,
  ])
  console.log(`Feature PR created: ${prUrl}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`::error::${String(error?.message ?? error).split('\n')[0]}`)
    process.exitCode = 1
  }
}
