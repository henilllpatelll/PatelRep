import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const closeout = read('.github/workflows/production-incident-closeout.yml')
const release = read('.github/workflows/production-release.yml')
const request = read('.github/workflows/claude-release-engineer-production-request.yml')
const policy = read('scripts/production-incident-closeout.mjs')
const deps = read('scripts/production-incident-closeout-deps.mjs')

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

test('Production Incident Closeout is manual owner-decision surface only and read-only', () => {
  assert.match(closeout, /^name: Production Incident Closeout/m)
  assert.match(closeout, /on:\n {2}workflow_dispatch:/)
  assert.match(closeout, /rollback_run_id:/)
  assert.match(closeout, /reentry_sha:/)
  assert.doesNotMatch(code(closeout), /workflow_run:|push:|pull_request:|schedule:|cron:/)
  assert.match(closeout, /^permissions:\n {2}contents: read\n {2}actions: read\n {2}checks: read/m)
  assert.doesNotMatch(closeout, /^\s+(contents|actions|checks|pull-requests|issues|deployments|id-token): write$/m)

  const job = jobSection(closeout, 'closeout')
  assert.match(job, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(job, /sparse-checkout: scripts/)
  assert.match(job, /persist-credentials: false/)
  assert.match(job, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(job, /REPOSITORY_OWNER: \$\{\{ github\.repository_owner \}\}/)
  assert.match(job, /ACTOR: \$\{\{ github\.actor \}\}/)
  assert.match(job, /node scripts\/production-incident-closeout\.mjs closeout/)
  assert.match(job, /name: production-incident-closeout/)
  assert.match(job, /retention-days: 90/)
  assert.match(job, /if-no-files-found: error/)
  assert.doesNotMatch(job, /environment: production|secrets\.|RAILWAY|SUPABASE|psql|gh workflow run|create-github-app-token|git push|gh release/i)
})

test('Production Release re-entry gate executes before any production Environment job', () => {
  assert.match(release, /incident_closeout_run_id:\n {8}description:[^\n]*\n {8}required: false\n {8}type: string/)
  const gate = jobSection(release, 'verify-incident-reentry')
  assert.match(gate, /permissions:\n {6}contents: read\n {6}actions: read/)
  assert.match(gate, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(gate, /persist-credentials: false/)
  assert.match(gate, /node scripts\/production-incident-closeout\.mjs release/)
  assert.match(gate, /INCIDENT_CLOSEOUT_RUN_ID: \$\{\{ inputs\.incident_closeout_run_id \}\}/)
  assert.match(gate, /AUTOMATION_SOURCE_RUN_ID: \$\{\{ inputs\.automation_source_run_id \}\}/)
  assert.doesNotMatch(gate, /environment: production|secrets\.|RAILWAY|SUPABASE|psql|create-github-app-token|git push|gh release/)

  const resolve = jobSection(release, 'resolve-and-verify-eligibility')
  assert.match(resolve, /needs: verify-incident-reentry/)
  assert.match(resolve, /environment: production/)
  assert.ok(release.indexOf('verify-incident-reentry:') < release.indexOf('resolve-and-verify-eligibility:'))
})

test('active quarantine can only be re-entered by manual exact-SHA release with owner closeout', () => {
  assert.match(policy, /automated Production Release cannot re-enter an automatic-rollback quarantine/)
  assert.match(policy, /quarantined re-entry requires an explicit release_sha/)
  assert.match(policy, /quarantined re-entry requires incident_closeout_run_id/)
  assert.match(policy, /closeout was not dispatched by the repository owner/)
  assert.match(policy, /closeout artifact does not authorize this exact release SHA/)
  assert.match(policy, /production changed after rollback; re-entry requires a new deliberate decision/)
  assert.match(policy, /approved_for_exact_sha/)
  assert.match(policy, /successful CI Gate/)
})

test('Phase 2D production requester cannot smuggle closeout authority into an automated release', () => {
  const requestCode = code(request)
  const dispatch = requestCode.slice(requestCode.indexOf('gh workflow run production-release.yml'))
  assert.match(dispatch, /-f automation_source_run_id="\$SOURCE_RUN_ID"/)
  assert.doesNotMatch(dispatch, /incident_closeout_run_id/)
  assert.doesNotMatch(requestCode, /production-incident-closeout/)
})

test('closeout/re-entry implementation is read-only and does not add a third production dispatch path', () => {
  for (const [name, source] of [['policy', policy], ['deps', deps]]) {
    const executable = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
    assert.doesNotMatch(executable, /gh workflow run|dispatches|createWorkflowDispatch|git push|gh release create|gh variable|gh secret|railway|supabase|psql|--method ['"]?(POST|PUT|PATCH|DELETE)/i, name)
  }
  assert.match(deps, /Every GitHub operation here is a GET/)
  assert.equal((code(closeout).match(/gh workflow run/g) ?? []).length, 0)

  for (const file of readdirSync('.github/workflows')) {
    if (['claude-release-engineer-production-request.yml', 'production-auto-rollback-request.yml'].includes(file)) continue
    const source = code(read(`.github/workflows/${file}`)).split('\n').filter((line) => !/disallowedTools/.test(line)).join('\n')
    assert.doesNotMatch(source, /gh workflow run production-(release|rollback)|workflows\/production-(release|rollback)\.yml\/dispatches/, file)
  }
})

test('Phase 4B control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/production-incident-closeout.yml',
    '.github/workflows/production-release.yml',
    'scripts/production-incident-closeout.mjs',
    'scripts/production-incident-closeout-deps.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Production Release evidence records the closeout run id when one authorizes re-entry', () => {
  const ledger = jobSection(release, 'production-release-evidence')
  assert.match(ledger, /INCIDENT_CLOSEOUT_RUN_ID: \$\{\{ inputs\.incident_closeout_run_id \}\}/)
  const evidence = read('scripts/production-release-evidence.mjs')
  assert.match(evidence, /incident_closeout_run_id: incidentCloseoutRunId/)
  assert.match(evidence, /incidentCloseoutRunId: env\.INCIDENT_CLOSEOUT_RUN_ID/)
})

test('Release Workflow Contract permanently runs Phase 4B tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = jobSection(ci, 'release-workflow-contract')
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-incident-closeout.test.mjs',
    'scripts/production-incident-closeout-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
  assert.equal(new Set(files).size, files.length)
  assert.doesNotMatch(job, /continue-on-error|\n\s+if:/)
})
