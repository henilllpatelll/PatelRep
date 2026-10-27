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

test('guards the remote rebuild, installs psql before drift verification, and proves API/web identity before staging smoke', () => {
  const guard = workflow.indexOf('node scripts/staging-target-guard.mjs')
  const remoteRebuild = workflow.indexOf('node scripts/remote-migration-apply.mjs')
  const postgresClient = workflow.indexOf('apt-get install --yes postgresql-client')
  const driftCheck = workflow.indexOf('node scripts/check-db-drift.mjs --environment staging')
  const fixtureAccess = workflow.indexOf('Grant staging fixture service access')
  const fixtureSeed = workflow.indexOf('npm run seed:staging-fixture')
  assert.ok(guard >= 0 && remoteRebuild > guard, 'target guard must execute before remote rebuild')
  assert.ok(postgresClient >= 0 && postgresClient < driftCheck, 'psql must be installed before drift verification')
  assert.ok(fixtureAccess > driftCheck && fixtureAccess < fixtureSeed, 'fixture service access must be established only after clean drift verification and before seeding')
  assert.match(workflow, /grant all privileges on all tables in schema public to service_role/i)
  assert.match(workflow, /grant all privileges on all tables in schema public to service_role;[^"]*notify pgrst, 'reload schema'/i, 'PostgREST must reload its schema cache after the rebuild and grants, before the API serves the smoke')
  assert.match(workflow, /npm run check:staging-health/)
  assert.match(workflow, /npm run test:e2e:staging/)
  assert.match(workflow, /npm run check:deployment-drift/)
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
  // Production keeps the account token and is not touched by this change.
  for (const wf of [productionRelease, productionRollback]) {
    assert.match(wf, /RAILWAY_API_TOKEN: \$\{\{ secrets\.PRODUCTION_RAILWAY_API_TOKEN \}\}/)
    assert.doesNotMatch(wf, /^\s*RAILWAY_TOKEN:/m)
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
