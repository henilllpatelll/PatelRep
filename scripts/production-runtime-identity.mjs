// Read-only proof of WHAT IS ACTUALLY DEPLOYED to production, from the two public production endpoints only.
// No production Environment, secret, Railway/Supabase credential, database access or write token is involved.
// This is an IDENTITY proof, not a health check: a body that carries the modern release identity is enough even
// when the service is otherwise unhealthy (that is exactly when Phase 2D matters). Anything legacy, partial,
// unreachable, malformed or contradictory between Web and API throws, so automatic requests stay ineligible.
import { classifyProductionContract } from './production-monitor-smoke.mjs'
import { extractMetaContent } from './public-smoke.mjs'
import { parseStrictTag } from './release-version.mjs'

// Same public URLs Deploy Health Check monitors (a test pins them to deploy-check.yml).
export const PRODUCTION_WEB_URL = 'https://patelrep-production-6f35.up.railway.app'
export const PRODUCTION_API_URL = 'https://noble-cooperation-production.up.railway.app'

const SHA = /^[0-9a-f]{40}$/
const fail = (message) => {
  throw new Error(`production runtime identity: ${message}`)
}
const urlOf = (base, path) => new URL(path, base.endsWith('/') ? base : `${base}/`).toString()

async function fetchBody(fetchImpl, label, url) {
  let response
  try {
    response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    fail(`${label} is unreachable (${String(error.message).split('\n')[0].slice(0, 100)})`)
  }
  // Status is deliberately not required to be 2xx: identity may be present on an unhealthy response.
  return response
}

/** @returns {{sha: string, version: string}} the proven, Web/API-agreeing modern release identity */
export async function readProductionRuntimeIdentity({ fetchImpl = fetch, webUrl = PRODUCTION_WEB_URL, apiUrl = PRODUCTION_API_URL } = {}) {
  const healthResponse = await fetchBody(fetchImpl, 'API /health', urlOf(apiUrl, 'health'))
  let health
  try {
    health = await healthResponse.json()
  } catch {
    fail(`API /health (HTTP ${healthResponse.status}) did not return JSON`)
  }
  let contract
  try {
    contract = classifyProductionContract(health)
  } catch (error) {
    fail(error.message)
  }
  if (contract !== 'modern') fail('production runs the legacy contract, which has no release identity')
  if (health.environment !== 'production' || health.env !== health.environment) fail('API does not report the production environment')
  if (!SHA.test(health.release_sha ?? '')) fail('API release SHA is not a 40-character SHA')
  if (typeof health.release_version !== 'string' || !parseStrictTag(health.release_version)) fail('API release version is not a managed vX.Y.Z version')

  const webResponse = await fetchBody(fetchImpl, 'Web /login', urlOf(webUrl, 'login'))
  let html
  try {
    html = await webResponse.text()
  } catch {
    fail('Web /login body could not be read')
  }
  const webSha = extractMetaContent(html, 'patelrep-release-sha')
  const webVersion = extractMetaContent(html, 'patelrep-release-version')
  if (!SHA.test(webSha ?? '') || !parseStrictTag(webVersion ?? '')) fail('Web does not carry a complete modern release identity')
  if (webSha !== health.release_sha || webVersion !== health.release_version) {
    fail(`Web ${webSha}/${webVersion} disagrees with API ${health.release_sha}/${health.release_version}`)
  }
  return { sha: health.release_sha, version: health.release_version }
}
