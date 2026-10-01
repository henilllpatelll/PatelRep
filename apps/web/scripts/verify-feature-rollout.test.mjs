import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyApiHealth, verifyWebReachable } from './verify-feature-rollout.mjs'

function fakeFetch(responses) {
  let call = 0
  return async () => responses[Math.min(call++, responses.length - 1)]
}

test('passes when the API reports ok status and ok database', async () => {
  const fetchImpl = fakeFetch([{ ok: true, status: 200, json: async () => ({ status: 'ok', db: 'ok' }) }])
  const health = await verifyApiHealth('https://api.test', { fetchImpl })
  assert.deepEqual(health, { status: 'ok', db: 'ok' })
})

test('fails when the API health endpoint is not OK', async () => {
  const fetchImpl = fakeFetch([{ ok: false, status: 503 }])
  await assert.rejects(() => verifyApiHealth('https://api.test', { fetchImpl }), /HTTP 503/)
})

test('fails when the database is not reported healthy', async () => {
  const fetchImpl = fakeFetch([{ ok: true, status: 200, json: async () => ({ status: 'ok', db: 'degraded' }) }])
  await assert.rejects(() => verifyApiHealth('https://api.test', { fetchImpl }), /healthy database/)
})

test('treats a redirect as a reachable web route, not a failure', async () => {
  const fetchImpl = fakeFetch([{ status: 302 }])
  assert.equal(await verifyWebReachable('https://web.test', 'login', { fetchImpl }), 302)
})

test('fails only on a server error from the web route', async () => {
  const fetchImpl = fakeFetch([{ status: 500 }])
  await assert.rejects(() => verifyWebReachable('https://web.test', 'login', { fetchImpl }), /HTTP 500/)
})
