import { useEffect } from "react";
import { AppState } from "react-native";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import {
  DESIGN_V2_FLAG,
  DESIGN_V2_MIN_REFRESH_GAP_MS,
  DESIGN_V2_REFRESH_INTERVAL_MS,
  designV2OwnerKey,
  useDesignV2Store,
} from "@/lib/design/designV2Store";

interface MeResponse {
  hotel?: { id?: string | null; enabled_features?: unknown } | null;
}

export type DesignV2ReadResult = "enabled" | "disabled" | "unknown";

/** One read of the hotel's flags for `tenantId`. Only the signed-in hotel's own answer counts; anything else
 *  (a failed request, another hotel's record, a malformed body) is "unknown" and never changes the stored answer. */
export async function readDesignV2Flag(
  tenantId: string,
  get: (path: string) => Promise<MeResponse> = (path) => api.get<MeResponse>(path),
): Promise<DesignV2ReadResult> {
  let res: MeResponse;
  try {
    res = await get("/auth/me");
  } catch {
    return "unknown";
  }
  const hotel = res?.hotel;
  if (!hotel || hotel.id !== tenantId || !Array.isArray(hotel.enabled_features)) return "unknown";
  return hotel.enabled_features.includes(DESIGN_V2_FLAG) ? "enabled" : "disabled";
}

/** Single-flight, owner-checked refresh. The answer is applied only if the same person and hotel are still signed in
 *  when it arrives, so a slow response can never repaint the next person's screen. Returns whether a read landed. */
export async function refreshDesignV2(
  deps: {
    read?: (tenantId: string) => Promise<DesignV2ReadResult>;
    currentOwnerKey?: () => string | null;
    now?: () => number;
  } = {},
): Promise<boolean> {
  const currentOwnerKey = deps.currentOwnerKey ?? (() => designV2OwnerKey(useAppStore.getState().user));
  const ownerKey = currentOwnerKey();
  const user = useAppStore.getState().user;
  if (!ownerKey || !user?.tenant_id) return false;
  const result = await (deps.read ?? ((tenant) => readDesignV2Flag(tenant)))(user.tenant_id);
  if (result === "unknown") return false;
  if (currentOwnerKey() !== ownerKey) return false;
  useDesignV2Store.getState().apply({ ownerKey, enabled: result === "enabled", fetchedAt: (deps.now ?? Date.now)() });
  return true;
}

let inFlight: Promise<boolean> | null = null;
let lastAttemptAt = 0;

/** Test hook: reset the module's throttle state. */
export function resetDesignV2SyncForTests(): void {
  inFlight = null;
  lastAttemptAt = 0;
}

/** Foreground/reconnect-triggered refresh, rate-limit friendly: skipped when one ran moments ago or is in flight. */
export function refreshDesignV2IfDue(minGapMs: number = DESIGN_V2_MIN_REFRESH_GAP_MS, now: number = Date.now()): Promise<boolean> {
  if (inFlight) return inFlight;
  if (now - lastAttemptAt < minGapMs) return Promise.resolve(false);
  lastAttemptAt = now;
  const run = refreshDesignV2().finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** Keeps this hotel's Design V2 decision fresh: a read on sign-in / hotel change, when the app returns to the
 *  foreground, when the network comes back, and on a slow timer while foregrounded. A failed read leaves the previous
 *  answer in place until it ages out (30 minutes), then the app is legacy. Mount once, inside the signed-in layout. */
export function useDesignV2Sync(): void {
  const ownerKey = useAppStore((s) => designV2OwnerKey(s.user));
  const isOnline = useAppStore((s) => s.isOnline);

  // Sign-in, person change or hotel change: read straight away (retrying a few times on failure).
  useEffect(() => {
    if (!ownerKey) return undefined;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const attempt = (n: number) => {
      if (cancelled) return;
      lastAttemptAt = Date.now();
      void refreshDesignV2().then((ok) => {
        if (cancelled || ok || n >= 3) return;
        timers.push(setTimeout(() => attempt(n + 1), 15_000 * 2 ** n));
      });
    };
    attempt(0);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [ownerKey]);

  // Reconnect.
  useEffect(() => {
    if (ownerKey && isOnline) void refreshDesignV2IfDue();
  }, [ownerKey, isOnline]);

  // Foreground + slow timer.
  useEffect(() => {
    if (!ownerKey) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshDesignV2IfDue();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refreshDesignV2IfDue(DESIGN_V2_REFRESH_INTERVAL_MS - 1000);
    }, DESIGN_V2_REFRESH_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [ownerKey]);
}
