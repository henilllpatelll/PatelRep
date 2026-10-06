import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/production-incident-reentry.yml')
const release = read('.github/workflows/production-release.yml')
const stabilization = read('.github/workflows/production-release-stabilization.yml')
const policy = read('scripts/production-incident-reentry.mjs')
const deps = read('scripts/production-incident-reentry-deps.mjs')

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

test('Production Incident Re-entry is manual-only and authorizes exact rollback SHA and version bump', () => {
  assert.match(workflow, /on:\n {2}workflow_dispatch:/)
  assert.match(workflow, /rollback_run_id:\n {8}description:[^\n]*\n {8}required: true/)
  assert.match(workflow, /release_sha:\n {8}description:[^\n]*\n {8}required: true/)
  assert.match(workflow, /version_bump:\n {8}description:[^\n]*\n {8}required: true\n {8}type: choice\n {8}default: patch\n {8}options: \[patch, minor, major\]/)
  assert.doesNotMatch(code(workflow), /workflow_run|schedule:|cron:|pull_request|push:/)
})

test('re-entry workflow is evidence-only with no production authority or dispatch', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n {2}checks: read\n {2}pull-requests: read\n/m)
  assert.doesNotMatch(workflow, /^\s+(contents|actions|checks|pull-requests|deployments|environments|issues|statuses|id-token): write$/m)
  assert.doesNotMatch(code(workflow), /environment: production|secrets\.|RAILWAY|SUPABASE|psql|create-github-app-token|PATELREP_APP|gh workflow run|dispatches|git push|gh release create|gh pr merge/i)
  const job = jobSection(workflow, 'authorize')
  assert.match(job, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(job, /persist-credentials: false/)
  assert.match(job, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(job, /node scripts\/production-incident-reentry\.mjs authorize/)
  assert.match(job, /name: production-incident-reentry/)
  assert.match(job, /retention-days: 90/)
  assert.match(job, /if-no-files-found: error/)
})

test('re-entry policy/dependencies remain read-only and reuse the Phase 3D quarantine proof', () => {
  for (const [name, source] of [['policy', policy], ['deps', deps]]) {
    const executable = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
    assert.doesNotMatch(executable, /'--method'|--method|-X ['"]?(PUT|POST|PATCH|DELETE)|workflow run|dispatches|createWorkflowDispatch|git push|gh variable|gh secret|gh release create|gh pr merge|railway\/cli|supabase\/setup-cli|psql/i, name)
  }
  assert.match(policy, /verifyAutoRollbackCircuitBreaker/)
  assert.match(policy, /automatic Production Release requests cannot re-enter/)
  assert.match(policy, /failed production candidate cannot authorize itself/)
  assert.match(policy, /main moved after re-entry authorization/)
  assert.match(deps, /read-only/i)
})

test('Production Release verifies re-entry before any production Environment job', () => {
  assert.match(release, /reentry_source_run_id:\n {8}description:[^\n]*\n {8}required: false\n {8}type: string/)
  const preflight = jobSection(release, 'verify-production-reentry')
  assert.match(preflight, /permissions:\n {6}contents: read\n {6}actions: read\n {6}checks: read\n {6}pull-requests: read/)
  assert.match(preflight, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(preflight, /persist-credentials: false/)
  assert.match(preflight, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(preflight, /node scripts\/production-incident-reentry\.mjs release/)
  assert.doesNotMatch(preflight, /environment: production|secrets\.|RAILWAY|SUPABASE|psql|create-github-app-token|gh workflow run/i)

  const resolve = jobSection(release, 'resolve-and-verify-eligibility')
  assert.match(resolve, /needs: verify-production-reentry/)
  assert.match(resolve, /environment: production/)
  assert.ok(release.indexOf('verify-production-reentry:') < release.indexOf('resolve-and-verify-eligibility:'))
})

test('release evidence records the re-entry authorization and exact rollback it closes', () => {
  const ledger = jobSection(release, 'production-release-evidence')
  assert.ok(ledger.includes('- verify-production-reentry'))
  assert.match(ledger, /REENTRY_SOURCE_RUN_ID: \$\{\{ inputs\.reentry_source_run_id \}\}/)
  assert.match(ledger, /REENTRY_ROLLBACK_RUN_ID: \$\{\{ needs\.verify-production-reentry\.outputs\.rollback_run_id \}\}/)
  assert.match(ledger, /REENTRY_PREFLIGHT_RESULT: \$\{\{ needs\.verify-production-reentry\.result \}\}/)
})

test('stabilization emits closeout evidence only after a non-incident authorized re-entry', () => {
  const job = jobSection(stabilization, 'classify')
  assert.match(job, /CLOSEOUT_DIR: \$\{\{ runner\.temp \}\}\/production-incident-closeout/)
  const upload = job.slice(job.indexOf('Upload successful incident closeout'))
  assert.match(upload, /if: steps\.classify\.outputs\.closeout == 'true'/)
  assert.match(upload, /name: production-incident-closeout/)
  assert.match(upload, /retention-days: 90/)
  assert.match(policy, /production-incident-closeout/)
})

test('Phase 4B control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/production-incident-reentry.yml',
    '.github/workflows/production-release.yml',
    '.github/workflows/production-release-stabilization.yml',
    'scripts/production-incident-reentry.mjs',
    'scripts/production-incident-reentry-deps.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Release Workflow Contract permanently runs both Phase 4B tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = jobSection(ci, 'release-workflow-contract')
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-incident-reentry.test.mjs',
    'scripts/production-incident-reentry-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
})
