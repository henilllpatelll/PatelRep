import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/production-release-audit.yml')
const workflowCode = code(workflow)
const script = read('scripts/production-release-audit.mjs')
const deps = read('scripts/production-release-audit-deps.mjs')

test('Phase 4D audit runs on main pushes, every six hours, and manual dispatch only', () => {
  assert.match(workflow, /on:\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n {4}- cron: '17 \*\/6 \* \* \*'\n {2}workflow_dispatch:/)
  assert.doesNotMatch(workflowCode, /pull_request|pull_request_target/)
})

test('audit has read-only repository permissions and no production authority', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n/m)
  assert.doesNotMatch(workflow, /^\s+(contents|actions|issues|pull-requests|checks|deployments|environments|statuses|id-token): write$/m)
  assert.doesNotMatch(workflowCode, /environment: production|secrets\.|create-github-app-token|PATELREP_APP|railway|supabase|psql|gh workflow run|dispatches|git push|gh release create|gh pr merge/i)
  assert.doesNotMatch(script, /railway\/cli|supabase\/setup-cli|supabase migration|psql|git push|gh workflow run|create-github-app-token/i)
})

test('audit executes exact trusted main SHA and uses a separate non-cancelling concurrency group', () => {
  assert.match(workflow, /group: production-release-audit/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /group: production-deploy/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /sparse-checkout: scripts/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
})

test('audit artifact is uploaded before any inconsistent-state failure', () => {
  const uploadIndex = workflow.indexOf('Upload production release audit evidence')
  const failIndex = workflow.indexOf('Fail on inconsistent production release state')
  assert.ok(uploadIndex > 0 && failIndex > uploadIndex)
  assert.match(workflow, /name: production-release-audit/)
  assert.match(workflow, /retention-days: 90/)
  assert.match(workflow, /if-no-files-found: error/)
  assert.match(workflow, /if: steps\.audit\.outputs\.consistent != 'true'/)
})

test('audit reuses canonical baseline, Phase 4B open-incident detection, and Phase 3D quarantine proof', () => {
  assert.match(script, /resolveProductionBaseline/)
  assert.match(script, /findLatestOpenAutomatedRollback/)
  assert.match(script, /verifyAutoRollbackCircuitBreaker/)
  assert.match(script, /runtime_managed_release_mismatch/)
  assert.match(script, /unmanaged_release_tag_conflict/)
  assert.match(script, /quarantined_post_release_regression/)
  assert.match(script, /quarantined_partial_release_failure/)
  assert.match(script, /deferred_active_production_operation/)
  assert.match(script, /patelrep\.production-release-audit\.v1/)
  assert.match(deps, /read-only production release audit dependencies/i)
})

test('audit distinguishes re-entry required, current authorization, and stale-main authorization', () => {
  assert.match(script, /state: 'required'/)
  assert.match(script, /authorized_current_main/)
  assert.match(script, /authorization_stale_main/)
  assert.match(script, /validateReentryAuthorizationRun/)
  assert.match(script, /validateReentryAuthorization/)
})

test('Phase 4D control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/production-release-audit.yml',
    'scripts/production-release-audit.mjs',
    'scripts/production-release-audit-deps.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Release Workflow Contract permanently runs both Phase 4D tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  release-workflow-contract:\n')
  assert.ok(start >= 0)
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/)
  const job = next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next)
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-release-audit.test.mjs',
    'scripts/production-release-audit-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
})
