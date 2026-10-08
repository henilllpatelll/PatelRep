// Runtime monitor for what is ACTUALLY deployed to production (used only by Deploy Health Check).
// scripts/public-smoke.mjs remains the strict release-verification contract for Production Release.
//
// The deployed API is classified into an explicit, known contract family from its /health shape.
// Only a positive match against the known legacy contract may skip /ready (that contract predates
// the endpoint). Unknown, partial, or contradictory shapes fail closed; a 404 is never ignored.
import { pathToFileURL } from 'node:url'
import { extractMetaContent } from './public-smoke.mjs'

const SHA = /^[0-9a-f]{40}$/
const MODERN_IDENTITY_KEYS = ['environment', 'release_sha', 'release_version', 'supabase_host']

function resolveUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

const FETCH_ATTEMPTS = 3
const FETCH_RETRY_DELAY_MS = 5_000

// A timeout or network error (cold start, slow edge) is retried a bounded number of times; a response
// with any HTTP status is a real answer and is never retried, so a genuinely down deployment still fails.
async function fetchOk(fetchImpl, label, url, retryDelayMs = FETCH_RETRY_DELAY_MS) {
  let response
  for (let attempt = 1; ; attempt += 1) {
    try {
      response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
      break
    } catch (error) {
      if (attempt >= FETCH_ATTEMPTS) throw new Error(`${label} did not respond after ${FETCH_ATTEMPTS} attempts: ${error?.message ?? error}`)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`)
  return response
}

/** Returns 'legacy' | 'modern', or throws for any shape that is not an explicitly known contract. */
export function classifyProductionContract(health) {
  if (!health || typeof health !== 'object' || Array.isArray(health)) {
    throw new Error('API /health did not return a JSON object; unknown production contract.')
  }
  const present = MODERN_IDENTITY_KEYS.filter((key) => health[key] !== undefined)
  if (present.length === MODERN_IDENTITY_KEYS.length && typeof health.env === 'string') return 'modern'
  if (present.length > 0) {
    throw new Error(`API /health has a partial release-identity shape (${present.join(', ')}); unknown production contract.`)
  }
  const legacy =
    typeof health.env === 'string' &&
    typeof health.status === 'string' &&
    typeof health.db === 'string' &&
    typeof health.version === 'string' &&
    health.cron !== null &&
    typeof health.cron === 'object'
  if (legacy) return 'legacy'
  throw new Error('API /health matches no known production contract (legacy or modern).')
}

function verifyHealthy(health) {
  if (health.status !== 'ok' || health.db !== 'ok') {
    throw new Error('API health did not confirm a ready database dependency.')
  }
}

export async function runProductionMonitorSmoke({ webUrl, apiUrl, fetchImpl = fetch, log = console.log, retryDelayMs }) {
  if (!webUrl || !apiUrl) throw new Error('PUBLIC_WEB_URL and PUBLIC_API_URL are required.')

  const webResponse = await fetchOk(fetchImpl, 'Web login', resolveUrl(webUrl, 'login'), retryDelayMs)
  const webHtml = await webResponse.text()
  const healthResponse = await fetchOk(fetchImpl, 'API health', resolveUrl(apiUrl, 'health'), retryDelayMs)
  const health = await healthResponse.json()

  const contract = classifyProductionContract(health)
  log(`Detected production contract: ${contract}`)
  verifyHealthy(health)

  if (contract === 'legacy') {
    if (health.env !== 'production') throw new Error(`Legacy API env was ${health.env}, expected production.`)
    log(`Production monitor passed: contract=legacy, web=${webResponse.status}, api=${healthResponse.status}, db=${health.db} (/ready not part of this contract)`)
    return { contract }
  }

  if (health.environment !== 'production' || health.env !== health.environment) {
    throw new Error(`API environment was ${health.environment ?? 'unset'}/${health.env ?? 'unset'}, expected production.`)
  }
  if (!SHA.test(health.release_sha ?? '')) throw new Error('API health release SHA is not a 40-character SHA.')
  if (typeof health.release_version !== 'string' || !health.release_version || health.release_version === 'unknown') {
    throw new Error('API health release version is missing.')
  }

  const readinessResponse = await fetchOk(fetchImpl, 'API readiness', resolveUrl(apiUrl, 'ready'), retryDelayMs)
  const readiness = await readinessResponse.json()
  if (readiness.status !== 'ready' || readiness.database !== 'compatible') {
    throw new Error('API readiness did not confirm a compatible database schema.')
  }
  if (readiness.environment !== 'production') throw new Error('API readiness did not report the production environment.')
  if (readiness.release_sha !== health.release_sha || readiness.release_version !== health.release_version) {
    throw new Error('API health and readiness disagree on release identity.')
  }

  const webSha = extractMetaContent(webHtml, 'patelrep-release-sha')
  const webVersion = extractMetaContent(webHtml, 'patelrep-release-version')
  if (webSha !== health.release_sha || webVersion !== health.release_version) {
    throw new Error(`Web bundle release ${webSha ?? 'missing'}/${webVersion ?? 'missing'} does not match API ${health.release_sha}/${health.release_version}.`)
  }

  log(`Production monitor passed: contract=modern, release=${health.release_sha}, version=${health.release_version}`)
  return { contract }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runProductionMonitorSmoke({ webUrl: process.env.PUBLIC_WEB_URL, apiUrl: process.env.PUBLIC_API_URL })
}
