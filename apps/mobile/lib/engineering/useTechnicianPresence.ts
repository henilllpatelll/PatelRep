import { useCallback } from "react";
import { fetchTeamSchedule } from "@/lib/api/schedulingTeam";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import { isVerified, knownValue } from "@/lib/housekeeping/supervisorSources";
import { useScopedSource } from "@/lib/housekeeping/useScopedSource";
import { useHotelToday } from "@/lib/scheduling/useTeamSchedule";
import { presenceFor, type Presence } from "@/lib/engineering/technicianPresence";
import { useAppStore } from "@/stores/appStore";

export interface TechnicianPresence {
  /** Today's published-schedule answer for one person, or null when it is not known (never "not scheduled" by default). */
  presenceOf: (userId: string) => Presence | null;
  /** The hotel's wall-clock zone, for formatting shift times. */
  zone: string | null;
  reload: () => Promise<void>;
}

/**
 * One read of today's engineering schedule (GET /schedules/team, hotel-local day, engineers only) for the Chief Engineer
 * Home. It is its own source: a failed or partial read only removes the schedule lines, it never affects the counts or the
 * workload. Only a fresh, verified, complete answer is used; a stale one is dropped rather than shown as current.
 * The server scopes the read to the departments the signed-in manager may see, so someone it does not cover has no line.
 */
export function useTechnicianPresence(enabled: boolean): TechnicianPresence {
  const tenantId = useAppStore((s) => s.user?.tenant_id ?? null);
  const userId = useAppStore((s) => s.user?.id ?? null);
  const isOnline = useAppStore((s) => s.isOnline);
  const { today, zone, nowMs } = useHotelToday();
  const scopeKey = tenantId && userId ? `${tenantId}:${userId}` : null;
  const load = useCallback(() => fetchTeamSchedule({ dateFrom: today, role: "engineer" }), [today]);
  const { state, reload } = useScopedSource({ scopeKey, active: enabled, isOnline, key: today, load, staleAfterMs: STALE_AFTER_MS });
  const schedule = isVerified(state) ? knownValue(state, null) : null;
  const presenceOf = useCallback((id: string) => presenceFor(schedule, id, nowMs), [schedule, nowMs]);
  return { presenceOf, zone, reload };
}
