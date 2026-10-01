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

test('guards the remote rebuild, installs psql before drift verification, and proves API/web identity before staging smoke', () => {
  const guard = workflow.indexOf('node scripts/staging-target-guard.mjs')
  const remoteRebuild = workflow.indexOf('node scripts/remote-migration-apply.mjs')
  const postgresClient = workflow.indexOf('apt-get install --yes postgresql-client')
  const driftCheck = workflow.indexOf('node scripts/check-db-drift.mjs --environment staging')
  assert.ok(guard >= 0 && remoteRebuild > guard, 'target guard must execute before remote rebuild')
  assert.ok(postgresClient >= 0 && postgresClient < driftCheck, 'psql must be installed before drift verification')
  assert.match(workflow, /npm run check:staging-health/)
  assert.match(workflow, /npm run test:e2e:staging/)
  assert.match(workflow, /npm run check:deployment-drift/)
})
