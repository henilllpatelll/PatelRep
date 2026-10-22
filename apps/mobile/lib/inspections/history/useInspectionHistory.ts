import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  fetchHistoryInspectors,
  fetchInspectionHistory,
  fetchInspectionInsights,
  type HistoryPageRaw,
  type HistoryQuery,
  type InspectorOption,
  type Insights,
} from "@/lib/api/inspectionHistory";
import { subscribeSupervisorRealtime } from "@/lib/housekeeping/supervisorRealtime";
import { hotelTodayKey } from "@/lib/housekeeping/supervisorToday";
import { classifyFailure, type SourceFailure } from "@/lib/housekeeping/supervisorSources";
import {
  DEFAULT_HISTORY_FILTERS,
  filterRange,
  queryKey,
  toHistoryQuery,
  validateRange,
  type DateRange,
  type HistoryFilters,
  type RangeProblem,
} from "@/lib/inspections/history/filters";
import { appendHistory, buildHistory, type HistoryItem } from "@/lib/inspections/history/rows";
import { useAppStore } from "@/stores/appStore";

/* The Done tab's data: completed inspections for a hotel-local period, paged by the server, plus the period's quality
   insights and who inspected. Each resource is tracked on its own, so a failing insights call never blanks the list.

   - The server filters, sorts and pages. Nothing here fetches "all history" and filters on the phone.
   - An answer belongs to ONE question (the query key). Changing a filter throws the previous list away; an answer
     that lands after the question changed - or after the hotel / account changed - is dropped.
   - A refresh that fails keeps the verified rows on screen, marked stale; it never turns them into "no history". */

export const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 350;
const TICK_MS = 60_000;

export interface HistoryFetchers {
  page: (query: HistoryQuery) => Promise<HistoryPageRaw>;
  insights: (dateFrom: string, dateTo: string) => Promise<Insights>;
  inspectors: (dateFrom: string, dateTo: string) => Promise<{ rows: InspectorOption[]; truncated: boolean }>;
}

const DEFAULT_FETCHERS: HistoryFetchers = {
  page: fetchInspectionHistory,
  insights: fetchInspectionInsights,
  inspectors: fetchHistoryInspectors,
};

export type StaleWhy = "offline" | "refresh_failed";

export type ListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed"; failure: SourceFailure }
  | {
      status: "ready";
      items: HistoryItem[];
      /** Rows the server sent that could not be read safely. */
      unreadable: number;
      hasMore: boolean;
      /** The exact number of matches, from the first page. Null once unknown. */
      total: number | null;
      fetchedAt: number;
      loadingMore: boolean;
      moreFailed: boolean;
      stale: StaleWhy | null;
    };

export type InsightsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed"; failure: SourceFailure }
  | { status: "ready"; data: Insights; fetchedAt: number; stale: StaleWhy | null };

interface Held {
  scope: string | null;
  key: string | null;
  list: ListState;
  cursor: string | null;
}

interface HeldInsights {
  scope: string | null;
  key: string | null;
  state: InsightsState;
}

export interface UseInspectionHistory {
  filters: HistoryFilters;
  /** Replace the applied filters (one tap on Show results / a chip / the search box). */
  setFilters: (next: HistoryFilters | ((previous: HistoryFilters) => HistoryFilters)) => void;
  /** The hotel's calendar day. */
  today: string;
  /** The days the filters select, or null when the custom range is not valid. */
  range: DateRange | null;
  rangeProblem: RangeProblem | null;
  list: ListState;
  insights: InsightsState;
  inspectors: { status: "idle" | "loading" | "failed" | "ready"; rows: InspectorOption[]; truncated: boolean };
  loadMore: () => void;
  refresh: () => Promise<void>;
  loadInspectors: () => void;
  refreshing: boolean;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function useInspectionHistory({
  enabled = true,
  fetchers = DEFAULT_FETCHERS,
  realtime = true,
}: { enabled?: boolean; fetchers?: HistoryFetchers; realtime?: boolean } = {}): UseInspectionHistory {
  const user = useAppStore((state) => state.user);
  const isOnline = useAppStore((state) => state.isOnline);
  const timeZone = useAppStore((state) => state.hotelTimezone ?? null);
  const scopeKey = user?.tenant_id && user?.id ? `${user.tenant_id}:${user.id}` : null;
  const active = enabled && scopeKey !== null;

  const [filters, setFiltersState] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [held, setHeld] = useState<Held>({ scope: scopeKey, key: null, list: { status: "idle" }, cursor: null });
  const [heldInsights, setHeldInsights] = useState<HeldInsights>({ scope: scopeKey, key: null, state: { status: "idle" } });
  const [inspectorState, setInspectorState] = useState<{ scope: string | null; key: string | null; status: "idle" | "loading" | "failed" | "ready"; rows: InspectorOption[]; truncated: boolean }>({
    scope: scopeKey,
    key: null,
    status: "idle",
    rows: [],
    truncated: false,
  });

  const fetchersRef = useRef(fetchers);
  fetchersRef.current = fetchers;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const listSeq = useRef(0);
  const moreSeq = useRef(0);
  const insightsSeq = useRef(0);
  const inspectorsSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listSeq.current += 1;
      moreSeq.current += 1;
      insightsSeq.current += 1;
      inspectorsSeq.current += 1;
    };
  }, []);

  // Another hotel or person: nothing in flight for the old one may land, and nothing they had chosen carries over.
  const lastScope = useRef(scopeKey);
  useEffect(() => {
    if (lastScope.current === scopeKey) return;
    lastScope.current = scopeKey;
    listSeq.current += 1;
    moreSeq.current += 1;
    insightsSeq.current += 1;
    inspectorsSeq.current += 1;
    setFiltersState(DEFAULT_HISTORY_FILTERS);
    setHeld({ scope: scopeKey, key: null, list: { status: "idle" }, cursor: null });
    setHeldInsights({ scope: scopeKey, key: null, state: { status: "idle" } });
    setInspectorState({ scope: scopeKey, key: null, status: "idle", rows: [], truncated: false });
  }, [scopeKey]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  const today = hotelTodayKey(now, timeZone);

  // The room box types live; the question only changes once typing pauses.
  const debouncedRoom = useDebounced(filters.room, SEARCH_DEBOUNCE_MS);
  const effective = useMemo<HistoryFilters>(() => ({ ...filters, room: debouncedRoom }), [filters, debouncedRoom]);
  const key = useMemo(() => queryKey(effective, today), [effective, today]);
  // Memoised on its parts: typing in the room box changes `filters` on every keystroke, but not the period.
  const customFrom = filters.custom?.from;
  const customTo = filters.custom?.to;
  const range = useMemo(() => filterRange(filters, today), [filters.period, customFrom, customTo, today]);
  const rangeProblem = useMemo<RangeProblem | null>(() => {
    if (filters.period !== "custom") return null;
    return filters.custom ? validateRange(filters.custom, today) : "invalid";
  }, [filters.period, filters.custom, today]);
  const periodKey = range ? `${range.from}|${range.to}` : null;

  const heldRef = useRef(held);
  heldRef.current = held;
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;
  const todayRef = useRef(today);
  todayRef.current = today;
  const keyRef = useRef(key);
  keyRef.current = key;

  const setFilters = useCallback((next: HistoryFilters | ((previous: HistoryFilters) => HistoryFilters)) => {
    setFiltersState((previous) => (typeof next === "function" ? next(previous) : next));
  }, []);

  /* ─── The list ─────────────────────────────────────────────────────────── */

  const loadFirst = useCallback(async () => {
    const scope = scopeRef.current;
    const query = toHistoryQuery(effectiveRef.current, todayRef.current, PAGE_SIZE);
    const forKey = keyRef.current;
    if (!scope || !query) return;
    const mine = ++listSeq.current;
    try {
      const page = await fetchersRef.current.page(query);
      if (!mounted.current || mine !== listSeq.current || scopeRef.current !== scope) return;
      const built = buildHistory(page.rows);
      setHeld({
        scope,
        key: forKey,
        cursor: page.nextCursor,
        list: { status: "ready", items: built.items, unreadable: built.unreadable, hasMore: page.hasMore, total: page.total, fetchedAt: Date.now(), loadingMore: false, moreFailed: false, stale: null },
      });
    } catch (error) {
      if (!mounted.current || mine !== listSeq.current || scopeRef.current !== scope) return;
      setHeld((previous) => {
        // A failed refresh of the SAME question keeps what was verified, marked stale. A different question has nothing to keep.
        if (previous.scope === scope && previous.key === forKey && previous.list.status === "ready") {
          return { ...previous, list: { ...previous.list, loadingMore: false, stale: "refresh_failed" } };
        }
        return { scope, key: forKey, cursor: null, list: { status: "failed", failure: classifyFailure(error) } };
      });
    }
  }, []);

  useEffect(() => {
    if (!active || !range) return;
    if (!isOnline) {
      setHeld((previous) =>
        previous.key === key && previous.list.status === "ready"
          ? { ...previous, list: { ...previous.list, stale: "offline" } }
          : previous.key === key
            ? previous
            : { scope: scopeKey, key, cursor: null, list: { status: "failed", failure: { kind: "offline", status: null } } },
      );
      return;
    }
    setHeld((previous) => (previous.scope === scopeKey && previous.key === key ? previous : { scope: scopeKey, key, cursor: null, list: { status: "loading" } }));
    void loadFirst();
  }, [active, range, isOnline, scopeKey, key, loadFirst]);

  const loadMore = useCallback(() => {
    const scope = scopeRef.current;
    const forKey = keyRef.current;
    const query = toHistoryQuery(effectiveRef.current, todayRef.current, PAGE_SIZE);
    const current = heldRef.current;
    if (!scope || !query || current.scope !== scope || current.key !== forKey) return;
    if (current.list.status !== "ready" || !current.list.hasMore || current.list.loadingMore || !current.cursor) return;
    const firstSeq = listSeq.current;
    const mine = ++moreSeq.current;
    const stillMine = () => mounted.current && mine === moreSeq.current && firstSeq === listSeq.current && scopeRef.current === scope;
    setHeld((previous) => (previous.list.status === "ready" ? { ...previous, list: { ...previous.list, loadingMore: true, moreFailed: false } } : previous));
    fetchersRef.current.page({ ...query, cursor: current.cursor }).then(
      (page) => {
        if (!stillMine()) return;
        setHeld((latest) => {
          if (latest.scope !== scope || latest.key !== forKey || latest.list.status !== "ready") return latest;
          const merged = appendHistory(latest.list.items, page.rows);
          return {
            ...latest,
            cursor: page.nextCursor,
            list: { ...latest.list, items: merged.items, unreadable: latest.list.unreadable + merged.unreadable, hasMore: page.hasMore, loadingMore: false, moreFailed: false, stale: null },
          };
        });
      },
      () => {
        if (!stillMine()) return;
        setHeld((latest) => (latest.list.status === "ready" ? { ...latest, list: { ...latest.list, loadingMore: false, moreFailed: true } } : latest));
      },
    );
  }, []);

  /* ─── Insights (same period, independent of the other filters) ──────────── */

  const loadInsights = useCallback(async () => {
    const scope = scopeRef.current;
    const current = filterRange(effectiveRef.current, todayRef.current);
    if (!scope || !current) return;
    const forKey = `${current.from}|${current.to}`;
    const mine = ++insightsSeq.current;
    try {
      const data = await fetchersRef.current.insights(current.from, current.to);
      if (!mounted.current || mine !== insightsSeq.current || scopeRef.current !== scope) return;
      setHeldInsights({ scope, key: forKey, state: { status: "ready", data, fetchedAt: Date.now(), stale: null } });
    } catch (error) {
      if (!mounted.current || mine !== insightsSeq.current || scopeRef.current !== scope) return;
      setHeldInsights((previous) =>
        previous.scope === scope && previous.key === forKey && previous.state.status === "ready"
          ? { ...previous, state: { ...previous.state, stale: "refresh_failed" } }
          : { scope, key: forKey, state: { status: "failed", failure: classifyFailure(error) } },
      );
    }
  }, []);

  useEffect(() => {
    if (!active || !periodKey) return;
    if (!isOnline) {
      setHeldInsights((previous) =>
        previous.key === periodKey && previous.state.status === "ready" ? { ...previous, state: { ...previous.state, stale: "offline" } } : previous,
      );
      return;
    }
    setHeldInsights((previous) => (previous.scope === scopeKey && previous.key === periodKey ? previous : { scope: scopeKey, key: periodKey, state: { status: "loading" } }));
    void loadInsights();
  }, [active, periodKey, isOnline, scopeKey, loadInsights]);

  /* ─── Inspectors for the filter (loaded when the drawer opens) ───────────── */

  const loadInspectors = useCallback(() => {
    const scope = scopeRef.current;
    const current = filterRange(effectiveRef.current, todayRef.current);
    if (!scope || !current) return;
    const forKey = `${current.from}|${current.to}`;
    const mine = ++inspectorsSeq.current;
    setInspectorState((previous) => ({ scope, key: forKey, status: previous.key === forKey && previous.status === "ready" ? "ready" : "loading", rows: previous.key === forKey ? previous.rows : [], truncated: previous.truncated }));
    fetchersRef.current.inspectors(current.from, current.to).then(
      (found) => {
        if (!mounted.current || mine !== inspectorsSeq.current || scopeRef.current !== scope) return;
        setInspectorState({ scope, key: forKey, status: "ready", rows: found.rows, truncated: found.truncated });
      },
      () => {
        if (!mounted.current || mine !== inspectorsSeq.current || scopeRef.current !== scope) return;
        setInspectorState((previous) => (previous.status === "ready" && previous.key === forKey ? previous : { scope, key: forKey, status: "failed", rows: [], truncated: false }));
      },
    );
  }, []);

  /* ─── Refresh: pull-to-refresh, coming back to the app, a room being inspected ─ */

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadFirst(), loadInsights()]);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [loadFirst, loadInsights]);

  useEffect(() => {
    if (!active) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && useAppStore.getState().isOnline) void refresh();
    });
    return () => subscription.remove();
  }, [active, refresh]);

  // A finished inspection moves room_status; the shared channel (debounced there) tells every screen. Only a period
  // that includes today can have changed, so an old period is left alone.
  useEffect(() => {
    const tenantId = user?.tenant_id;
    if (!realtime || !active || !tenantId) return undefined;
    return subscribeSupervisorRealtime(
      tenantId,
      () => {
        const current = filterRange(effectiveRef.current, todayRef.current);
        if (current && current.to === todayRef.current && useAppStore.getState().isOnline) void refresh();
      },
      { independent: true },
    );
  }, [realtime, active, user?.tenant_id, refresh]);

  // Answers that belong to another hotel / question are never shown.
  const list: ListState = held.scope === scopeKey && held.key === key ? held.list : held.scope === scopeKey && held.key !== null ? { status: "loading" } : { status: "idle" };
  const insights: InsightsState = heldInsights.scope === scopeKey && heldInsights.key === periodKey ? heldInsights.state : periodKey ? { status: "loading" } : { status: "idle" };
  const inspectors = inspectorState.scope === scopeKey && inspectorState.key === periodKey ? inspectorState : { status: "idle" as const, rows: [], truncated: false };

  return { filters, setFilters, today, range, rangeProblem, list, insights, inspectors, loadMore, refresh, loadInspectors, refreshing };
}
