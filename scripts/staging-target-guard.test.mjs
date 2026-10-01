import assert from 'node:assert/strict'
import test from 'node:test'

import { assertStagingTarget } from './staging-target-guard.mjs'

const safeTarget = {
  databaseUrl: 'postgresql://postgres:password@db.staging-project.supabase.co:5432/postgres',
  supabaseUrl: 'https://staging-project.supabase.co',
  expectedDatabaseHost: 'db.staging-project.supabase.co',
  expectedSupabaseHost: 'staging-project.supabase.co',
  productionDatabaseHost: 'db.production-project.supabase.co',
  productionSupabaseHost: 'production-project.supabase.co',
}

test('allows only the explicitly configured staging database and API hosts', () => {
  assert.doesNotThrow(() => assertStagingTarget(safeTarget))
})

test('blocks a destructive reset when a production database host is supplied', () => {
  assert.throws(
    () => assertStagingTarget({ ...safeTarget, databaseUrl: 'postgresql://postgres:password@db.production-project.supabase.co:5432/postgres' }),
    /expected staging database host/,
  )
})

test('blocks a staging fixture wired to the production Supabase API host', () => {
  assert.throws(
    () => assertStagingTarget({ ...safeTarget, supabaseUrl: 'https://production-project.supabase.co' }),
    /expected staging Supabase host/,
  )
})
