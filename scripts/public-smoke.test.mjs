import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  MAX_WAIT_INTERVAL_SECONDS,
  MAX_WAIT_TIMEOUT_SECONDS,
  PublicSmokePendingError,
  extractMetaContent,
  parseWaitConfig,
  runPublicSmoke,
  waitForPublicSmoke,
} from './public-smoke.mjs'

test('extracts content from a name-then-content meta tag', () => {
  const html = '<head><meta name="patelrep-release-sha" content="abc1234"/></head>'
  assert.equal(extractMetaContent(html, 'patelrep-release-sha'), 'abc1234')
})

test('extracts content from a content-then-name meta tag', () => {
  const html = '<head><meta content="v1.8.0" name="patelrep-release-version"/></head>'
  assert.equal(extractMetaContent(html, 'patelrep-release-version'), 'v1.8.0')
})

test('returns null when the tag is missing', () => {
  const html = '<head><meta name="other-tag" content="value"/></head>'
  assert.equal(extractMetaContent(html, 'patelrep-release-sha'), null)
})

// ---- bounded release-identity polling (run 37958771273: Web still served the previous release) ----------------

const NEW_SHA = '8e4ee88b354360754d1134d62d81b8af370b0434'
const OLD_SHA = '97013490563b732c0848c625fc1b592b0a70bdbb'
const HOST = 'oacnwalhcpqdabivweki.supabase.co'

const options = (fetchImpl) => ({
  webUrl: 'https://web.example.test',
  apiUrl: 'https://api.example.test',
  expectedEnvironment: 'production',
  expectedSupabaseHost: HOST,
  expectedReleaseSha: NEW_SHA,
  expectedReleaseVersion: 'v1.9.2',
  fetchImpl,
})

const page = (sha, version) =>
  `<html><head><meta name="patelrep-release-sha" content="${sha}"/><meta name="patelrep-release-version" content="${version}"/></head></html>`

/** `web`, `api`, `ready` are functions of the 0-based poll number so tests can script propagation over time. */
function fakeFetch({ web, api = () => ({}), ready = () => ({}) }) {
  const polls = { web: 0, api: 0, ready: 0 }
  const apiBody = (extra) => ({ status: 'ok', db: 'ok', environment: 'production', supabase_host: HOST, release_sha: NEW_SHA, release_version: 'v1.9.2', ...extra })
  const readyBody = (extra) => ({ status: 'ready', database: 'compatible', release_sha: NEW_SHA, release_version: 'v1.9.2', ...extra })
  const respond = (ok, status, body) => ({ ok, status, text: async () => body, json: async () => body })
  const fetchImpl = async (url) => {
    const { pathname } = new URL(url)
    if (pathname === '/login') {
      const result = web(polls.web++)
      if (result === 'down') return respond(false, 502, '')
      if (result === 'throw') throw new Error('socket hang up')
      return respond(true, 200, page(result.sha, result.version))
    }
    if (pathname === '/health') {
      const result = api(polls.api++)
      return result === 'down' ? respond(false, 503, '') : respond(true, 200, apiBody(result))
    }
    if (pathname === '/ready') return respond(true, 200, readyBody(ready(polls.ready++)))
    throw new Error(`unexpected URL ${url}`)
  }
  return { fetchImpl, polls }
}

function fakeClock() {
  let t = 1_000_000
  const sleeps = []
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms)
      t += ms
    },
    sleeps,
    log: () => {},
  }
}

const stale = { sha: OLD_SHA, version: 'v1.9.1' }
const fresh = { sha: NEW_SHA, version: 'v1.9.2' }

function wait(fetchImpl, { timeoutSeconds = 120, intervalSeconds = 10 } = {}) {
  const clock = fakeClock()
  const result = waitForPublicSmoke(options(fetchImpl), { timeoutSeconds, intervalSeconds, ...clock })
  return { result, clock }
}

test('succeeds on the first attempt without sleeping when the release is already live', async () => {
  const { fetchImpl } = fakeFetch({ web: () => fresh })
  const { result, clock } = wait(fetchImpl)
  assert.deepEqual(await result, { attempts: 1, elapsedSeconds: 0 })
  assert.deepEqual(clock.sleeps, [])
})

test('delayed propagation: old Web container keeps serving, then the exact release appears', async () => {
  const { fetchImpl, polls } = fakeFetch({ web: (n) => (n < 3 ? stale : fresh) })
  const { result, clock } = wait(fetchImpl)
  assert.deepEqual(await result, { attempts: 4, elapsedSeconds: 30 })
  assert.deepEqual(clock.sleeps, [10_000, 10_000, 10_000])
  assert.equal(polls.web, 4)
})

test('tolerates the Web endpoint being briefly unreachable while the deployment activates', async () => {
  const { fetchImpl } = fakeFetch({ web: (n) => (n === 0 ? 'down' : n === 1 ? 'throw' : fresh) })
  const { result } = wait(fetchImpl)
  assert.equal((await result).attempts, 3)
})

test('timeout: a Web that never converges fails with bounded attempts and useful diagnostics', async () => {
  const { fetchImpl, polls } = fakeFetch({ web: () => stale })
  const { result, clock } = wait(fetchImpl, { timeoutSeconds: 60, intervalSeconds: 10 })
  await assert.rejects(result, (error) => {
    assert.match(error.message, /did not converge to the exact expected release within 60s/)
    assert.match(error.message, /Web bundle release SHA was 97013490563b/)
    assert.match(error.message, /webSha=97013490563b732c0848c625fc1b592b0a70bdbb/)
    assert.match(error.message, /apiSha=8e4ee88b354360754d1134d62d81b8af370b0434/)
    assert.match(error.message, /check Railway deployment status/)
    return true
  })
  assert.ok(polls.web >= 2 && polls.web <= 7, `bounded polls, got ${polls.web}`)
  assert.ok(clock.sleeps.reduce((a, b) => a + b, 0) <= 60_000, 'never sleeps past the window')
})

test('a Web serving a different, never-correct SHA is never accepted', async () => {
  const other = { sha: 'a'.repeat(40), version: 'v1.9.2' }
  const { fetchImpl } = fakeFetch({ web: () => other })
  await assert.rejects(wait(fetchImpl, { timeoutSeconds: 30 }).result, /Web bundle release SHA was a{40}/)
})

test('the right SHA with the wrong version is never accepted', async () => {
  const { fetchImpl } = fakeFetch({ web: () => ({ sha: NEW_SHA, version: 'v1.9.1' }) })
  await assert.rejects(wait(fetchImpl, { timeoutSeconds: 30 }).result, /Web bundle release version was v1\.9\.1, expected v1\.9\.2/)
})

test('a missing release meta tag (legacy build) is never accepted', async () => {
  const { fetchImpl } = fakeFetch({ web: () => ({ sha: 'unknown', version: 'unknown' }) })
  await assert.rejects(wait(fetchImpl, { timeoutSeconds: 20 }).result, /Web bundle release SHA was unknown/)
})

test('Web matching is not enough: a stale API identity also fails to converge', async () => {
  const { fetchImpl } = fakeFetch({ web: () => fresh, api: () => ({ release_sha: OLD_SHA }) })
  await assert.rejects(wait(fetchImpl, { timeoutSeconds: 20 }).result, /API health\/readiness did not report the exact expected release SHA/)
})

test('a transient API outage is retried, a persistent one times out', async () => {
  const flaky = fakeFetch({ web: () => fresh, api: (n) => (n < 2 ? 'down' : {}) })
  assert.equal((await wait(flaky.fetchImpl).result).attempts, 3)
  const dead = fakeFetch({ web: () => fresh, api: () => 'down' })
  await assert.rejects(wait(dead.fetchImpl, { timeoutSeconds: 30 }).result, /API health returned HTTP 503/)
})

test('genuine deployment failures are hard failures: one attempt, no waiting', async () => {
  const cases = {
    'unhealthy database': { api: () => ({ db: 'error' }), pattern: /ready database dependency/ },
    'wrong environment': { api: () => ({ environment: 'staging' }), pattern: /API environment was staging/ },
    'wrong Supabase host': { api: () => ({ supabase_host: 'other.supabase.co' }), pattern: /expected Supabase host/ },
    'schema not ready': { ready: () => ({ status: 'not_ready' }), pattern: /compatible database schema/ },
    'schema incompatible': { ready: () => ({ database: 'incompatible' }), pattern: /compatible database schema/ },
  }
  for (const [label, { api, ready, pattern }] of Object.entries(cases)) {
    const { fetchImpl, polls } = fakeFetch({ web: () => stale, api, ready })
    const { result, clock } = wait(fetchImpl, { timeoutSeconds: 600 })
    await assert.rejects(result, pattern, label)
    assert.equal(polls.web, 1, `${label}: attempted exactly once`)
    assert.deepEqual(clock.sleeps, [], `${label}: never slept`)
  }
})

test('hard failures are never converted into pending errors', async () => {
  const { fetchImpl } = fakeFetch({ web: () => fresh, api: () => ({ db: 'error' }) })
  await assert.rejects(runPublicSmoke(options(fetchImpl)), (error) => !(error instanceof PublicSmokePendingError))
})

test('a zero timeout is exactly the original single-shot strict behaviour', async () => {
  const { fetchImpl, polls } = fakeFetch({ web: () => stale })
  const { result, clock } = wait(fetchImpl, { timeoutSeconds: 0 })
  await assert.rejects(result, /Web bundle release SHA was 97013490563b/)
  assert.equal(polls.web, 1)
  assert.deepEqual(clock.sleeps, [])
})

test('runPublicSmoke itself never polls: stale Web fails on the first read', async () => {
  const { fetchImpl, polls } = fakeFetch({ web: () => stale })
  await assert.rejects(runPublicSmoke(options(fetchImpl)), /API and Web do not agree/)
  assert.equal(polls.web, 1)
})

test('wait configuration is validated, capped and defaults to no waiting', () => {
  assert.deepEqual(parseWaitConfig({}), { timeoutSeconds: 0, intervalSeconds: 10 })
  assert.deepEqual(parseWaitConfig({ SMOKE_WAIT_TIMEOUT_SECONDS: '600', SMOKE_WAIT_INTERVAL_SECONDS: '15' }), { timeoutSeconds: 600, intervalSeconds: 15 })
  for (const bad of ['abc', '-1', '1.5', '1e3', String(MAX_WAIT_TIMEOUT_SECONDS + 1)]) {
    assert.throws(() => parseWaitConfig({ SMOKE_WAIT_TIMEOUT_SECONDS: bad }), /SMOKE_WAIT_TIMEOUT_SECONDS/, bad)
  }
  for (const bad of ['0', 'x', String(MAX_WAIT_INTERVAL_SECONDS + 1)]) {
    assert.throws(() => parseWaitConfig({ SMOKE_WAIT_INTERVAL_SECONDS: bad }), /SMOKE_WAIT_INTERVAL_SECONDS/, bad)
  }
})

test('only the Production Release verification step opts in to waiting', () => {
  const release = readFileSync('.github/workflows/production-release.yml', 'utf8')
  const step = release.slice(release.indexOf('- name: Verify Web/API agree with each other and the exact expected release'))
  const block = step.slice(0, step.indexOf('- name: Verify no deployment API-URL drift'))
  assert.match(block, /SMOKE_WAIT_TIMEOUT_SECONDS: '600'/)
  assert.match(block, /timeout-minutes: 15/)
  assert.match(block, /EXPECTED_RELEASE_SHA: \$\{\{ needs\.resolve-and-verify-eligibility\.outputs\.target_sha \}\}/)
  assert.match(block, /EXPECTED_RELEASE_VERSION: \$\{\{ needs\.compute-version\.outputs\.next_version \}\}/)
  assert.match(block, /EXPECTED_SUPABASE_HOST: \$\{\{ vars\.PRODUCTION_SUPABASE_HOST \}\}/)
  // Strict-by-design callers keep single-shot semantics (stabilization counts consecutive failures).
  for (const file of [
    '.github/workflows/production-rollback.yml',
    '.github/workflows/staging-candidate.yml',
    '.github/workflows/deploy-check.yml',
    '.github/workflows/production-release-stabilization.yml',
  ]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /SMOKE_WAIT_/, file)
  }
  for (const file of ['scripts/production-release-stabilization.mjs', 'scripts/production-auto-rollback-deps.mjs', 'scripts/production-monitor-smoke.mjs']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /waitForPublicSmoke/, file)
  }
})
