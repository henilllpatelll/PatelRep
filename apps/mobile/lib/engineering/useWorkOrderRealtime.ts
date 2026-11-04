import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { onWorkOrderMutated } from "@/lib/engineering/teamEvents";

/** Realtime changes arrive in bursts (one edit can emit several events); one trailing callback per burst. */
export const REALTIME_DEBOUNCE_MS = 1500;

/**
 * The one hotel-scoped work-order subscription both Engineering Homes share. It opens a single channel per hotel,
 * coalesces a burst of events into one trailing `onChange`, and tears everything down (including a pending timer) when
 * the screen unmounts or the hotel changes, so a late event can never refresh a screen that moved on. `onChange` is read
 * through a ref, so a new callback identity never re-subscribes.
 *
 * A change this phone just had the server confirm (claim, start, hold, complete, new report) feeds the SAME debounce as the
 * realtime echo of that change, so the two together cost one read, and the person sees their own change even if realtime lags.
 */
export function useWorkOrderRealtime(tenantId: string | null | undefined, onChange: () => void, debounceMs: number = REALTIME_DEBOUNCE_MS): void {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!tenantId) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = true;
    const trigger = () => {
      if (!live) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (live) latest.current();
      }, debounceMs);
    };
    const channel = supabase
      .channel(`engineering-home-wo:${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${tenantId}` }, trigger)
      .subscribe();
    const stopLocal = onWorkOrderMutated(trigger);
    return () => {
      live = false;
      stopLocal();
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tenantId, debounceMs]);
}
