import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveApiUrl } from './apiUrl'

test('uses the local v1 API fallback when no public API URL is configured', () => {
  assert.equal(resolveApiUrl(), 'http://localhost:8000/v1')
})

test('adds the v1 API prefix when a configured Railway URL has no path', () => {
  assert.equal(resolveApiUrl('https://patelrep-api-staging-staging.up.railway.app'), 'https://patelrep-api-staging-staging.up.railway.app/v1')
  assert.equal(resolveApiUrl('https://patelrep-api-staging-staging.up.railway.app/'), 'https://patelrep-api-staging-staging.up.railway.app/v1')
})

test('preserves a configured API version path', () => {
  assert.equal(resolveApiUrl('https://api.example.test/v1'), 'https://api.example.test/v1')
})
