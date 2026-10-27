import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { DEFAULT_LIMITS, HARD_LIMITS, NEVER_AUTOMATIC, normalizePolicy } from './dependency-orchestrator-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const workflow = read('.github/workflows/dependency-orchestrator.yml')
const code = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const policyFile = JSON.parse(read('.github/dependency-orchestrator.policy.json'))
const scriptNames = readdirSync('scripts').filter((f) => /^dependency-orchestrator.*\.mjs$/.test(f) && !f.endsWith('.test.mjs') && !f.includes('fixtures'))
const scripts = Object.fromEntries(scriptNames.map((f) => [f, read(`scripts/${f}`)]))

const job = (name) => {
  const start = code.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const rest = code.slice(start + 1)
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}
const [resolve, research, execute, merge] = ['resolve', 'research', 'execute', 'merge'].map(job)

test('triggers are limited to dispatch, completed workflow runs and a slow schedule; never PR-controlled events', () => {
  assert.match(code, /^on:\n {2}workflow_dispatch:/m)
  assert.match(code, /workflow_run:\n {4}workflows:\n {6}- CI\n {6}- Staging Candidate\n {6}- Claude Release Engineer\n {4}types: \[completed\]/)
  assert.match(code, /schedule:\n {4}- cron:/)
  assert.doesNotMatch(code, /pull_request|pull_request_target|issue_comment|check_suite|^ {2}push:|repository_dispatch/m)
})

test('every checkout is trusted main code at a frozen SHA; PR heads are never checked out or executed', () => {
  assert.match(resolve, /ref: main/)
  for (const section of [research, execute, merge]) assert.match(section, /ref: \$\{\{ needs\.resolve\.outputs\.trusted_sha \}\}/)
  assert.doesNotMatch(code, /workflow_run\.head_sha|workflow_run\.head_branch\s*\}\}|pull_request\.head|github\.head_ref|refs\/pull\//)
  assert.equal((code.match(/persist-credentials: false/g) ?? []).length, (code.match(/actions\/checkout@/g) ?? []).length, 'no checkout persists credentials')
  assert.doesNotMatch(code, /npm (ci|install)|pip install|npx |node_modules/, 'no dependency installation of any kind (nothing from a PR is ever installed or run)')
})

test('the planning job is read-only and holds no secret or App credential', () => {
  assert.doesNotMatch(resolve, /secrets\.|create-github-app-token|GH_WRITE_TOKEN|GH_ISSUE_TOKEN/)
  assert.doesNotMatch(resolve, /^\s+permissions:/m, 'inherits the read-only workflow permissions')
  assert.match(code, /^permissions:\n {2}contents: read\n {2}actions: read\n {2}pull-requests: read\n {2}checks: read\n\njobs:/m)
})

test('Claude research holds no write credential, only the Claude token, and no shell or edit tools', () => {
  assert.doesNotMatch(research, /create-github-app-token|GH_WRITE_TOKEN|GH_ISSUE_TOKEN|permissions:/)
  assert.deepEqual([...research.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]), ['CLAUDE_CODE_OAUTH_TOKEN'])
  const tools = /--allowedTools "([^"]+)"/.exec(research)[1].split(',')
  assert.deepEqual(tools.sort(), ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Write'])
  assert.match(research, /UNTRUSTED DATA/)
  assert.match(research, /github\.actor != 'dependabot\[bot\]'/)
})

test('App tokens are minted only in execute and merge, per action, with the narrowest scopes', () => {
  assert.doesNotMatch(resolve + research, /create-github-app-token/)
  assert.equal((code.match(/create-github-app-token/g) ?? []).length, 3)
  const branchToken = /id: token-branch[\s\S]*?(?=\n {6}- name: Create dispatch)/.exec(execute)[0]
  assert.match(branchToken, /action_type == 'update_branch' \|\| needs\.resolve\.outputs\.action_type == 'dependabot_rebase'/)
  assert.match(branchToken, /permission-contents: write\n\s+permission-pull-requests: write/)
  assert.doesNotMatch(branchToken, /permission-issues/)
  assert.doesNotMatch(branchToken, /permission-actions/)
  const dispatchToken = /id: token-dispatch[\s\S]*?(?=\n {6}- name: Execute)/.exec(execute)[0]
  assert.match(dispatchToken, /dispatch_staging' \|\| needs\.resolve\.outputs\.action_type == 'request_repair'/)
  assert.match(dispatchToken, /permission-actions: write/)
  assert.doesNotMatch(dispatchToken, /permission-(contents|pull-requests|issues)/)
  assert.match(merge, /permission-contents: write\n\s+permission-pull-requests: write/)
  assert.doesNotMatch(merge, /permission-actions|permission-workflows/)
  assert.doesNotMatch(code, /permission-(administration|workflows|environments|secrets|members|deployments|statuses|checks)/)
})

test('execute and merge share one non-cancelling concurrency group so staging and merges are never concurrent', () => {
  for (const section of [execute, merge]) assert.match(section, /concurrency:\n {6}group: patelrep-dependency-orchestrator\n {6}cancel-in-progress: false/)
  assert.doesNotMatch(code, /cancel-in-progress: true/)
  assert.match(execute, /needs\.resolve\.outputs\.action_type != 'merge'/)
  assert.match(merge, /action_type == 'merge'/)
})

test('no job ever holds Issues write: the repository reserves it for the production notifier', () => {
  assert.doesNotMatch(code, /issues: write|issues: read|permission-issues|GH_ISSUE_TOKEN/)
  assert.doesNotMatch(Object.values(scripts).join('\n'), /issueToken|\/labels|repos\/\$\{repo\}\/issues`/)
})

test('the checkpoint is a provenance-checked workflow artifact written only by execute and merge', () => {
  assert.equal((code.match(/name: dependency-orchestrator-state/g) ?? []).length, 2)
  assert.doesNotMatch(resolve + research, /name: dependency-orchestrator-state/, 'read-only jobs never write the checkpoint')
  const deps = scripts['dependency-orchestrator-deps.mjs']
  assert.match(deps, /run\.path !== WORKFLOW_PATH/)
  assert.match(deps, /\['workflow_dispatch', 'schedule'\]\.includes\(run\.event\) && run\.head_branch === defaultBranch/)
})

test('privileged jobs refuse non-main refs and Dependabot-actor events (which carry no secrets anyway)', () => {
  for (const section of [execute, merge, research]) {
    assert.match(section, /github\.ref == 'refs\/heads\/main'/)
    assert.match(section, /github\.actor != 'dependabot\[bot\]'/)
  }
})

/** Collects the shell text of every `run:` step (inline or block scalar). */
function runScripts(source) {
  const lines = source.split('\n')
  const found = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s+)(?:- )?run:\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const indent = m[1].length
    const body = [m[2].replace(/^[|>]-?$/, '')]
    while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].search(/\S/) > indent)) body.push(lines[++i])
    found.push(body.join('\n'))
  }
  return found
}

test('untrusted values reach scripts only through env, never interpolated into shell', () => {
  const scriptsText = runScripts(code).join('\n')
  assert.ok(scriptsText.includes('dependency-orchestrator.mjs'), 'run blocks were extracted')
  assert.doesNotMatch(scriptsText, /\$\{\{\s*(github\.event|inputs)\./, 'no event/input expression inside a run script')
  for (const key of ['INPUT_ACTION', 'INPUT_PR_NUMBERS', 'INPUT_RESTART']) assert.match(code, new RegExp(`${key}: \\$\\{\\{ inputs\\.`))
})

test('no production surface: no environments, no production workflows, only the allowed secrets', () => {
  assert.doesNotMatch(code, /^\s+environment:/m)
  assert.doesNotMatch(code, /production|rollback|release_sha|RAILWAY|VERCEL|SUPABASE|STRIPE|PRODUCTION_AUTO_RELEASE/i)
  assert.deepEqual([...new Set([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'PATELREP_APP_PRIVATE_KEY'])
  assert.deepEqual([...new Set([...code.matchAll(/vars\.([A-Z_]+)/g)].map((m) => m[1]))].sort(), ['DEPENDENCY_ORCHESTRATOR_PAUSED', 'DEPENDENCY_ORCHESTRATOR_TICKS', 'PATELREP_APP_CLIENT_ID'])
})

test('scheduled ticks are explicitly opt-in: only DEPENDENCY_ORCHESTRATOR_TICKS == on enables them', () => {
  const gate = /\(github\.event_name != 'schedule' \|\| ([^)]+)\)/.exec(code)
  assert.ok(gate, 'resolve job gates the schedule event')
  // An unset variable reads as '' and 'off' must stay off: only the exact value 'on' may satisfy the gate.
  assert.equal(gate[1].trim(), "vars.DEPENDENCY_ORCHESTRATOR_TICKS == 'on'")
  assert.doesNotMatch(code, /DEPENDENCY_ORCHESTRATOR_TICKSs*!=/, 'no negated (default-on) form')
})

test('it is event-driven: no sleeping, polling loops or native auto-merge anywhere', () => {
  assert.doesNotMatch(code, /sleep |until |while |enable-auto-merge|--auto\b|autoMerge/)
  for (const [name, source] of Object.entries(scripts)) {
    const stripped = source.replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(stripped, /enableAutoMerge|--auto\b|auto_merge|while \(true\)|for \(;;\)/, name)
  }
})

test('scripts can write to GitHub only through the allowlisted endpoints', () => {
  const deps = scripts['dependency-orchestrator-deps.mjs']
  const writes = [...deps.matchAll(/'-X', '(PUT|POST|PATCH|DELETE)', `([^`]+)`/g)].map((m) => `${m[1]} ${m[2].replace(/\$\{[^}]+\}/g, '{}')}`)
  assert.deepEqual([...new Set(writes)].sort(), [
    'POST repos/{}/actions/workflows/{}/dispatches',
    'POST repos/{}/issues/{}/comments',
    'PUT repos/{}/pulls/{}/merge',
    'PUT repos/{}/pulls/{}/update-branch',
  ])
  assert.match(deps, /actions\/workflows\/\$\{file\}\/dispatches/)
  const run = scripts['dependency-orchestrator-run.mjs']
  const dispatched = [...run.matchAll(/dispatchWorkflow\('([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(dispatched, ['claude-release-engineer.yml', 'staging-candidate.yml'])
})

test('scripts never touch protected branches, rulesets, tags, releases, migrations or production tooling', () => {
  for (const [name, source] of Object.entries(scripts)) {
    const stripped = source.replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(stripped, /git push|--force|rulesets|branches\/main\/protection|git\/refs|releases|supabase migration|migration repair|railway|vercel|production-release|rollback|DELETE/i, name)
    if (name !== 'dependency-orchestrator-deps.mjs') assert.doesNotMatch(stripped, /child_process|execFileSync|spawnSync|\bspawn\(/, `${name} runs no processes`)
  }
})

test('the merge path is the only caller of the merge endpoint and always passes the exact SHA', () => {
  const deps = scripts['dependency-orchestrator-deps.mjs']
  assert.equal([...deps.matchAll(/pulls\/\$\{number\}\/merge/g)].length, 1)
  assert.match(deps, /'-f', `sha=\$\{sha\}`, '-f', 'merge_method=merge'/)
  const callers = Object.entries(scripts).filter(([name, source]) => name !== 'dependency-orchestrator-deps.mjs' && /\.mergePr\(/.test(source)).map(([name]) => name)
  assert.deepEqual(callers, ['dependency-orchestrator-run.mjs'])
  assert.equal([...scripts['dependency-orchestrator-run.mjs'].matchAll(/\.mergePr\(/g)].length, 1)
})

test('the committed policy is safe by default: paused off, no mutation, prepare-only, no approvals, schedule off', () => {
  const policy = normalizePolicy(policyFile)
  assert.equal(policy.mutation_enabled, false)
  assert.equal(policy.merge.mode, 'prepare-only')
  assert.deepEqual(policy.merge.approvals, [])
  assert.equal(policy.schedule.mode, 'off')
  assert.deepEqual(policy.discovery.authors, ['dependabot[bot]'])
  assert.deepEqual(policy.allowed_paths['github-actions'], ['.github/workflows/'], 'workflow edits are expected for Actions PRs yet remain never-automatic')
  for (const key of Object.keys(HARD_LIMITS)) {
    assert.ok(policy.limits[key] <= HARD_LIMITS[key], `${key} within hard cap`)
    assert.ok(DEFAULT_LIMITS[key] <= HARD_LIMITS[key])
    assert.ok(policy.limits[key] > 0 || key === 'max_claude_usd', `${key} is a positive bound`)
  }
})

test('high-risk categories named by the owner are hard-coded never-automatic, not just configured', () => {
  for (const category of ['billing', 'auth-security', 'database', 'github-actions', 'framework', 'unexpected-files']) assert.equal(NEVER_AUTOMATIC[category], 'any', category)
  for (const category of ['sftp', 'css-framework', 'ai-accounting']) assert.equal(NEVER_AUTOMATIC[category], 'major', category)
  const configured = Object.keys(policyFile.risk.package_categories)
  for (const category of configured) assert.ok(category in NEVER_AUTOMATIC, `${category} is code-enforced`)
  const names = Object.values(policyFile.risk.package_categories).flat()
  for (const required of ['stripe', 'paramiko', 'tailwindcss', 'tailwind-merge', 'next', 'react', '@supabase/ssr', 'cryptography']) assert.ok(names.includes(required), `${required} is categorized`)
})

test('the existing release-engineer auto-merge eligibility policy is untouched and still excludes Dependabot', () => {
  const policy = read('scripts/release-engineer-auto-merge-policy.mjs')
  assert.match(policy, /Cheap identity refusals first: ordinary feature\/Dependabot\/human PRs end here/)
  assert.doesNotMatch(policy, /dependency-orchestrator/)
  assert.doesNotMatch(read('.github/workflows/claude-release-engineer-auto-merge.yml'), /dependency-orchestrator|dependabot/i)
})
