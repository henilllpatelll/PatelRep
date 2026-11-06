import { resolveTenantDesignV2, useDesignV2Store } from "./designV2Store";

/** Design System V2 on mobile: two independent switches, deliberately kept apart.
 *
 *  1. PRODUCTION ACTIVATION (per hotel, runtime). The registered `design_v2` tenant flag, read from
 *     `GET /auth/me` -> `hotel.enabled_features` (see designV2Store.ts / useDesignV2Sync.ts). Off for every hotel by
 *     default; turned on/off with the Feature Rollout workflow, no new binary and no OTA update. It is observed on the
 *     next authenticated context refresh, so it is NOT instant.
 *  2. DEVELOPMENT PREVIEW (bundle time, never production). `EXPO_PUBLIC_DESIGN_V2_PREVIEW=true` exposes V2 to everyone
 *     on a developer/staging bundle, including the signed-out screens and the preview route. It fails CLOSED: it needs
 *     the Metro dev server (`__DEV__`) or an explicit non-production `EXPO_PUBLIC_APP_ENV` (development | staging |
 *     test). An unset or unknown environment counts as production, so a production OTA update exported with the flag
 *     set (EAS build-profile env does not apply to a hand-run `eas update`) cannot turn V2 on for installed apps.
 *
 *  Both are purely visual: they grant no permission, unlock no feature and add no setting. Expo inlines
 *  `process.env.EXPO_PUBLIC_*` only for literal references, so the two reads below must stay literal. */

const PREVIEW_ALLOWED_ENVS = new Set(["development", "staging", "test"]);

export function resolveDesignV2Preview(
  flag: string | undefined,
  appEnv: string | undefined,
  isDevBundle = false,
): boolean {
  if ((flag ?? "").trim().toLowerCase() !== "true") return false;
  if (isDevBundle) return true;
  return PREVIEW_ALLOWED_ENVS.has((appEnv ?? "").trim().toLowerCase());
}

declare const __DEV__: boolean | undefined;

const DESIGN_V2_PREVIEW_ENABLED = resolveDesignV2Preview(
  process.env.EXPO_PUBLIC_DESIGN_V2_PREVIEW,
  process.env.EXPO_PUBLIC_APP_ENV,
  typeof __DEV__ !== "undefined" && __DEV__ === true,
);

/** Development preview only (bundle-time switch). Not the production activation. */
export function isDesignV2PreviewEnabled(): boolean {
  return DESIGN_V2_PREVIEW_ENABLED;
}

/** Current decision: development preview OR this hotel's `design_v2` flag for the signed-in person (fresh read).
 *  Signed-out, loading, failed and unknown states are false. Non-reactive: components must use
 *  `useDesignV2Active()` (lib/design/useDesignV2Active.ts) so they re-render when it changes. */
export function isDesignV2Enabled(now: number = Date.now()): boolean {
  if (DESIGN_V2_PREVIEW_ENABLED) return true;
  const s = useDesignV2Store.getState();
  // The store is cleared synchronously whenever the signed-in person or hotel changes, so its own owner key is
  // the current owner by construction; resolveTenantDesignV2 still insists on a non-empty, matching key.
  return resolveTenantDesignV2(s, s.ownerKey, now);
}
