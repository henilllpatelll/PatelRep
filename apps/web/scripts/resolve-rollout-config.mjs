#!/usr/bin/env node
/**
 * Resolves the Feature Rollout configuration for ONE GitHub Environment and
 * maps it onto the names the rollout scripts read (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, EXPECTED_SUPABASE_HOST, OTHER_ENV_SUPABASE_HOST,
 * API_URL, WEB_URL).
 *
 * The two Environments name things differently: `staging` uses STAGING_*
 * names, `production` uses unprefixed names (and PRODUCTION_* aliases). Each
 * environment only ever reads its OWN family of names -- a missing staging
 * value is never satisfied from a production name, or the reverse. Two names
 * for the same value inside one environment must agree or the run fails.
 *
 * Nothing is printed except variable NAMES. Values (and the service-role key
 * especially) are never logged; the key is masked before it is exported.
 */
import { appendFileSync } from 'node:fs'

// Non-secret host/url settings, then the one secret. Order is the lookup
// priority; every listed name belongs to the same environment.
export const ROLLOUT_CONFIG = {
  staging: {
    SUPABASE_URL: ['STAGING_SUPABASE_URL'],
    SUPABASE_SERVICE_ROLE_KEY: ['STAGING_SUPABASE_SERVICE_ROLE_KEY'],
    EXPECTED_SUPABASE_HOST: ['STAGING_EXPECTED_SUPABASE_HOST'],
    OTHER_ENV_SUPABASE_HOST: ['OTHER_ENV_SUPABASE_HOST', 'PRODUCTION_SUPABASE_HOST'],
    API_URL: ['STAGING_API_URL'],
    WEB_URL: ['STAGING_WEB_URL'],
  },
  production: {
    SUPABASE_URL: ['SUPABASE_URL', 'PRODUCTION_SUPABASE_URL'],
    SUPABASE_SERVICE_ROLE_KEY: ['SUPABASE_SERVICE_ROLE_KEY', 'PRODUCTION_SUPABASE_SERVICE_ROLE_KEY'],
    EXPECTED_SUPABASE_HOST: ['EXPECTED_SUPABASE_HOST', 'PRODUCTION_SUPABASE_HOST'],
    OTHER_ENV_SUPABASE_HOST: ['OTHER_ENV_SUPABASE_HOST', 'STAGING_SUPABASE_HOST'],
    API_URL: ['API_URL', 'PRODUCTION_API_URL'],
    WEB_URL: ['WEB_URL', 'PRODUCTION_WEB_URL'],
  },
}

export const SECRET_TARGETS = new Set(['SUPABASE_SERVICE_ROLE_KEY'])

export function resolveRolloutConfig(environment, source) {
  const mapping = ROLLOUT_CONFIG[environment]
  if (!mapping) throw new Error(`Unknown rollout environment "${environment}" (expected staging or production).`)

  const resolved = {}
  const missing = []
  const conflicts = []

  for (const [target, names] of Object.entries(mapping)) {
    const present = names.filter((name) => (source[name] ?? '').trim() !== '')
    if (present.length === 0) {
      missing.push(`${names[0]}${names.length > 1 ? ` (or ${names.slice(1).join(', ')})` : ''}`)
      continue
    }
    const values = new Set(present.map((name) => source[name].trim()))
    if (values.size > 1) {
      conflicts.push(`${present.join(' vs ')}`)
      continue
    }
    const value = source[present[0]].trim()
    if (/[\r\n]/.test(value)) {
      conflicts.push(`${present[0]} contains a line break`)
      continue
    }
    resolved[target] = value
  }

  if (missing.length > 0 || conflicts.length > 0) {
    const parts = []
    if (missing.length > 0) parts.push(`missing in the ${environment} Environment: ${missing.join('; ')}`)
    if (conflicts.length > 0) parts.push(`conflicting or invalid values: ${conflicts.join('; ')}`)
    throw new Error(`Feature Rollout configuration for ${environment} is incomplete -- ${parts.join(' | ')}. No changes were made.`)
  }
  return resolved
}

function main() {
  const environment = process.env.ROLLOUT_ENVIRONMENT
  const resolved = resolveRolloutConfig(environment, process.env)

  const githubEnv = process.env.GITHUB_ENV
  if (!githubEnv) throw new Error('GITHUB_ENV is required to export the resolved configuration.')

  for (const [name, value] of Object.entries(resolved)) {
    if (SECRET_TARGETS.has(name)) console.log(`::add-mask::${value}`)
    appendFileSync(githubEnv, `${name}=${value}\n`)
  }
  console.log(`Resolved Feature Rollout configuration for ${environment}: ${Object.keys(resolved).join(', ')}`)
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
