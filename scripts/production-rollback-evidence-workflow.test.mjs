import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const rollback = read('.github/workflows/production-rollback.yml')
const evidence = read('scripts/production-rollback-evidence.mjs')
const capture = read('scripts/production-rollback-runtime-capture.mjs')

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

test('Phase 4A captures before-runtime identity read-only before target resolution', () => {
  const captureJob = jobSection(rollback, 'capture-pre-rollback-runtime')
  assert.match(captureJob, /needs: verify-automation-provenance/)
  assert.match(captureJob, /permissions:\n {6}contents: read/)
  assert.match(captureJob, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(captureJob, /sparse-checkout: scripts/)
  assert.match(captureJob, /persist-credentials: false/)
  assert.match(captureJob, /node scripts\/production-rollback-runtime-capture\.mjs/)
  assert.doesNotMatch(captureJob, /environment: production|secrets\.|RAILWAY|SUPABASE|psql|create-github-app-token|gh workflow run/)

  const resolve = jobSection(rollback, 'resolve-and-verify-target')
  assert.match(resolve, /needs: \[verify-automation-provenance, capture-pre-rollback-runtime\]/)
  assert.ok(rollback.indexOf('capture-pre-rollback-runtime:') < rollback.indexOf('resolve-and-verify-target:'))
})

test('rollback evidence ledger always follows the complete rollback graph and has no production authority', () => {
  const ledger = jobSection(rollback, 'production-rollback-evidence')
  for (const dep of [
    'verify-automation-provenance',
    'capture-pre-rollback-runtime',
    'resolve-and-verify-target',
    'compatibility-check',
    'deploy-api',
    'deploy-web',
    'verify-rollback',
    'verify-automated-circuit-breaker',
  ]) assert.ok(ledger.includes(`- ${dep}`), `ledger waits for ${dep}`)

  assert.match(ledger, /if: \$\{\{ always\(\) \}\}/)
  assert.match(ledger, /permissions:\n {6}contents: read/)
  assert.match(ledger, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(ledger, /persist-credentials: false/)
  assert.doesNotMatch(ledger, /environment: production|secrets\.|PRODUCTION_(SUPABASE|RAILWAY)|RAILWAY_API_TOKEN|supabase|railway|psql|git push|gh workflow run|create-github-app-token/i)
  assert.match(ledger, /node scripts\/production-rollback-evidence\.mjs/)
  assert.match(ledger, /name: production-rollback-evidence/)
  assert.match(ledger, /retention-days: 90/)
  assert.match(ledger, /if-no-files-found: error/)
  assert.match(ledger, /CONTROL_PLANE_SHA: \$\{\{ github\.sha \}\}/)
  assert.match(ledger, /PRE_RUNTIME_STATUS: \$\{\{ needs\.capture-pre-rollback-runtime\.outputs\.status \}\}/)
  assert.match(ledger, /RESOLVED_TARGET_SHA: \$\{\{ needs\.resolve-and-verify-target\.outputs\.target_sha \}\}/)
  assert.match(ledger, /API_RESULT: \$\{\{ needs\.deploy-api\.result \}\}/)
  assert.match(ledger, /VERIFY_RESULT: \$\{\{ needs\.verify-rollback\.result \}\}/)
  assert.match(ledger, /CIRCUIT_RESULT: \$\{\{ needs\.verify-automated-circuit-breaker\.result \}\}/)
})

test('Phase 4A adds exactly one rollback job-level always path and no soft production failure', () => {
  assert.equal((rollback.match(/^ {4}if: \$\{\{ always\(\) \}\}$/gm) ?? []).length, 1)
  assert.doesNotMatch(rollback, /continue-on-error/)
})

test('rollback evidence scripts are sanitized and cannot deploy mutate DB or dispatch workflows', () => {
  for (const [name, source] of [['evidence', evidence], ['capture', capture]]) {
    assert.doesNotMatch(source, /railway\\/cli|supabase\\/setup-cli|supabase migration|psql|git push|gh workflow run|create-github-app-token|RAILWAY_API_TOKEN|PRODUCTION_SUPABASE_DB_URL/i, name)
  }
  assert.match(evidence, /patelrep\.production-rollback-evidence\.v1/)
  assert.match(evidence, /not_mutated_by_workflow/)
  assert.match(evidence, /not_created_by_workflow/)
  assert.match(evidence, /unknown_after_attempt/)
  assert.match(capture, /unproven/)
})

test('Release Workflow Contract permanently includes Phase 4A tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  release-workflow-contract:\n')
  assert.ok(start >= 0)
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/)
  const job = next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next)
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-rollback-runtime-capture.test.mjs',
    'scripts/production-rollback-evidence.test.mjs',
    'scripts/production-rollback-evidence-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
})
