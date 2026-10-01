function resolveUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

async function fetchOrThrow(label, url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`)
  }

  return response
}

/** Reads a static `<meta name="..." content="...">` tag's value straight out of server-rendered HTML — no browser needed. */
export function extractMetaContent(html, name) {
  const match = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
    ?? html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'))
  return match?.[1] ?? null
}

export async function runPublicSmoke({
  webUrl,
  apiUrl,
  expectedEnvironment,
  expectedSupabaseHost,
  expectedReleaseSha,
  expectedReleaseVersion,
}) {
  if (!webUrl || !apiUrl) {
    throw new Error('PUBLIC_WEB_URL and PUBLIC_API_URL are required.')
  }

  const webResponse = await fetchOrThrow('Web login', resolveUrl(webUrl, 'login'))
  const webHtml = await webResponse.text()
  const healthResponse = await fetchOrThrow('API health', resolveUrl(apiUrl, 'health'))
  const health = await healthResponse.json()
  const readinessResponse = await fetchOrThrow('API readiness', resolveUrl(apiUrl, 'ready'))
  const readiness = await readinessResponse.json()

  if (health.status !== 'ok' || health.db !== 'ok') {
    throw new Error('API health did not confirm a ready database dependency.')
  }
  if (expectedEnvironment && health.environment !== expectedEnvironment) {
    throw new Error(`API environment was ${health.environment ?? 'unset'}, expected ${expectedEnvironment}.`)
  }
  if (expectedSupabaseHost && health.supabase_host !== expectedSupabaseHost) {
    throw new Error('API health did not report the expected Supabase host.')
  }
  if (expectedReleaseSha && (health.release_sha !== expectedReleaseSha || readiness.release_sha !== expectedReleaseSha)) {
    throw new Error('API health/readiness did not report the exact expected release SHA.')
  }
  if (expectedReleaseVersion && (health.release_version !== expectedReleaseVersion || readiness.release_version !== expectedReleaseVersion)) {
    throw new Error('API health/readiness did not report the exact expected release version.')
  }
  if (readiness.status !== 'ready' || readiness.database !== 'compatible') {
    throw new Error('API readiness did not confirm a compatible database schema.')
  }
  if (expectedReleaseSha) {
    const webReleaseSha = extractMetaContent(webHtml, 'patelrep-release-sha')
    if (webReleaseSha !== expectedReleaseSha) {
      throw new Error(`Web bundle release SHA was ${webReleaseSha ?? 'missing'}, expected ${expectedReleaseSha} — API and Web do not agree.`)
    }
  }
  if (expectedReleaseVersion) {
    const webReleaseVersion = extractMetaContent(webHtml, 'patelrep-release-version')
    if (webReleaseVersion !== expectedReleaseVersion) {
      throw new Error(`Web bundle release version was ${webReleaseVersion ?? 'missing'}, expected ${expectedReleaseVersion} — API and Web do not agree.`)
    }
  }

  console.log(`Public smoke passed: web=${webResponse.status}, api=${healthResponse.status}, db=${health.db}, environment=${health.environment}, release=${health.release_sha}, version=${health.release_version ?? 'unknown'}`)
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await runPublicSmoke({
    webUrl: process.env.PUBLIC_WEB_URL,
    apiUrl: process.env.PUBLIC_API_URL,
    expectedEnvironment: process.env.EXPECTED_APP_ENV,
    expectedSupabaseHost: process.env.EXPECTED_SUPABASE_HOST,
    expectedReleaseSha: process.env.EXPECTED_RELEASE_SHA,
    expectedReleaseVersion: process.env.EXPECTED_RELEASE_VERSION,
  })
}
