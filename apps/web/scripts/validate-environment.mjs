function hostname(value, name) {
  if (!value) throw new Error(`${name} is required when NEXT_PUBLIC_APP_ENV=staging.`)
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    throw new Error(`${name} must be an absolute URL.`)
  }
}

function configuredHostname(value) {
  return value?.trim().toLowerCase() || ''
}

/**
 * Ensure a public staging bundle can only talk to its declared staging stack.
 * Expected/production hosts are build-only configuration, not browser secrets.
 */
export function validatePublicEnvironment(env = process.env) {
  const appEnv = (env.NEXT_PUBLIC_APP_ENV || 'development').toLowerCase()
  if (appEnv !== 'staging') return

  const apiHost = hostname(env.NEXT_PUBLIC_API_URL, 'NEXT_PUBLIC_API_URL')
  const supabaseHost = hostname(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL')
  const expectedApiHost = configuredHostname(env.STAGING_EXPECTED_API_HOST)
  const expectedSupabaseHost = configuredHostname(env.STAGING_EXPECTED_SUPABASE_HOST)
  const productionApiHost = configuredHostname(env.PRODUCTION_API_HOST)
  const productionSupabaseHost = configuredHostname(env.PRODUCTION_SUPABASE_HOST)

  if (!expectedApiHost) throw new Error('STAGING_EXPECTED_API_HOST is required when NEXT_PUBLIC_APP_ENV=staging.')
  if (!expectedSupabaseHost) throw new Error('STAGING_EXPECTED_SUPABASE_HOST is required when NEXT_PUBLIC_APP_ENV=staging.')
  if (apiHost !== expectedApiHost || (productionApiHost && apiHost === productionApiHost)) {
    throw new Error('Staging build rejected: NEXT_PUBLIC_API_URL is not the configured staging API host.')
  }
  if (supabaseHost !== expectedSupabaseHost || (productionSupabaseHost && supabaseHost === productionSupabaseHost)) {
    throw new Error('Staging build rejected: NEXT_PUBLIC_SUPABASE_URL is not the configured staging Supabase host.')
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) validatePublicEnvironment()
