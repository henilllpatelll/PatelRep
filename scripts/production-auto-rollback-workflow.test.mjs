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
const circuit = read('scripts/production-auto-rollback-circuit-breaker.mjs')

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

test('Phase 3D wires independent rollback-side revalidation before any production Environment job', () => {
  assert.match(rollback, /run-name: Production Rollback .*automation_source_run_id/)
  assert.match(rollback, /automation_source_run_id:\n {8}description:/)
  const preflight = jobSection(rollback, 'verify-automation-provenance')
  assert.doesNotMatch(preflight, /environment: production|secrets\.|RAILWAY|SUPABASE|psql|create-github-app-token/)
  assert.match(preflight, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(preflight, /persist-credentials: false/)
  assert.match(preflight, /if: inputs\.automation_source_run_id == ''/)
  assert.match(preflight, /if: inputs\.automation_source_run_id != ''/)
  assert.match(preflight, /node scripts\/production-auto-rollback-request\.mjs rollback/)
  assert.match(preflight, /PRODUCTION_AUTO_ROLLBACK_ENABLED: \$\{\{ vars\.PRODUCTION_AUTO_ROLLBACK_ENABLED \}\}/)
  const resolve = jobSection(rollback, 'resolve-and-verify-target')
  assert.match(resolve, /needs: verify-automation-provenance/)
  assert.match(resolve, /environment: production/)
  assert.ok(rollback.indexOf('verify-automation-provenance:') < rollback.indexOf('resolve-and-verify-target:'))
  assert.match(policy, /Phase 3D must land before auto-rollback requests can dispatch/)
})

test('automated rollback requires CLEAN DB drift while manual rollback keeps operator-reviewed compatibility behavior', () => {
  const compatibility = jobSection(rollback, 'compatibility-check')
  assert.match(compatibility, /AUTOMATION_SOURCE_RUN_ID: \$\{\{ inputs\.automation_source_run_id \}\}/)
  assert.match(compatibility, /if \[ -n "\$AUTOMATION_SOURCE_RUN_ID" \]; then/)
  assert.match(compatibility, /grep -qx "Status: CLEAN" drift\.txt/)
  assert.match(compatibility, /Automated rollback requires CLEAN production migration history/)
  assert.match(compatibility, /if grep -q "Missing on production" drift\.txt/)
  assert.match(compatibility, /if grep -q "Unknown on production" drift\.txt/)
  assert.doesNotMatch(compatibility, /migration repair|supabase migration repair/i)
})

test('manual rollback remains available with a blank automation source and no automation switch requirement', () => {
  assert.match(rollback, /automation_source_run_id:\n {8}description:[^\n]*\n {8}required: false\n {8}default: ""/)
  const preflight = jobSection(rollback, 'verify-automation-provenance')
  assert.match(preflight, /Manual rollback dispatch; automated provenance validation is not applicable/)
  const manual = preflight.match(/- name: Preserve manual rollback semantics[\s\S]*?(?=\n {6}- name:|$)/)?.[0] ?? ''
  assert.doesNotMatch(manual, /PRODUCTION_AUTO_ROLLBACK_ENABLED|production-auto-rollback-request/)
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

test('Phase 3D verifies a read-only circuit breaker only after exact rollback verification succeeds', () => {
  const breaker = jobSection(rollback, 'verify-automated-circuit-breaker')
  assert.match(breaker, /needs: \[resolve-and-verify-target, verify-rollback\]/)
  assert.match(breaker, /inputs\.automation_source_run_id != '' && needs\.verify-rollback\.result == 'success'/)
  assert.match(breaker, /permissions:\n {6}contents: read\n {6}actions: read/)
  assert.doesNotMatch(breaker, /environment: production|secrets\.|RAILWAY|SUPABASE|psql|create-github-app-token|gh workflow run/)
  assert.match(breaker, /node scripts\/production-auto-rollback-circuit-breaker\.mjs/)
  assert.match(circuit, /managed_release_mismatch/)
  assert.match(circuit, /failed_candidate_unmanaged/)
  assert.match(circuit, /resolveProductionBaseline/)
  assert.match(circuit, /readRuntimeIdentity/)
})

test('owner switch is explicit and workflows never create or modify it', () => {
  assert.match(workflow, /PRODUCTION_AUTO_ROLLBACK_ENABLED: \$\{\{ vars\.PRODUCTION_AUTO_ROLLBACK_ENABLED \}\}/)
  assert.match(policy, /PRODUCTION_AUTO_ROLLBACK_ENABLED/)
  for (const file of readdirSync('.github/workflows')) {
    const source = code(read(`.github/workflows/${file}`))
    assert.doesNotMatch(source, /gh (variable|api).*PRODUCTION_AUTO_ROLLBACK_ENABLED|PRODUCTION_AUTO_ROLLBACK_ENABLED.*--method (POST|PATCH|PUT|DELETE)/i, file)
  }
})

test('Release Workflow Contract requires the Phase 3C/3D rollback test files', () => {
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
    'scripts/production-auto-rollback-circuit-breaker.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
  assert.equal(new Set(files).size, files.length)
  assert.doesNotMatch(job, /continue-on-error|\n\s+if:/)
})
