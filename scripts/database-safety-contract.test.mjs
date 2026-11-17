import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

// Repository-wide contract: no automation may reset, wipe or replay-from-scratch a shared (staging/production)
// database. Destructive replay is allowed only against an isolated local stack (`--local`) or a loopback disposable.

const workflows = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: readFileSync(`.github/workflows/${name}`, 'utf8') }))
const scripts = readdirSync('scripts')
  .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
  .map((name) => ({ name, text: readFileSync(`scripts/${name}`, 'utf8') }))

const stripComments = (text) => text.split('\n').filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line)).join('\n')

test('every `supabase db reset` in a workflow targets the isolated local stack', () => {
  for (const { name, text } of workflows) {
    for (const line of stripComments(text).split('\n').filter((candidate) => /\bdb\s+reset\b/.test(candidate))) {
      assert.match(line, /--local\b/, `${name}: ${line.trim()}`)
      assert.doesNotMatch(line, /--db-url|--linked/, `${name}: ${line.trim()}`)
    }
  }
})

test('no workflow wipes, repairs history, or drops a database/schema', () => {
  for (const { name, text } of workflows) {
    assert.doesNotMatch(stripComments(text), /\bmigration\s+repair\b|\bDROP\s+(SCHEMA|DATABASE)\b|\bTRUNCATE\b/i, name)
  }
})

// A blanket table grant re-opens TRUNCATE (and UPDATE/DELETE on append-only tables) on the protected agent audit
// tables (#230). Every workflow step that issues one must re-assert least privilege with the migration-254 function
// AFTER the grant and in the SAME transaction (one psql --command, or --single-transaction), so no run can leave the
// restrictions silently undone.
const BLANKET_TABLE_GRANT = /grant\s+all(?:\s+privileges)?\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+service_role/i
const workflowSteps = (text) => stripComments(text).split(/\n\s*-\s+(?=name:|uses:|run:)/)

test('every blanket service_role table grant re-asserts agent audit least privilege in the same transaction', () => {
  let grantSteps = 0
  for (const { name, text } of workflows) {
    for (const step of workflowSteps(text).filter((candidate) => BLANKET_TABLE_GRANT.test(candidate))) {
      grantSteps += 1
      const grantAt = step.search(BLANKET_TABLE_GRANT)
      const enforceAt = step.indexOf('public.agent_audit_privileges_enforce()', grantAt)
      assert.ok(enforceAt > grantAt, `${name}: a blanket table grant must be followed by agent_audit_privileges_enforce()`)
      assert.match(step, /PERFORM public\.agent_audit_privileges_enforce\(\)/i, `${name}: the enforcement must run, not just be named`)
      const oneCommand = /--command\s+"[^"]*grant\s+all[^"]*agent_audit_privileges_enforce\(\)[^"]*"/i.test(step)
      assert.ok(oneCommand || /--single-transaction/.test(step), `${name}: grant and enforcement must share one transaction`)
    }
  }
  assert.equal(grantSteps, 2, 'expected exactly the CI Gate and Staging Candidate blanket grants; review any new one')
})

// A blanket service_role function grant re-opens the owner-only migration-254 functions (#230). Only the throwaway
// CI database may issue one, and it must revoke exactly the functions the schema contract requires to be owner-only,
// after the grant and in the same transaction, so the integration tests run with deployed function privileges.
const BLANKET_FUNCTION_GRANT = /grant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+public\s+to\s+service_role/i
const OWNER_ONLY_CONTRACT = /owner-only[\s\S]*?procs\.proname IN \(([^)]*)\)[\s\S]*?NOT has_function_privilege\('service_role'/

test('every blanket service_role function grant re-revokes the owner-only hardening functions', () => {
  const contract = readFileSync('scripts/schema-contracts.sql', 'utf8').match(OWNER_ONLY_CONTRACT)
  assert.ok(contract, 'schema-contracts.sql must keep the owner-only hardening function check')
  const ownerOnly = [...contract[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort()
  assert.equal(ownerOnly.length, 6)
  let grantSteps = 0
  for (const { name, text } of workflows) {
    for (const step of workflowSteps(text).filter((candidate) => BLANKET_FUNCTION_GRANT.test(candidate))) {
      grantSteps += 1
      assert.equal(name, 'ci.yml', `${name}: only the throwaway CI database may grant every function to service_role`)
      assert.match(step, /--single-transaction/, `${name}: grant and revoke must share one transaction`)
      const tail = step.slice(step.search(BLANKET_FUNCTION_GRANT))
      const revoke = tail.match(/REVOKE ALL ON FUNCTION ([^;]*?)\s+FROM service_role;/)
      assert.ok(revoke, `${name}: the blanket function grant must be followed by a REVOKE ... FROM service_role`)
      const revoked = [...revoke[1].matchAll(/public\.([a-z_]+)\(\)/g)].map((match) => match[1]).sort()
      assert.deepEqual(revoked, ownerOnly, `${name}: revoke exactly the schema contract's owner-only functions`)
    }
  }
  assert.equal(grantSteps, 1, 'expected exactly the CI Gate blanket function grant; review any new one')
})

test('the from-scratch replay tool is not wired into any workflow', () => {
  for (const { name, text } of workflows) {
    assert.doesNotMatch(stripComments(text), /remote-migration-apply[.]mjs/, name)
  }
})

test('no repository script spawns a Supabase database reset except against the local stack', () => {
  for (const { name, text } of scripts) {
    const code = stripComments(text)
    const resets = code.match(/['"]db['"],\s*['"]reset['"][^\]]*\]/g) ?? []
    for (const call of resets) {
      assert.match(call, /['"]--local['"]/, `${name}: ${call}`)
      assert.doesNotMatch(call, /--db-url|--linked/, `${name}: ${call}`)
    }
  }
})

test('the CI migration replay runs only on the isolated local Supabase stack', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  assert.match(ci, /supabase start --workdir "\$\{\{ runner\.temp \}\}\/migration-replay"/)
  assert.match(ci, /supabase db reset --local --workdir "\$\{\{ runner\.temp \}\}\/migration-replay"/)
})

test('manual Staging Database Migrate is main-only, guarded, forward-only and never resets', () => {
  const workflow = readFileSync('.github/workflows/staging-db-migrate.yml', 'utf8')
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /node scripts\/staging-target-guard\.mjs/)
  assert.match(workflow, /node scripts\/staging-migration-apply-workspace\.mjs apply/)
  assert.doesNotMatch(workflow, /supabase db push|--include-all/)
  assert.doesNotMatch(workflow, /\bdb\s+reset\b/)
})

test('the staging fixture seed is additive: it never deletes users, tenants, assets, rooms or work orders', () => {
  const seed = readFileSync('apps/web/e2e/fixtures/seed-staging-tenant.mjs', 'utf8')
  assert.doesNotMatch(seed, /\.delete\s*\(|deleteUser|\btruncate\b|\.rpc\s*\(/i)
  assert.match(seed, /APP_ENV !== 'staging'/)
  assert.match(seed, /hostname !== EXPECTED_HOST/)
})

test('the staging fixture seed never UPDATEs rooms, which have no updated_at column but still carry trg_rooms_updated_at', () => {
  const seed = readFileSync('apps/web/e2e/fixtures/seed-staging-tenant.mjs', 'utf8')
  assert.doesNotMatch(seed, /from\('rooms'\)\.(upsert|update)/)
  assert.match(seed, /from\('rooms'\)\.insert\(/)
})

test('replay tool refuses non-disposable targets before it touches any database client', () => {
  const run = (...argv) => spawnSync(process.execPath, ['scripts/remote-migration-apply.mjs', ...argv], {
    // An empty PATH proves the refusal happens before psql/supabase could be invoked at all.
    env: { PATH: '', STAGING_SUPABASE_DB_URL: 'postgresql://postgres:x@db.stagingref.supabase.co:5432/postgres' },
    encoding: 'utf8',
  })
  const cases = [
    ['--db-url', 'postgresql://postgres:x@db.stagingref.supabase.co:5432/postgres', '--disposable'],
    ['--db-url', 'postgresql://postgres:x@127.0.0.1:54322/postgres'],
    ['--db-url', 'postgresql://postgres:x@127.0.0.1:54322/postgres?host=db.stagingref.supabase.co', '--disposable'],
    [],
  ]
  for (const argv of cases) {
    const result = run(...argv)
    assert.notEqual(result.status, 0, argv.join(' '))
    assert.match(result.stderr, /Refusing destructive database action|--db-url is required/, argv.join(' '))
  }
})

test('replay tool has no environment fallback to a shared database URL', () => {
  const source = readFileSync('scripts/remote-migration-apply.mjs', 'utf8')
  assert.doesNotMatch(stripComments(source), /process\.env\.(STAGING|PRODUCTION)_SUPABASE_DB_URL/)
  assert.match(source, /assertDisposableDatabaseTarget\(/)
  assert.ok(source.indexOf('assertDisposableDatabaseTarget(') < source.indexOf('evaluateBlankness(inspectTarget('), 'target check precedes any database read')
  assert.ok(source.indexOf('evaluateBlankness(') < source.indexOf('psqlFile(databaseUrl, wrappedPath)'), 'blank check precedes any write')
})
