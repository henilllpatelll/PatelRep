import { api } from "@/lib/api/client";
import { fetchGuestRequests } from "@/lib/frontDesk/guestRequestsApi";
import type { GuestRequestView } from "@/lib/frontDesk/guestRequests";
import type { BoardStatusRow } from "@/lib/frontDesk/roomReadiness";
import { adaptRiskAlerts, type RiskAlertsResult } from "@/lib/gm/riskAlerts";
import { currentShiftDate } from "@/lib/housekeeping/hotelTime";
import { useAppStore } from "@/stores/appStore";
import { useSource, type SourceState } from "./useSource";

/* Read-only sources for the Front Desk and GM Home. Each is a plain GET the existing screens already make (the
   server scopes every one by hotel and role); none writes, and none calls a paid AI model. */

export function useGuestRequestsSource(enabled = true): SourceState<GuestRequestView[]> {
  return useSource(fetchGuestRequests, enabled);
}

/** The whole-property housekeeping board for the hotel's current shift date. Predictions are not needed here. */
export function useBoardSource(enabled = true): SourceState<BoardStatusRow[]> {
  const zone = useAppStore((s) => s.hotelTimezone);
  return useSource(async () => {
    const date = currentShiftDate(zone);
    const res = await api.get<{ data: BoardStatusRow[] }>(`/housekeeping/board?date=${date}&include_predictions=false`);
    return Array.isArray(res.data) ? res.data : [];
  }, enabled);
}

/** Exact tenant counts for work orders (not derived from a page of rows). */
export interface WorkOrderStats {
  open: number;
  escalated: number;
  in_progress: number;
  on_hold: number;
  overdue: number;
  unassigned: number;
  urgent: number;
  completed_today: number;
}

export function useWorkOrderStatsSource(enabled = true): SourceState<WorkOrderStats> {
  return useSource(async () => {
    const res = await api.get<{ data: Partial<WorkOrderStats> }>("/work-orders/stats");
    const d = res.data ?? {};
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      open: n(d.open),
      escalated: n(d.escalated),
      in_progress: n(d.in_progress),
      on_hold: n(d.on_hold),
      overdue: n(d.overdue),
      unassigned: n(d.unassigned),
      urgent: n(d.urgent),
      completed_today: n(d.completed_today),
    };
  }, enabled);
}

export function useRiskAlertsSource(enabled = true): SourceState<RiskAlertsResult> {
  return useSource(async () => {
    const res = await api.get<{ data: unknown }>("/ai/risk-alerts");
    return adaptRiskAlerts(res.data);
  }, enabled);
}

export const activeWorkOrders = (s: WorkOrderStats): number => s.open + s.escalated + s.in_progress + s.on_hold;
