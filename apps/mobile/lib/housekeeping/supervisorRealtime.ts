import { supabase } from "@/lib/supabase";

/* One Supabase Realtime channel for every supervisor screen that shows Today data (the A2 "Housekeeping
   Breakout Board" surface). Screens register a refresh; the channel exists while at least one is
   registered, so opening the Attention Center on top of Today never adds a second subscription.
   Every registered refresh feeds the same shared store, so one call per event is enough. */

/** Realtime bursts (many rooms changing at once) collapse into one refresh. */
export const REALTIME_DEBOUNCE_MS = 1500;

type Refresh = () => void | Promise<void>;

interface Shared {
  tenantId: string;
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<Refresh>;
  timer: ReturnType<typeof setTimeout> | null;
}

let shared: Shared | null = null;

function close(current: Shared) {
  if (current.timer) clearTimeout(current.timer);
  supabase.removeChannel(current.channel);
}

/** Start refreshing on room changes for `tenantId`. Returns the unsubscribe. */
export function subscribeSupervisorRealtime(tenantId: string, refresh: Refresh): () => void {
  if (shared && shared.tenantId !== tenantId) {
    close(shared);
    shared = null;
  }
  if (!shared) {
    const listeners = new Set<Refresh>();
    const next: Shared = { tenantId, listeners, timer: null, channel: undefined as never };
    next.channel = supabase
      .channel("supervisor-home-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_status", filter: `tenant_id=eq.${tenantId}` }, () => {
        if (next.timer) clearTimeout(next.timer);
        next.timer = setTimeout(() => {
          next.timer = null;
          // The newest registration; they all refresh the same shared store.
          const latest = Array.from(listeners).pop();
          void latest?.();
        }, REALTIME_DEBOUNCE_MS);
      })
      .subscribe();
    shared = next;
  }
  const current = shared;
  current.listeners.add(refresh);
  return () => {
    current.listeners.delete(refresh);
    if (current.listeners.size === 0 && shared === current) {
      close(current);
      shared = null;
    }
  };
}
