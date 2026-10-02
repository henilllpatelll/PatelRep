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
