import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { ApiClientError, apiClient } from '@/lib/api/client'

describe('apiClient rate-limit errors', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('exposes Retry-After on a 429 so callers can wait it out', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Too many requests' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '35' },
      })) as typeof fetch

    await assert.rejects(apiClient.get('/auth/me'), (err: unknown) => {
      assert.ok(err instanceof ApiClientError)
      assert.equal(err.status, 429)
      assert.equal(err.retryAfterSeconds, 35)
      return true
    })
  })

  it('leaves retryAfterSeconds null when the header is absent', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: 'nope' }), { status: 500 })) as typeof fetch

    await assert.rejects(apiClient.get('/auth/me'), (err: unknown) => {
      assert.ok(err instanceof ApiClientError)
      assert.equal(err.retryAfterSeconds, null)
      return true
    })
  })
})
