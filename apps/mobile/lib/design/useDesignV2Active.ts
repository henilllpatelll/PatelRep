import { useSyncExternalStore } from "react";
import { isDesignV2Enabled } from "@/lib/design/designV2";
import { DESIGN_V2_CONTEXT_MAX_AGE_MS, useDesignV2Store } from "@/lib/design/designV2Store";

/** Live Design V2 decision, shared by every subscriber.
 *
 *  The decision itself is `isDesignV2Enabled()` (preview OR this hotel's fresh `design_v2` read), the one place
 *  that combines them. It changes in exactly two ways, and both notify subscribers: the tenant store changes
 *  (refresh, sign-out, person or hotel change), or a fresh-enough read ages out (an offline phone drops back to
 *  the legacy design on its own). One module-level timer serves all subscribers, so hundreds of styled rows cost
 *  one timer, not one each. `getSnapshot` re-evaluates the pure decision, so a late timer can never leave a
 *  subscriber on an expired answer longer than its next render. */

const listeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeStore: (() => void) | null = null;

function scheduleExpiry(): void {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const fetchedAt = useDesignV2Store.getState().fetchedAt;
  if (typeof fetchedAt !== "number" || listeners.size === 0) return;
  const wait = fetchedAt + DESIGN_V2_CONTEXT_MAX_AGE_MS - Date.now() + 50;
  if (wait <= 0) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    listeners.forEach((l) => l());
  }, wait);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribeStore = useDesignV2Store.subscribe(() => {
      scheduleExpiry();
      listeners.forEach((l) => l());
    });
    scheduleExpiry();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribeStore?.();
      unsubscribeStore = null;
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };
}

const getSnapshot = (): boolean => isDesignV2Enabled();

/** Reactive Design V2 decision. Re-renders when the answer changes; never evaluated at module initialization. */
export function useDesignV2Active(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
