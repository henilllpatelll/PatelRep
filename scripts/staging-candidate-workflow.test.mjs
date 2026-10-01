import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/staging-candidate.yml', 'utf8')

test('uses a trusted CI completion trigger and never pull_request_target', () => {
  assert.match(workflow, /workflow_run:/)
  assert.match(workflow, /workflows:\s*\[CI\]/)
  assert.doesNotMatch(workflow, /pull_request_target/)
  assert.match(workflow, /head\.repo\.full_name !== context\.repo\.owner \+ '\/' \+ context\.repo\.repo/)
})

test('serializes candidates and deploys one exact SHA through both services', () => {
  assert.match(workflow, /group: staging-release-candidate/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /name: 'Staging Gate'/)
  assert.match(workflow, /RELEASE_SHA/)
  assert.match(workflow, /NEXT_PUBLIC_RELEASE_SHA/)
  assert.match(workflow, /git checkout --detach "\$\{\{ needs\.resolve-candidate\.outputs\.sha \}\}"/)
})

test('links each release-identity update to its explicit staging Railway service', () => {
  const apiLink = workflow.indexOf('railway/cli@4.30.0 link --project "$STAGING_RAILWAY_PROJECT_ID" --environment staging --service "$STAGING_RAILWAY_API_SERVICE_ID"')
  const apiIdentity = workflow.indexOf('variables set RELEASE_SHA=')
  const webLink = workflow.indexOf('railway/cli@4.30.0 link --project "$STAGING_RAILWAY_PROJECT_ID" --environment staging --service "$STAGING_RAILWAY_WEB_SERVICE_ID"')
  const webIdentity = workflow.indexOf('variables set NEXT_PUBLIC_RELEASE_SHA=')
  assert.ok(apiLink >= 0 && apiLink < apiIdentity, 'API identity update must link the explicit staging API service first')
  assert.ok(webLink >= 0 && webLink < webIdentity, 'web identity update must link the explicit staging web service first')
  assert.match(workflow, /variables set RELEASE_SHA=.*--skip-deploys/)
  assert.match(workflow, /variables set NEXT_PUBLIC_RELEASE_SHA=.*--skip-deploys/)
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
  assert.match(workflow, /npm run check:staging-health/)
  assert.match(workflow, /npm run test:e2e:staging/)
  assert.match(workflow, /npm run check:deployment-drift/)
})
