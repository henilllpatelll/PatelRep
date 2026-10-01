#!/usr/bin/env node

function hostname(value, label) {
  if (!value) throw new Error(`${label} is required.`)
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    throw new Error(`${label} must be a valid URL.`)
  }
}

function requiredHost(value, label) {
  const host = value?.trim().toLowerCase()
  if (!host) throw new Error(`${label} is required.`)
  return host
}

/**
 * Hard stop before any command that can mutate the production database.
 * Hostnames are non-secret GitHub Environment variables; credentials never print.
 */
export function assertProductionTarget({
  databaseUrl,
  supabaseUrl,
  expectedDatabaseHost,
  expectedSupabaseHost,
  stagingDatabaseHost = '',
  stagingSupabaseHost = '',
}) {
  const databaseHost = hostname(databaseUrl, 'PRODUCTION_SUPABASE_DB_URL')
  const apiHost = hostname(supabaseUrl, 'PRODUCTION_SUPABASE_URL')
  const expectedDb = requiredHost(expectedDatabaseHost, 'PRODUCTION_EXPECTED_DATABASE_HOST')
  const expectedApi = requiredHost(expectedSupabaseHost, 'PRODUCTION_EXPECTED_SUPABASE_HOST')
  const stagingDb = stagingDatabaseHost.trim().toLowerCase()
  const stagingApi = stagingSupabaseHost.trim().toLowerCase()

  if (databaseHost !== expectedDb || (stagingDb && databaseHost === stagingDb)) {
    throw new Error('Refusing production action: database URL is not the expected production database host.')
  }
  if (apiHost !== expectedApi || (stagingApi && apiHost === stagingApi)) {
    throw new Error('Refusing production action: Supabase URL is not the expected production Supabase host.')
  }
  if (expectedDb === stagingDb || expectedApi === stagingApi) {
    throw new Error('Refusing production action: production and staging host allowlists overlap.')
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  assertProductionTarget({
    databaseUrl: process.env.PRODUCTION_SUPABASE_DB_URL,
    supabaseUrl: process.env.PRODUCTION_SUPABASE_URL,
    expectedDatabaseHost: process.env.PRODUCTION_EXPECTED_DATABASE_HOST,
    expectedSupabaseHost: process.env.PRODUCTION_EXPECTED_SUPABASE_HOST,
    stagingDatabaseHost: process.env.STAGING_DATABASE_HOST,
    stagingSupabaseHost: process.env.STAGING_SUPABASE_HOST,
  })
  console.log('Production target identity validated; release database actions are allowed.')
}
