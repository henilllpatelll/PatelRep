#!/usr/bin/env node
/**
 * Read-only post-enable verification for .github/workflows/feature-rollout.yml.
 * Confirms the platform is healthy and the web app is reachable after a flag
 * change -- it deliberately does NOT attempt to authenticate as the affected
 * tenant's users (the rollout workflow holds no per-tenant user credentials),
 * so it cannot assert the gated endpoint/page itself now behaves differently.
 * That per-tenant confirmation is a manual step (see docs/FEATURE_FLAGS.md).
 * No destructive E2E, no mutation.
 */

const resolveUrl = (baseUrl, path) => new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()

export async function verifyApiHealth(apiUrl, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(resolveUrl(apiUrl, 'health'), { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`API health check returned HTTP ${response.status}.`)
  const health = await response.json()
  if (health.status !== 'ok' || health.db !== 'ok') {
    throw new Error('API did not report a healthy database after the flag change.')
  }
  return health
}

export async function verifyWebReachable(webUrl, path = 'login', { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(resolveUrl(webUrl, path), { signal: AbortSignal.timeout(15_000), redirect: 'manual' })
  if (response.status >= 500) throw new Error(`Web route ${path} returned HTTP ${response.status}.`)
  return response.status
}

async function main() {
  const apiUrl = process.env.API_URL
  const webUrl = process.env.WEB_URL
  if (!apiUrl || !webUrl) throw new Error('API_URL and WEB_URL are required.')

  await verifyApiHealth(apiUrl)
  await verifyWebReachable(webUrl)
  console.log('Post-enable verification passed: API health is green and the web app is reachable.')
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
