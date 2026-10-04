import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PRODUCTION_API_URL, PRODUCTION_WEB_URL, readProductionRuntimeIdentity } from './production-runtime-identity.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const SHA = 'e'.repeat(40)
const VERSION = 'v1.8.0'

const modernHealth = (overrides = {}) => ({
  status: 'ok', db: 'ok', env: 'production', environment: 'production', release_sha: SHA, release_version: VERSION, supabase_host: 'x.supabase.co', ...overrides,
})
const webHtml = (sha = SHA, version = VERSION) =>
  `<html><head><meta name="patelrep-release-sha" content="${sha}"><meta name="patelrep-release-version" content="${version}"></head></html>`

function fakeFetch({ health = modernHealth(), html = webHtml(), healthStatus = 200, webStatus = 200, healthBody, throwFor } = {}) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    if (throwFor && url.includes(throwFor)) throw new Error('connect ECONNREFUSED')
    if (url.endsWith('/health')) {
      return { status: healthStatus, ok: healthStatus < 400, json: async () => { if (healthBody === 'bad') throw new Error('not json'); return health } }
    }
    return { status: webStatus, ok: webStatus < 400, text: async () => html }
  }
  return { impl, calls }
}

const identity = (options) => readProductionRuntimeIdentity({ fetchImpl: fakeFetch(options).impl })

test('a modern, agreeing Web/API identity is proven from public endpoints only', async () => {
  const { impl, calls } = fakeFetch()
  assert.deepEqual(await readProductionRuntimeIdentity({ fetchImpl: impl }), { sha: SHA, version: VERSION })
  assert.deepEqual(calls.map((call) => call.url), [`${PRODUCTION_API_URL}/health`, `${PRODUCTION_WEB_URL}/login`])
  for (const call of calls) assert.equal(call.init.headers, undefined, 'no credentials are ever sent')
})

test('identity does not require health success: an unhealthy response that still carries identity is enough', async () => {
  assert.deepEqual(await identity({ health: modernHealth({ status: 'degraded', db: 'down' }), healthStatus: 503 }), { sha: SHA, version: VERSION })
  assert.deepEqual(await identity({ webStatus: 500 }), { sha: SHA, version: VERSION })
})

test('legacy, partial, unknown and non-production identities are refused', async () => {
  const legacy = { env: 'production', status: 'ok', db: 'ok', version: '1.0.0', cron: { ok: true } }
  await assert.rejects(identity({ health: legacy }), /legacy contract/)
  await assert.rejects(identity({ health: { status: 'ok', release_sha: SHA } }), /partial release-identity/)
  await assert.rejects(identity({ health: { hello: 'world' } }), /no known production contract/)
  await assert.rejects(identity({ health: [] }), /production runtime identity/)
  await assert.rejects(identity({ health: modernHealth({ environment: 'staging', env: 'staging' }) }), /production environment/)
})

test('malformed SHA or version is refused', async () => {
  await assert.rejects(identity({ health: modernHealth({ release_sha: 'abc' }) }), /40-character SHA/)
  await assert.rejects(identity({ health: modernHealth({ release_sha: 'E'.repeat(40) }) }), /40-character SHA/)
  for (const release_version of ['unknown', '1.8.0', 'v1.8', 'v1.8.0-rc1', 'v01.8.0', '']) {
    await assert.rejects(identity({ health: modernHealth({ release_version }) }), /managed vX\.Y\.Z/, release_version)
  }
})

test('Web must carry a complete identity that agrees with the API', async () => {
  await assert.rejects(identity({ html: webHtml('c'.repeat(40)) }), /disagrees/)
  await assert.rejects(identity({ html: webHtml(SHA, 'v1.8.1') }), /disagrees/)
  await assert.rejects(identity({ html: '<html></html>' }), /complete modern release identity/)
  await assert.rejects(identity({ html: `<meta name="patelrep-release-sha" content="${SHA}">` }), /complete modern release identity/)
  await assert.rejects(identity({ html: webHtml('nope', VERSION) }), /complete modern release identity/)
})

test('unavailable endpoints or unreadable bodies are refused, never guessed', async () => {
  await assert.rejects(identity({ throwFor: '/health' }), /API \/health is unreachable/)
  await assert.rejects(identity({ throwFor: '/login' }), /Web \/login is unreachable/)
  await assert.rejects(identity({ healthBody: 'bad', healthStatus: 502 }), /did not return JSON/)
})

test('the module is credential-free and pinned to the URLs Deploy Health Check monitors; monitor and rollback are untouched', () => {
  const source = read('scripts/production-runtime-identity.mjs')
  const executable = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
  assert.doesNotMatch(executable, /process\.env|secrets|token|authorization|supabase\.co|psql|railway\.com|--method|createClient/i)
  const deployCheck = read('.github/workflows/deploy-check.yml')
  assert.ok(deployCheck.includes(`PUBLIC_WEB_URL: ${PRODUCTION_WEB_URL}`))
  assert.ok(deployCheck.includes(`PUBLIC_API_URL: ${PRODUCTION_API_URL}`))
  // The strict monitor and Production Release verification keep their own contracts (the runtime proof is additive).
  assert.match(read('scripts/production-monitor-smoke.mjs'), /verifyHealthy\(health\)/)
  assert.match(read('.github/workflows/production-release.yml'), /production-release-request\.mjs release/)
})

test('request and release stages all go through the shared policy that reads the runtime and health history', () => {
  const policy = read('scripts/production-release-request-policy.mjs')
  assert.match(policy, /await deps\.readRuntimeIdentity\(\)/)
  assert.match(policy, /await deps\.listHealthRuns\(result\.base_main_sha\)/)
  assert.match(policy, /runtime\?\.sha !== baseline\.sha \|\| runtime\?\.version !== baseline\.tag/)
  const cli = read('scripts/production-release-request.mjs')
  assert.equal((cli.match(/validateProductionRequest|evaluateProductionRequest/g) ?? []).length >= 3, true)
  const deps = read('scripts/production-release-request-deps.mjs')
  assert.match(deps, /readRuntimeIdentity: \(\) => readProductionRuntimeIdentity\(\)/)
  assert.match(deps, /actions\/workflows\/deploy-check\.yml\/runs\?head_sha=/)
})
