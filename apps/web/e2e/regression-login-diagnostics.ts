interface AuthResponseLike {
  url(): string
  status(): number
  request(): { method(): string }
}

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

export function createLoginDiagnostics(role: string, baseURL: string) {
  const authResponses: Array<{ method: string; status: number; url: string }> = []
  const pageErrors: string[] = []

  return {
    recordAuthResponse(response: AuthResponseLike) {
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
        pageErrors,
        visibleLoginErrors: visibleLoginErrors.map(redactDiagnosticText).filter(Boolean),
      }
    },
  }
}
