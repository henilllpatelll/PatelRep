import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { assertValidFixtureUsers, preferredName, STAGING_FIXTURE_USERS, usersWithRole } from './staging-fixture-users.mjs'

test('the original six staging accounts are preserved exactly', () => {
  const original = [
    ['staging-gm@patelrep.test', 'Staging GM', 'gm'],
    ['staging-front-desk@patelrep.test', 'Staging Front Desk', 'front_desk'],
    ['staging-housekeeping-supervisor@patelrep.test', 'Staging Housekeeping Supervisor', 'housekeeping_supervisor'],
    ['staging-housekeeper@patelrep.test', 'Staging Housekeeper', 'housekeeper'],
    ['staging-chief-engineer@patelrep.test', 'Staging Chief Engineer', 'chief_engineer'],
    ['staging-engineer@patelrep.test', 'Staging Engineer', 'engineer'],
  ]
  for (const [email, fullName, role] of original) {
    const found = STAGING_FIXTURE_USERS.find((user) => user.email === email)
    assert.ok(found, `${email} must still be seeded`)
    assert.equal(found.fullName, fullName)
    assert.equal(found.role, role)
  }
})

test('there are exactly two housekeepers and the original one stays first', () => {
  const housekeepers = usersWithRole('housekeeper')
  assert.deepEqual(housekeepers.map((user) => user.email), ['staging-housekeeper@patelrep.test', 'staging-housekeeper-2@patelrep.test'])
  assert.notEqual(housekeepers[0].fullName, housekeepers[1].fullName)
})

test('both housekeepers are explicitly in the housekeeping department', () => {
  for (const user of usersWithRole('housekeeper')) assert.equal(user.department, 'HK')
})

test('every other role has exactly one user (nothing else changed)', () => {
  for (const role of ['gm', 'front_desk', 'housekeeping_supervisor', 'chief_engineer', 'engineer']) {
    assert.equal(usersWithRole(role).length, 1, role)
  }
})

test('the list is valid: unique keys and emails, synthetic lower-case addresses', () => {
  assert.doesNotThrow(() => assertValidFixtureUsers())
})

test('a duplicate key, a duplicate email or a real-looking address is refused', () => {
  const base = { key: 'a', email: 'a@patelrep.test', fullName: 'A', role: 'gm', department: null }
  assert.throws(() => assertValidFixtureUsers([base, { ...base, email: 'b@patelrep.test' }]), /Duplicate fixture user key/)
  assert.throws(() => assertValidFixtureUsers([base, { ...base, key: 'b' }]), /Duplicate fixture user email/)
  assert.throws(() => assertValidFixtureUsers([{ ...base, email: 'someone@gmail.com' }]), /synthetic/)
  assert.throws(() => assertValidFixtureUsers([{ ...base, email: 'A@patelrep.test' }]), /lower case/)
})

test('preferred names drop the Staging prefix', () => {
  assert.equal(preferredName('Staging Housekeeper Two'), 'Housekeeper Two')
})

test('the seed keys everything it writes by user key, so two housekeepers cannot overwrite each other', () => {
  const seed = readFileSync(new URL('./seed-staging-tenant.mjs', import.meta.url), 'utf8')
  assert.match(seed, /from '\.\/staging-fixture-users\.mjs'/)
  assert.match(seed, /userIds\[user\.key\] = userId/)
  assert.doesNotMatch(seed, /userIds\[role\]/, 'indexing by role would collapse the two housekeepers into one id')
  assert.match(seed, /for \(const user of usersWithRole\('housekeeper'\)\)/, 'every housekeeper needs a housekeeper profile')
  assert.match(seed, /APP_ENV !== 'staging'/)
  assert.match(seed, /new URL\(SUPABASE_URL\)\.hostname !== EXPECTED_HOST/)
})

// The seed imports the Supabase SDK before its guards run, so this needs the web dependencies installed (CI always has them).
const sdkInstalled = (() => {
  try { import.meta.resolve('@supabase/supabase-js'); return true } catch { return false }
})()

test('the seed refuses to run without explicit staging confirmation', { skip: !sdkInstalled && '@supabase/supabase-js is not installed here' }, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./seed-staging-tenant.mjs', import.meta.url))], {
    env: { ...process.env, APP_ENV: '', SEED_STAGING_FIXTURES: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Refusing fixture seed: set APP_ENV=staging and SEED_STAGING_FIXTURES=confirm/)
})
