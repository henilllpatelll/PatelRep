import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyProductionContract, runProductionMonitorSmoke } from './production-monitor-smoke.mjs'

const WEB = 'https://web.example'
const API = 'https://api.example'
const SHA = 'a'.repeat(40)

const legacyHealth = (overrides = {}) => ({ status: 'ok', env: 'production', db: 'ok', version: '1.0.0', cron: { 'predictions.run': 'ok' }, ...overrides })
const modernHealth = (overrides = {}) => ({
  status: 'ok', environment: 'production', env: 'production', supabase_host: 'db.example', release_sha: SHA, release_version: 'v1.2.3', db: 'ok', version: '1.0.0', cron: {}, ...overrides,
})
const readyBody = (overrides = {}) => ({ status: 'ready', database: 'compatible', environment: 'production', release_sha: SHA, release_version: 'v1.2.3', ...overrides })
const metaHtml = (sha = SHA, version = 'v1.2.3') => `<meta name="patelrep-release-sha" content="${sha}"/><meta name="patelrep-release-version" content="${version}"/>`

function mockFetch({ health, ready, readyStatus = 200, html = '<html></html>', webStatus = 200 }) {
  const requested = []
  const fetchImpl = async (url) => {
    const { pathname } = new URL(url)
    requested.push(pathname)
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => body })
    if (pathname === '/login') return reply(webStatus, html)
    if (pathname === '/health') return reply(200, health)
    if (pathname === '/ready') return readyStatus === 200 ? reply(200, ready) : reply(readyStatus, {})
    return reply(404, {})
  }
  return { fetchImpl, requested }
}

const run = (mock) => runProductionMonitorSmoke({ webUrl: WEB, apiUrl: API, fetchImpl: mock.fetchImpl, log: () => {} })

test('the known legacy contract passes without ever requesting /ready', async () => {
  const mock = mockFetch({ health: legacyHealth() })
  assert.deepEqual(await run(mock), { contract: 'legacy' })
  assert.ok(!mock.requested.includes('/ready'))
})

test('legacy contract with an unhealthy database or wrong environment fails', async () => {
  await assert.rejects(run(mockFetch({ health: legacyHealth({ db: 'unavailable' }) })), /ready database/)
  await assert.rejects(run(mockFetch({ health: legacyHealth({ status: 'degraded' }) })), /ready database/)
  await assert.rejects(run(mockFetch({ health: legacyHealth({ env: 'staging' }) })), /expected production/)
})

test('the modern contract passes only with a valid /ready and matching Web identity', async () => {
  const mock = mockFetch({ health: modernHealth(), ready: readyBody(), html: metaHtml() })
  assert.deepEqual(await run(mock), { contract: 'modern' })
  assert.ok(mock.requested.includes('/ready'))
})

test('the modern contract fails when /ready disappears (404) or is not ready', async () => {
  await assert.rejects(run(mockFetch({ health: modernHealth(), readyStatus: 404, html: metaHtml() })), /readiness returned HTTP 404/)
  await assert.rejects(run(mockFetch({ health: modernHealth(), ready: readyBody({ status: 'not_ready' }), html: metaHtml() })), /compatible database/)
  await assert.rejects(run(mockFetch({ health: modernHealth(), ready: readyBody({ database: 'incompatible' }), html: metaHtml() })), /compatible database/)
})

test('the modern contract fails on mismatched release identity', async () => {
  await assert.rejects(run(mockFetch({ health: modernHealth(), ready: readyBody({ release_sha: 'b'.repeat(40) }), html: metaHtml() })), /disagree/)
  await assert.rejects(run(mockFetch({ health: modernHealth(), ready: readyBody({ release_version: 'v9.9.9' }), html: metaHtml() })), /disagree/)
  await assert.rejects(run(mockFetch({ health: modernHealth(), ready: readyBody(), html: metaHtml('c'.repeat(40)) })), /does not match API/)
  await assert.rejects(run(mockFetch({ health: modernHealth(), ready: readyBody(), html: '<html></html>' })), /does not match API/)
  await assert.rejects(run(mockFetch({ health: modernHealth({ release_sha: 'unknown' }), ready: readyBody(), html: metaHtml() })), /40-character/)
})

test('unknown, partial, or mixed contract shapes fail closed', async () => {
  assert.throws(() => classifyProductionContract({}), /no known production contract/)
  assert.throws(() => classifyProductionContract({ status: 'ok', db: 'ok' }), /no known production contract/)
  assert.throws(() => classifyProductionContract(legacyHealth({ release_sha: SHA })), /partial release-identity/)
  assert.throws(() => classifyProductionContract({ ...modernHealth(), release_version: undefined, supabase_host: undefined }), /partial release-identity/)
  assert.throws(() => classifyProductionContract(null), /JSON object/)
  await assert.rejects(run(mockFetch({ health: { status: 'ok', db: 'ok' } })), /no known production contract/)
})

test('a failing web login fails the monitor', async () => {
  await assert.rejects(run(mockFetch({ health: legacyHealth(), webStatus: 503 })), /Web login returned HTTP 503/)
})

test('a transient timeout is retried, but a persistent one still fails the monitor', async () => {
  const inner = mockFetch({ health: legacyHealth() }).fetchImpl
  let loginCalls = 0
  const flaky = async (url, init) => {
    if (new URL(url).pathname === '/login' && (loginCalls += 1) < 3) throw new DOMException('timeout', 'TimeoutError')
    return inner(url, init)
  }
  const opts = { webUrl: WEB, apiUrl: API, log: () => {}, retryDelayMs: 0 }
  assert.deepEqual(await runProductionMonitorSmoke({ ...opts, fetchImpl: flaky }), { contract: 'legacy' })
  assert.equal(loginCalls, 3)
  const dead = async () => { throw new DOMException('timeout', 'TimeoutError') }
  await assert.rejects(runProductionMonitorSmoke({ ...opts, fetchImpl: dead }), /Web login did not respond after 3 attempts/)
})

test('public-smoke.mjs stays strict: it still requires /ready and has no legacy fallback', () => {
  const strict = readFileSync('scripts/public-smoke.mjs', 'utf8')
  assert.match(strict, /resolveUrl\(apiUrl, 'ready'\)/)
  assert.match(strict, /readiness\.status !== 'ready' \|\| readiness\.database !== 'compatible'/)
  assert.doesNotMatch(strict, /legacy|health\.env\b/)
})
