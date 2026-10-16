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

/** Re-evaluates freshness (and the hotel date) this often so an old answer is never left looking fresh. */
const TICK_MS = 60_000;

export interface UseSupervisorToday {
  today: SupervisorToday;
  /** True while a refresh is in flight. Existing data stays on screen meanwhile. */
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Supervisor Today data for the signed-in supervisor. Loads on mount and on `refresh()`; callers decide when
 * to refresh (pull-to-refresh, realtime events) so Realtime behaviour stays with the screen.
 */
export function useSupervisorToday(enabled = true, fetchers: TodayFetchers = todayFetchers): UseSupervisorToday {
  const isOnline = useAppStore((state) => state.isOnline);
  const timeZone = useAppStore((state) => state.hotelTimezone ?? null);
  const [sources, setSources] = useState<TodaySources>(initialTodaySources);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const sourcesRef = useRef(sources);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const request = ++requestRef.current;
    const startedAt = Date.now();
    setRefreshing(true);
    try {
      const next = await loadTodaySources(sourcesRef.current, fetchers, { now: startedAt, timeZone, online: isOnline });
      // A newer refresh started while this one was in flight: its answer wins.
      if (request !== requestRef.current) return;
      sourcesRef.current = next;
      setSources(next);
      setNow(Date.now());
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, [enabled, fetchers, isOnline, timeZone]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const today = useMemo(() => composeSupervisorToday(sources, { now, timeZone }), [sources, now, timeZone]);
  return { today, refreshing, refresh };
}
