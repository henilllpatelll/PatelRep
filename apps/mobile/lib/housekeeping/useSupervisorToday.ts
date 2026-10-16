import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import {
  fetchAssignableStaff,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchShiftRoster,
} from "@/lib/api/housekeepingSupervisor";
import {
  composeSupervisorToday,
  initialTodaySources,
  loadTodaySources,
  type SupervisorToday,
  type TodayFetchers,
  type TodaySources,
} from "@/lib/housekeeping/supervisorToday";
import { useAppStore } from "@/stores/appStore";

/* The production fetchers. Each is independent: see `loadTodaySources`. */
export const todayFetchers: TodayFetchers = {
  board: fetchBoardVerified,
  staff: fetchAssignableStaff,
  roster: fetchShiftRoster,
  inspections: fetchInspectionHistory,
  blockedTasks: async () => (await fetchBlockedTasks()).items,
};

const INITIAL = initialTodaySources();

/** Re-evaluates freshness (and the hotel date) this often so an old answer is never left looking fresh. */
const TICK_MS = 60_000;

export interface UseSupervisorToday {
  today: SupervisorToday;
  /** True while a refresh is in flight. Existing data stays on screen meanwhile. */
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export interface UseSupervisorTodayOptions {
  enabled?: boolean;
  fetchers?: TodayFetchers;
  /** The signed-in supervisor; excluded from the on-shift count. */
  viewerId?: string | null;
  /** Hotel + person. Changing it throws away everything loaded for the previous one. */
  scopeKey?: string | null;
}

/**
 * Supervisor Today data for the signed-in supervisor. Loads on mount and on `refresh()`; callers decide when
 * to refresh (pull-to-refresh, realtime events) so Realtime behaviour stays with the screen.
 */
export function useSupervisorToday({
  enabled = true,
  fetchers = todayFetchers,
  viewerId = null,
  scopeKey = null,
}: UseSupervisorTodayOptions = {}): UseSupervisorToday {
  const isOnline = useAppStore((state) => state.isOnline);
  const timeZone = useAppStore((state) => state.hotelTimezone ?? null);
  // Sources are stored with the scope they were loaded for; a different scope reads as "nothing loaded yet".
  const [loaded, setLoaded] = useState<{ scope: string | null; sources: TodaySources }>(() => ({
    scope: scopeKey,
    sources: initialTodaySources(),
  }));
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const loadedRef = useRef(loaded);
  const requestRef = useRef(0);
  const sources = loaded.scope === scopeKey ? loaded.sources : INITIAL;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const request = ++requestRef.current;
    const startedAt = Date.now();
    const previous = loadedRef.current.scope === scopeKey ? loadedRef.current.sources : initialTodaySources();
    setRefreshing(true);
    try {
      const next = await loadTodaySources(previous, fetchers, { now: startedAt, timeZone, online: isOnline });
      // A newer refresh (or a different hotel/person) started while this one was in flight: its answer wins.
      if (request !== requestRef.current) return;
      loadedRef.current = { scope: scopeKey, sources: next };
      setLoaded(loadedRef.current);
      setNow(Date.now());
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, [enabled, fetchers, isOnline, timeZone, scopeKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const today = useMemo(() => composeSupervisorToday(sources, { now, timeZone, viewerId }), [sources, now, timeZone, viewerId]);
  return { today, refreshing, refresh };
}
