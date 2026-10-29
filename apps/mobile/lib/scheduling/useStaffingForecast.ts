import { useEffect, useMemo } from "react";
import { fetchForecast, type Forecast } from "@/lib/api/schedulingForecast";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import { ageSource, knownValue, type SourceState } from "@/lib/housekeeping/supervisorSources";
import { useScopedSource } from "@/lib/housekeeping/useScopedSource";
import { onCoverageChanged } from "@/lib/scheduling/coverageSignal";
import { useAppStore } from "@/stores/appStore";

/* The staffing forecast's data: one scoped source holding today and the next six hotel days.

   - Scoped to `tenant:user` and to the hotel's current day: a hotel switch, a new account or the day rolling over
     throws the held answer away, and an answer that lands after that is discarded (useScopedSource).
   - A failed refresh keeps the last verified answer, relabelled stale; with none it is `failed`. Never an empty forecast.
   - Read-only cache: the forecast is shown from memory when offline, labelled as possibly out of date. Nothing is queued
     and nothing writes while offline.
   - Reloaded when a shift, call-out or coverage gap changes (the coverage signal, or the owning screen calling `reload`
     after its own write), on regaining connectivity, and on returning to the foreground once it is old. The server
     recomputes on every read, so there is no server cache to invalidate. */

export interface UseStaffingForecast {
  state: SourceState<Forecast>;
  /** What the source knows, or null while nothing has answered (callers treat null as unknown, never as zero). */
  forecast: Forecast | null;
  reload: () => Promise<void>;
}

export function useStaffingForecast({ today, nowMs, enabled = true }: { today: string; nowMs: number; enabled?: boolean }): UseStaffingForecast {
  const tenantId = useAppStore((state) => state.user?.tenant_id ?? null);
  const userId = useAppStore((state) => state.user?.id ?? null);
  const isOnline = useAppStore((state) => state.isOnline);
  const scopeKey = tenantId && userId ? `${tenantId}:${userId}` : null;

  const source = useScopedSource<Forecast>({
    scopeKey,
    active: enabled,
    isOnline,
    key: `forecast:${today}`,
    load: () => fetchForecast({ dateFrom: today, days: 7 }),
    staleAfterMs: STALE_AFTER_MS,
  });
  const reload = source.reload;
  useEffect(() => onCoverageChanged(() => void reload()), [reload]);

  const state = useMemo(() => ageSource(source.state, nowMs), [source.state, nowMs]);
  return { state, forecast: knownValue<Forecast | null>(state, null), reload };
}
