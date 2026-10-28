// Contract for the CI "Security Scan" job: a dependency finding must fail the job, never pass silently.
// Before this contract both audit steps used continue-on-error and an unexplained --ignore-vuln, so the job
// reported success even while pip-audit / npm audit reported vulnerabilities.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.join(import.meta.dirname, '..')
const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')

function securityJob() {
  const start = ci.indexOf('\n  security:\n')
  assert.notEqual(start, -1, 'ci.yml must define the security job')
  const rest = ci.slice(start + 1)
  const next = rest.slice(1).search(/\n  [A-Za-z0-9_-]+:\s*\n/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

test('Security Scan job keeps its name and both dependency audits', () => {
  const job = securityJob()
  assert.match(job, /name: Security Scan/)
  assert.match(job, /pip-audit -r requirements\.txt/)
  assert.match(job, /npm audit --audit-level=high/)
})

test('Security Scan audits cannot be masked by continue-on-error', () => {
  assert.doesNotMatch(securityJob(), /continue-on-error/)
})

test('Security Scan carries no vulnerability ignore exceptions', () => {
  const job = securityJob()
  assert.doesNotMatch(job, /--ignore-vuln|--ignore\b/)
  assert.doesNotMatch(job, /audit-level=(critical|none)/)
})

test('pip-audit fails when a dependency cannot be audited', () => {
  assert.match(securityJob(), /pip-audit -r requirements\.txt[^\n]*--strict/)
})

test('python-jose (PYSEC-2026-4298, no patched release) is not a dependency', () => {
  const requirements = fs.readFileSync(path.join(ROOT, 'apps', 'api', 'requirements.txt'), 'utf8')
  assert.doesNotMatch(requirements, /^\s*python-jose/im)
  assert.match(requirements, /^PyJWT\[crypto\]==\d/m)
})

test('sharp override is at or above the librsvg fix (0.35.5)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'web', 'package.json'), 'utf8'))
  const match = String(pkg.overrides?.sharp ?? '').match(/(\d+)\.(\d+)\.(\d+)/)
  assert.ok(match, 'sharp override must be an explicit version range')
  const [major, minor, patch] = match.slice(1).map(Number)
  assert.ok(major > 0 || minor > 35 || (minor === 35 && patch >= 5), `sharp override ${match[0]} < 0.35.5`)
})

// --- CI Gate enforcement: Security Scan must be a required, success-only input of the aggregate gate. ---
const normalized = ci.replace(/\r\n/g, '\n')
const gateJob = normalized.slice(normalized.indexOf('\n  ci-gate:\n'), normalized.indexOf('\n  pr-comment:\n'))
const gateScript = gateJob
  .slice(gateJob.indexOf('        run: |\n') + '        run: |\n'.length)
  .split('\n')
  .map((l) => l.replace(/^ {10}/, ''))
  .join('\n')

const GREEN = {
  LINT_API: 'success', LINT_WEB: 'success', BUILD_WEB: 'success', TEST_WEB_PUBLIC_SMOKE: 'success', TEST_API: 'success', DATABASE_MIGRATION_GATE: 'success',
  SECURITY_SCAN: 'success', TEST_UNIT_WEB: 'success', FEATURE_FLAG_REGISTRY_GATE: 'success', FROZEN_GUARD: 'success', CONTRAST: 'success', I18N_PARITY: 'success',
  ROOM_BOARD_REGRESSION: 'success', ROOM_BOARD_HERMETIC: 'success', RELEASE_WORKFLOW_CONTRACT: 'success', SUPABASE_CLI_APPLY_CONTRACT: 'success',
  ACTIONS_RUNTIME_PRODUCE: 'success', ACTIONS_RUNTIME_CONSUME: 'success', EVENT_NAME: 'pull_request', PR_AUTHOR: 'someone',
}
const runGate = (env) => {
  const run = spawnSync('bash', ['-c', gateScript], { env: { PATH: process.env.PATH, ...GREEN, ...env }, encoding: 'utf8' })
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` }
}

test('CI Gate depends on the security job and receives its result', () => {
  const needs = gateJob.slice(gateJob.indexOf('    needs:\n'), gateJob.indexOf('    steps:\n'))
  assert.match(needs, /^\s+- security$/m)
  assert.match(gateJob, /SECURITY_SCAN: \$\{\{ needs\.security\.result \}\}/)
  assert.match(gateScript, /"Security Scan:\$SECURITY_SCAN"/)
})

test('CI Gate fails unless Security Scan is exactly success', () => {
  assert.ok(runGate({}).ok, 'all green passes')
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    const gate = runGate({ SECURITY_SCAN: result })
    assert.equal(gate.ok, false, `SECURITY_SCAN=${result || '(unset)'}`)
    assert.match(gate.output, /Security Scan completed with/)
  }
})

test('Security Scan is never exempted, including for Dependabot PRs and non-PR events', () => {
  const cases = [
    { PR_AUTHOR: 'dependabot[bot]', ROOM_BOARD_REGRESSION: 'skipped' },
    { EVENT_NAME: 'push', PR_AUTHOR: '' },
    { EVENT_NAME: 'workflow_dispatch', PR_AUTHOR: '' },
  ]
  for (const base of cases) {
    assert.ok(runGate(base).ok, JSON.stringify(base))
    for (const result of ['failure', 'cancelled', 'skipped']) assert.equal(runGate({ ...base, SECURITY_SCAN: result }).ok, false, `${JSON.stringify(base)} ${result}`)
  }
})

test('Security Scan job has no condition that could skip it', () => {
  assert.doesNotMatch(securityJob(), /^\s{4}if:/m)
})

test('release docs no longer describe Security Scan as advisory or outside CI Gate', () => {
  const docs = fs.readFileSync(path.join(ROOT, 'docs', 'RELEASE_PROCESS.md'), 'utf8')
  assert.doesNotMatch(docs, /Security Scan[^\n]*not yet part/i)
  assert.match(docs, /^- `Security Scan`/m)
  assert.doesNotMatch(normalized, /Security scan \(advisory\)/)
})
