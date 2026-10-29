import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { fetchTeamSchedule, type TeamSchedule } from "@/lib/api/schedulingTeam";
import { currentShiftDate, resolveTimeZone } from "@/lib/housekeeping/hotelTime";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import { ageSource, type SourceState } from "@/lib/housekeeping/supervisorSources";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { useScopedSource } from "@/lib/housekeeping/useScopedSource";
import { addDaysToYmd, weekStartOf } from "@/lib/scheduling/teamScheduleDates";
import { useAppStore } from "@/stores/appStore";

/* The Team Schedule's data: two independent, scoped sources (see teamScheduleView for how they combine).

   - Scoped to `tenant:user`: switching hotel or account throws the held answers away, and an answer that lands
     after the scope moved on is discarded (useScopedSource).
   - A failed refresh keeps the last verified answer, relabelled stale; with none it is `failed`. Never empty.
   - The plan for a week is keyed by that week, so moving between days of one week never refetches; the attendance
     read is keyed by the hotel's current day, so the hotel-day rollover loads the new day by itself.
   - No Realtime subscription: Supervisor Today / Room Board already own the one shared channel, and this screen's
     plan changes by the day. Pull-to-refresh, foreground return and regained connectivity are enough. */

const TICK_MS = 30_000;

/** The hotel's current calendar day, re-read so the screen follows midnight in the HOTEL's zone. */
export function useHotelToday(): { today: string; zone: string | null; nowMs: number } {
  useHotelTimezone();
  const zone = useAppStore((state) => state.hotelTimezone ?? null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNowMs(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return { today: currentShiftDate(zone, new Date(nowMs)), zone: zone ? resolveTimeZone(zone) : null, nowMs };
}

export interface UseTeamSchedule {
  week: SourceState<TeamSchedule>;
  day: SourceState<TeamSchedule>;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Hotel + person; changing it resets every held answer. null = nobody signed in. */
  scopeKey: string | null;
}

const hasNobody = (schedule: TeamSchedule): boolean => schedule.people.length === 0;

export function useTeamSchedule({ date, today, nowMs, enabled = true }: { date: string; today: string; nowMs: number; enabled?: boolean }): UseTeamSchedule {
  const tenantId = useAppStore((state) => state.user?.tenant_id ?? null);
  const userId = useAppStore((state) => state.user?.id ?? null);
  const isOnline = useAppStore((state) => state.isOnline);
  const scopeKey = tenantId && userId ? `${tenantId}:${userId}` : null;
  const start = weekStartOf(date);
  const [refreshing, setRefreshing] = useState(false);

  const loadWeek = useCallback(() => fetchTeamSchedule({ dateFrom: start, dateTo: addDaysToYmd(start, 6) }), [start]);
  const loadDay = useCallback(() => fetchTeamSchedule({ dateFrom: today, includeAttendance: true }), [today]);

  const week = useScopedSource<TeamSchedule>({ scopeKey, active: enabled, isOnline, key: `week:${start}`, load: loadWeek, isEmpty: hasNobody, staleAfterMs: STALE_AFTER_MS });
  // Attendance is only ever read for the hotel's current day, and only while that day is on screen.
  const day = useScopedSource<TeamSchedule>({ scopeKey, active: enabled && date === today, isOnline, key: `day:${today}`, load: loadDay, isEmpty: hasNobody, staleAfterMs: STALE_AFTER_MS });

  const reloadWeek = week.reload;
  const reloadDay = day.reload;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadWeek(), reloadDay()]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadWeek, reloadDay]);

  // An answer that has sat past the freshness window is shown as stale even though nothing failed.
  const weekState = useMemo(() => ageSource(week.state, nowMs), [week.state, nowMs]);
  const dayState = useMemo(() => ageSource(day.state, nowMs), [day.state, nowMs]);
  return { week: weekState, day: dayState, refreshing, refresh, scopeKey };
}
