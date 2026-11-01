/* ─── Equipment readings ────────────────────────────────────────────────────
   Rules for recording and reading meter values, taken from the API contract (`/assets/{id}/meters`,
   `/assets/meters/{id}/readings`). The server owns every threshold: `status_at_recording` is whatever it computed from
   the meter's configured warning/critical limits, and a meter with no limits has no status at all. The client never
   invents a safe range and never calls a value "safe". The server does not require meters to increase, so neither
   does this; a surprising jump is shown to the person, not blocked. */

export interface AssetMeter {
  id: string;
  asset_id?: string | null;
  name: string;
  meter_type: string;
  unit: string;
  warning_low?: number | null;
  warning_high?: number | null;
  critical_low?: number | null;
  critical_high?: number | null;
  stale_after_hours?: number | null;
  critical_action?: "none" | "create_work_order";
  is_active?: boolean;
  /** `normal | warning | critical` from the latest reading, `stale` / `no_readings` from freshness. */
  current_status?: string | null;
  latest_reading?: MeterReading | null;
}

export interface MeterReading {
  id: string;
  meter_id?: string;
  value: number | string;
  recorded_at: string;
  status_at_recording?: string | null;
  notes?: string | null;
  source?: string | null;
  work_order_id?: string | null;
}

export const READING_VALUE_LIMIT = 1_000_000_000;
export const READING_NOTES_MAX = 1000;
const MAX_DECIMALS = 6;

export type ReadingError = "required" | "invalid" | "out_of_range" | "too_precise" | "notes_too_long";

export interface ReadingCheck {
  value: number | null;
  error: ReadingError | null;
}

/** Plain decimal only: `4280`, `-3.5`, `18.25`. A comma is refused rather than guessed (thousands or decimal point?). */
export function parseReadingValue(text: string): ReadingCheck {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: "required" };
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { value: null, error: "invalid" };
  const decimals = trimmed.split(".")[1]?.length ?? 0;
  if (decimals > MAX_DECIMALS) return { value: null, error: "too_precise" };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { value: null, error: "invalid" };
  if (Math.abs(value) > READING_VALUE_LIMIT) return { value: null, error: "out_of_range" };
  return { value, error: null };
}

export function checkReadingInput(valueText: string, notes: string): ReadingCheck {
  const parsed = parseReadingValue(valueText);
  if (parsed.error) return parsed;
  if (notes.length > READING_NOTES_MAX) return { value: null, error: "notes_too_long" };
  return parsed;
}

export type ReadingLimitState = "outside_critical" | "outside_warning" | "inside_configured" | "no_limits";

/** Compares a typed value to the meter's OWN configured limits, before submit. "no_limits" means the server will not judge it. */
export function limitState(meter: Pick<AssetMeter, "warning_low" | "warning_high" | "critical_low" | "critical_high">, value: number): ReadingLimitState {
  const { warning_low: wl, warning_high: wh, critical_low: cl, critical_high: ch } = meter;
  if (wl == null && wh == null && cl == null && ch == null) return "no_limits";
  if ((cl != null && value <= Number(cl)) || (ch != null && value >= Number(ch))) return "outside_critical";
  if ((wl != null && value <= Number(wl)) || (wh != null && value >= Number(wh))) return "outside_warning";
  return "inside_configured";
}

export function readingNumber(reading: Pick<MeterReading, "value">): number | null {
  const n = typeof reading.value === "number" ? reading.value : Number(reading.value);
  return Number.isFinite(n) ? n : null;
}

/** Newest first, as the API returns; duplicates by id removed. */
export function sortReadings(readings: readonly MeterReading[]): MeterReading[] {
  const seen = new Set<string>();
  return [...readings]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
}

export interface TrendPoint {
  at: string;
  value: number;
}

export const MIN_TREND_POINTS = 4;
export const MAX_TREND_POINTS = 12;

/** Oldest to newest, numeric readings of ONE meter (one unit) only. */
export function trendPoints(readings: readonly MeterReading[]): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const reading of sortReadings(readings).slice(0, MAX_TREND_POINTS)) {
    const value = readingNumber(reading);
    if (value != null && Number.isFinite(Date.parse(reading.recorded_at))) points.push({ at: reading.recorded_at, value });
  }
  return points.reverse();
}

/** A chart needs enough real points to say something. Fewer than this is shown as a list, never a stretched line. */
export function hasEnoughForTrend(points: readonly TrendPoint[]): boolean {
  return points.length >= MIN_TREND_POINTS;
}

export type TrendDirection = "rising" | "falling" | "flat";

/** First vs. last recorded value. Descriptive only: no forecast, no model. */
export function trendDirection(points: readonly TrendPoint[]): TrendDirection | null {
  if (points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const span = Math.max(...points.map((p) => p.value)) - Math.min(...points.map((p) => p.value));
  if (span === 0 || Math.abs(last - first) < span * 0.05) return "flat";
  return last > first ? "rising" : "falling";
}

/** Chart geometry in a 0..1 box; the y axis spans the recorded min..max, x is spaced by the real timestamps. */
export function trendGeometry(points: readonly TrendPoint[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const times = points.map((p) => Date.parse(p.at));
  const values = points.map((p) => p.value);
  const t0 = Math.min(...times);
  const tSpan = Math.max(...times) - t0;
  const v0 = Math.min(...values);
  const vSpan = Math.max(...values) - v0;
  return points.map((p, i) => ({
    x: tSpan === 0 ? i / Math.max(1, points.length - 1) : (times[i] - t0) / tSpan,
    y: vSpan === 0 ? 0.5 : 1 - (p.value - v0) / vSpan,
  }));
}

/** "4,280" / "18.25" for display, using the device locale; the stored value is never rounded beyond 2 decimals shown. */
export function formatReadingValue(value: number | string, locale: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
}
