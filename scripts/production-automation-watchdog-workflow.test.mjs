import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/production-automation-watchdog.yml')
const workflowCode = code(workflow)
const script = read('scripts/production-automation-watchdog.mjs')
const deps = read('scripts/production-automation-watchdog-deps.mjs')
const notify = read('scripts/production-operations-notify.mjs')
const notifyWorkflow = read('.github/workflows/production-operations-notify.yml')
const executable = (source) => source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')

test('watchdog runs on main pushes, every 15 minutes offset from Deploy Health Check, and manual dispatch only', () => {
  assert.match(workflow, /^name: Production Automation Watchdog$/m)
  assert.match(workflow, /on:\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n {4}- cron: '7,22,37,52 \* \* \* \*'\n {2}workflow_dispatch:/)
  assert.doesNotMatch(workflowCode, /pull_request|pull_request_target|workflow_run/)
})

test('watchdog has read-only permissions and zero production, secret, write, or dispatch authority', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n/m)
  assert.equal((workflow.match(/^\s*permissions:/gm) ?? []).length, 1, 'no job-level permission escalation')
  assert.doesNotMatch(workflow, /^\s+[a-z-]+: write$/m)
  assert.doesNotMatch(workflowCode, /environment:|secrets\.|create-github-app-token|PATELREP_APP|vars\.|railway|supabase|psql|gh workflow run|gh run (cancel|rerun)|\/dispatches|\/cancel|\/rerun|\/approve|git push|gh release|gh pr merge|id-token/i)
  const mutating = /--method|-X\s*(POST|PUT|PATCH|DELETE)|execFileSync\('git'|ghs+workflows+run|ghs+runs+(cancel|rerun)|\/cancel|\/rerun|\/dispatches|\/approve|git push|create-github-app-token|railway|supabase|psql|process\.env\.(RAILWAY|SUPABASE|PRODUCTION)/i
  assert.doesNotMatch(executable(script), mutating)
  assert.doesNotMatch(executable(deps), mutating)
  assert.match(deps, /Every call is a GET/)
})

test('watchdog executes the exact trusted main SHA with its own non-cancelling concurrency group', () => {
  assert.match(workflow, /concurrency:\n {2}group: production-automation-watchdog\n {2}cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /group: production-deploy/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /sparse-checkout: scripts/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /CONTROL_PLANE_SHA: \$\{\{ github\.sha \}\}/)
})

test('evidence is uploaded with always() before the unhealthy failure step', () => {
  const upload = workflow.indexOf('Upload production automation watchdog evidence')
  const fail = workflow.indexOf('Fail on unhealthy production automation')
  assert.ok(upload > 0 && fail > upload)
  assert.match(workflow, /name: Upload production automation watchdog evidence\n {8}if: always\(\)/)
  assert.match(workflow, /name: production-automation-watchdog/)
  assert.match(workflow, /retention-days: 90/)
  assert.match(workflow, /if-no-files-found: error/)
  assert.match(workflow, /if: steps\.watchdog\.outputs\.healthy != 'true'/)
  assert.match(workflow, /printf -- '- State: `%s`\\n'/)
})

test('policy constants are fixed in code, not configurable from workflow input or env', () => {
  assert.match(script, /production_in_progress_minutes: 45/)
  assert.match(script, /production_waiting_minutes: 30/)
  assert.match(script, /control_plane_active_minutes: 20/)
  assert.match(script, /deploy_health: 45/)
  assert.match(script, /release_audit: 7 \* 60/)
  assert.match(script, /recovery_readiness: 26 \* 60/)
  assert.match(script, /resilience_drill: 8 \* 24 \* 60/)
  assert.doesNotMatch(workflow, /inputs\./)
  assert.doesNotMatch(executable(script), /process\.env\.(?!REPO|GH_TOKEN|RUN_ID|RUN_ATTEMPT|CONTROL_PLANE_SHA|RESULT_DIR|GITHUB_OUTPUT)/)
})

test('Phase 5C never uses run.name, display titles, or title prefixes as identity', () => {
  for (const [label, source] of [['script', script], ['deps', deps], ['workflow', workflowCode]]) {
    assert.doesNotMatch(executable(source), /\.name\b|display_title|displayTitle|run-name|startsWith\(|\.includes\(['"`]Production/, `${label} must not read display names`)
  }
  assert.doesNotMatch(executable(deps), /\bname,|,name\b|display_title/)
  assert.match(script, /run\.path !== workflowPath/)
  const watchdogNotify = notify.slice(notify.indexOf('function validateWatchdogResult'), notify.indexOf('async function incidentIdFromRollbackRun'))
  assert.ok(watchdogNotify.length > 500)
  assert.doesNotMatch(watchdogNotify, /\.name\b|display_title|displayTitle/)
  assert.match(notify, /\[WATCHDOG_WORKFLOW_PATH\]: \{\n {4}workflow: WATCHDOG_WORKFLOW_NAME/)
})

test('notifier adds the watchdog trigger without adding another issues:write or any new write path', () => {
  assert.match(notifyWorkflow, /- Production Release Audit\n {6}- Production Automation Watchdog\n {4}types: \[completed\]/)
  assert.equal((notifyWorkflow.match(/issues: write/g) ?? []).length, 1)
  const publish = notifyWorkflow.slice(notifyWorkflow.indexOf('\n  publish:\n'))
  assert.match(publish, /permissions:\n {6}contents: read\n {6}actions: read\n {6}issues: write\n/)
  assert.doesNotMatch(publish, /^\s{6}(contents|actions|pull-requests|checks|deployments|environments|statuses|id-token): write$/m)
  for (const file of readdirSync('.github/workflows')) {
    if (file === 'production-operations-notify.yml') continue
    assert.doesNotMatch(read(`.github/workflows/${file}`), /issues: write|group: production-operations-notifications/, `${file} must not gain Issue write`)
  }
  assert.match(notify, /watchdog:production-automation|WATCHDOG_NOTIFICATION_KEY/)
  assert.match(notify, /Condition-based thread/)
})

test('notification history lookup is artifact-first and never enumerates every notify workflow run', () => {
  const notifyDeps = read('scripts/production-operations-notify-deps.mjs')
  assert.doesNotMatch(executable(notify), /listNotificationRuns/)
  assert.doesNotMatch(executable(notifyDeps), /listNotificationRuns|workflows\/production-operations-notify\.yml\/runs/)
  assert.match(executable(notifyDeps), /actions\/artifacts\?name=\$\{NOTIFICATION_ARTIFACT\}/)
  assert.match(notify, /NOTIFICATION_RETENTION_MS = 90/)
  assert.match(notify, /await deps\.getRun\(candidate\.runId\)/)
  assert.doesNotMatch(executable(notifyDeps), /writeApi\('(PUT|DELETE)'|actions\/artifacts\/[^`]*method/)
})

test('Phase 5C control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/production-automation-watchdog.yml',
    'scripts/production-automation-watchdog.mjs',
    'scripts/production-automation-watchdog-deps.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Release Workflow Contract permanently runs all Phase 5C tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  release-workflow-contract:\n')
  assert.ok(start >= 0)
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/)
  const job = next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next)
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-automation-watchdog.test.mjs',
    'scripts/production-automation-watchdog-notify.test.mjs',
    'scripts/production-automation-watchdog-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
  assert.equal(new Set(files).size, files.length, 'no duplicate Release Workflow Contract tests')
})
