#!/usr/bin/env node
/**
 * Applies one tenant feature-flag change via the Supabase service-role client
 * (no raw SQL) and records it in feature_flag_events in the same run. This is
 * the only place outside the app that writes to tenant_feature_flags — always
 * invoked from .github/workflows/feature-rollout.yml (or staging-candidate.yml's
 * pre-e2e flag setup), never run ad hoc against production by hand.
 *
 * Tenant resolution is EXACT: zero or more than one match for a slug is a
 * hard failure, never a fuzzy pick.
 */
import { createClient } from '@supabase/supabase-js'

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
 * Defense in depth on top of GitHub Environment secret scoping: even if this
 * workflow were misconfigured to read the wrong environment's secrets, the
 * Supabase host itself must still match what this run claims to target.
 */
export function assertFeatureFlagTarget({ supabaseUrl, expectedHost, otherEnvHost = '' }) {
  const host = hostname(supabaseUrl, 'SUPABASE_URL')
  const expected = requiredHost(expectedHost, 'EXPECTED_SUPABASE_HOST')
  const other = otherEnvHost.trim().toLowerCase()

  // Checked before the actual host, so a misconfigured pair of Environment
  // variables is caught even if the incoming URL happens to match expectedHost.
  if (other && expected === other) {
    throw new Error('Refusing feature-flag mutation: this environment and the other environment host allowlists overlap.')
  }
  if (host !== expected || (other && host === other)) {
    throw new Error('Refusing feature-flag mutation: SUPABASE_URL does not match the expected host for this environment.')
  }
}

export async function resolveTenantId(repo, slug) {
  const tenants = await repo.findTenantsBySlug(slug)
  if (tenants.length === 0) throw new Error(`No tenant found with slug: ${slug}`)
  if (tenants.length > 1) throw new Error(`Refusing ambiguous tenant slug (matched ${tenants.length} tenants): ${slug}`)
  return tenants[0].id
}

export async function applyFeatureFlag(repo, { tenantId, featureKey, enabled, changeSource }) {
  const existing = await repo.getFlag(tenantId, featureKey)
  const oldValue = existing ? existing.enabled : null
  await repo.upsertFlag({ tenantId, featureKey, enabled, changeSource })
  await repo.insertEvent({ tenantId, featureKey, oldValue, newValue: enabled, changeSource })
  return { oldValue, newValue: enabled }
}

function createSupabaseRepo(supabase) {
  return {
    async findTenantsBySlug(slug) {
      const { data, error } = await supabase.from('tenants').select('id, slug').eq('slug', slug)
      if (error) throw new Error(`Tenant lookup failed: ${error.message}`)
      return data ?? []
    },
    async getFlag(tenantId, featureKey) {
      const { data, error } = await supabase
        .from('tenant_feature_flags')
        .select('enabled')
        .eq('tenant_id', tenantId)
        .eq('feature_key', featureKey)
        .maybeSingle()
      if (error) throw new Error(`Flag lookup failed: ${error.message}`)
      return data
    },
    async upsertFlag({ tenantId, featureKey, enabled, changeSource }) {
      const { error } = await supabase.from('tenant_feature_flags').upsert(
        { tenant_id: tenantId, feature_key: featureKey, enabled, updated_at: new Date().toISOString(), updated_by: changeSource },
        { onConflict: 'tenant_id,feature_key' },
      )
      if (error) throw new Error(`Flag upsert failed: ${error.message}`)
    },
    async insertEvent({ tenantId, featureKey, oldValue, newValue, changeSource }) {
      const { error } = await supabase.from('feature_flag_events').insert({
        tenant_id: tenantId,
        feature_key: featureKey,
        old_value: oldValue,
        new_value: newValue,
        change_source: changeSource,
      })
      if (error) throw new Error(`Audit event insert failed: ${error.message}`)
    },
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const expectedHost = process.env.EXPECTED_SUPABASE_HOST
  const otherEnvHost = process.env.OTHER_ENV_SUPABASE_HOST ?? ''
  const tenantSlug = process.env.TENANT_SLUG
  const featureKey = process.env.FEATURE_KEY
  const enabledRaw = process.env.ENABLED
  const changeSource = process.env.CHANGE_SOURCE

  if (!tenantSlug || !featureKey || !changeSource) {
    throw new Error('TENANT_SLUG, FEATURE_KEY, and CHANGE_SOURCE are required.')
  }
  if (enabledRaw !== 'true' && enabledRaw !== 'false') {
    throw new Error(`ENABLED must be exactly "true" or "false", got: ${enabledRaw}`)
  }
  const enabled = enabledRaw === 'true'

  assertFeatureFlagTarget({ supabaseUrl, expectedHost, otherEnvHost })

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const repo = createSupabaseRepo(supabase)

  const tenantId = await resolveTenantId(repo, tenantSlug)
  const { oldValue, newValue } = await applyFeatureFlag(repo, { tenantId, featureKey, enabled, changeSource })

  console.log(`Applied feature flag: tenant=${tenantSlug} (${tenantId}) feature=${featureKey} ${oldValue ?? 'MISSING'} -> ${newValue}`)
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
