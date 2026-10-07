import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DISPATCH_INPUT_KEYS } from './feature-orchestrator-policy.mjs'
import { realDeps } from './resolve-feature-orchestrator-status.mjs'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')
const orchestrator = read('.github/workflows/claude-feature-orchestrator.yml')
const builder = read('.github/workflows/autonomous-feature-builder.yml')
const releaseEngineer = read('.github/workflows/claude-release-engineer.yml')
const ci = read('.github/workflows/ci.yml')
const policy = read('scripts/feature-orchestrator-policy.mjs')
const dispatcher = read('scripts/dispatch-feature-builder.mjs')
const resolver = read('scripts/resolve-feature-orchestrator-status.mjs')

// Strip comments so prose describing what is forbidden does not trip the checks.
const code = (source) => source.replace(/^\s*#.*$/gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const PRODUCTION = /production-release|production-rollback|production-incident|production-auto-rollback|production-release-request|environment:\s*production|PRODUCTION_|RAILWAY|SUPABASE|psql|railway/

test('orchestrator is manual-dispatch only and runs only from main', () => {
  const body = code(orchestrator)
  assert.match(body, /\non:\n  workflow_dispatch:/)
  for (const trigger of ['push:', 'pull_request:', 'pull_request_target:', 'schedule:', 'workflow_run:', 'repository_dispatch:', 'issue_comment:']) {
    assert.ok(!body.includes(`\n  ${trigger}`), `must not trigger on ${trigger}`)
  }
  assert.match(body, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(body, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
})

test('orchestrator declares exactly the Feature Builder inputs and the builder still accepts only those', () => {
  const inputs = (source) => [...source.match(/workflow_dispatch:\n    inputs:\n([\s\S]*?)\n\npermissions:/)[1].matchAll(/^      ([a-z_]+):$/gm)].map((m) => m[1])
  assert.deepEqual(inputs(orchestrator), [...DISPATCH_INPUT_KEYS])
  assert.deepEqual(inputs(builder), [...DISPATCH_INPUT_KEYS])
})

test('orchestrator has the minimum permissions: contents read + actions write in one job, nothing else', () => {
  const body = code(orchestrator)
  assert.match(body, /\npermissions: \{\}\n/)
  const grants = [...body.matchAll(/^\s+([a-z-]+): (read|write)$/gm)].map((m) => `${m[1]}:${m[2]}`).sort()
  assert.deepEqual(grants, ['actions:write', 'contents:read'])
  assert.equal((body.match(/\n  [a-z-]+:\n    name:/g) ?? []).length, 1, 'exactly one job')
})

test('orchestrator has no secrets, App token, production Environment, merge, push, or deployment path', () => {
  const body = code(orchestrator)
  assert.doesNotMatch(body, /secrets\.|vars\.|create-github-app-token|PATELREP_APP|id-token|environment:/)
  assert.doesNotMatch(body, PRODUCTION)
  assert.doesNotMatch(body, /gh pr|gh release|git push|--force|merge|gh workflow run|claude-code-action|anthropics\//)
})

test('untrusted request text reaches the dispatcher only through env, never interpolated into a shell command', () => {
  const body = code(orchestrator)
  const runBlocks = [...body.matchAll(/run: (?:\|\n((?:\s{10}.*\n?)+)|(.*))/g)].map((m) => m[1] ?? m[2]).join('\n')
  assert.doesNotMatch(runBlocks, /\$\{\{/)
  assert.match(body, /FEATURE_NAME: \$\{\{ inputs\.feature_name \}\}/)
  assert.match(body, /FEATURE_REQUIREMENTS: \$\{\{ inputs\.requirements \}\}/)
})

test('dispatcher can issue exactly one write: the Feature Builder workflow_dispatch', () => {
  const body = code(dispatcher)
  const posts = body.match(/--method', 'POST'[^\n]*/g) ?? []
  assert.equal(posts.length, 1)
  assert.match(posts[0], /actions\/workflows\/\$\{workflowId\}\/dispatches/)
  assert.doesNotMatch(body, /'PUT'|'PATCH'|'DELETE'|-X\b/)
  assert.doesNotMatch(body, /pulls\/.*merge|git push|--force|gh pr|gh release|refs\/tags|check-runs|statuses/)
  assert.doesNotMatch(body, PRODUCTION)
  const envNames = [...body.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]).sort()
  assert.deepEqual([...new Set(envNames)], ['DISPATCH_OUTPUT_DIR', 'FEATURE_NAME', 'FEATURE_REQUIREMENTS', 'GITHUB_ACTOR', 'GITHUB_REF', 'GITHUB_RUN_ID', 'GITHUB_SHA', 'GITHUB_STEP_SUMMARY', 'GITHUB_TRIGGERING_ACTOR', 'REPO'], 'no env var can choose a workflow, ref, or input')
})

test('dispatch authority is bound to the builder workflow path and main, in policy code', () => {
  assert.match(policy, /FEATURE_BUILDER_WORKFLOW_PATH = '\.github\/workflows\/autonomous-feature-builder\.yml'/)
  assert.match(policy, /ref: DEFAULT_BRANCH/)
  assert.doesNotMatch(code(policy), PRODUCTION)
  assert.doesNotMatch(policy, /from 'node:(child_process|fs|net|http|https)'/, 'policy stays pure')
})

test('resolver is read-only: GET only, no mutation endpoints, no merge, no dispatch', () => {
  const body = code(resolver)
  assert.doesNotMatch(body, /'POST'|'PUT'|'PATCH'|'DELETE'|-X\b|\/merge|\/dispatches|\/rerun|\/cancel|git push|gh pr|gh workflow|gh release/)
  assert.doesNotMatch(body, PRODUCTION)
  assert.match(body, /read-only resolver refuses non-GET/)
})

test('every API call the real dependencies make is an explicit GET', async () => {
  const calls = []
  const gh = (args) => {
    calls.push(args)
    if (args[0] === 'run') return ''
    const endpoint = args[args.indexOf('--method') + 2]
    if (/commits$|commits\?|pulls\?|runs\?|check-runs/.test(endpoint) || /artifacts/.test(endpoint) || /runs\?/.test(endpoint)) {
      return JSON.stringify(/check-runs/.test(endpoint) ? { check_runs: [] } : /artifacts/.test(endpoint) ? { artifacts: [] } : /runs\?/.test(endpoint) ? { workflow_runs: [] } : [])
    }
    return JSON.stringify([])
  }
  const deps = realDeps('owner/repo', { gh })
  await Promise.allSettled([
    deps.getWorkflowRun('1'), deps.listRefs('heads/feature/ai-1-'), deps.listPrsForHead('feature/ai-1-x'), deps.getPr(1),
    deps.listPrCommits(1), deps.listWorkflowRuns('.github/workflows/ci.yml', { headSha: 'a'.repeat(40) }),
    deps.listWorkflowRuns('.github/workflows/staging-candidate.yml', {}), deps.listCheckRuns('a'.repeat(40)),
    deps.listRunArtifacts(1), deps.listBuilderRuns(),
  ])
  const api = calls.filter((args) => args[0] === 'api')
  assert.ok(api.length >= 10)
  for (const args of api) assert.deepEqual(args.slice(1, 3), ['--method', 'GET'])
})

test('no second repair agent: orchestration never invokes Claude and the Release Engineer never references it', () => {
  for (const source of [orchestrator, dispatcher, resolver, policy]) assert.doesNotMatch(code(source), /claude-code-action|claude_code_oauth_token|ANTHROPIC/i)
  assert.doesNotMatch(releaseEngineer, /claude-feature-orchestrator|feature-orchestrator/)
  assert.doesNotMatch(code(orchestrator), /workflow_run:/)
})

test('merge, production dispatch, and force-push tokens exist nowhere in the orchestration layer', () => {
  for (const [name, source] of Object.entries({ orchestrator, dispatcher, resolver, policy })) {
    const body = code(source)
    assert.doesNotMatch(body, /gh pr merge|merge_pull_request|\.merge\(|pulls\/[^\n]*\/merge|--auto\b/, name)
    assert.doesNotMatch(body, /git push|--force|--force-with-lease|push --delete|createRef|updateRef/, name)
    assert.doesNotMatch(body, /production-release\.yml|production-rollback\.yml|production-incident-reentry\.yml|\/releases\b|refs\/tags/, name)
    assert.doesNotMatch(body, /supabase migration|migration repair/, name)
  }
})

test('the orchestrator is wired into the Release Workflow Contract that feeds CI Gate', () => {
  const line = ci.split('\n').find((candidate) => candidate.includes('node --test') && candidate.includes('scripts/feature-builder.test.mjs'))
  assert.ok(line, 'release workflow contract command exists')
  assert.match(line, /scripts\/feature-orchestrator-policy\.test\.mjs/)
  assert.match(line, /scripts\/feature-orchestrator-workflow\.test\.mjs/)
})
