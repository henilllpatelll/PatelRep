/** Contract for .github/workflows/staging-reviewed-migration-preview.yml: trust boundary, approval gate, no escalation. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/staging-reviewed-migration-preview.yml', 'utf8').replace(/\r\n/g, '\n')
const jobNames = ['verify-request', 'plan', 'authorize', 'apply']
const jobs = Object.fromEntries(jobNames.map((name, index) => {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  const end = index + 1 < jobNames.length ? workflow.indexOf(`\n  ${jobNames[index + 1]}:\n`) : workflow.length
  assert.ok(start > 0, `job ${name} exists`)
  return [name, workflow.slice(start, end)]
}))
const stepsOf = (job) => job.split(/\n      - /).slice(1).map((step) => `- ${step}`)
const SECRET = 'secrets.STAGING_SUPABASE_DB_URL'

test('manual dispatch only, from main only, with exactly the four restated inputs', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n/m)
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|pull_request_target|workflow_run|schedule|repository_dispatch):/m)
  const inputs = [...workflow.matchAll(/^      ([a-z_]+):\n        description:/gm)].map((match) => match[1])
  assert.deepEqual(inputs, ['preview_id', 'pr_number', 'head_sha', 'file_digests'])
  assert.match(jobs['verify-request'], /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(jobs.plan, /needs: verify-request/)
  assert.match(jobs.authorize, /needs: plan/)
  assert.match(jobs.apply, /needs: \[verify-request, plan, authorize\]/, 'apply can never run without the authorization job')
  assert.match(workflow, /^permissions:\n  contents: read\n/m)
})

test('the authorization job is the human gate: protected environment, no secrets, no code, no permissions', () => {
  assert.match(jobs.authorize, /environment: staging-migration-approval\n/)
  assert.match(jobs.authorize, /permissions: \{\}/)
  assert.doesNotMatch(jobs.authorize, /secrets\.|actions\/checkout|node |uses:/)
  for (const name of ['plan', 'apply']) assert.match(jobs[name], /environment: staging\n/)
  assert.doesNotMatch(jobs['verify-request'], /environment:|secrets\./, 'request verification holds no secret')
})

test('the plan and apply jobs share the staging lock with Staging Candidate and never cancel in progress', () => {
  const candidate = readFileSync('.github/workflows/staging-candidate.yml', 'utf8')
  const group = candidate.match(/^  group: (.+)$/m)[1]
  for (const name of ['plan', 'apply']) {
    assert.match(jobs[name], new RegExp(`\\n    concurrency:\\n      group: ${group}\\n      cancel-in-progress: false\\n`))
  }
  assert.doesNotMatch(jobs.authorize, /concurrency:/, 'waiting for approval never holds the shared staging lock')
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*(true|\$\{\{)/)
})

test('the only secret is the staging database URL, and only in plan/apply steps that run from the trusted checkout', () => {
  const secrets = [...new Set([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]))]
  assert.deepEqual(secrets, ['STAGING_SUPABASE_DB_URL'])
  assert.doesNotMatch(workflow, /RAILWAY|VERCEL|SERVICE_ROLE|PRODUCTION_SUPABASE_DB_URL|secrets\.PRODUCTION/i)
  for (const name of ['plan', 'apply']) {
    for (const step of stepsOf(jobs[name]).filter((item) => item.includes(SECRET))) {
      assert.match(step, /working-directory: \.trusted-control-plane/, `${step.match(/name: (.+)/)?.[1]} sees the secret and must run from the trusted checkout`)
    }
  }
  // Production values appear only as non-secret hostnames feeding the denylist of the target guard.
  for (const line of workflow.split('\n').filter((item) => /PRODUCTION_/.test(item))) {
    assert.match(line, /PRODUCTION_(DATABASE|SUPABASE)_HOST: \$\{\{ vars\.PRODUCTION_(DATABASE|SUPABASE)_HOST \}\}/)
  }
})

test('trusted checkout of the workflow commit, candidate checkout as data, shadow refusal, trust assertion first', () => {
  for (const name of ['verify-request', 'plan', 'apply']) {
    const job = jobs[name]
    const candidate = job.indexOf('ref: ${{ inputs.head_sha }}')
    const prove = job.indexOf('test "$(git rev-parse HEAD)" = "$PREVIEW_HEAD_SHA"')
    const shadow = job.indexOf('test ! -e .trusted-control-plane')
    const trusted = job.indexOf('path: .trusted-control-plane')
    const assertion = job.indexOf('node scripts/staging-trusted-control-plane.mjs assert')
    const firstPrivileged = job.indexOf('node scripts/check-migrations.mjs')
    assert.ok(candidate > 0 && prove > candidate && shadow > prove && trusted > shadow && assertion > trusted && firstPrivileged > assertion, `${name}: ordering`)
    const checkouts = stepsOf(job).filter((step) => step.includes('actions/checkout'))
    assert.equal(checkouts.length, 2)
    for (const step of checkouts) assert.match(step, /persist-credentials: false/)
    assert.match(checkouts[1], /ref: \$\{\{ github\.sha \}\}/)
    assert.doesNotMatch(checkouts[1], /inputs\./, 'the trusted ref never derives from an input')
    for (const step of stepsOf(job).filter((item) => /node scripts\//.test(item))) {
      assert.match(step, /working-directory: \.trusted-control-plane/, 'every script runs from the trusted checkout')
      if (/staging-target-guard\.mjs/.test(step)) continue // reads only the target identity, never migrations
      assert.match(step, /STAGING_CANDIDATE_MIGRATIONS_DIR: \$\{\{ github\.workspace \}\}\/supabase\/migrations/, 'candidate migrations are passed only as the data directory')
    }
  }
})

test('no candidate code, package manager, interpreter or SQL file ever runs', () => {
  assert.doesNotMatch(workflow, /\bnpm\b|\bnpx\b|\byarn\b|\bpnpm\b|\bpip\b|\bpython\b|setup-python|\bbash \.\/|\bsh \.\//)
  assert.doesNotMatch(workflow, /psql[^\n]*--file (?!scripts\/schema-contracts\.sql)/)
  const psqlFile = stepsOf(jobs.apply).find((step) => step.includes('--file scripts/schema-contracts.sql'))
  assert.match(psqlFile, /working-directory: \.trusted-control-plane/, 'only main\'s schema contracts are executed')
  for (const step of stepsOf(workflow).filter((item) => item.includes('actions/setup-node'))) assert.match(step, /package-manager-cache: false/)
})

test('dispatch inputs never reach a shell through expression interpolation', () => {
  for (const step of stepsOf(workflow)) {
    const run = step.match(/\n {8}run: [|>]?\n?([\s\S]*?)(?=\n {8}[a-z-]+:|$)/)?.[1] ?? ''
    assert.doesNotMatch(run, /\$\{\{\s*(inputs|github\.event)\./, `${step.match(/name: (.+)/)?.[1] ?? 'step'} interpolates an input into a shell`)
  }
  for (const name of ['verify-request', 'plan', 'apply']) assert.match(jobs[name], /\^\[0-9a-f\]\{40\}\$/, `${name} validates head_sha shape`)
})

test('never resets, repairs, force-pushes history or applies outside the verified driver', () => {
  assert.doesNotMatch(workflow, /db reset|migration repair|--include-all|db push|migration up|supabase_migrations\.schema_migrations|DELETE FROM|TRUNCATE/i)
  assert.match(jobs.apply, /node scripts\/staging-reviewed-migration-preview\.mjs apply/)
  assert.match(jobs.apply, /node scripts\/staging-reviewed-migration-preview\.mjs verify-applied/)
  assert.match(jobs.plan, /node scripts\/staging-reviewed-migration-preview\.mjs plan/)
  assert.doesNotMatch(jobs.plan, /preview\.mjs apply/)
  assert.ok(jobs.apply.indexOf('staging-target-guard.mjs') < jobs.apply.indexOf('preview.mjs apply'), 'target guard before apply')
  assert.match(jobs.apply, /version: 2\.112\.0/)
  assert.match(jobs.plan, /version: 2\.112\.0/)
})

test('apply reads this run\'s recorded approvals and passes them to the driver', () => {
  assert.match(jobs.apply, /GET \/repos\/\{owner\}\/\{repo\}\/actions\/runs\/\{run_id\}\/approvals/)
  assert.match(jobs.apply, /PREVIEW_RUN_APPROVALS_JSON: \$\{\{ steps\.live\.outputs\.approvals \}\}/)
  assert.doesNotMatch(workflow, /getCollaboratorPermissionLevel|permissions\[/, 'approvers are matched against the required reviewers only')
  for (const name of ['verify-request', 'plan', 'apply']) {
    assert.match(jobs[name], /PREVIEW_LIVE_PR_JSON: \$\{\{ steps\.live\.outputs\.pr \}\}/, `${name} re-reads the live PR`)
    assert.match(jobs[name], /PREVIEW_APPROVAL_ENVIRONMENT_JSON: \$\{\{ steps\.live\.outputs\.environment \}\}/)
  }
})

test('the normal staging workflows are unchanged: no preview hook, destructive refusal intact', () => {
  for (const file of ['staging-candidate.yml', 'staging-db-migrate.yml']) {
    const text = readFileSync(`.github/workflows/${file}`, 'utf8')
    assert.doesNotMatch(text, /staging-reviewed-migration|staging-migration-approval|PREVIEW_/)
  }
  assert.match(readFileSync('scripts/staging-migration-plan.mjs', 'utf8'), /Refusing to auto-apply destructive pending migration\(s\) to persistent staging/)
})
