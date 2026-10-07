const LOCAL_API_URL = 'http://localhost:8000/v1'

export function resolveApiUrl(configuredApiUrl?: string): string {
  const value = configuredApiUrl?.trim()
  if (!value) return LOCAL_API_URL

  try {
    const url = new URL(value)
    if (url.pathname === '' || url.pathname === '/') url.pathname = '/v1'
    return url.toString().replace(/\/$/, '')
  } catch {
    return value
  }
}

const RETIRED_API_URLS = [
  'https://patelrep-web-production.up.railway.app/v1',
  'https://stellar-integrity-production-f507.up.railway.app/v1',
  'https://stellar-integrity-production-30cf.up.railway.app/v1',
]
const LIVE_API_URL = 'https://noble-cooperation-production.up.railway.app/v1'

// A deployment (Vercel) can carry a stale NEXT_PUBLIC_API_URL pointing at a
// deleted Railway service. Retired hosts never serve traffic, so redirect them
// to the live API regardless of NEXT_PUBLIC_APP_ENV (which may also be unset).
export function resolveLiveApiUrl(configuredApiUrl?: string): string {
  const resolved = resolveApiUrl(configuredApiUrl)
  return RETIRED_API_URLS.includes(resolved) ? LIVE_API_URL : resolved
}
