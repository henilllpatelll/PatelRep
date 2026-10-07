import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveApiUrl, resolveLiveApiUrl } from './apiUrl'

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

test('redirects retired Railway API hosts to the live API regardless of app env', () => {
  const live = 'https://noble-cooperation-production.up.railway.app/v1'
  assert.equal(resolveLiveApiUrl('https://stellar-integrity-production-30cf.up.railway.app'), live)
  assert.equal(resolveLiveApiUrl('https://stellar-integrity-production-f507.up.railway.app/v1'), live)
  assert.equal(resolveLiveApiUrl('https://patelrep-web-production.up.railway.app'), live)
})

test('leaves live, staging and local API URLs untouched', () => {
  assert.equal(resolveLiveApiUrl('https://noble-cooperation-production.up.railway.app'), 'https://noble-cooperation-production.up.railway.app/v1')
  assert.equal(resolveLiveApiUrl('https://api.example.test/v1'), 'https://api.example.test/v1')
  assert.equal(resolveLiveApiUrl(), 'http://localhost:8000/v1')
})
