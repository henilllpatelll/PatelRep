/**
 * Decide whether a clicked link should be held back by the unsaved-changes guard.
 * Returns the in-app path to navigate to once the user confirms, or null to let the click through
 * (same page, hash-only, new tab, download, modified click, or an external / non-http link).
 */
export function getNavigationTarget(input: {
  href: string
  currentHref: string
  origin: string
  target?: string | null
  download?: boolean
  modifier?: boolean
}): string | null {
  if (input.modifier || input.download) return null
  if (input.target && input.target !== '_self') return null
  let url: URL
  let current: URL
  try {
    url = new URL(input.href, input.currentHref)
    current = new URL(input.currentHref)
  } catch {
    return null
  }
  if (url.origin !== input.origin || !/^https?:$/.test(url.protocol)) return null
  if (url.pathname === current.pathname && url.search === current.search) return null
  return url.pathname + url.search + url.hash
}
