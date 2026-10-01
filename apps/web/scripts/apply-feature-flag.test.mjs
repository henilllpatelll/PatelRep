import assert from 'node:assert/strict'
import test from 'node:test'

import { applyFeatureFlag, assertFeatureFlagTarget, resolveTenantId } from './apply-feature-flag.mjs'

const safeTarget = {
  supabaseUrl: 'https://production-project.supabase.co',
  expectedHost: 'production-project.supabase.co',
  otherEnvHost: 'staging-project.supabase.co',
}

test('allows a Supabase URL matching the expected host for this environment', () => {
  assert.doesNotThrow(() => assertFeatureFlagTarget(safeTarget))
})

test('blocks a mutation aimed at the other environment host', () => {
  assert.throws(
    () => assertFeatureFlagTarget({ ...safeTarget, supabaseUrl: 'https://staging-project.supabase.co' }),
    /does not match the expected host/,
  )
})

test('blocks when the expected and other-environment hosts overlap, even if the URL matches', () => {
  assert.throws(
    () => assertFeatureFlagTarget({ ...safeTarget, otherEnvHost: safeTarget.expectedHost }),
    /allowlists overlap/,
  )
})

function fakeRepo({ tenants = [], flags = {} } = {}) {
  const events = []
  return {
    events,
    async findTenantsBySlug(slug) {
      return tenants.filter((tenant) => tenant.slug === slug)
    },
    async getFlag(tenantId, featureKey) {
      return flags[`${tenantId}:${featureKey}`] ?? null
    },
    async upsertFlag({ tenantId, featureKey, enabled }) {
      flags[`${tenantId}:${featureKey}`] = { enabled }
    },
    async insertEvent(event) {
      events.push(event)
    },
  }
}

test('resolves exactly one matching tenant slug', async () => {
  const repo = fakeRepo({ tenants: [{ id: 't1', slug: 'austin-test-suites' }] })
  assert.equal(await resolveTenantId(repo, 'austin-test-suites'), 't1')
})

test('fails closed when no tenant matches the slug', async () => {
  const repo = fakeRepo({ tenants: [] })
  await assert.rejects(() => resolveTenantId(repo, 'does-not-exist'), /No tenant found/)
})

test('fails closed on an ambiguous slug match rather than fuzzy-picking one', async () => {
  const repo = fakeRepo({ tenants: [{ id: 't1', slug: 'dup' }, { id: 't2', slug: 'dup' }] })
  await assert.rejects(() => resolveTenantId(repo, 'dup'), /Refusing ambiguous tenant slug/)
})

test('applying a flag to a tenant with no prior row records old_value as null', async () => {
  const repo = fakeRepo()
  const result = await applyFeatureFlag(repo, { tenantId: 't1', featureKey: 'staging_flag_demo', enabled: true, changeSource: 'test' })
  assert.deepEqual(result, { oldValue: null, newValue: true })
  assert.equal(repo.events.length, 1)
  assert.deepEqual(repo.events[0], { tenantId: 't1', featureKey: 'staging_flag_demo', oldValue: null, newValue: true, changeSource: 'test' })
})

test('applying a flag change records the prior value as old_value', async () => {
  const repo = fakeRepo({ flags: { 't1:staging_flag_demo': { enabled: true } } })
  const result = await applyFeatureFlag(repo, { tenantId: 't1', featureKey: 'staging_flag_demo', enabled: false, changeSource: 'test' })
  assert.deepEqual(result, { oldValue: true, newValue: false })
})
