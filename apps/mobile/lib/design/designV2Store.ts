import { create } from "zustand";

/** Design System V2 tenant activation (mobile) — the single in-memory record of what the hotel said.
 *
 *  The source of truth is the existing tenant feature-flag system: `GET /auth/me` -> `hotel.enabled_features`
 *  containing `design_v2`. This store only remembers the last successful answer and who/when it was for. It is never
 *  persisted, so a cold start is legacy until the first read succeeds, and it is cleared the instant the signed-in
 *  person or hotel changes (see appStore.setUser). It is visual only: it grants no permission and gates no route. */

export const DESIGN_V2_FLAG = "design_v2";

/** A successful read older than this stops counting (an offline phone falls back to the legacy design). */
export const DESIGN_V2_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000;
/** Re-read cadence while the app is in the foreground. /auth/* is limited to 10/min per user; this is far below it. */
export const DESIGN_V2_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
/** Foreground / reconnect refreshes inside this gap of the last attempt are skipped. */
export const DESIGN_V2_MIN_REFRESH_GAP_MS = 2 * 60 * 1000;

export const designV2OwnerKey = (user: { tenant_id?: string | null; id?: string | null } | null | undefined): string | null =>
  user?.tenant_id && user?.id ? `${user.tenant_id}:${user.id}` : null;

interface DesignV2State {
  /** `${tenant_id}:${user_id}` the answer below was read for. */
  ownerKey: string | null;
  enabled: boolean;
  /** Epoch ms of the last successful read. */
  fetchedAt: number | null;
  /** Bumped on every change so hooks re-render. */
  revision: number;
  apply: (next: { ownerKey: string; enabled: boolean; fetchedAt: number }) => void;
  clear: () => void;
}

export const useDesignV2Store = create<DesignV2State>((set) => ({
  ownerKey: null,
  enabled: false,
  fetchedAt: null,
  revision: 0,
  apply: ({ ownerKey, enabled, fetchedAt }) => set((s) => ({ ownerKey, enabled, fetchedAt, revision: s.revision + 1 })),
  clear: () =>
    set((s) =>
      s.ownerKey === null && !s.enabled && s.fetchedAt === null
        ? s
        : { ownerKey: null, enabled: false, fetchedAt: null, revision: s.revision + 1 },
    ),
}));

/** Pure decision: enabled for `ownerKey` with a fresh read. Anything unknown is false. */
export function resolveTenantDesignV2(
  state: Pick<DesignV2State, "ownerKey" | "enabled" | "fetchedAt">,
  currentOwnerKey: string | null,
  now: number,
): boolean {
  if (!state.enabled || !state.ownerKey || !currentOwnerKey) return false;
  if (state.ownerKey !== currentOwnerKey) return false;
  if (typeof state.fetchedAt !== "number" || !Number.isFinite(state.fetchedAt)) return false;
  const age = now - state.fetchedAt;
  return age >= 0 && age <= DESIGN_V2_CONTEXT_MAX_AGE_MS;
}
