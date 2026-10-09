function resolveUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

/**
 * A mismatch that can legitimately resolve on its own while a deployment is still activating (old container still
 * serving, endpoint briefly unreachable). Only `waitForPublicSmoke` retries these; `runPublicSmoke` still throws
 * on the first one, so every other caller keeps its single-shot, strict behaviour. Anything NOT of this type
 * (wrong environment, wrong Supabase host, unhealthy database, incompatible schema) is a hard failure and is
 * never retried.
 */
export class PublicSmokePendingError extends Error {
  constructor(message, observed = {}) {
    super(message)
    this.name = 'PublicSmokePendingError'
    this.observed = observed
  }
}

async function fetchOrThrow(label, url, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new PublicSmokePendingError(`${label} request failed: ${String(error?.message ?? error).slice(0, 200)}`)
  }

  if (!response.ok) {
    throw new PublicSmokePendingError(`${label} returned HTTP ${response.status}.`)
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
  fetchImpl = fetch,
}) {
  if (!webUrl || !apiUrl) {
    throw new Error('PUBLIC_WEB_URL and PUBLIC_API_URL are required.')
  }

  const webResponse = await fetchOrThrow('Web login', resolveUrl(webUrl, 'login'), fetchImpl)
  const webHtml = await webResponse.text()
  const healthResponse = await fetchOrThrow('API health', resolveUrl(apiUrl, 'health'), fetchImpl)
  const health = await healthResponse.json()
  const readinessResponse = await fetchOrThrow('API readiness', resolveUrl(apiUrl, 'ready'), fetchImpl)
  const readiness = await readinessResponse.json()
  const observed = () => ({
    apiSha: health.release_sha ?? null,
    apiVersion: health.release_version ?? null,
    readinessSha: readiness.release_sha ?? null,
    webSha: extractMetaContent(webHtml, 'patelrep-release-sha'),
    webVersion: extractMetaContent(webHtml, 'patelrep-release-version'),
  })

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
    throw new PublicSmokePendingError('API health/readiness did not report the exact expected release SHA.', observed())
  }
  if (expectedReleaseVersion && (health.release_version !== expectedReleaseVersion || readiness.release_version !== expectedReleaseVersion)) {
    throw new PublicSmokePendingError('API health/readiness did not report the exact expected release version.', observed())
  }
  if (readiness.status !== 'ready' || readiness.database !== 'compatible') {
    throw new Error('API readiness did not confirm a compatible database schema.')
  }
  if (expectedReleaseSha) {
    const webReleaseSha = extractMetaContent(webHtml, 'patelrep-release-sha')
    if (webReleaseSha !== expectedReleaseSha) {
      throw new PublicSmokePendingError(`Web bundle release SHA was ${webReleaseSha ?? 'missing'}, expected ${expectedReleaseSha} — API and Web do not agree.`, observed())
    }
  }
  if (expectedReleaseVersion) {
    const webReleaseVersion = extractMetaContent(webHtml, 'patelrep-release-version')
    if (webReleaseVersion !== expectedReleaseVersion) {
      throw new PublicSmokePendingError(`Web bundle release version was ${webReleaseVersion ?? 'missing'}, expected ${expectedReleaseVersion} — API and Web do not agree.`, observed())
    }
  }

  console.log(`Public smoke passed: web=${webResponse.status}, api=${healthResponse.status}, db=${health.db}, environment=${health.environment}, release=${health.release_sha}, version=${health.release_version ?? 'unknown'}`)
}

export const MAX_WAIT_TIMEOUT_SECONDS = 1800
export const MAX_WAIT_INTERVAL_SECONDS = 120

function boundedSeconds(label, raw, { min, max, fallback }) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
  const text = String(raw).trim()
  const value = Number(text)
  if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}; got "${text.slice(0, 40)}".`)
  }
  return value
}

/** Parses the opt-in wait window. Both values are validated and capped; a bad value fails closed. */
export function parseWaitConfig(env) {
  return {
    timeoutSeconds: boundedSeconds('SMOKE_WAIT_TIMEOUT_SECONDS', env.SMOKE_WAIT_TIMEOUT_SECONDS, { min: 0, max: MAX_WAIT_TIMEOUT_SECONDS, fallback: 0 }),
    intervalSeconds: boundedSeconds('SMOKE_WAIT_INTERVAL_SECONDS', env.SMOKE_WAIT_INTERVAL_SECONDS, { min: 1, max: MAX_WAIT_INTERVAL_SECONDS, fallback: 10 }),
  }
}

function describeObserved(observed) {
  const parts = Object.entries(observed ?? {}).map(([key, value]) => `${key}=${value ?? 'missing'}`)
  return parts.length ? ` [${parts.join(' ')}]` : ''
}

/**
 * Runs the strict smoke repeatedly until ONE attempt passes every exact check, or the bounded window ends.
 * Only `PublicSmokePendingError` (stale/unreachable deployment identity) is retried; every other failure is
 * rethrown immediately. A pass is always a single complete snapshot that matched the exact expected SHA and
 * version: nothing is ever relaxed, averaged or accepted partially. `timeoutSeconds` of 0 is exactly one attempt.
 */
export async function waitForPublicSmoke(options, {
  timeoutSeconds = 0,
  intervalSeconds = 10,
  run = runPublicSmoke,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  const startedAt = now()
  const deadline = startedAt + timeoutSeconds * 1000
  const history = []
  let attempt = 0

  for (;;) {
    attempt += 1
    try {
      await run(options)
      const elapsed = Math.round((now() - startedAt) / 1000)
      if (attempt > 1) log(`Public release verification passed on attempt ${attempt} after ${elapsed}s.`)
      return { attempts: attempt, elapsedSeconds: elapsed }
    } catch (error) {
      if (!(error instanceof PublicSmokePendingError)) throw error
      const elapsed = Math.round((now() - startedAt) / 1000)
      const line = `attempt ${attempt} at ${elapsed}s: ${error.message}${describeObserved(error.observed)}`
      history.push(line)
      if (now() + intervalSeconds * 1000 > deadline) {
        const shown = history.length > 6 ? ['...', ...history.slice(-5)] : history
        throw new Error(
          `Public release verification did not converge to the exact expected release within ${timeoutSeconds}s ` +
          `(${attempt} attempt${attempt === 1 ? '' : 's'}). The deployment may not have activated or may have failed; ` +
          `check Railway deployment status. Last observations:\n  ${shown.join('\n  ')}`,
        )
      }
      log(`Waiting for release identity to propagate — ${line}`)
      await sleep(intervalSeconds * 1000)
    }
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const wait = parseWaitConfig(process.env)
  await waitForPublicSmoke({
    webUrl: process.env.PUBLIC_WEB_URL,
    apiUrl: process.env.PUBLIC_API_URL,
    expectedEnvironment: process.env.EXPECTED_APP_ENV,
    expectedSupabaseHost: process.env.EXPECTED_SUPABASE_HOST,
    expectedReleaseSha: process.env.EXPECTED_RELEASE_SHA,
    expectedReleaseVersion: process.env.EXPECTED_RELEASE_VERSION,
  }, wait)
}
