/* Builders for the Staffing Forecast tests. They produce exactly what GET /schedules/forecast sends (snake_case, the
   shape of services/staffing_forecast.forecast_day), so the client parser is exercised against the real contract. */

type Fact = { value: number | null; quality: "verified" | "estimate" | "unavailable"; reason?: string | null; assumptions?: string[] };

export const fact = (value: number | null, reason: string | null = null): Fact => ({
  value,
  quality: value === null ? "unavailable" : "estimate",
  reason,
  assumptions: value === null ? [] : ["paid_shift_minutes_no_break_policy"],
});

export interface WireDayOptions {
  date: string;
  isToday?: boolean;
  status?: "sufficient" | "short" | "unknown";
  quality?: "estimated" | "partial" | "unavailable";
  demand?: number | null;
  capacity?: number | null;
  gap?: number | null;
  isMinimum?: boolean;
  reason?: string | null;
  rooms?: number | null;
  people?: number | null;
  complete?: boolean;
  unestimated?: number;
  openGaps?: Array<{ gap_id: string; shift_name: string; start_time: string; end_time: string }>;
  recommendations?: unknown[];
  limitations?: string[];
  sources?: unknown[];
  extra?: Record<string, unknown>;
}

export function wireDay(o: WireDayOptions) {
  const demand = o.demand === undefined ? 300 : o.demand;
  const capacity = o.capacity === undefined ? 480 : o.capacity;
  const status = o.status ?? "sufficient";
  return {
    date: o.date,
    is_today: o.isToday ?? false,
    status,
    basis: status === "unknown" ? "unavailable" : "estimate",
    forecast_quality: o.quality ?? (status === "unknown" ? "unavailable" : "estimated"),
    headline: { code: status, reason: o.reason ?? null, gap_minutes: o.gap ?? null, is_minimum: o.isMinimum ?? false },
    demand: {
      minutes: fact(demand, demand === null ? (o.reason ?? "pms_not_connected") : null),
      complete: o.complete ?? demand !== null,
      scope: demand === null ? "unavailable" : "identified_work",
      rooms: o.rooms === undefined ? (demand === null ? null : 10) : o.rooms,
      by_category: demand === null ? [] : [{ category: "departure", rooms: 6, minutes: 180, unestimated_rooms: 0 }, { category: "stayover", rooms: 4, minutes: 120, unestimated_rooms: 0 }],
      unestimated_rooms: demand === null ? null : (o.unestimated ?? 0),
      history_estimated_rooms: 0,
      declined_service_rooms: o.isToday ? 0 : null,
      unassigned_rooms: o.isToday ? 2 : null,
      incomplete_reasons: o.complete === false ? ["unestimated_rooms"] : demand === null ? [o.reason ?? "pms_not_connected"] : [],
    },
    capacity: {
      productive_minutes: fact(capacity),
      full_day_minutes: fact(capacity),
      measured_from: o.isToday ? "now" : "shift_start",
      people: o.people === undefined ? 1 : o.people,
      pools: [],
      shifts: [{ shift_id: "s1", name: "Morning", start_time: "07:00:00", end_time: "15:00:00", people: 1, productive_minutes: capacity ?? 0 }],
      confirmed_callouts: 0,
      pending_callouts: 0,
      replacements: 0,
      leave_reduced_shifts: 0,
      pending_leave_shifts: 0,
      draft_shifts: 0,
      other_housekeeping_staff: 0,
      break_policy: "unknown",
      break_minutes_per_shift: 0,
    },
    gap: { minutes: o.gap ?? null, is_minimum: o.isMinimum ?? false, additional_shifts: status === "short" ? { value: 1, quality: "estimate", is_minimum: false } : null },
    time_window: { available: false, reason: "no_service_window_data" },
    current: o.isToday ? { verified: true, source: "hk_shift_sessions", scheduled_people: 1, working: 1, on_break: 0, not_clocked_in: 0, clocked_out: 0, unknown: 0 } : null,
    open_gaps: o.openGaps ?? [],
    limitations: o.limitations ?? (o.isToday ? ["later_departures_unknown"] : []),
    sources: o.sources ?? [
      { code: o.isToday ? "room_board" : "future_demand", as_of: "2026-10-28T15:00:00+00:00", quality: demand === null ? "unavailable" : "estimate", stale: false },
      { code: "scheduled_shifts", as_of: "2026-10-28T15:00:00+00:00", quality: "estimate", stale: false },
    ],
    recommendations: o.recommendations ?? [],
    calculated_at: "2026-10-28T15:00:00+00:00",
    ...o.extra,
  };
}

/** Seven days from `start`: today per `today`, the rest unknown (no future demand source), like the real server. */
export function wireForecast(days: unknown[], meta: Record<string, unknown> = {}) {
  return { data: { days }, meta: { generated_at: "2026-10-28T15:00:00+00:00", hotel_today: "2026-10-28", hotel_name: "Fossil Creek Inn", revision: "abc123", ...meta } };
}

export const recommendation = (over: Record<string, unknown> = {}) => ({
  id: "shortfall:2026-10-28",
  kind: "shortfall",
  severity: "attention",
  basis: "estimate",
  params: { gap_minutes: 60, is_minimum: false, date: "2026-10-28", additional_shifts: 1 },
  action: { type: "add_shift", date: "2026-10-28" },
  ...over,
});
