/* ─── Refresh gate ──────────────────────────────────────────────────────────
   Every way a Home can be told to re-read (screen focus, a realtime event, pull-to-refresh, Retry, an app returning to
   the foreground) goes through one gate, so the same data is never requested twice at once.

   - one read in flight at a time; a caller that arrives meanwhile joins it;
   - "realtime" means the server data changed: if a read is already in flight it may have missed that change, so exactly
     one trailing read runs after it (a burst still costs one extra read, never one per event);
   - "focus" is only a "maybe stale" hint: skipped while a read is running or one started in the last `focusFreshMs`;
   - "manual" (pull / Retry) always reads unless one is already running, in which case it joins that one.
   Pure TypeScript: no React, no timers, the clock is injectable for tests. */

export type RefreshReason = "focus" | "realtime" | "manual";

/** A screen regaining focus within this window of the last read does not read again. */
export const FOCUS_FRESH_MS = 15_000;

export interface RefreshGate {
  request: (reason: RefreshReason) => Promise<void>;
  /** When the latest read started (ms), or null before the first. */
  lastStartedAt: () => number | null;
  inFlight: () => boolean;
}

export function createRefreshGate(run: () => Promise<void>, options: { focusFreshMs?: number; now?: () => number } = {}): RefreshGate {
  const focusFreshMs = options.focusFreshMs ?? FOCUS_FRESH_MS;
  const now = options.now ?? Date.now;
  let inflight: Promise<void> | null = null;
  let dirty = false;
  let started: number | null = null;

  async function drain(): Promise<void> {
    do {
      dirty = false;
      started = now();
      try {
        await run();
      } catch {
        // The caller's own state already records the failure; the gate only sequences reads.
      }
    } while (dirty);
    // Released in the same turn as the last check, so a request cannot join a read that has already finished.
    inflight = null;
  }

  return {
    request(reason) {
      if (inflight) {
        if (reason === "realtime") dirty = true;
        return inflight;
      }
      if (reason === "focus" && started != null && now() - started < focusFreshMs) return Promise.resolve();
      inflight = drain();
      return inflight;
    },
    lastStartedAt: () => started,
    inFlight: () => inflight != null,
  };
}
