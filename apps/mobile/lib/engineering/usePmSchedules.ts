import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listPmSchedules, type PmScheduleRow } from "@/lib/api/assets";
import { useAppStore } from "@/stores/appStore";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { adaptPmSchedules, countPmSchedules, type PmCounts, type PmScheduleView } from "./pmSchedules";
import { countThisWeek } from "./pmCalendar";
import { classifyLoadFailure, type LoadFailure } from "./loadState";

export interface PmSummary extends PmCounts {
  thisWeek: number;
}

export interface PmSchedulesData {
  schedules: PmScheduleView[];
  summary: PmSummary;
  /** Hotel-local today (YYYY-MM-DD) as of the last read. */
  today: string;
  loading: boolean;
  refreshing: boolean;
  failure: LoadFailure | null;
  /** True once any read has succeeded for this person + hotel - a failed read before that is an error, not "no schedules". */
  hasData: boolean;
  syncedAt: Date | null;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** Last good read per person + hotel, so opening a schedule from the list shows it instantly instead of re-fetching blind. */
const cache = new Map<string, { rows: PmScheduleRow[]; syncedAt: Date }>();

/** For tests. */
export function resetPmScheduleCache(): void {
  cache.clear();
}

/**
 * The single source of PM schedule data for the PM screens (Home reads the same rows through the same adapter, so counts
 * cannot disagree). A new hotel/person starts clean; an answer for a previous scope or an older request is dropped;
 * a failed refresh keeps the last good rows and reports the failure instead of showing an empty list.
 */
export function usePmSchedules(): PmSchedulesData {
  useHotelTimezone();
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const user = useAppStore((s) => s.user);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;

  const [rows, setRows] = useState<PmScheduleRow[]>(() => (scope ? cache.get(scope)?.rows ?? [] : []));
  const [syncedAt, setSyncedAt] = useState<Date | null>(() => (scope ? cache.get(scope)?.syncedAt ?? null : null));
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const generation = useRef(0);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    const requestScope = scopeRef.current;
    if (!requestScope) return;
    try {
      const next = await listPmSchedules();
      if (ticket !== generation.current || requestScope !== scopeRef.current) return;
      const at = new Date();
      cache.set(requestScope, { rows: next, syncedAt: at });
      setRows(next);
      setSyncedAt(at);
      setNow(at);
      setFailure(null);
    } catch (err) {
      if (ticket !== generation.current || requestScope !== scopeRef.current) return;
      setFailure(classifyLoadFailure(err));
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    const cached = scope ? cache.get(scope) : undefined;
    setRows(cached?.rows ?? []);
    setSyncedAt(cached?.syncedAt ?? null);
    setFailure(null);
    if (!scope) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load().finally(() => {
      if (scopeRef.current === scope) setLoading(false);
    });
  }, [scope, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const schedules = useMemo(() => adaptPmSchedules(rows, hotelTimezone, now), [rows, hotelTimezone, now]);
  const today = useMemo(() => hotelDateKey(now, hotelTimezone) ?? "", [now, hotelTimezone]);
  const summary = useMemo<PmSummary>(() => ({ ...countPmSchedules(schedules), thisWeek: countThisWeek(schedules, today) }), [schedules, today]);

  return { schedules, summary, today, loading, refreshing, failure, hasData: syncedAt != null, syncedAt, reload: load, refresh };
}
