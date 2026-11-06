interface AuthResponseLike {
  url(): string
  status(): number
  request(): { method(): string }
}

interface AuthRequestLike {
  url(): string
  method(): string
  failure?(): { errorText: string } | null
}

export interface AuthBackendProbe {
  endpoint: string
  outcome: 'http' | 'timeout' | 'error'
  status?: number
  ms: number
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number }>

const MAX_DIAGNOSTIC_ENTRIES = 10
const MAX_TEXT_LENGTH = 500

export function safeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/([?&\s](?:access_token|refresh_token|token|api[_-]?key|password)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .slice(0, MAX_TEXT_LENGTH)
}

/**
 * Asks the auth backend directly whether it answers at all, from the same runner and network path as the browser.
 * `/auth/v1/settings` is served by the auth service itself and needs only the public anon key the page already
 * sent, so a timeout here means the auth service is unresponsive (an environment outage), not that the login
 * form, the credentials or the click misbehaved. Reports outcome, status and latency only: the key, the URL's
 * query and any body are never returned or logged.
 */
export async function probeAuthBackend(
  authOrigin: string,
  anonKey: string,
  { timeoutMs = 8000, fetchImpl = fetch as unknown as FetchLike }: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<AuthBackendProbe> {
  const endpoint = '/auth/v1/settings'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetchImpl(`${authOrigin}${endpoint}`, { headers: { apikey: anonKey }, signal: controller.signal })
    return { endpoint, outcome: 'http', status: response.status, ms: Date.now() - started }
  } catch (error) {
    const aborted = controller.signal.aborted || (error as { name?: string })?.name === 'AbortError'
    return { endpoint, outcome: aborted ? 'timeout' : 'error', ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

export function createLoginDiagnostics(role: string, baseURL: string) {
  const authResponses: Array<{ method: string; status: number; url: string }> = []
  const pageErrors: string[] = []
  const authRequestsSent: string[] = []
  const failedAuthRequests: Array<{ method: string; url: string; error: string }> = []
  // Auth requests that were sent and have neither completed nor failed yet, keyed by the request object.
  const unanswered = new Map<unknown, { label: string; at: number }>()

  return {
    // An auth request that was sent but never answered (hung, cancelled, or
    // failed at the network level) leaves authResponses empty and no visible
    // alert, which is otherwise indistinguishable from "the click never fired".
    recordAuthRequest(request: AuthRequestLike) {
      const url = safeDiagnosticUrl(request.url())
      if (!url.includes('/auth/') || authRequestsSent.length >= MAX_DIAGNOSTIC_ENTRIES) return
      authRequestsSent.push(`${request.method()} ${url}`)
      unanswered.set(request, { label: `${request.method()} ${url}`, at: Date.now() })
    },
    /** Auth requests still waiting for a response, with how long each has waited. */
    unansweredAuthRequests(now: number = Date.now()) {
      return [...unanswered.values()].map(({ label, at }) => ({ request: label, waitedMs: now - at }))
    },
    recordAuthRequestFailure(request: AuthRequestLike) {
      unanswered.delete(request)
      const url = safeDiagnosticUrl(request.url())
      if (!url.includes('/auth/') || failedAuthRequests.length >= MAX_DIAGNOSTIC_ENTRIES) return
      failedAuthRequests.push({
        method: request.method(),
        url,
        error: redactDiagnosticText(request.failure?.()?.errorText ?? 'unknown'),
      })
    },
    recordAuthResponse(response: AuthResponseLike) {
      unanswered.delete(response.request())
      if (authResponses.length >= MAX_DIAGNOSTIC_ENTRIES) return

      const url = safeDiagnosticUrl(response.url())
      if (!url.includes('/auth/')) return

      authResponses.push({
        method: response.request().method(),
        status: response.status(),
        url,
      })
    },
    recordPageError(error: Error) {
      if (pageErrors.length < MAX_DIAGNOSTIC_ENTRIES) {
        pageErrors.push(redactDiagnosticText(error.message))
      }
    },
    snapshot(currentPage: string, visibleLoginErrors: string[]) {
      return {
        role,
        target: safeDiagnosticUrl(baseURL),
        currentPage: safeDiagnosticUrl(currentPage),
        authResponses,
        authRequestsSent,
        failedAuthRequests,
        pageErrors,
        visibleLoginErrors: visibleLoginErrors.map(redactDiagnosticText).filter(Boolean),
      }
    },
  }
}
