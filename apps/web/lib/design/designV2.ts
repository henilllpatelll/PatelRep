import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { resolveTenantDesignV2 } from './designV2Activation'

/** Design System V2 on web: two independent switches that are deliberately kept apart.
 *
 *  1. PRODUCTION ACTIVATION (per hotel, runtime). The registered `design_v2` tenant flag, read from
 *     `GET /auth/me` -> `hotel.enabled_features` (see designV2Activation.ts). Off for every hotel by default.
 *     Turned on/off with the Feature Rollout workflow, no rebuild or redeploy. Applies after sign-in only.
 *  2. DEVELOPMENT PREVIEW (build time, never production). `NEXT_PUBLIC_DESIGN_V2_PREVIEW=true` exposes V2 to
 *     everyone on a developer/staging build, including the signed-out sign-in page and the /design-v2-preview
 *     reference route. It fails CLOSED: it needs an explicit non-production `NEXT_PUBLIC_APP_ENV`
 *     (development | staging | test), or `next dev`. An unset or unknown environment is treated as production.
 *     A stray preview flag in a production build therefore does nothing.
 *
 *  Both are purely visual: they grant no permission, unlock no feature and are never an input to a route guard.
 *  Next inlines NEXT_PUBLIC_* only for literal references, so the three reads below must stay literal. */

const PREVIEW_ALLOWED_ENVS = new Set(['development', 'staging', 'test'])

export function resolveDesignV2Preview(
  flag: string | undefined,
  appEnv: string | undefined,
  nodeEnv?: string | undefined,
): boolean {
  if ((flag ?? '').trim().toLowerCase() !== 'true') return false
  const env = (appEnv ?? '').trim().toLowerCase()
  if (env) return PREVIEW_ALLOWED_ENVS.has(env)
  // No explicit environment: only the local dev server qualifies. Never a production build.
  return (nodeEnv ?? '').trim().toLowerCase() === 'development'
}

/** Development preview only (build-time switch). Not the production activation. */
export function isDesignV2PreviewEnabled(): boolean {
  return resolveDesignV2Preview(
    process.env.NEXT_PUBLIC_DESIGN_V2_PREVIEW,
    process.env.NEXT_PUBLIC_APP_ENV,
    process.env.NODE_ENV,
  )
}

/** Non-reactive read of the current decision: development preview OR the signed-in hotel's `design_v2` flag.
 *  Safe to call during render of anything inside <DashboardShell>: the shell subscribes via useDesignV2() and
 *  swaps between two different trees when the answer changes, so every descendant re-mounts and re-reads it.
 *  Signed-out and unknown states are false. */
export function isDesignV2Enabled(now: number = Date.now()): boolean {
  if (isDesignV2PreviewEnabled()) return true
  const hotelState = useHotelStore.getState()
  return resolveTenantDesignV2({
    authUserId: useAuthStore.getState().user?.id,
    hotel: hotelState.hotel,
    contextUserId: hotelState.contextUserId,
    contextHotelId: hotelState.contextHotelId,
    contextFetchedAt: hotelState.contextFetchedAt,
    now,
  })
}
