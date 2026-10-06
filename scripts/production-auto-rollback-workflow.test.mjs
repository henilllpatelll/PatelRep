import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/production-auto-rollback-request.yml')
const workflowCode = code(workflow)
const rollback = read('.github/workflows/production-rollback.yml')
const policy = read('scripts/production-auto-rollback-policy.mjs')
const cli = read('scripts/production-auto-rollback-request.mjs')
const deps = read('scripts/production-auto-rollback-deps.mjs')

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

test('Phase 3C triggers only after Production Release Stabilization completes', () => {
  assert.match(workflow, /on:\n {2}workflow_run:\n {4}workflows:\n {6}- Production Release Stabilization\n {4}types: \[completed\]/)
  assert.doesNotMatch(workflowCode, /schedule:|cron:|pull_request|push:|workflow_dispatch:/)
  assert.match(jobSection(workflow, 'resolve'), /github\.event\.workflow_run\.conclusion == 'success'/)
  assert.match(jobSection(workflow, 'resolve'), /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/)
})

test('resolver is read-only and freezes one trusted main control-plane SHA', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n {2}pull-requests: read/m)
  const resolve = jobSection(workflow, 'resolve')
  assert.match(resolve, /ref: main/)
  assert.match(resolve, /path: \.trusted-resolver/)
  assert.match(resolve, /sparse-checkout: scripts/)
  assert.match(resolve, /persist-credentials: false/)
  assert.match(resolve, /git -C \.trusted-resolver rev-parse HEAD/)
  assert.match(resolve, /node \.trusted-resolver\/scripts\/production-auto-rollback-request\.mjs resolve/)
  assert.doesNotMatch(resolve, /create-github-app-token|permission-actions: write|secrets\.|environment: production/)
})

test('request job revalidates before the only write-capable App token exists', () => {
  const request = jobSection(workflow, 'request-rollback')
  const revalidate = request.indexOf('Revalidate rollback eligibility and duplicate state')
  const token = request.indexOf('Create PatelRep GitHub App token')
  const dispatch = request.indexOf('Request exact known-good Production Rollback')
  assert.ok(revalidate >= 0 && token > revalidate && dispatch > token)
  assert.match(request, /ref: \$\{\{ needs\.resolve\.outputs\.trusted_control_plane_sha \}\}/)
  assert.match(request, /EXPECTED_CONTROL_PLANE_SHA: \$\{\{ needs\.resolve\.outputs\.trusted_control_plane_sha \}\}/)
  assert.match(request, /EXPECTED_TARGET_VERSION: \$\{\{ needs\.resolve\.outputs\.target_version \}\}/)
  assert.match(request, /permission-actions: write/)
  assert.doesNotMatch(request, /permission-contents: write|permission-deployments: write|permission-environments: write/)
  assert.doesNotMatch(request, /environment: production|PRODUCTION_SUPABASE|PRODUCTION_RAILWAY|RAILWAY_API_TOKEN|psql|supabase\/setup-cli/)
})

test('Phase 3C can request exactly one rollback workflow and passes only target version plus incident run id', () => {
  const request = jobSection(workflow, 'request-rollback')
  assert.equal((request.match(/gh workflow run production-rollback\.yml/g) ?? []).length, 1)
  assert.match(request, /--ref main/)
  assert.match(request, /-f target_version="\$TARGET_VERSION" -f automation_source_run_id="\$SOURCE_RUN_ID"/)
  assert.doesNotMatch(request, /production-release\.yml/)
  assert.doesNotMatch(request, /release_sha=|version_bump=/)
})

test('no other workflow gains a production rollback dispatch path', () => {
  for (const file of readdirSync('.github/workflows')) {
    if (file === 'production-auto-rollback-request.yml') continue
    const source = code(read(`.github/workflows/${file}`)).split('\n').filter((line) => !/disallowedTools/.test(line)).join('\n')
    assert.doesNotMatch(source, /gh workflow run production-rollback|workflows\/production-rollback\.yml\/dispatches/, file)
  }
})

test('Phase 3C remains inert until Phase 3D wires independent rollback-side revalidation', () => {
  assert.doesNotMatch(rollback, /automation_source_run_id/)
  assert.doesNotMatch(rollback, /production-auto-rollback-request\.mjs rollback/)
  assert.match(policy, /Phase 3D must land before auto-rollback requests can dispatch/)
  assert.match(policy, /automation_source_run_id:\\n/)
  assert.match(policy, /production-auto-rollback-request\\\.mjs rollback/)
  assert.match(policy, /run-name: Production Rollback/)
})

test('policy keeps zero-migration, exact-runtime, fresh-failure, low-risk and no-active-run gates', () => {
  for (const gate of [
    /applied zero production migrations/,
    /readRuntimeIdentity/,
    /isExactCandidateHealthy/,
    /findHighRiskChange/,
    /listActiveProductionRuns/,
    /resolveTagCommit/,
    /isAncestorOfMain/,
    /validateReleaseEvidence/,
  ]) assert.match(policy, gate)
  assert.match(policy, /incident\.release_state\?\.mutations\?\.database !== 'no_change'/)
  assert.match(policy, /live production no longer runs the exact failing release/)
  assert.match(policy, /now passes strict production smoke/)
})

test('the request CLI exposes rollback mode for Phase 3D but never dispatches itself', () => {
  assert.match(cli, /resolve\|request\|rollback/)
  assert.match(cli, /requireAutomatedRollbackDispatch/)
  assert.match(cli, /validateAutoRollbackRequest/)
  assert.doesNotMatch(cli, /gh workflow run|execFile|spawn|railway|supabase|psql/)
  assert.match(deps, /Every GitHub call here is a GET/)
  assert.match(deps, /runPublicSmoke/)
})

test('owner switch is explicit and workflows never create or modify it', () => {
  assert.match(workflow, /PRODUCTION_AUTO_ROLLBACK_ENABLED: \$\{\{ vars\.PRODUCTION_AUTO_ROLLBACK_ENABLED \}\}/)
  assert.match(policy, /PRODUCTION_AUTO_ROLLBACK_ENABLED/)
  for (const file of readdirSync('.github/workflows')) {
    const source = code(read(`.github/workflows/${file}`))
    assert.doesNotMatch(source, /gh (variable|api).*PRODUCTION_AUTO_ROLLBACK_ENABLED|PRODUCTION_AUTO_ROLLBACK_ENABLED.*--method (POST|PATCH|PUT|DELETE)/i, file)
  }
})

test('Release Workflow Contract requires both Phase 3C test files', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  release-workflow-contract:\n')
  assert.ok(start >= 0)
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/)
  const job = next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next)
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-auto-rollback-policy.test.mjs',
    'scripts/production-auto-rollback-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
  assert.equal(new Set(files).size, files.length)
  assert.doesNotMatch(job, /continue-on-error|\n\s+if:/)
})
