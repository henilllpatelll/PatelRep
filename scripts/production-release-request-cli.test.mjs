import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

function runCli(mode, env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'prr-'))
  const output = path.join(dir, 'output')
  const summary = path.join(dir, 'summary')
  writeFileSync(output, '')
  writeFileSync(summary, '')
  const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '', REPO: 'henilllpatelll/PatelRep', GH_TOKEN: 'unused-read-token', SOURCE_RUN_ID: '37203774058', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }
  const result = spawnSync(process.execPath, ['scripts/production-release-request.mjs', mode], { encoding: 'utf8', env: { ...base, ...env } })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8') }
}

// Reproduces live run 37203774058: the resolver ran with the activation variable absent.
test('the real resolver entry point with the activation variable missing succeeds as a clean no-op', () => {
  const result = runCli('resolve', {})
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr + result.stdout, /unknown validation mode/)
  assert.equal(result.output, 'eligible=false\n')
  assert.match(result.summary, /PRODUCTION_AUTO_RELEASE_ENABLED is not "true"/)
})

test('resolve and request are clean no-ops for a disabled switch; request reports dispatch=false', () => {
  for (const value of ['false', '', 'yes']) {
    const resolved = runCli('resolve', { PRODUCTION_AUTO_RELEASE_ENABLED: value })
    assert.equal(resolved.status, 0, resolved.stderr)
    assert.equal(resolved.output, 'eligible=false\n')
    const requested = runCli('request', { PRODUCTION_AUTO_RELEASE_ENABLED: value, EXPECTED_MERGE_COMMIT_SHA: 'd'.repeat(40) })
    assert.equal(requested.status, 0, requested.stderr)
    assert.equal(requested.output, 'dispatch=false\n')
  }
})

test('release mode fails the release when the switch is off, and an invalid mode fails', () => {
  const release = runCli('release', { PRODUCTION_AUTO_RELEASE_ENABLED: 'false' })
  assert.notEqual(release.status, 0)
  assert.match(release.stderr, /PRODUCTION_AUTO_RELEASE_ENABLED/)
  assert.equal(release.output, '')
  const bogus = runCli('dispatch', {})
  assert.notEqual(bogus.status, 0)
  assert.match(bogus.stderr, /usage/)
})

test('every workflow call of the entry point uses a mode the policy supports', () => {
  const policy = read('scripts/production-release-request-policy.mjs')
  const modes = JSON.parse(policy.match(/VALIDATION_MODES = Object\.freeze\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'))
  const calls = ['.github/workflows/claude-release-engineer-production-request.yml', '.github/workflows/production-release.yml']
    .flatMap((file) => [...read(file).matchAll(/production-release-request\.mjs (\w+)/g)].map((match) => match[1]))
  assert.deepEqual([...new Set(calls)].sort(), ['release', 'request', 'resolve'])
  for (const mode of calls) assert.ok(modes.includes(mode), mode)
})
