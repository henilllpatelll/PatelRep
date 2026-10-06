import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/production-release-stabilization.yml')
const workflowCode = code(workflow)
const script = read('scripts/production-release-stabilization.mjs')

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

test('Phase 3B triggers only on completed Production Release runs', () => {
  assert.match(workflow, /on:\n {2}workflow_run:\n {4}workflows:\n {6}- Production Release\n {4}types: \[completed\]\n/)
  assert.doesNotMatch(workflowCode, /workflow_dispatch|schedule:|cron:|pull_request|push:/)
  const job = jobSection(workflow, 'classify')
  assert.match(job, /if: github\.event\.workflow_run\.head_repository\.full_name == github\.repository/)
  assert.match(job, /SOURCE_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/)
})

test('Phase 3B is read-only and has no production authority', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n/m)
  assert.doesNotMatch(workflowCode, /^\s+(contents|actions|checks|deployments|environments|issues|pull-requests|statuses|id-token): write$/m)
  assert.doesNotMatch(workflowCode, /environment: production|secrets\.|create-github-app-token|PATELREP_APP|SUPABASE|RAILWAY|psql|feature-rollout/i)
  assert.doesNotMatch(workflowCode, /gh workflow run|workflows\/production-rollback\.yml\/dispatches|production-rollback\.yml.*dispatch/i)
  assert.doesNotMatch(workflowCode, /git push|gh release create|gh pr merge|--method ['"]?(POST|PUT|PATCH|DELETE)/i)
})

test('the classifier executes trusted main control-plane code, never candidate code', () => {
  const job = jobSection(workflow, 'classify')
  assert.match(job, /ref: main/)
  assert.match(job, /sparse-checkout: scripts/)
  assert.match(job, /persist-credentials: false/)
  assert.match(job, /git rev-parse HEAD/)
  assert.match(job, /TRUSTED_CONTROL_PLANE_SHA: \$\{\{ steps\.trusted\.outputs\.sha \}\}/)
  assert.doesNotMatch(job, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/)
  assert.doesNotMatch(job, /ref: \$\{\{.*release_sha/)
  assert.match(job, /node scripts\/production-release-stabilization\.mjs/)
})

test('stabilization result is always retained and incident artifact exists only for confirmed incidents', () => {
  const job = jobSection(workflow, 'classify')
  assert.match(job, /name: production-release-stabilization/)
  assert.match(job, /retention-days: 90/)
  assert.match(job, /if-no-files-found: error/)
  const incidentUpload = job.slice(job.indexOf('Upload confirmed production incident'))
  assert.match(incidentUpload, /if: steps\.classify\.outputs\.incident == 'true'/)
  assert.match(incidentUpload, /name: production-release-incident/)
  assert.match(incidentUpload, /retention-days: 90/)
})

test('classifier policy requires repeated exact-release probe failures and stores no remote error text in the incident handoff', () => {
  assert.match(script, /CONSECUTIVE_FAILURES_REQUIRED = 2/)
  assert.match(script, /STABILIZATION_ATTEMPTS = 3/)
  assert.match(script, /INITIAL_DELAY_MS = 30_000/)
  assert.match(script, /BETWEEN_PROBES_MS = 60_000/)
  assert.match(script, /runPublicSmoke\(/)
  assert.match(script, /expectedReleaseSha: releaseSha/)
  assert.match(script, /expectedReleaseVersion: releaseVersion/)
  assert.match(script, /outcome: 'transient_unconfirmed'/)
  assert.match(script, /outcome: 'post_release_regression'/)
  assert.doesNotMatch(script, /error_message|errorText|probe_error/)
})

test('partial releases require a runtime mutation and failed final verification; bookkeeping-only failures are not rollback incidents', () => {
  assert.match(script, /validated\.production_verified/)
  assert.match(script, /release_record_failure_no_runtime_incident/)
  assert.match(script, /verified_applied/)
  assert.match(script, /unknown_after_attempt/)
  assert.match(script, /partial_release_failure/)
  assert.match(script, /pre_production_failure_no_incident/)
})

test('required Release Workflow Contract runs both Phase 3B test files', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = jobSection(ci, 'release-workflow-contract')
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-release-stabilization.test.mjs',
    'scripts/production-release-stabilization-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
  assert.equal(new Set(files).size, files.length, 'no duplicate tests')
  assert.doesNotMatch(job, /continue-on-error|\n\s+if:/)
})
