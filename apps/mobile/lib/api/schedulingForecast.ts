import { api } from "./client";

/* ─── GET /schedules/forecast (Team Scheduling Phase 6) ──────────────────────
   The housekeeping staffing forecast. The SERVER does the arithmetic (services/staffing_forecast.py); this file only reads
   its answer, strictly:

     - a number is shown only if the server said it was known: `value: null` stays null, it is never turned into 0;
     - `quality` travels with every figure (verified / estimate / unavailable), as do its assumptions and reason;
     - an unrecognised status is `unknown`, never "sufficient";
     - a day the client cannot read is counted (`unreadableDays`), never silently dropped or defaulted.

   Nothing here writes. A recommendation's `action` is a deep link into a screen that already exists; the forecast never
   publishes a schedule, assigns anyone or moves a room. */

type Raw = Record<string, unknown>;

function rec(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === "string");
}

export type ForecastStatus = "sufficient" | "short" | "unknown";
export type ForecastQuality = "estimated" | "partial" | "unavailable";
export type DataQuality = "verified" | "estimate" | "unavailable";
export type ForecastActionType = "find_coverage" | "add_shift" | "view_week" | "review_time_off" | "view_assignments";

export interface ForecastFact {
  /** null = not known. Never 0 for "unknown". */
  value: number | null;
  quality: DataQuality;
  reason: string | null;
  assumptions: string[];
}

export interface ForecastAction {
  type: ForecastActionType;
  date: string | null;
  gapId: string | null;
}

export interface ForecastRecommendation {
  id: string;
  kind: string;
  severity: "attention" | "info";
  /** verified = read from a record; estimate = derived. */
  basis: "verified" | "estimate";
  params: Record<string, string | number | boolean | null>;
  action: ForecastAction | null;
}

export interface ForecastCategory {
  category: string;
  rooms: number;
  minutes: number;
  unestimatedRooms: number;
}

export interface ForecastShift {
  shiftId: string | null;
  name: string | null;
  startTime: string | null;
  endTime: string | null;
  people: number;
  productiveMinutes: number;
}

export interface ForecastOpenGap {
  gapId: string;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface ForecastSource {
  code: string;
  quality: DataQuality;
  asOf: string | null;
  stale: boolean;
}

export interface ForecastDay {
  date: string;
  isToday: boolean;
  status: ForecastStatus;
  quality: ForecastQuality;
  headline: { code: string; reason: string | null; gapMinutes: number | null; isMinimum: boolean };
  demand: {
    minutes: ForecastFact;
    complete: boolean;
    rooms: number | null;
    byCategory: ForecastCategory[];
    unestimatedRooms: number | null;
    declinedServiceRooms: number | null;
    unassignedRooms: number | null;
    incompleteReasons: string[];
  };
  capacity: {
    productive: ForecastFact;
    measuredFrom: "now" | "shift_start";
    people: number | null;
    shifts: ForecastShift[];
    confirmedCallouts: number | null;
    pendingCallouts: number | null;
    replacements: number | null;
    leaveReducedShifts: number | null;
    draftShifts: number | null;
    breakPolicy: "unknown" | "scenario";
  };
  gap: { minutes: number | null; isMinimum: boolean; additionalShifts: number | null };
  current: { verified: boolean; scheduledPeople: number; working: number | null; notClockedIn: number | null } | null;
  openGaps: ForecastOpenGap[];
  limitations: string[];
  sources: ForecastSource[];
  recommendations: ForecastRecommendation[];
  calculatedAt: string | null;
}

export interface Forecast {
  days: ForecastDay[];
  unreadableDays: number;
  generatedAt: string | null;
  hotelToday: string | null;
  hotelName: string | null;
  revision: string | null;
}

const STATUSES: readonly ForecastStatus[] = ["sufficient", "short", "unknown"];
const ACTIONS: readonly ForecastActionType[] = ["find_coverage", "add_shift", "view_week", "review_time_off", "view_assignments"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function fact(raw: unknown): ForecastFact {
  const row = rec(raw);
  const quality = row?.quality === "verified" || row?.quality === "estimate" ? row.quality : "unavailable";
  const value = quality === "unavailable" ? null : num(row?.value);
  return { value, quality: value === null ? "unavailable" : quality, reason: str(row?.reason), assumptions: strings(row?.assumptions) };
}

function params(raw: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(rec(raw) ?? {})) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

function recommendation(raw: unknown): ForecastRecommendation | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const kind = row ? str(row.kind) : null;
  if (!row || !id || !kind) return null;
  const action = rec(row.action);
  const type = action ? str(action.type) : null;
  const known = type !== null && (ACTIONS as readonly string[]).includes(type);
  return {
    id,
    kind,
    severity: row.severity === "attention" ? "attention" : "info",
    basis: row.basis === "verified" ? "verified" : "estimate",
    params: params(row.params),
    action: known && action ? { type: type as ForecastActionType, date: str(action.date), gapId: str(action.gap_id) } : null,
  };
}

export function parseForecastDay(raw: unknown): ForecastDay | null {
  const row = rec(raw);
  const date = row ? str(row.date) : null;
  const demand = rec(row?.demand);
  const capacity = rec(row?.capacity);
  if (!row || !date || !YMD.test(date) || !demand || !capacity) return null;
  const status = (STATUSES as readonly unknown[]).includes(row.status) ? (row.status as ForecastStatus) : "unknown";
  const headline = rec(row.headline);
  const gap = rec(row.gap);
  const current = rec(row.current);
  const extra = rec(gap?.additional_shifts);
  const quality: ForecastQuality = row.forecast_quality === "estimated" || row.forecast_quality === "partial" ? row.forecast_quality : "unavailable";
  return {
    date,
    isToday: row.is_today === true,
    // A status the client cannot trust is "unknown", never a quiet "sufficient".
    status: quality === "unavailable" && status === "sufficient" ? "unknown" : status,
    quality,
    headline: { code: str(headline?.code) ?? "unknown", reason: str(headline?.reason), gapMinutes: num(headline?.gap_minutes), isMinimum: headline?.is_minimum === true },
    demand: {
      minutes: fact(demand.minutes),
      complete: demand.complete === true,
      rooms: num(demand.rooms),
      byCategory: list(demand.by_category).flatMap((item) => {
        const c = rec(item);
        const category = c ? str(c.category) : null;
        return c && category ? [{ category, rooms: num(c.rooms) ?? 0, minutes: num(c.minutes) ?? 0, unestimatedRooms: num(c.unestimated_rooms) ?? 0 }] : [];
      }),
      unestimatedRooms: num(demand.unestimated_rooms),
      declinedServiceRooms: num(demand.declined_service_rooms),
      unassignedRooms: num(demand.unassigned_rooms),
      incompleteReasons: strings(demand.incomplete_reasons),
    },
    capacity: {
      productive: fact(capacity.productive_minutes),
      measuredFrom: capacity.measured_from === "now" ? "now" : "shift_start",
      people: num(capacity.people),
      shifts: list(capacity.shifts).flatMap((item) => {
        const s = rec(item);
        return s ? [{ shiftId: str(s.shift_id), name: str(s.name), startTime: str(s.start_time), endTime: str(s.end_time), people: num(s.people) ?? 0, productiveMinutes: num(s.productive_minutes) ?? 0 }] : [];
      }),
      confirmedCallouts: num(capacity.confirmed_callouts),
      pendingCallouts: num(capacity.pending_callouts),
      replacements: num(capacity.replacements),
      leaveReducedShifts: num(capacity.leave_reduced_shifts),
      draftShifts: num(capacity.draft_shifts),
      breakPolicy: capacity.break_policy === "scenario" ? "scenario" : "unknown",
    },
    gap: { minutes: num(gap?.minutes), isMinimum: gap?.is_minimum === true, additionalShifts: extra ? num(extra.value) : null },
    current: current
      ? { verified: current.verified === true, scheduledPeople: num(current.scheduled_people) ?? 0, working: num(current.working), notClockedIn: num(current.not_clocked_in) }
      : null,
    openGaps: list(row.open_gaps).flatMap((item) => {
      const g = rec(item);
      const gapId = g ? str(g.gap_id) : null;
      return g && gapId ? [{ gapId, shiftName: str(g.shift_name), startTime: str(g.start_time), endTime: str(g.end_time) }] : [];
    }),
    limitations: strings(row.limitations),
    sources: list(row.sources).flatMap((item) => {
      const s = rec(item);
      const code = s ? str(s.code) : null;
      const quality: DataQuality = s?.quality === "verified" || s?.quality === "estimate" ? s.quality : "unavailable";
      return s && code ? [{ code, quality, asOf: str(s.as_of), stale: s.stale === true }] : [];
    }),
    recommendations: list(row.recommendations).flatMap((item) => {
      const parsed = recommendation(item);
      return parsed ? [parsed] : [];
    }),
    calculatedAt: str(row.calculated_at),
  };
}

export function parseForecast(body: unknown): Forecast {
  const root = rec(body);
  const data = root ? rec(root.data) : null;
  if (!data || !Array.isArray(data.days)) throw new Error("Forecast response was not in the expected shape.");
  const parsed = data.days.map(parseForecastDay);
  const days = parsed.filter((day): day is ForecastDay => day !== null);
  if (days.length === 0 && data.days.length > 0) throw new Error("Forecast days could not be read.");
  const meta = rec(root?.meta);
  return {
    days,
    unreadableDays: parsed.length - days.length,
    generatedAt: str(meta?.generated_at),
    hotelToday: str(meta?.hotel_today),
    hotelName: str(meta?.hotel_name),
    revision: str(meta?.revision),
  };
}

export async function fetchForecast(req: { dateFrom?: string; days?: number } = {}): Promise<Forecast> {
  const query = [req.dateFrom ? `date_from=${encodeURIComponent(req.dateFrom)}` : null, `days=${req.days ?? 7}`].filter(Boolean).join("&");
  return parseForecast(await api.get<unknown>(`/schedules/forecast?${query}`));
}
