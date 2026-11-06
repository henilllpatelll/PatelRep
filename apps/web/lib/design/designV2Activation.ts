/** Design System V2 tenant activation (web) — the pure decision, with no store or React imports.
 *
 *  V2 is shown to a signed-in person only when ALL of these hold; any unknown fails closed to the legacy design:
 *   1. a signed-in user is present;
 *   2. the hotel context was fetched for THAT user and THAT hotel (`GET /auth/me`), never carried over from another
 *      person or another hotel;
 *   3. that hotel's `enabled_features` contains `design_v2` (the existing tenant feature-flag system);
 *   4. the context is fresh: the last successful read is at most MAX_AGE ago, so a tab that has lost the network
 *      does not keep an enabled hotel's V2 look indefinitely after the flag was turned off.
 *
 *  It is visual only. It grants no permission, unlocks no capability and is never an input to any route guard. */

export const DESIGN_V2_FLAG = 'design_v2'

/** A successful context read older than this no longer counts. Refreshes run well inside it (see
 *  DESIGN_V2_REFRESH_INTERVAL_MS), so a healthy online session never expires; an offline one falls back to legacy. */
export const DESIGN_V2_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000
/** Periodic re-read while the tab is visible. /auth/* is rate-limited to 10/min per user; this is far below that. */
export const DESIGN_V2_REFRESH_INTERVAL_MS = 10 * 60 * 1000
/** A refresh triggered by tab focus / reconnect is skipped when the last attempt was more recent than this. */
export const DESIGN_V2_MIN_REFRESH_GAP_MS = 2 * 60 * 1000

export interface DesignV2ContextInput {
  /** Signed-in user id, or null when signed out / not yet known. */
  authUserId: string | null | undefined
  hotel: { id: string; enabled_features?: string[] } | null | undefined
  /** Which user/hotel the stored context was fetched for, and when (epoch ms). Null until a read succeeds. */
  contextUserId: string | null | undefined
  contextHotelId: string | null | undefined
  contextFetchedAt: number | null | undefined
  now: number
}

export function resolveTenantDesignV2(input: DesignV2ContextInput): boolean {
  const { authUserId, hotel, contextUserId, contextHotelId, contextFetchedAt, now } = input
  if (!authUserId || !hotel) return false
  if (contextUserId !== authUserId || contextHotelId !== hotel.id) return false
  if (typeof contextFetchedAt !== 'number' || !Number.isFinite(contextFetchedAt)) return false
  const age = now - contextFetchedAt
  if (age < 0 || age > DESIGN_V2_CONTEXT_MAX_AGE_MS) return false
  return hotel.enabled_features?.includes(DESIGN_V2_FLAG) === true
}

/** Epoch ms at which a context fetched at `fetchedAt` stops counting (for scheduling one re-render). */
export function designV2ContextExpiresAt(fetchedAt: number): number {
  return fetchedAt + DESIGN_V2_CONTEXT_MAX_AGE_MS
}
