import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/release-resilience-drill.yml')
const workflowCode = code(workflow)
const drill = read('scripts/release-resilience-drill.mjs')

test('Phase 5A drill is weekly/manual only and pinned to trusted main', () => {
  assert.match(workflow, /on:\n {2}schedule:\n {4}- cron: '43 10 \* \* 1'\n {2}workflow_dispatch:/)
  assert.doesNotMatch(workflowCode, /pull_request|pull_request_target|push:/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
})

test('Phase 5A drill has no production or GitHub write authority', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m)
  assert.doesNotMatch(workflow, /^\s+(contents|actions|issues|pull-requests|checks|deployments|environments|statuses|id-token): write$/m)
  assert.doesNotMatch(workflowCode, /environment: production|secrets\.|create-github-app-token|PATELREP_APP|RAILWAY|SUPABASE|psql|gh workflow run|dispatches|git push|gh release create|gh pr merge/i)
  assert.doesNotMatch(drill, /execFile|spawn|fetch\(|axios|https:\/\/|railway\/cli|supabase\/setup-cli|supabase migration|psql|git push|gh workflow run|create-github-app-token/i)
  assert.match(drill, /synthetic_only: true/)
  assert.match(drill, /authority_added: false/)
})

test('drill always uploads sanitized evidence before propagating scenario failure', () => {
  const runIndex = workflow.indexOf('Exercise synthetic failure scenarios')
  const uploadIndex = workflow.indexOf('Upload resilience drill evidence')
  const failIndex = workflow.indexOf('Fail if any resilience scenario failed')
  assert.ok(runIndex >= 0 && uploadIndex > runIndex && failIndex > uploadIndex)
  assert.match(workflow, /set \+e/)
  assert.match(workflow, /echo "exit_code=\$code" >> "\$GITHUB_OUTPUT"/)
  assert.match(workflow, /name: release-resilience-drill/)
  assert.match(workflow, /retention-days: 90/)
  assert.match(workflow, /if-no-files-found: error/)
  assert.doesNotMatch(workflow, /continue-on-error:/)
})

test('drill composes the real Phase 3/4 policy functions rather than duplicate logic', () => {
  for (const token of [
    'classifyProductionRelease',
    'evaluateAutoRollbackRequest',
    'verifyAutoRollbackCircuitBreaker',
    'authorizeProductionIncidentReentry',
    'verifyProductionReleaseReentry',
    'auditProductionReleaseState',
    'buildNotificationIntent',
  ]) assert.match(drill, new RegExp(token))
  assert.match(drill, /post_release_regression_full_cycle/)
  assert.match(drill, /database_change_blocks_auto_rollback/)
  assert.match(drill, /partial_release_quarantine/)
  assert.match(drill, /runtime_drift_is_detected_and_notified/)
  assert.match(drill, /stale_reentry_authorization_is_refused/)
  assert.match(drill, /active_production_operation_defers_audit/)
})

test('Phase 5A control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/release-resilience-drill.yml',
    'scripts/release-resilience-drill.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Release Workflow Contract permanently runs both Phase 5A tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  release-workflow-contract:\n')
  assert.ok(start >= 0)
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/)
  const job = next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next)
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/release-resilience-drill.test.mjs',
    'scripts/release-resilience-drill-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
})
