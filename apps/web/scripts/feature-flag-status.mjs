#!/usr/bin/env node
/**
 * Read-only inspection of tenant_feature_flags. Never imports a write path —
 * this script cannot mutate a flag, only report on it.
 *
 * Usage:
 *   node scripts/feature-flag-status.mjs --feature <key>
 *   node scripts/feature-flag-status.mjs --tenant <slug>
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment,
 * pointed at whichever project you want to inspect (staging or production).
 */
import { createClient } from '@supabase/supabase-js'

export function formatStatusTable(rows) {
  if (rows.length === 0) return 'No matching rows.'
  const header = 'tenant_slug | feature_key | enabled | updated_at | updated_by'
  const lines = rows.map(
    (row) => `${row.tenant_slug} | ${row.feature_key} | ${row.enabled} | ${row.updated_at ?? ''} | ${row.updated_by ?? ''}`,
  )
  return [header, ...lines].join('\n')
}

export async function fetchStatusByFeature(supabase, featureKey) {
  const { data, error } = await supabase
    .from('tenant_feature_flags')
    .select('enabled, updated_at, updated_by, tenants(slug)')
    .eq('feature_key', featureKey)
  if (error) throw new Error(`Status query failed: ${error.message}`)
  return (data ?? [])
    .map((row) => ({ tenant_slug: row.tenants?.slug ?? '(unknown)', feature_key: featureKey, enabled: row.enabled, updated_at: row.updated_at, updated_by: row.updated_by }))
    .sort((a, b) => a.tenant_slug.localeCompare(b.tenant_slug))
}

export async function fetchStatusByTenant(supabase, tenantSlug) {
  const { data: tenant, error: tenantError } = await supabase.from('tenants').select('id, slug').eq('slug', tenantSlug).maybeSingle()
  if (tenantError) throw new Error(`Tenant lookup failed: ${tenantError.message}`)
  if (!tenant) throw new Error(`No tenant found with slug: ${tenantSlug}`)

  const { data, error } = await supabase
    .from('tenant_feature_flags')
    .select('feature_key, enabled, updated_at, updated_by')
    .eq('tenant_id', tenant.id)
  if (error) throw new Error(`Status query failed: ${error.message}`)
  return (data ?? [])
    .map((row) => ({ tenant_slug: tenant.slug, ...row }))
    .sort((a, b) => a.feature_key.localeCompare(b.feature_key))
}

async function main() {
  const argumentsByName = new Map()
  for (let index = 2; index < process.argv.length; index += 2) {
    argumentsByName.set(process.argv[index], process.argv[index + 1])
  }
  const feature = argumentsByName.get('--feature')
  const tenant = argumentsByName.get('--tenant')
  if (!feature === !tenant) {
    throw new Error('Pass exactly one of --feature <key> or --tenant <slug>.')
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const rows = feature ? await fetchStatusByFeature(supabase, feature) : await fetchStatusByTenant(supabase, tenant)
  console.log(formatStatusTable(rows))
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
