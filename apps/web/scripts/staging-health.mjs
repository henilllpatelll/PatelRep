import { chromium } from '@playwright/test'

const webUrl = process.env.STAGING_WEB_URL
const apiUrl = process.env.STAGING_API_URL
const expectedSupabaseHost = process.env.STAGING_EXPECTED_SUPABASE_HOST
const expectedReleaseSha = process.env.STAGING_EXPECTED_RELEASE_SHA

if (!webUrl || !apiUrl || !expectedSupabaseHost || !expectedReleaseSha) {
  throw new Error('STAGING_WEB_URL, STAGING_API_URL, STAGING_EXPECTED_SUPABASE_HOST, and STAGING_EXPECTED_RELEASE_SHA are required.')
}

const resolveUrl = (baseUrl, path) => new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
const healthResponse = await fetch(resolveUrl(apiUrl, 'health'), { signal: AbortSignal.timeout(15_000) })
if (!healthResponse.ok) throw new Error(`Staging API health returned HTTP ${healthResponse.status}.`)
const health = await healthResponse.json()
if (health.status !== 'ok' || health.db !== 'ok' || health.environment !== 'staging') {
  throw new Error('Staging API did not report a ready staging database.')
}
if (health.supabase_host !== expectedSupabaseHost) {
  throw new Error('Staging API is not connected to the expected staging Supabase host.')
}
if (health.release_sha !== expectedReleaseSha) {
  throw new Error('Staging API does not report the exact candidate release SHA.')
}

const browser = await chromium.launch()
const page = await browser.newPage()
try {
  await page.goto(resolveUrl(webUrl, 'login'), { waitUntil: 'networkidle', timeout: 30_000 })
  await page.getByTestId('service-health').waitFor({ state: 'visible', timeout: 10_000 })
  const healthText = (await page.getByTestId('service-health').textContent())?.trim() ?? ''
  if (!/connected/i.test(healthText)) throw new Error(`Staging login reports ${JSON.stringify(healthText)}.`)
  const webReleaseSha = await page.locator('meta[name="patelrep-release-sha"]').getAttribute('content')
  if (webReleaseSha !== expectedReleaseSha) throw new Error('Staging web bundle does not report the exact candidate release SHA.')
  console.log('Staging health passed: web login, API, database, environment, Supabase identity, and release SHA match.')
} finally {
  await browser.close()
}
