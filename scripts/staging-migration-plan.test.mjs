import assert from 'node:assert/strict'
import test from 'node:test'

import { planStagingMigrations } from './staging-migration-plan.mjs'

const migrations = [
  { filename: '001_a.sql', version: '001', content: 'create table a(id int);' },
  { filename: '002_b.sql', version: '002', content: 'alter table a add column b int;' },
  { filename: '003_c.sql', version: '003', content: 'drop table a;' },
]
const evaluation = (overrides) => ({ status: 'PENDING', missingOnRemote: [], unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [] }, ...overrides })

test('a clean staging history has nothing to apply', () => {
  assert.deepEqual(planStagingMigrations({ evaluation: evaluation({ status: 'CLEAN' }), migrations }), { pending: [] })
})

test('plans only the migrations staging has not applied, matching versions without zero padding', () => {
  assert.deepEqual(planStagingMigrations({ evaluation: evaluation({ missingOnRemote: ['2'] }), migrations }), { pending: ['002_b.sql'] })
})

test('refuses when staging holds migrations this candidate does not know (never reset to match)', () => {
  assert.throws(
    () => planStagingMigrations({ evaluation: evaluation({ status: 'BLOCKED', unknownOnRemote: ['500'] }), migrations }),
    /Unknown on staging: 500.*never reset/s,
  )
})

test('refuses to auto-apply destructive pending migrations to persistent staging', () => {
  assert.throws(
    () => planStagingMigrations({ evaluation: evaluation({ missingOnRemote: ['2', '3'] }), migrations }),
    /destructive pending migration\(s\).*003_c\.sql/s,
  )
})

test('refuses incomplete duplicate-identifier coverage', () => {
  assert.throws(
    () => planStagingMigrations({ evaluation: evaluation({ status: 'BLOCKED', duplicateCoverage: { incompleteGroups: [{}] } }), migrations }),
    /Duplicate-identifier coverage is incomplete/,
  )
})
