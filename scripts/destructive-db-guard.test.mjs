import assert from 'node:assert/strict'
import test from 'node:test'

import { assertDisposableDatabaseTarget, configuredSharedHosts, DESTRUCTIVE_COMMAND_PATTERN, evaluateBlankness } from './destructive-db-guard.mjs'

const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const sharedEnv = {
  STAGING_SUPABASE_DB_URL: 'postgresql://postgres:secret@db.stagingref.supabase.co:5432/postgres',
  STAGING_EXPECTED_DATABASE_HOST: 'db.stagingref.supabase.co',
  PRODUCTION_DATABASE_HOST: 'db.prodref.supabase.co',
}

test('allows only an explicitly declared disposable loopback database', () => {
  assert.doesNotThrow(() => assertDisposableDatabaseTarget({ databaseUrl: local, env: sharedEnv, disposable: true }))
  assert.doesNotThrow(() => assertDisposableDatabaseTarget({ databaseUrl: 'postgres://u:p@localhost:5432/db', env: {}, disposable: true }))
  assert.doesNotThrow(() => assertDisposableDatabaseTarget({ databaseUrl: 'postgresql://u:p@[::1]:5432/db', env: {}, disposable: true }))
})

test('refuses everything unless the caller declares the target disposable', () => {
  assert.throws(() => assertDisposableDatabaseTarget({ databaseUrl: local, env: {} }), /explicitly declared disposable/)
  assert.throws(() => assertDisposableDatabaseTarget({ databaseUrl: local, env: {}, disposable: 'true' }), /explicitly declared disposable/)
})

test('refuses staging and production even when the wrong URL is supplied', () => {
  for (const databaseUrl of [
    sharedEnv.STAGING_SUPABASE_DB_URL,
    'postgresql://postgres:x@db.prodref.supabase.co:5432/postgres',
    'postgresql://postgres.ref:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres:x@roundhouse.proxy.rlwy.net:1234/railway',
    'postgresql://postgres:x@db.unknown.example.com:5432/postgres',
  ]) {
    assert.throws(() => assertDisposableDatabaseTarget({ databaseUrl, env: sharedEnv, disposable: true }), /Refusing destructive database action/, databaseUrl)
  }
})

test('refuses a loopback host that is configured as a shared environment (tunnel to staging or production)', () => {
  assert.throws(() => assertDisposableDatabaseTarget({ databaseUrl: local, env: { STAGING_EXPECTED_DATABASE_HOST: '127.0.0.1' }, disposable: true }), /configured staging\/production/)
  assert.throws(() => assertDisposableDatabaseTarget({ databaseUrl: local, env: { PRODUCTION_SUPABASE_DB_URL: local }, disposable: true }), /configured staging\/production/)
})

test('refuses libpq host overrides that would redirect a loopback-looking URL', () => {
  for (const parameter of ['host', 'hostaddr', 'service']) {
    assert.throws(
      () => assertDisposableDatabaseTarget({ databaseUrl: `${local}?${parameter}=db.prodref.supabase.co`, env: {}, disposable: true }),
      new RegExp(`"${parameter}" override`),
    )
  }
})

test('refuses missing, malformed, hostless and non-postgres URLs', () => {
  for (const databaseUrl of [undefined, '', 'not a url', 'postgresql:///postgres', 'https://127.0.0.1/postgres']) {
    assert.throws(() => assertDisposableDatabaseTarget({ databaseUrl, env: {}, disposable: true }), /Refusing destructive database action/, String(databaseUrl))
  }
})

test('collects every configured shared host', () => {
  const hosts = configuredSharedHosts(sharedEnv)
  assert.ok(hosts.has('db.stagingref.supabase.co') && hosts.has('db.prodref.supabase.co'))
})

test('a replay target must be completely blank', () => {
  assert.deepEqual(evaluateBlankness({ publicTableCount: 0, migrationRowCount: 0, authUserCount: 0 }), { blank: true, problems: [] })
  const dirty = evaluateBlankness({ publicTableCount: 120, migrationRowCount: 5, authUserCount: 7 })
  assert.equal(dirty.blank, false)
  assert.equal(dirty.problems.length, 3)
  assert.equal(evaluateBlankness({ publicTableCount: 0, migrationRowCount: 0, authUserCount: 1 }).blank, false)
})

test('destructive command detector recognises resets, repairs and wipes', () => {
  for (const text of ['supabase db reset --db-url x', 'npx supabase@2.112.0 db reset --linked', 'supabase migration repair --status reverted 1', 'DROP SCHEMA public CASCADE', 'TRUNCATE auth.users', 'DROP DATABASE postgres']) {
    assert.match(text, DESTRUCTIVE_COMMAND_PATTERN, text)
  }
  assert.doesNotMatch('supabase db push --db-url x', DESTRUCTIVE_COMMAND_PATTERN)
})
