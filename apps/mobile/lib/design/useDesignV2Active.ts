import { useEffect, useState } from "react";
import { isDesignV2Enabled } from "@/lib/design/designV2";
import { DESIGN_V2_CONTEXT_MAX_AGE_MS, useDesignV2Store } from "@/lib/design/designV2Store";

/** Reactive Design V2 decision. Re-renders when the tenant answer changes (refresh, sign-out, person/hotel change)
 *  and exactly when a fresh-enough read ages out, so an offline phone drops back to the legacy design on its own.
 *  The decision itself is `isDesignV2Enabled()`, the one place that combines preview and tenant activation. */
export function useDesignV2Active(): boolean {
  const revision = useDesignV2Store((s) => s.revision);
  const fetchedAt = useDesignV2Store((s) => s.fetchedAt);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (typeof fetchedAt !== "number") return undefined;
    const wait = fetchedAt + DESIGN_V2_CONTEXT_MAX_AGE_MS - Date.now() + 50;
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [fetchedAt, revision]);

  return isDesignV2Enabled();
}
