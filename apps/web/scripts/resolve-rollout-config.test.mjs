import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { applyFeatureFlag, assertFeatureFlagTarget, resolveTenantId } from './apply-feature-flag.mjs'
import { resolveRolloutConfig } from './resolve-rollout-config.mjs'

const STAGING_KEY = 'staging-service-role-key-DO-NOT-LOG'
const PRODUCTION_KEY = 'production-service-role-key-DO-NOT-LOG'

const stagingEnvironment = {
  STAGING_SUPABASE_URL: 'https://stagingref.supabase.co',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY,
  STAGING_EXPECTED_SUPABASE_HOST: 'stagingref.supabase.co',
  STAGING_API_URL: 'https://api-staging.example.test',
  STAGING_WEB_URL: 'https://web-staging.example.test',
  OTHER_ENV_SUPABASE_HOST: 'prodref.supabase.co',
  PRODUCTION_SUPABASE_HOST: 'prodref.supabase.co',
}

const productionEnvironment = {
  SUPABASE_URL: 'https://prodref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: PRODUCTION_KEY,
  EXPECTED_SUPABASE_HOST: 'prodref.supabase.co',
  API_URL: 'https://api.example.test',
  WEB_URL: 'https://web.example.test',
  OTHER_ENV_SUPABASE_HOST: 'stagingref.supabase.co',
}

test('staging resolves staging credentials and endpoints onto the script names', () => {
  assert.deepEqual(resolveRolloutConfig('staging', stagingEnvironment), {
    SUPABASE_URL: 'https://stagingref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY,
    EXPECTED_SUPABASE_HOST: 'stagingref.supabase.co',
    OTHER_ENV_SUPABASE_HOST: 'prodref.supabase.co',
    API_URL: 'https://api-staging.example.test',
    WEB_URL: 'https://web-staging.example.test',
  })
})

test('production resolves production credentials and endpoints onto the script names', () => {
  assert.deepEqual(resolveRolloutConfig('production', productionEnvironment), {
    SUPABASE_URL: 'https://prodref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: PRODUCTION_KEY,
    EXPECTED_SUPABASE_HOST: 'prodref.supabase.co',
    OTHER_ENV_SUPABASE_HOST: 'stagingref.supabase.co',
    API_URL: 'https://api.example.test',
    WEB_URL: 'https://web.example.test',
  })
})

test('staging ignores production-family names even when both families are visible', () => {
  const resolved = resolveRolloutConfig('staging', { ...productionEnvironment, ...stagingEnvironment })
  assert.equal(resolved.SUPABASE_URL, 'https://stagingref.supabase.co')
  assert.equal(resolved.SUPABASE_SERVICE_ROLE_KEY, STAGING_KEY)
})

test('production ignores staging-family names even when both families are visible', () => {
  const resolved = resolveRolloutConfig('production', { ...stagingEnvironment, ...productionEnvironment })
  assert.equal(resolved.SUPABASE_URL, 'https://prodref.supabase.co')
  assert.equal(resolved.SUPABASE_SERVICE_ROLE_KEY, PRODUCTION_KEY)
})

test('staging never falls back to production names when a staging value is missing', () => {
  const { STAGING_SUPABASE_URL: _omitted, ...withoutStagingUrl } = stagingEnvironment
  assert.throws(
    () => resolveRolloutConfig('staging', { ...withoutStagingUrl, SUPABASE_URL: productionEnvironment.SUPABASE_URL }),
    /missing in the staging Environment: STAGING_SUPABASE_URL/,
  )
  const { STAGING_SUPABASE_SERVICE_ROLE_KEY: _key, ...withoutStagingKey } = stagingEnvironment
  assert.throws(
    () => resolveRolloutConfig('staging', { ...withoutStagingKey, SUPABASE_SERVICE_ROLE_KEY: PRODUCTION_KEY }),
    /STAGING_SUPABASE_SERVICE_ROLE_KEY/,
  )
})

test('production never falls back to staging names when a production value is missing', () => {
  const { SUPABASE_URL: _omitted, ...withoutUrl } = productionEnvironment
  assert.throws(
    () => resolveRolloutConfig('production', { ...withoutUrl, STAGING_SUPABASE_URL: stagingEnvironment.STAGING_SUPABASE_URL }),
    /missing in the production Environment: SUPABASE_URL/,
  )
  const { SUPABASE_SERVICE_ROLE_KEY: _key, ...withoutKey } = productionEnvironment
  assert.throws(
    () => resolveRolloutConfig('production', { ...withoutKey, STAGING_SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  )
})

test('the other-environment host is required, so the isolation guard cannot be silently empty', () => {
  const { OTHER_ENV_SUPABASE_HOST: _omitted, ...withoutOther } = productionEnvironment
  assert.throws(() => resolveRolloutConfig('production', withoutOther), /OTHER_ENV_SUPABASE_HOST/)
})

test('lists every missing name at once without leaking any value', () => {
  assert.throws(
    () => resolveRolloutConfig('staging', { STAGING_SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY }),
    (error) => {
      assert.match(error.message, /STAGING_SUPABASE_URL/)
      assert.match(error.message, /STAGING_EXPECTED_SUPABASE_HOST/)
      assert.match(error.message, /STAGING_API_URL/)
      assert.match(error.message, /STAGING_WEB_URL/)
      assert.match(error.message, /No changes were made/)
      assert.doesNotMatch(error.message, new RegExp(STAGING_KEY))
      return true
    },
  )
})

test('two names for one value inside the same environment must agree', () => {
  assert.doesNotThrow(() =>
    resolveRolloutConfig('production', { ...productionEnvironment, PRODUCTION_SUPABASE_URL: productionEnvironment.SUPABASE_URL }),
  )
  assert.throws(
    () => resolveRolloutConfig('production', { ...productionEnvironment, PRODUCTION_SUPABASE_URL: 'https://another.supabase.co' }),
    /conflicting or invalid values: SUPABASE_URL vs PRODUCTION_SUPABASE_URL/,
  )
})

test('blank values count as missing and line breaks are rejected', () => {
  assert.throws(() => resolveRolloutConfig('staging', { ...stagingEnvironment, STAGING_API_URL: '   ' }), /STAGING_API_URL/)
  assert.throws(
    () => resolveRolloutConfig('staging', { ...stagingEnvironment, STAGING_API_URL: 'https://a.test\nINJECTED=1' }),
    /contains a line break/,
  )
})

test('rejects an unknown environment', () => {
  assert.throws(() => resolveRolloutConfig('preview', stagingEnvironment), /Unknown rollout environment/)
})

test('a staging run cannot be pointed at the production database', () => {
  const resolved = resolveRolloutConfig('staging', { ...stagingEnvironment, STAGING_SUPABASE_URL: 'https://prodref.supabase.co' })
  assert.throws(
    () => assertFeatureFlagTarget({
      supabaseUrl: resolved.SUPABASE_URL,
      expectedHost: resolved.EXPECTED_SUPABASE_HOST,
      otherEnvHost: resolved.OTHER_ENV_SUPABASE_HOST,
    }),
    /does not match the expected host/,
  )
})

test('a production run cannot be pointed at the staging database', () => {
  const resolved = resolveRolloutConfig('production', { ...productionEnvironment, SUPABASE_URL: 'https://stagingref.supabase.co' })
  assert.throws(
    () => assertFeatureFlagTarget({
      supabaseUrl: resolved.SUPABASE_URL,
      expectedHost: resolved.EXPECTED_SUPABASE_HOST,
      otherEnvHost: resolved.OTHER_ENV_SUPABASE_HOST,
    }),
    /does not match the expected host/,
  )
})

test('correctly resolved staging and production configs both pass the host guard', () => {
  for (const [environment, source] of [['staging', stagingEnvironment], ['production', productionEnvironment]]) {
    const resolved = resolveRolloutConfig(environment, source)
    assert.doesNotThrow(() =>
      assertFeatureFlagTarget({
        supabaseUrl: resolved.SUPABASE_URL,
        expectedHost: resolved.EXPECTED_SUPABASE_HOST,
        otherEnvHost: resolved.OTHER_ENV_SUPABASE_HOST,
      }),
    )
  }
})

test('tenant slug resolution stays exact and enable/disable keep writing audit events', async () => {
  const flags = {}
  const events = []
  const repo = {
    async findTenantsBySlug(slug) {
      return [{ id: 't-a', slug: 'rehearsal-a' }, { id: 't-b', slug: 'rehearsal-b' }].filter((tenant) => tenant.slug === slug)
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

  await assert.rejects(() => resolveTenantId(repo, 'rehearsal'), /No tenant found/)
  const tenantId = await resolveTenantId(repo, 'rehearsal-a')
  assert.equal(tenantId, 't-a')

  await applyFeatureFlag(repo, { tenantId, featureKey: 'design_v2', enabled: true, changeSource: 'test' })
  await applyFeatureFlag(repo, { tenantId, featureKey: 'design_v2', enabled: false, changeSource: 'test' })
  assert.deepEqual(events.map((event) => [event.oldValue, event.newValue]), [[null, true], [true, false]])
  assert.equal(flags['t-b:design_v2'], undefined)
})

function runResolver(environment, source) {
  const directory = mkdtempSync(join(tmpdir(), 'rollout-config-'))
  const githubEnv = join(directory, 'github-env')
  writeFileSync(githubEnv, '')
  const result = spawnSync(process.execPath, [new URL('./resolve-rollout-config.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    env: { PATH: process.env.PATH, ROLLOUT_ENVIRONMENT: environment, GITHUB_ENV: githubEnv, ...source },
    encoding: 'utf8',
  })
  return { ...result, exported: readFileSync(githubEnv, 'utf8') }
}

test('CLI exports the resolved names, masks the key, and never prints values', () => {
  const result = runResolver('staging', stagingEnvironment)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`::add-mask::${STAGING_KEY}`))
  assert.doesNotMatch(result.stdout.replace(`::add-mask::${STAGING_KEY}`, ''), new RegExp(STAGING_KEY))
  assert.match(result.exported, /^SUPABASE_URL=https:\/\/stagingref\.supabase\.co$/m)
  assert.match(result.exported, new RegExp(`^SUPABASE_SERVICE_ROLE_KEY=${STAGING_KEY}$`, 'm'))
})

test('CLI exports nothing and exits non-zero when configuration is incomplete', () => {
  const { STAGING_WEB_URL: _omitted, ...incomplete } = stagingEnvironment
  const result = runResolver('staging', incomplete)
  assert.notEqual(result.status, 0)
  assert.equal(result.exported, '')
  assert.match(result.stderr, /STAGING_WEB_URL/)
  assert.doesNotMatch(result.stderr + result.stdout, new RegExp(STAGING_KEY))
})
