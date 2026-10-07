import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const executable = (source) => source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
const workflow = read('.github/workflows/production-readiness-certification.yml')
const workflowCode = code(workflow)
const script = read('scripts/production-readiness-certification.mjs')
const deps = read('scripts/production-readiness-certification-deps.mjs')

const MUTATING = /--method|-X\s*(POST|PUT|PATCH|DELETE)|execFileSync\('git'|gh\s+workflow\s+run|gh\s+run\s+(cancel|rerun)|\/cancel|\/rerun|\/dispatches|\/approve|git push|gh release|gh pr merge|create-github-app-token|railway|supabase|psql|\.merge\(|process\.env\.(RAILWAY|SUPABASE|PRODUCTION)/i

test('certification is an explicit workflow_dispatch attestation: never on push, schedule, or any other trigger', () => {
  assert.match(workflow, /^name: Production Readiness Certification$/m)
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n\nconcurrency:/m)
  assert.doesNotMatch(workflowCode, /^\s+(push|schedule|pull_request|pull_request_target|workflow_run|repository_dispatch|workflow_call):/m)
  assert.doesNotMatch(workflowCode, /cron:/)
  assert.doesNotMatch(workflow, /inputs\./, 'no operator-controlled input can change policy or target')
})

test('certification has read-only permissions and zero production, secret, write, or dispatch authority', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n\njobs:/m)
  assert.equal((workflow.match(/^\s*permissions:/gm) ?? []).length, 1, 'no job-level permission escalation')
  assert.doesNotMatch(workflow, /^\s+[a-z-]+: write$/m)
  assert.doesNotMatch(workflowCode, /environment:|secrets\.|vars\.|PATELREP_APP|id-token|issues:|checks:|statuses:|deployments:/i)
  assert.doesNotMatch(workflowCode, MUTATING)
  assert.doesNotMatch(executable(script), MUTATING)
  assert.doesNotMatch(executable(deps), MUTATING)
  assert.match(deps, /Every call is a GET/)
  assert.doesNotMatch(read('scripts/production-readiness-certification.mjs').split('\n').filter((line) => /^import /.test(line)).join('\n'), /production-release\.|rollback|reentry|dispatch|publish|notify/i, 'imports no mutating module')
})

test('certification executes the exact trusted main SHA under its own non-cancelling concurrency group with a 15 minute timeout', () => {
  assert.match(workflow, /concurrency:\n {2}group: production-readiness-certification\n {2}cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /group: production-deploy|group: production-automation-watchdog/)
  assert.match(workflow, /timeout-minutes: 15/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /sparse-checkout: scripts/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /CONTROL_PLANE_SHA: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/)
})

test('evidence is uploaded with always() for 90 days BEFORE the not-certified failure step', () => {
  const upload = workflow.indexOf('Upload production readiness certification evidence')
  const fail = workflow.indexOf('Fail when production is not certified')
  assert.ok(upload > 0 && fail > upload, 'upload precedes failure propagation')
  assert.match(workflow, /name: Upload production readiness certification evidence\n {8}if: always\(\)/)
  assert.match(workflow, /name: production-readiness-certification/)
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/production-readiness-certification\/context\.json/)
  assert.match(workflow, /retention-days: 90/)
  assert.match(workflow, /if-no-files-found: error/)
  assert.match(workflow, /if: steps\.certify\.outputs\.certified != 'true'/)
  assert.match(script, /certified=\$\{result\.certified \? 'true' : 'false'\}/)
  assert.match(script, /export const CERT_SCHEMA = 'patelrep\.production-readiness-certification\.v1'/)
})

test('freshness windows and the scenario set are fixed in code, not configurable', () => {
  assert.match(script, /deploy_health_minutes: 45/)
  assert.match(script, /release_audit_minutes: 7 \* 60/)
  assert.match(script, /recovery_readiness_minutes: 26 \* 60/)
  assert.match(script, /resilience_drill_minutes: 8 \* 24 \* 60/)
  assert.match(script, /watchdog_minutes: 30/)
  assert.doesNotMatch(executable(script), /process\.env\.(?!REPO|GH_TOKEN|RUN_ID|RUN_ATTEMPT|CONTROL_PLANE_SHA|RESULT_DIR|GITHUB_OUTPUT)/)
  assert.match(script, /main_moved_during_certification/)
})

test('Phase 5D never uses run.name, display titles, workflow names, or Issue contents as identity', () => {
  for (const [label, source] of [['script', script], ['deps', deps], ['workflow', workflowCode]]) {
    assert.doesNotMatch(executable(source), /display_title|displayTitle|run-name|\brun\.name\b|startsWith\(|issues\/|listIssues|getIssue|\.body\b/, `${label} must not read display names or Issue contents`)
  }
  assert.doesNotMatch(executable(deps), /name: *\.name|\.name,|run_name|workflow_name/)
  assert.match(script, /run\.path !== workflowPath/)
  assert.match(script, /_run_path_mismatch/)
  assert.match(script, /_run_repository_mismatch/)
})

test('artifact lookup stays artifact-first and bounded; run-only evidence uses the resolved workflow id and unfiltered pages', () => {
  const d = executable(deps)
  assert.match(d, /actions\/artifacts\?name=\$\{name\}&per_page=\$\{ARTIFACTS_PER_PAGE\}/)
  assert.doesNotMatch(d, /--paginate/, 'no unbounded history enumeration')
  assert.doesNotMatch(d, /status=|branch=|actions\/runs\?|workflows\/\$\{file\}|workflows\/[a-z-]+\.yml\/runs/, 'no stale-prone filtered listings')
  assert.match(d, /realProductionAutomationWatchdogDeps/)
  assert.match(script, /artifact_candidate_limit: 10/)
  assert.match(script, /deps\.listWorkflowRuns\(workflowId, \{ recent: true \}\)/)
  assert.doesNotMatch(executable(script), /listWorkflowRuns\([^)]*(status|branch)/)
})

test('provenance proves exact main identity, GitHub PR association and exact tree equality, never ancestry or message parsing', () => {
  const s = executable(script)
  assert.match(s, /deps\.listPullsForCommit\(sha\)/)
  assert.match(s, /candidateCommit\.tree !== mainCommit\.tree/)
  assert.match(s, /candidate_tree_mismatch/)
  assert.doesNotMatch(s, /isAncestor|compare\/|commit\??\.message|git log|changed_files|listPrFiles/)
  const proveMain = s.match(/await proveMainIdentity\(controlPlaneSha, deps\)/g) ?? []
  assert.equal(proveMain.length, 2, 'main is proven at the start and again immediately before finalizing')
})

test('there is no deployment, rollback, dispatch, cancel, rerun, tag, release, approval or merge path', () => {
  for (const [label, source] of [['script', executable(script)], ['deps', executable(deps)], ['workflow', workflowCode]]) {
    assert.doesNotMatch(source, MUTATING, label)
    assert.doesNotMatch(source, /createRelease|createTag|git\/refs|releases\b.*POST|deployments|workflow_dispatch\(/i, label)
  }
  assert.equal((workflow.match(/\bgh\b/g) ?? []).length, 0, 'workflow itself runs no gh command')
  const names = Object.keys(JSON.parse(JSON.stringify(Object.fromEntries([...deps.matchAll(/^ {4}(\w+):/gm)].map((match) => [match[1], 1])))))
  for (const name of names) assert.doesNotMatch(name, /^(create|update|delete|put|post|patch|merge|dispatch|cancel|rerun|approve|tag|release|publish)/i, `dependency ${name} must be read-only`)
})

test('no other workflow gains a trigger or permission from certification, and none consumes it as authority', () => {
  for (const file of readdirSync('.github/workflows')) {
    if (file === 'production-readiness-certification.yml') continue
    // ci.yml may only REGISTER the certification's own test files in the Release Workflow Contract.
    const other = read(`.github/workflows/${file}`).replaceAll(/scripts\/production-readiness-certification(-workflow)?\.test\.mjs/g, '')
    assert.doesNotMatch(other, /production-readiness-certification/, `${file} must not depend on certification`)
  }
  for (const file of readdirSync('scripts').filter((name) => name.endsWith('.mjs') && !name.includes('readiness-certification'))) {
    assert.doesNotMatch(read(`scripts/${file}`), /production-readiness-certification/, `${file} must not consume certification as authority`)
  }
})

test('Phase 5D control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/production-readiness-certification.yml',
    'scripts/production-readiness-certification.mjs',
    'scripts/production-readiness-certification-deps.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Release Workflow Contract permanently runs all Phase 5D tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  release-workflow-contract:\n')
  assert.ok(start >= 0)
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/)
  const job = next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next)
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-readiness-certification.test.mjs',
    'scripts/production-readiness-certification-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
  assert.equal(new Set(files).size, files.length, 'no duplicate Release Workflow Contract tests')
})

test('there is no staging-context expiry fallback and certification limitations are an explicit closed set', () => {
  const s = executable(script)
  assert.doesNotMatch(s, /staging_context_artifact_expired|staging_gate_check_summary|staging_context_retention|STAGING_EXPIRED/)
  assert.match(s, /export function finalSuccessState/)
  assert.match(s, /unsupported_limitations/)
  assert.match(s, /result\.state = finalSuccessState\(result\.limitations\)/)
})
