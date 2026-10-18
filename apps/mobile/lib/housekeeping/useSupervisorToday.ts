import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import {
  fetchAssignableStaff,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchShiftRoster,
} from "@/lib/api/housekeepingSupervisor";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import { fetchedAtOf, isVerified } from "@/lib/housekeeping/supervisorSources";
import {
  composeSupervisorToday,
  initialTodaySources,
  loadTodaySources,
  type SupervisorToday,
  type TodayFetchers,
  type TodaySources,
} from "@/lib/housekeeping/supervisorToday";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { useAppStore } from "@/stores/appStore";
import { acquireTodayStore, requestTodayRefresh, sourcesFor, useSupervisorTodayStore } from "@/stores/supervisorTodayStore";

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
  /**
   * Skip the load on mount when every source was verified within the freshness window (a screen opened on
   * top of Today reuses Today's snapshot instead of fetching it again).
   */
  reuseFresh?: boolean;
}

/** Every source answered, and none of the answers is older than the freshness window. */
export function isSnapshotFresh(sources: TodaySources, now: number): boolean {
  return Object.values(sources).every((state) => {
    const at = fetchedAtOf(state);
    return isVerified(state) && at !== null && now - at <= STALE_AFTER_MS;
  });
}

/**
 * Supervisor Today data for the signed-in supervisor, from the snapshot shared by every screen that shows it.
 * Loads on mount and on `refresh()`; callers decide when to refresh (pull-to-refresh, realtime events) so
 * Realtime behaviour stays with the screen.
 */
export function useSupervisorToday({
  enabled = true,
  fetchers = todayFetchers,
  viewerId = null,
  scopeKey = null,
  reuseFresh = false,
}: UseSupervisorTodayOptions = {}): UseSupervisorToday {
  const isOnline = useAppStore((state) => state.isOnline);
  const timeZone = useAppStore((state) => state.hotelTimezone ?? null);
  useHotelTimezone();
  const stored = useSupervisorTodayStore((state) => state);
  // A different hotel/person reads as "nothing loaded yet" until its own answer arrives.
  const sources = stored.scope === scopeKey ? stored.sources : INITIAL;
  const [now, setNow] = useState(() => Date.now());
  // Only the very first load may be skipped or joined; later changes (going offline, a new hotel) always refresh.
  const firstLoad = useRef(true);
  const reuseRef = useRef(reuseFresh);

  useEffect(() => acquireTodayStore(), []);

  const load = useCallback(
    async (join: boolean) => {
      if (!enabled) return;
      try {
        await requestTodayRefresh(
          scopeKey,
          (previous) => loadTodaySources(previous, fetchers, { now: Date.now(), timeZone, online: isOnline }),
          { join },
        );
      } finally {
        setNow(Date.now());
      }
    },
    [enabled, fetchers, isOnline, timeZone, scopeKey],
  );
  const refresh = useCallback(() => load(false), [load]);

  useEffect(() => {
    const first = firstLoad.current;
    firstLoad.current = false;
    if (first && reuseRef.current && isSnapshotFresh(sourcesFor(scopeKey), Date.now())) return;
    void load(first);
  }, [load, scopeKey]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Another screen's refresh changed the snapshot: re-evaluate against the current time.
  useEffect(() => {
    setNow(Date.now());
  }, [stored.sources]);

  const today = useMemo(() => composeSupervisorToday(sources, { now, timeZone, viewerId }), [sources, now, timeZone, viewerId]);

  // The hotel's day rolled over (midnight in the hotel's zone, not the phone's): what is held was requested for
  // yesterday, so ask again instead of waiting for the next pull or Realtime event.
  const seenDate = useRef<string | null>(null);
  useEffect(() => {
    const previous = seenDate.current;
    seenDate.current = today.hotelDate;
    if (previous !== null && previous !== today.hotelDate) void load(false);
  }, [today.hotelDate, load]);

  // Back from the background: re-read the clock now (the hotel date may have moved while suspended) and
  // refresh when nothing verified is fresh any more. A fresh snapshot is left alone.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setNow(Date.now());
      if (!isSnapshotFresh(sourcesFor(scopeKey), Date.now())) void load(false);
    });
    return () => subscription.remove();
  }, [load, scopeKey]);

  return { today, refreshing: stored.refreshing, refresh };
}
