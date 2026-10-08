export const RATE_LIMITED_CONSOLE_ERROR = 'Failed to load resource: the server responded with a status of 429 ()'

export const UNAUTHORIZED_CONSOLE_ERROR = 'Failed to load resource: the server responded with a status of 401 ()'

/**
 * A restricted (mobile-only) role is signed out right after password sign-in, so requests the page
 * makes around that moment may legitimately answer 401. The browser logs each as a URL-less generic
 * console error (not necessarily the Supabase logout endpoint). Drop one console message per observed
 * 401 response; unmatched 401 messages and every other error stay fatal.
 */
export function filterExpectedUnauthorized(failures: string[], unauthorizedCount: number): string[] {
  let tolerated = unauthorizedCount
  return failures.filter((failure) => {
    if (failure !== UNAUTHORIZED_CONSOLE_ERROR || tolerated <= 0) return true
    tolerated -= 1
    return false
  })
}

export type ObservedRateLimit = { method: string }

/**
 * The browser logs an API 429 as a generic console error with no URL. The staging smoke
 * navigates many pages in a few seconds as one user, so the API's per-user limiter can
 * transiently answer a page's background GET with 429. Drop that console noise only for
 * observed read (GET/HEAD) 429s, one console message per observed response. A 429 on a write
 * (the synthetic mutation) and every other error stay fatal.
 */
export function filterTransientRateLimits(failures: string[], rateLimits: ObservedRateLimit[]): string[] {
  const reads = rateLimits.filter((r) => ['GET', 'HEAD'].includes(r.method.toUpperCase())).length
  let tolerated = reads
  return failures.filter((failure) => {
    if (failure !== RATE_LIMITED_CONSOLE_ERROR || tolerated <= 0) return true
    tolerated -= 1
    return false
  })
}
