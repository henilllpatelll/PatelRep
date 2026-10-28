// Contract for the CI "Security Scan" job: a dependency finding must fail the job, never pass silently.
// Before this contract both audit steps used continue-on-error and an unexplained --ignore-vuln, so the job
// reported success even while pip-audit / npm audit reported vulnerabilities.
import assert from 'node:assert/strict'
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
