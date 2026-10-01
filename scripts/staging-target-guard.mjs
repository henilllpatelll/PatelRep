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
 * Hard stop before any command that can mutate the disposable staging database.
 * Hostnames are non-secret GitHub Environment variables; credentials never print.
 */
export function assertStagingTarget({
  databaseUrl,
  supabaseUrl,
  expectedDatabaseHost,
  expectedSupabaseHost,
  productionDatabaseHost = '',
  productionSupabaseHost = '',
}) {
  const databaseHost = hostname(databaseUrl, 'STAGING_SUPABASE_DB_URL')
  const apiHost = hostname(supabaseUrl, 'STAGING_SUPABASE_URL')
  const expectedDb = requiredHost(expectedDatabaseHost, 'STAGING_EXPECTED_DATABASE_HOST')
  const expectedApi = requiredHost(expectedSupabaseHost, 'STAGING_EXPECTED_SUPABASE_HOST')
  const productionDb = productionDatabaseHost.trim().toLowerCase()
  const productionApi = productionSupabaseHost.trim().toLowerCase()

  if (databaseHost !== expectedDb || (productionDb && databaseHost === productionDb)) {
    throw new Error('Refusing destructive action: database URL is not the expected staging database host.')
  }
  if (apiHost !== expectedApi || (productionApi && apiHost === productionApi)) {
    throw new Error('Refusing destructive action: Supabase URL is not the expected staging Supabase host.')
  }
  if (expectedDb === productionDb || expectedApi === productionApi) {
    throw new Error('Refusing destructive action: staging and production host allowlists overlap.')
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  assertStagingTarget({
    databaseUrl: process.env.STAGING_SUPABASE_DB_URL,
    supabaseUrl: process.env.STAGING_SUPABASE_URL,
    expectedDatabaseHost: process.env.STAGING_EXPECTED_DATABASE_HOST,
    expectedSupabaseHost: process.env.STAGING_EXPECTED_SUPABASE_HOST,
    productionDatabaseHost: process.env.PRODUCTION_DATABASE_HOST,
    productionSupabaseHost: process.env.PRODUCTION_SUPABASE_HOST,
  })
  console.log('Staging target identity validated; destructive database actions are allowed.')
}
