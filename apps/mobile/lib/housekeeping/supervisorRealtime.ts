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
  /** Listeners with their own data store: each is called on every event, not only the newest registration. */
  independent: Set<Refresh>;
  timer: ReturnType<typeof setTimeout> | null;
  /** The channel dropped (error / timeout / closed) since it last delivered; events may have been missed. */
  interrupted: boolean;
  /** Closed channels never refresh: a late event from a hotel we have left must not reach anyone. */
  closed: boolean;
}

let shared: Shared | null = null;

function close(current: Shared) {
  current.closed = true;
  if (current.timer) clearTimeout(current.timer);
  current.timer = null;
  supabase.removeChannel(current.channel);
}

/**
 * Start refreshing on room changes for `tenantId`. Returns the unsubscribe. `independent` is for a screen that keeps
 * its own data instead of the shared Today store: it still shares this one channel, but is always called.
 */
export function subscribeSupervisorRealtime(tenantId: string, refresh: Refresh, options: { independent?: boolean } = {}): () => void {
  if (shared && shared.tenantId !== tenantId) {
    close(shared);
    shared = null;
  }
  if (!shared) {
    const listeners = new Set<Refresh>();
    const independent = new Set<Refresh>();
    const next: Shared = { tenantId, listeners, independent, timer: null, interrupted: false, closed: false, channel: undefined as never };
    const scheduleRefresh = () => {
      if (next.closed) return;
      if (next.timer) clearTimeout(next.timer);
      next.timer = setTimeout(() => {
        next.timer = null;
        // The newest shared registration; those all refresh the same shared store.
        const latest = Array.from(listeners).filter((listener) => !independent.has(listener)).pop();
        void latest?.();
        // A screen with its own store (Inspect) is never skipped because another screen registered after it.
        for (const listener of independent) void listener();
      }, REALTIME_DEBOUNCE_MS);
    };
    next.channel = supabase
      .channel("supervisor-home-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_status", filter: `tenant_id=eq.${tenantId}` }, scheduleRefresh)
      .subscribe((status: string) => {
        if (next.closed) return;
        // Freshness never depends on this channel (an old answer is shown as stale by age), so a drop is
        // harmless on its own. When the channel is back, catch up on whatever it missed with one refresh.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") next.interrupted = true;
        else if (status === "SUBSCRIBED" && next.interrupted) {
          next.interrupted = false;
          scheduleRefresh();
        }
      });
    shared = next;
  }
  const current = shared;
  current.listeners.add(refresh);
  if (options.independent) current.independent.add(refresh);
  return () => {
    current.listeners.delete(refresh);
    current.independent.delete(refresh);
    if (current.listeners.size === 0 && shared === current) {
      close(current);
      shared = null;
    }
  };
}
