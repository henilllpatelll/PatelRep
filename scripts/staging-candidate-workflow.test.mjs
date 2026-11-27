import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/staging-candidate.yml', 'utf8')
const productionRelease = readFileSync('.github/workflows/production-release.yml', 'utf8')
const productionRollback = readFileSync('.github/workflows/production-rollback.yml', 'utf8')
const webDockerfile = readFileSync('apps/web/Dockerfile', 'utf8')

test('uses a trusted CI completion trigger and never pull_request_target', () => {
  assert.match(workflow, /workflow_run:/)
  assert.match(workflow, /workflows:\s*\[CI\]/)
  assert.doesNotMatch(workflow, /pull_request_target/)
  assert.doesNotMatch(workflow, /^\s*pull_request:/m, 'staging secrets never run from a PR-supplied workflow definition')
  assert.match(workflow, /head\.repo\.full_name !== context\.repo\.owner \+ '\/' \+ context\.repo\.repo/)
})

test('gate lookups paginate check runs (commits can carry more than 100)', () => {
  for (const source of [workflow, productionRelease]) {
    assert.doesNotMatch(source, /checks\.listForRef\(/)
    assert.match(source, /github\.paginate\(github\.rest\.checks\.listForRef/)
  }
})

test('serializes candidates and deploys one exact SHA through both services', () => {
  assert.match(workflow, /group: staging-release-candidate/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /name: 'Staging Gate'/)
  assert.match(workflow, /CANDIDATE_SHA/)
  assert.match(workflow, /git checkout --detach "\$\{\{ needs\.resolve-candidate\.outputs\.sha \}\}"/)
})

test('injects only public candidate identity into the exact staging build artifacts', () => {
  assert.match(workflow, /core\/release_identity\.json/)
  assert.match(workflow, /release-identity\.json/)
  const wrapper = readFileSync('scripts/staging-railway-deploy.mjs', 'utf8')
  assert.ok(
    wrapper.includes("['up', path, '--ci', '--no-gitignore', '--path-as-root', '--project', projectId, '--environment', 'staging', '--service', serviceId]"),
    'uploads must target the explicit staging project, environment, and service',
  )
  assert.ok(wrapper.includes("'@railway/cli@4.30.0'"))
  assert.ok(workflow.includes('node scripts/staging-railway-deploy.mjs apps/api'), 'API upload goes through the recovery wrapper')
  assert.ok(workflow.includes('node scripts/staging-railway-deploy.mjs apps/web'), 'web upload goes through the recovery wrapper')
  assert.doesNotMatch(workflow, /railway\/cli@4\.30\.0 up /, 'no deploy bypasses the wrapper')
  assert.equal((workflow.match(/TARGET_SERVICE_ID: \$\{\{ vars\.STAGING_RAILWAY_(API|WEB)_SERVICE_ID \}\}/g) ?? []).length, 2)
  assert.doesNotMatch(workflow, /railway\/cli@4\.30\.0 link /, 'a Project Token cannot run `railway link`; every command is explicitly targeted')
  assert.doesNotMatch(workflow, /variables set RELEASE_SHA/)
  assert.doesNotMatch(workflow, /variables set NEXT_PUBLIC_RELEASE_SHA/)
})

test('Railway variables set is not passed --project (unsupported by CLI 4.30.0; the token scopes the project)', () => {
  for (const wf of [productionRelease, productionRollback]) {
    const calls = wf.match(/railway\/cli@4\.30\.0 variables set[\s\S]*?--service "[^"]+"/g) ?? []
    assert.equal(calls.length, 2, 'expected API and web variables set calls')
    for (const call of calls) {
      assert.doesNotMatch(call, /--project/)
      assert.match(call, /--environment production --service/)
    }
  }
})

test('uses one self-contained Web build context in staging, production, and rollback', () => {
  assert.match(webDockerfile, /^COPY package\.json \.\/\s*$/m)
  assert.match(webDockerfile, /^COPY \. \.\/\s*$/m)
  assert.doesNotMatch(webDockerfile, /^COPY apps\/web\//m)

  assert.match(workflow, /staging-railway-deploy\.mjs apps\/web/)
  assert.match(readFileSync('scripts/staging-railway-deploy.mjs', 'utf8'), /'--ci', '--no-gitignore', '--path-as-root'/)
  assert.match(productionRelease, /up --ci --project "\$PRODUCTION_RAILWAY_PROJECT_ID"/)
  assert.match(productionRollback, /up --ci --project "\$PRODUCTION_RAILWAY_PROJECT_ID"/)
})

test('keeps the production migration preflight fail-closed with pipefail', () => {
  const preflight = productionRelease.slice(
    productionRelease.indexOf('  production-db-preflight:'),
    productionRelease.indexOf('  production-db-migrate:'),
  )

  assert.match(preflight, /set -o pipefail\s+node scripts\/check-db-drift\.mjs --environment production --allow-pending \| tee drift\.txt\s+status=\$\?\s+set \+o pipefail/)
  assert.match(preflight, /Unknown on production/)
  assert.match(preflight, /exit "\$status"/)
  assert.doesNotMatch(preflight, /continue-on-error/)
})

test('uses the staging Environment Project Token and refuses every production Railway target', () => {
  const apiDeploy = workflow.slice(workflow.indexOf('  deploy-api:'), workflow.indexOf('  deploy-web:'))
  const webDeploy = workflow.slice(workflow.indexOf('  deploy-web:'), workflow.indexOf('  verify-staging:'))

  for (const deploy of [apiDeploy, webDeploy]) {
    assert.match(deploy, /RAILWAY_TOKEN: \$\{\{ secrets\.STAGING_RAILWAY_PROJECT_TOKEN \}\}/)
    assert.doesNotMatch(deploy, /RAILWAY_API_TOKEN/)
    assert.doesNotMatch(deploy, /secrets\.PRODUCTION_/)
    assert.match(deploy, /test "\$STAGING_RAILWAY_ENVIRONMENT" = staging/)
    assert.match(deploy, /test -n "\$STAGING_RAILWAY_PROJECT_ID"/)
    assert.match(deploy, /if \[ -n "\$PRODUCTION_RAILWAY_PROJECT_ID" \]; then/)
    assert.match(deploy, /test "\$STAGING_RAILWAY_PROJECT_ID" != "\$PRODUCTION_RAILWAY_PROJECT_ID"/)
  }

  assert.match(apiDeploy, /test -n "\$STAGING_RAILWAY_API_SERVICE_ID"/)
  assert.match(apiDeploy, /test -n "\$PRODUCTION_RAILWAY_API_SERVICE_ID"/)
  assert.match(apiDeploy, /test "\$STAGING_RAILWAY_API_SERVICE_ID" != "\$PRODUCTION_RAILWAY_API_SERVICE_ID"/)
  assert.match(webDeploy, /test -n "\$STAGING_RAILWAY_WEB_SERVICE_ID"/)
  assert.match(webDeploy, /test -n "\$PRODUCTION_RAILWAY_WEB_SERVICE_ID"/)
  assert.match(webDeploy, /test "\$STAGING_RAILWAY_WEB_SERVICE_ID" != "\$PRODUCTION_RAILWAY_WEB_SERVICE_ID"/)
})

test('collects API runtime diagnostics only after a protected staging readiness failure', () => {
  const apiDeploy = workflow.slice(workflow.indexOf('  deploy-api:'), workflow.indexOf('  deploy-web:'))
  const diagnostics = apiDeploy.slice(
    apiDeploy.indexOf('- name: Collect staging API runtime diagnostics'),
    apiDeploy.indexOf('- name: Restore checked-in API release identity'),
  )

  assert.match(diagnostics, /- name: Collect staging API runtime diagnostics\s+if: failure\(\)/)
  assert.match(diagnostics, /railway\/cli@4\.30\.0 logs --latest --lines 100 --filter "@level:error" --environment staging --service "\$STAGING_RAILWAY_API_SERVICE_ID"/)
  assert.doesNotMatch(diagnostics, /railway\/cli@4\.30\.0 link /)
  assert.match(diagnostics, /RAILWAY_TOKEN: \$\{\{ secrets\.STAGING_RAILWAY_PROJECT_TOKEN \}\}/)
  assert.doesNotMatch(diagnostics, /RAILWAY_API_TOKEN/)
})

test('migrates persistent staging forward only, guarded, and proves API/web identity before staging smoke', () => {
  const guard = workflow.indexOf('node scripts/staging-target-guard.mjs')
  const plan = workflow.indexOf('node scripts/staging-migration-apply-workspace.mjs plan')
  const push = workflow.indexOf('node scripts/staging-migration-apply-workspace.mjs apply')
  const postgresClient = workflow.indexOf('apt-get install --yes postgresql-client')
  const driftCheck = workflow.indexOf('node scripts/check-db-drift.mjs --environment staging')
  const fixtureAccess = workflow.indexOf('Grant staging fixture service access')
  const fixtureSeed = workflow.indexOf('node apps/web/e2e/fixtures/seed-staging-tenant.mjs') // trusted copy; see staging-trusted-execution.test.mjs
  assert.ok(guard >= 0 && plan > guard, 'target guard must execute before the read-only plan')
  assert.ok(postgresClient >= 0 && postgresClient < plan, 'psql must be installed before the plan reads migration history')
  assert.ok(push > plan && push < driftCheck, 'forward push happens only after the plan and before the clean-drift proof')
  assert.match(workflow, /if: steps\.plan\.outputs\.has_pending == 'true'/)
  assert.doesNotMatch(workflow, /supabase db push|--include-all/, 'the workflow never pushes the full repository directory; only the verified workspace script does')
  assert.match(workflow, /node scripts\/staging-migration-apply-workspace\.mjs verify-applied/)
  assert.ok(fixtureAccess > driftCheck && fixtureAccess < fixtureSeed, 'fixture service access must be established only after clean drift verification and before seeding')
  assert.match(workflow, /grant all privileges on all tables in schema public to service_role/i)
  assert.match(workflow, /grant all privileges on all tables in schema public to service_role;[^"]*notify pgrst, 'reload schema'/i, 'PostgREST must reload its schema cache after the migrations and grants, before the API serves the smoke')
  assert.match(workflow, /grant all privileges on all tables in schema public to service_role;[^"]*perform public\.agent_audit_privileges_enforce\(\);[^"]*notify pgrst, 'reload schema'/i, 'the blanket grant must be followed, in the same --command transaction, by the agent audit least-privilege re-assertion (#230)')
  assert.match(workflow, /npm run check:staging-health/)
  assert.match(workflow, /npm run test:e2e:staging/)
  assert.match(workflow, /npm run check:deployment-drift/)
})

test('never resets, wipes or replays-from-scratch the persistent staging database', () => {
  assert.doesNotMatch(workflow, /remote-migration-apply/)
  assert.doesNotMatch(workflow, /\bdb\s+reset\b/)
  assert.doesNotMatch(workflow, /migration\s+repair|TRUNCATE|DROP\s+(SCHEMA|DATABASE)/i)
  assert.doesNotMatch(workflow, /Rebuild isolated staging database/)
})

test('web service root directory carries its own Dockerfile Railway config', () => {
  // Production deploys upload the repo root and Railway applies the service Root Directory
  // (apps/web). Config-as-code is read from that directory, so without apps/web/railway.toml
  // Railway falls back to Railpack instead of apps/web/Dockerfile and the deploy fails.
  const config = readFileSync('apps/web/railway.toml', 'utf8')
  assert.match(config, /builder\s*=\s*"DOCKERFILE"/)
  assert.match(config, /dockerfilePath\s*=\s*"Dockerfile"/)
  assert.match(config, /healthcheckPath\s*=\s*"\/login"/)
})

test('staging uses Project Tokens only; the workflow-wide credential split is intact', () => {
  assert.doesNotMatch(workflow, /RAILWAY_API_TOKEN|STAGING_RAILWAY_API_TOKEN|secrets\.PRODUCTION_/)
  assert.equal((workflow.match(/RAILWAY_TOKEN: \$\{\{ secrets\.STAGING_RAILWAY_PROJECT_TOKEN \}\}/g) ?? []).length, 3, 'API deploy, web deploy, and diagnostics')
  assert.equal((workflow.match(/^\s*RAILWAY_TOKEN:/gm) ?? []).length, 3, 'RAILWAY_TOKEN is set only on the three staging Railway steps')
  // Production Release and Rollback use the production-scoped project token only.
  assert.match(productionRelease, /RAILWAY_TOKEN: \$\{\{ secrets\.PRODUCTION_RAILWAY_TOKEN \}\}/)
  assert.doesNotMatch(productionRelease, /RAILWAY_API_TOKEN/)
  assert.match(productionRollback, /RAILWAY_TOKEN: \$\{\{ secrets\.PRODUCTION_RAILWAY_TOKEN \}\}/)
  assert.doesNotMatch(productionRollback, /RAILWAY_API_TOKEN/)
  for (const wf of [productionRelease, productionRollback]) {
    assert.doesNotMatch(wf, /STAGING_RAILWAY/)
  }
})

test('Railway deploy recovery is narrow: no ignored exit codes, no re-upload, wrapper owns the only CLI up call', () => {
  const wrapper = readFileSync('scripts/staging-railway-deploy.mjs', 'utf8')
  for (const step of ['Deploy API from exact checkout', 'Deploy web from exact checkout']) {
    const body = workflow.slice(workflow.indexOf(`- name: ${step}`), workflow.indexOf(`- name: ${step}`) + 600)
    assert.match(body, /run: \|\s+node scripts\/staging-railway-deploy\.mjs apps\/(api|web)\s/)
    assert.doesNotMatch(body, /continue-on-error|\|\| true|set \+e/)
  }
  assert.doesNotMatch(workflow, /continue-on-error/)
  assert.equal((wrapper.match(/\['up'/g) ?? []).length, 1, 'exactly one upload call; recovery never re-uploads')
  assert.doesNotMatch(wrapper, /redeploy|deployment', 'up'|--detach/)
  assert.match(wrapper, /Failed to stream build logs: Failed to retrieve build log/)
  assert.match(workflow, /Require API health, readiness, staging database, and exact SHA/, 'recovered API deploys still pass the exact-SHA health gate')
  assert.match(workflow, /Verify deployed web\/API\/database release identity/, 'recovered web deploys still pass the release-identity check')
})

// ── R-25 (Developer Harness V3 D3.6 integration): exact-head dispatch and exact-source CI selection ─────────────────────────────────────────────────────
// The resolve-candidate github-script is EXECUTED here (its exact text, extracted from the workflow) against fixture GitHub/core/context objects that record every call.
// This verifies the new behaviour BEFORE merge; the trusted definition only runs on GitHub from main after merge (post-merge verification is recorded separately).
const AsyncFunction = (async () => {}).constructor
function resolveScript() {
  const lines = workflow.replace(/\r\n?/g, '\n').split('\n')
  const at = lines.indexOf('      - id: candidate'); assert.ok(at > 0, 'resolve-candidate step present')
  const start = lines.indexOf('          script: |', at); assert.ok(start > at, 'script block present')
  const body = []
  for (let k = start + 1; k < lines.length; k += 1) { const l = lines[k]; if (l.trim() === '') { body.push(''); continue } if (!l.startsWith('            ')) break; body.push(l.slice(12)) }
  return body.join('\n')
}
const REPO = { owner: 'henilllpatelll', repo: 'PatelRep' }; const FULL = 'henilllpatelll/PatelRep'
const HEAD = 'a'.repeat(40); const NEWER = 'b'.repeat(40); const SUITE = 9001
const prFixture = (sha = HEAD, over = {}) => ({ number: 42, state: 'open', body: '', base: { ref: 'main' }, head: { sha, ref: 'feat/x', repo: { full_name: FULL } }, ...over })
const ciRun = (over = {}) => ({ id: 500, run_number: 10, path: '.github/workflows/ci.yml', head_sha: HEAD, head_repository: { full_name: FULL }, status: 'completed', conclusion: 'success', check_suite_id: SUITE, pull_requests: [{ number: 42 }], ...over })
const gate = (over = {}) => ({ id: 700, name: 'CI Gate', app: { slug: 'github-actions' }, check_suite: { id: SUITE }, head_sha: HEAD, status: 'completed', conclusion: 'success', ...over })
async function resolve({ event = 'workflow_dispatch', inputs = { pr_number: '42' }, workflowRun = ciRun(), prs = [prFixture(), prFixture()], runs = [ciRun()], checks = [gate()] } = {}) {
  const calls = []; const outputs = {}; let pullIdx = 0
  const listWorkflowRuns = async (p) => { calls.push(['listWorkflowRuns', p]); return { data: { workflow_runs: runs } } }
  const listForRef = async (p) => { calls.push(['listForRef', p]); return { data: { check_runs: checks } } }
  const github = {
    paginate: async (method, p) => { if (method === listWorkflowRuns) { await method(p); return runs } if (method === listForRef) { await method(p); return checks } throw new Error('unexpected paginate target') },
    rest: {
      pulls: { get: async (p) => { calls.push(['pulls.get', p]); const pr = prs[Math.min(pullIdx, prs.length - 1)]; pullIdx += 1; return { data: pr } } },
      actions: { listWorkflowRuns, listWorkflowRunsForRepo: async (p) => { calls.push(['listWorkflowRunsForRepo', p]); return { data: { workflow_runs: runs } } } },
      checks: { listForRef, create: async (p) => { calls.push(['checks.create', p]); return { data: { id: 1 } } }, update: async (p) => { calls.push(['checks.update', p]); return { data: { id: p.check_run_id } } } },
    },
  }
  const context = { eventName: event, repo: REPO, runId: 1, payload: event === 'workflow_run' ? { workflow_run: workflowRun } : { inputs } }
  const core = { setOutput: (k, v) => { outputs[k] = v }, notice: (m) => calls.push(['notice', m]) }
  await new AsyncFunction('github', 'context', 'core', resolveScript())(github, context, core)
  return { outputs, calls, mutations: calls.filter(([n]) => n === 'checks.create' || n === 'checks.update') }
}

test('R-25: workflow_dispatch has an OPTIONAL head_sha input; pr_number stays required; trigger, permissions and staging concurrency are unchanged', () => {
  const on = workflow.slice(workflow.indexOf('  workflow_dispatch:'), workflow.indexOf('concurrency:'))
  assert.match(on, /\n {6}pr_number:\n {8}description: [^\n]+\n {8}required: true\n {8}type: string\n/)
  assert.match(on, /\n {6}head_sha:\n {8}description: >-\n(?: {10}[^\n]+\n)+ {8}required: false\n {8}type: string\n/)
  assert.match(workflow, /^permissions:\n {2}actions: read\n {2}checks: write\n {2}contents: read\n {2}pull-requests: write\n/m, 'workflow permissions unchanged')
  assert.match(workflow, /concurrency:\n(?: {2}#[^\n]*\n)* {2}group: staging-release-candidate\n {2}cancel-in-progress: false\n/)
})

test('R-25: a dispatch naming the EXACT current PR head resolves that head (and only that head)', async () => {
  const r = await resolve({ inputs: { pr_number: '42', head_sha: HEAD } })
  assert.equal(r.outputs.eligible, 'true'); assert.equal(r.outputs.sha, HEAD); assert.equal(r.outputs.ci_run_id, '500')
  assert.deepEqual(r.mutations.map(([, p]) => p.head_sha), [HEAD], 'the Staging Gate check is created for the requested head')
  const lw = r.calls.find(([n]) => n === 'listWorkflowRuns'); assert.equal(lw[1].workflow_id, 'ci.yml'); assert.equal(lw[1].head_sha, HEAD)
  assert.ok(!r.calls.some(([n]) => n === 'listWorkflowRunsForRepo'), 'never a repository-wide, name-matched run search')
})

test('R-25: a dispatch whose head_sha differs from the PR head is refused BEFORE any check or staging mutation; a newer head is never substituted', async () => {
  const r = await resolve({ inputs: { pr_number: '42', head_sha: HEAD }, prs: [prFixture(NEWER)] })
  assert.equal(r.outputs.eligible, 'false'); assert.equal(r.outputs.sha, undefined, 'no candidate sha is emitted'); assert.deepEqual(r.mutations, [])
  assert.ok(!r.calls.some(([n]) => n === 'listWorkflowRuns' || n === 'listForRef'), 'refused at the first PR read')
  assert.ok(r.calls.some(([n, m]) => n === 'notice' && m.includes(NEWER) && m.includes(HEAD)), 'the refusal names both heads')
})

test('R-25: a malformed head_sha is refused before ANY GitHub call', async () => {
  for (const bad of ['abc', HEAD.slice(0, 7), HEAD.toUpperCase(), `${HEAD}0`, ` ${HEAD}`, `${HEAD.slice(0, 39)}g`, 'refs/heads/main', '--help']) {
    const r = await resolve({ inputs: { pr_number: '42', head_sha: bad } })
    assert.equal(r.outputs.eligible, 'false', bad); assert.deepEqual(r.calls.filter(([n]) => n !== 'notice'), [], `${bad}: no API call at all`)
  }
})

test('R-25: the PR head moving DURING resolution is refused at the existing trusted re-check (no Staging Gate, no staging work)', async () => {
  const r = await resolve({ inputs: { pr_number: '42', head_sha: HEAD }, prs: [prFixture(HEAD), prFixture(NEWER)] })
  assert.equal(r.outputs.eligible, 'false'); assert.deepEqual(r.mutations, []); assert.equal(r.calls.filter(([n]) => n === 'pulls.get').length, 2, 'the fresh re-read happened')
  const legacy = await resolve({ inputs: { pr_number: '42' }, prs: [prFixture(HEAD), prFixture(NEWER)] }); assert.equal(legacy.outputs.eligible, 'false', 'the same re-check protects legacy callers')
})

test('R-25: existing manual callers WITHOUT head_sha keep their behaviour (current PR head)', async () => {
  for (const inputs of [{ pr_number: '42' }, { pr_number: '42', head_sha: '' }, { pr_number: '42', required_flags: 'flag_a' }]) {
    const r = await resolve({ inputs }); assert.equal(r.outputs.eligible, 'true', JSON.stringify(inputs)); assert.equal(r.outputs.sha, HEAD)
  }
  assert.equal((await resolve({ inputs: { pr_number: '42', required_flags: 'flag_a,flag_b' } })).outputs.flags_csv, 'flag_a,flag_b', 'required_flags still wins')
  for (const n of ['0', '-1', 'x', '']) assert.equal((await resolve({ inputs: { pr_number: n } })).outputs.eligible, 'false', `pr_number ${n}`)
})

test('R-25: workflow_run behaviour is unchanged for the real CI workflow, and now refuses a run that is not the repository CI workflow for that head', async () => {
  const ok = await resolve({ event: 'workflow_run' }); assert.equal(ok.outputs.eligible, 'true'); assert.equal(ok.outputs.sha, HEAD); assert.equal(ok.outputs.ci_run_id, '500')
  assert.ok(!ok.calls.some(([n]) => n === 'listWorkflowRuns'), 'workflow_run takes its run from the event, as before')
  for (const [why, workflowRun] of [['failed run', ciRun({ conclusion: 'failure' })], ['no PR', ciRun({ pull_requests: [] })], ['another workflow named CI', ciRun({ path: '.github/workflows/fake-ci.yml' })], ['fork head', ciRun({ head_repository: { full_name: 'evil/PatelRep' } })]]) {
    const r = await resolve({ event: 'workflow_run', workflowRun }); assert.equal(r.outputs.eligible, 'false', why); assert.deepEqual(r.mutations, [], why)
  }
})

test('R-25: CI selection is exact-source — the LATEST ci.yml run for the head must have succeeded; an older success never masks a newer failure', async () => {
  const older = ciRun({ id: 400, run_number: 9 }); const newerFail = ciRun({ id: 501, run_number: 11, conclusion: 'failure' }); const newerPending = ciRun({ id: 502, run_number: 12, status: 'in_progress', conclusion: null })
  assert.equal((await resolve({ runs: [older, newerFail] })).outputs.eligible, 'false', 'newer failure wins')
  assert.equal((await resolve({ runs: [newerFail, older] })).outputs.eligible, 'false', 'order of the listing does not matter')
  assert.equal((await resolve({ runs: [older, newerPending] })).outputs.eligible, 'false', 'a newer run still running is not a success yet')
  assert.equal((await resolve({ runs: [ciRun({ path: '.github/workflows/other.yml', run_number: 99 }), older], checks: [gate({ check_suite: { id: SUITE } })] })).outputs.ci_run_id, '400', 'a run of any other workflow file is ignored')
  assert.equal((await resolve({ runs: [ciRun({ head_repository: { full_name: 'evil/PatelRep' } })] })).outputs.eligible, 'false', 'a fork run never counts')
  assert.equal((await resolve({ runs: [] })).outputs.eligible, 'false')
})

test('R-25: CI Gate is bound to the selected CI run — the github-actions check in THAT check suite, newest attempt; another app, another suite or another head never counts', async () => {
  const bad = { 'another app': [gate({ app: { slug: 'spoofer' } })], 'another suite': [gate({ check_suite: { id: 1 } })], 'another head': [gate({ head_sha: NEWER })], 'still running': [gate({ status: 'in_progress', conclusion: null })], 'failed': [gate({ conclusion: 'failure' })],
    'newest attempt failed': [gate({ id: 700 }), gate({ id: 701, conclusion: 'failure' })], 'only a foreign success': [gate({ conclusion: 'failure' }), gate({ id: 900, app: { slug: 'spoofer' } })] }
  for (const [why, checks] of Object.entries(bad)) { const r = await resolve({ checks }); assert.equal(r.outputs.eligible, 'false', why); assert.deepEqual(r.mutations, [], why) }
  assert.equal((await resolve({ checks: [gate({ id: 700, conclusion: 'failure' }), gate({ id: 701 })] })).outputs.eligible, 'true', 're-run attempt 2 succeeded (same suite, newer check)')
  const listed = (await resolve()).calls.find(([n]) => n === 'listForRef'); assert.equal(listed[1].filter, 'all', 'every attempt is listed, then the newest is chosen')
})

test('R-25: no staging job can mutate anything unless the candidate resolved eligible', () => {
  const jobs = [...workflow.matchAll(/^ {2}([a-z][a-z-]+):\n/gm)].map((m) => m[1]); assert.deepEqual(jobs, ['resolve-candidate', 'prepare-staging-database', 'deploy-api', 'deploy-web', 'verify-staging', 'finalize-staging-gate'])
  const block = (j) => { const i = workflow.indexOf(`\n  ${j}:\n`); const n = jobs[jobs.indexOf(j) + 1]; return workflow.slice(i, n ? workflow.indexOf(`\n  ${n}:\n`) : undefined) }
  assert.match(block('prepare-staging-database'), /\n {4}needs: resolve-candidate\n {4}if: needs\.resolve-candidate\.outputs\.eligible == 'true'\n/)
  for (const j of ['deploy-api', 'deploy-web', 'verify-staging']) { assert.match(block(j), /\n {4}needs: \[resolve-candidate, [a-z-, ]+\]\n/, j); assert.doesNotMatch(block(j), /\n {4}if: [^\n]*always\(\)/, `${j} has no job-level always(): it is skipped when what it needs was skipped`) }
  assert.match(block('deploy-api'), /needs: \[resolve-candidate, prepare-staging-database\]/); assert.match(block('verify-staging'), /prepare-staging-database/)
  assert.match(block('finalize-staging-gate'), /\n {4}if: always\(\) && needs\.resolve-candidate\.outputs\.eligible == 'true'\n/, 'the gate report runs only for an eligible candidate')
})

test('staging API identity check retries inside the polling loop instead of aborting under bash -e', () => {
  const start = workflow.indexOf('- name: Require API health, readiness, staging database, and exact SHA')
  const step = workflow.slice(start, workflow.indexOf('env:', start))
  assert.match(step, /if node -e '[^\n]*r\.release_sha!==process\.env\.CANDIDATE_SHA\) process\.exit\(1\)'; then\s+exit 0\s+fi/)
  assert.doesNotMatch(step, /^\s*node -e /m, 'a bare node check under bash -e aborts on the first stale-container response')
  assert.match(step, /sleep 10/)
})
