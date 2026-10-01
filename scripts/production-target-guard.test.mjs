import assert from 'node:assert/strict'
import test from 'node:test'

import { assertProductionTarget } from './production-target-guard.mjs'

const safeTarget = {
  databaseUrl: 'postgresql://postgres:password@db.production-project.supabase.co:5432/postgres',
  supabaseUrl: 'https://production-project.supabase.co',
  expectedDatabaseHost: 'db.production-project.supabase.co',
  expectedSupabaseHost: 'production-project.supabase.co',
  stagingDatabaseHost: 'db.staging-project.supabase.co',
  stagingSupabaseHost: 'staging-project.supabase.co',
}

test('allows only the explicitly configured production database and API hosts', () => {
  assert.doesNotThrow(() => assertProductionTarget(safeTarget))
})

test('blocks a release action when a staging database host is supplied', () => {
  assert.throws(
    () => assertProductionTarget({ ...safeTarget, databaseUrl: 'postgresql://postgres:password@db.staging-project.supabase.co:5432/postgres' }),
    /expected production database host/,
  )
})

test('blocks a release wired to the staging Supabase API host', () => {
  assert.throws(
    () => assertProductionTarget({ ...safeTarget, supabaseUrl: 'https://staging-project.supabase.co' }),
    /expected production Supabase host/,
  )
})
