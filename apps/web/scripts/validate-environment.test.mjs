import assert from 'node:assert/strict'
import test from 'node:test'

import { validatePublicEnvironment } from './validate-environment.mjs'

const staging = {
  NEXT_PUBLIC_APP_ENV: 'staging',
  NEXT_PUBLIC_API_URL: 'https://api.staging.example.test/v1',
  NEXT_PUBLIC_SUPABASE_URL: 'https://staging-project.supabase.co',
  STAGING_EXPECTED_API_HOST: 'api.staging.example.test',
  STAGING_EXPECTED_SUPABASE_HOST: 'staging-project.supabase.co',
  PRODUCTION_API_HOST: 'api.production.example.test',
  PRODUCTION_SUPABASE_HOST: 'production-project.supabase.co',
}

test('allows a staging bundle wired to its designated staging hosts', () => {
  assert.doesNotThrow(() => validatePublicEnvironment(staging))
})

test('rejects a staging web bundle wired to the production API', () => {
  assert.throws(
    () => validatePublicEnvironment({ ...staging, NEXT_PUBLIC_API_URL: 'https://api.production.example.test/v1' }),
    /staging API host/,
  )
})

test('rejects a staging web bundle wired to the production Supabase project', () => {
  assert.throws(
    () => validatePublicEnvironment({ ...staging, NEXT_PUBLIC_SUPABASE_URL: 'https://production-project.supabase.co' }),
    /staging Supabase host/,
  )
})

test('requires an explicit staging allowlist', () => {
  const { STAGING_EXPECTED_API_HOST, ...withoutExpectedApiHost } = staging
  assert.throws(() => validatePublicEnvironment(withoutExpectedApiHost), /STAGING_EXPECTED_API_HOST/)
})
