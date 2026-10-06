import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/production-operations-notify.yml')
const workflowCode = code(workflow)
const policy = read('scripts/production-operations-notify.mjs')
const deps = read('scripts/production-operations-notify-deps.mjs')

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

test('Phase 4C/4D notifier triggers only on completed trusted production lifecycle workflows', () => {
  assert.match(workflow, /on:\n {2}workflow_run:\n {4}workflows:\n {6}- Production Release Stabilization\n {6}- Production Rollback\n {6}- Production Incident Re-entry\n {6}- Production Release Audit\n {4}types: \[completed\]/)
  assert.doesNotMatch(workflowCode, /workflow_dispatch|schedule:|cron:|pull_request|push:/)
  assert.match(jobSection(workflow, 'resolve'), /if: github\.event\.workflow_run\.head_repository\.full_name == github\.repository/)
  assert.match(workflow, /SOURCE_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/)
})

test('global notification permissions are read-only and the resolver has zero issue or production write authority', () => {
  const topLevelPermissions = workflow.slice(workflow.indexOf('\npermissions:\n'), workflow.indexOf('\njobs:\n'))
  assert.match(topLevelPermissions, /^\npermissions:\n {2}contents: read\n {2}actions: read\n$/m)
  assert.doesNotMatch(topLevelPermissions, /: write/)
  const resolve = jobSection(workflow, 'resolve')
  assert.match(resolve, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(resolve, /sparse-checkout: scripts/)
  assert.match(resolve, /persist-credentials: false/)
  assert.match(resolve, /node scripts\/production-operations-notify\.mjs resolve/)
  assert.doesNotMatch(resolve, /issues: write|environment: production|secrets\.|create-github-app-token|PATELREP_APP|railway|supabase|psql|gh workflow run|dispatches/i)
})

test('publisher is gated by the read-only decision and receives issues:write as its only write permission', () => {
  const publish = jobSection(workflow, 'publish')
  assert.match(publish, /needs: resolve/)
  assert.match(publish, /if: needs\.resolve\.outputs\.notify == 'true'/)
  assert.match(publish, /permissions:\n {6}contents: read\n {6}actions: read\n {6}issues: write/)
  assert.doesNotMatch(publish, /^\s{6}(contents|actions|pull-requests|checks|deployments|environments|statuses|id-token): write$/m)
  assert.match(publish, /ref: \$\{\{ needs\.resolve\.outputs\.trusted_control_plane_sha \}\}/)
  assert.match(publish, /persist-credentials: false/)
  assert.match(publish, /EXPECTED_INTENT_DIGEST: \$\{\{ needs\.resolve\.outputs\.intent_digest \}\}/)
  assert.match(publish, /node scripts\/production-operations-notify\.mjs publish/)
  assert.doesNotMatch(publish, /environment: production|secrets\.|create-github-app-token|PATELREP_APP|railway|supabase|psql|gh workflow run|dispatches|git push|gh release create|gh pr merge/i)
})

test('notification publishing is serialized without cancelling and retains sanitized result evidence', () => {
  assert.match(workflow, /concurrency:\n {2}group: production-operations-notifications\n {2}cancel-in-progress: false/)
  const publish = jobSection(workflow, 'publish')
  assert.match(publish, /name: production-operations-notification/)
  assert.match(publish, /retention-days: 90/)
  assert.match(publish, /if-no-files-found: error/)
  assert.match(policy, /patelrep\.production-operations-notification\.v1/)
  assert.match(policy, /deduplicated/)
  assert.match(policy, /intent changed between resolve and publish/)
})

test('Phase 4C issue mutation dependency is constrained to create comment and state transitions only', () => {
  const executable = deps.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
  assert.match(executable, /repos\/\$\{repo\}\/issues/)
  assert.match(executable, /writeApi\('POST'.*issues/)
  assert.match(executable, /writeApi\('POST'.*comments/)
  assert.match(executable, /writeApi\('PATCH'.*issues/)
  assert.doesNotMatch(executable, /workflows\/.+dispatches|gh workflow run|git push|pulls\/.+merge|releases|refs\/tags|variables|secrets|railway|supabase|psql/i)
  assert.doesNotMatch(policy, /create-github-app-token|PATELREP_APP|RAILWAY_API_TOKEN|PRODUCTION_SUPABASE_DB_URL|supabase migration|railway\/cli|psql|gh workflow run|git push/i)
})

test('normal stable releases are explicitly no-op to prevent alert fatigue', () => {
  assert.match(policy, /result\.classification === 'stable' \|\| result\.classification === 'transient_unconfirmed'/)
  assert.match(policy, /operation: 'none'/)
  assert.match(policy, /release_attention/)
  assert.match(policy, /incident_opened/)
  assert.match(policy, /automated_rollback_restored/)
  assert.match(policy, /reentry_authorized/)
  assert.match(policy, /incident_closed/)
  assert.match(policy, /audit_inconsistent/)
  assert.match(policy, /audit_recovered/)
  assert.match(policy, /close_existing/)
})

test('no other workflow gains Issues write through Phase 4C changes', () => {
  for (const file of readdirSync('.github/workflows')) {
    if (file === 'production-operations-notify.yml') continue
    const source = read(`.github/workflows/${file}`)
    // Existing product workflows may legitimately use issues in the future; this assertion is intentionally
    // limited to the exact Phase 4C production-notification permission block.
    assert.doesNotMatch(source, /group: production-operations-notifications/)
  }
  assert.equal((workflow.match(/issues: write/g) ?? []).length, 1)
})

test('Phase 4C control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/production-operations-notify.yml',
    'scripts/production-operations-notify.mjs',
    'scripts/production-operations-notify-deps.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Release Workflow Contract permanently runs both Phase 4C tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = jobSection(ci, 'release-workflow-contract')
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-operations-notify.test.mjs',
    'scripts/production-operations-notify-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
  assert.equal(new Set(files).size, files.length, 'no duplicate Release Workflow Contract tests')
})
