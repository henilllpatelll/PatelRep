export interface FeedbackRuntimeContext {
  page_url?: string
  pathname?: string
  user_agent?: string
  browser_language?: string
  viewport_width?: number
  viewport_height?: number
  client_context: Record<string, unknown>
}

export function getFeedbackRuntimeContext(win: Window | undefined): FeedbackRuntimeContext {
  if (!win) return { client_context: {} }

  return {
    page_url: win.location.href,
    pathname: win.location.pathname,
    user_agent: win.navigator.userAgent,
    browser_language: win.navigator.language,
    viewport_width: win.innerWidth,
    viewport_height: win.innerHeight,
    client_context: {
      referrer: win.document.referrer || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  }
}
