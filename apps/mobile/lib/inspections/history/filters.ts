import type { HistoryInspectionType, HistoryQuery, HistoryResult } from "@/lib/api/inspectionHistory";
import { addDaysToYmd } from "@/lib/housekeeping/hotelTime";

/* ─── History period and filters (pure) ──────────────────────────────────────
   A period is a pair of HOTEL-LOCAL calendar days. "Today" comes from the hotel's own clock (never the phone's), and
   the server turns the two days into the hotel's local midnights, so daylight-saving days are the right length.
   Every filter here maps to a field the server really filters on; nothing is filtered on the phone. */

export const PERIOD_KEYS = ["today", "yesterday", "7d", "30d", "90d", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/** The server refuses longer ranges; the screen refuses first so the message is ours. */
export const MAX_RANGE_DAYS = 366;

export interface DateRange {
  from: string;
  to: string;
}

export type RangeProblem = "invalid" | "reversed" | "future" | "too_long";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Whole days from `from` to `to`, inclusive (same day = 1). Pure calendar arithmetic. */
export function daysInRange(range: DateRange): number {
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

export function validateRange(range: DateRange, today: string): RangeProblem | null {
  if (!isYmd(range.from) || !isYmd(range.to)) return "invalid";
  if (range.from > range.to) return "reversed";
  if (range.to > today) return "future";
  if (daysInRange(range) > MAX_RANGE_DAYS) return "too_long";
  return null;
}

/** The days a preset covers, ending on the hotel's today. `custom` is null: it comes from the filter's own range. */
export function presetRange(key: Exclude<PeriodKey, "custom">, today: string): DateRange {
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDaysToYmd(today, -1);
      return { from: day, to: day };
    }
    case "7d":
      return { from: addDaysToYmd(today, -6), to: today };
    case "30d":
      return { from: addDaysToYmd(today, -29), to: today };
    case "90d":
      return { from: addDaysToYmd(today, -89), to: today };
  }
}

export type ResultFilter = "all" | HistoryResult;
export type TypeFilter = "all" | HistoryInspectionType;

export interface FailedStandardFilter {
  id: string;
  label: string;
}

export interface HistoryFilters {
  period: PeriodKey;
  /** Only read when `period` is "custom". */
  custom: DateRange | null;
  result: ResultFilter;
  type: TypeFilter;
  /** A search label typed by the supervisor; never an identifier. */
  room: string;
  /** A stable user id, never a name. */
  inspectorId: string | null;
  /** Set by drilling in from the insights; narrows the list to inspections that failed this checklist standard. */
  standard: FailedStandardFilter | null;
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  period: "today",
  custom: null,
  result: "all",
  type: "all",
  room: "",
  inspectorId: null,
  standard: null,
};

/** The days the filters select, or null when a custom range is missing or not valid (nothing is fetched then). */
export function filterRange(filters: HistoryFilters, today: string): DateRange | null {
  if (filters.period !== "custom") return presetRange(filters.period, today);
  if (!filters.custom) return null;
  return validateRange(filters.custom, today) === null ? filters.custom : null;
}

/** How many of the optional filters are set (the period is shown separately and is always set). */
export function activeFilterCount(filters: HistoryFilters): number {
  return (
    (filters.result !== "all" ? 1 : 0) +
    (filters.type !== "all" ? 1 : 0) +
    (filters.room.trim() ? 1 : 0) +
    (filters.inspectorId ? 1 : 0) +
    (filters.standard ? 1 : 0)
  );
}

/** Any filter beyond the default period. A different period is a choice of what to look at, not a filter. */
export function hasActiveFilters(filters: HistoryFilters): boolean {
  return activeFilterCount(filters) > 0;
}

export function isDefaultView(filters: HistoryFilters): boolean {
  return filters.period === "today" && !hasActiveFilters(filters);
}

/** The server query for the filters, or null when the period is not valid. */
export function toHistoryQuery(filters: HistoryFilters, today: string, limit: number, cursor: string | null = null): HistoryQuery | null {
  const range = filterRange(filters, today);
  if (!range) return null;
  const room = filters.room.trim();
  return {
    dateFrom: range.from,
    dateTo: range.to,
    ...(filters.result !== "all" ? { result: filters.result } : {}),
    ...(filters.type !== "all" ? { inspectionType: filters.type } : {}),
    ...(filters.inspectorId ? { inspectorId: filters.inspectorId } : {}),
    ...(room ? { roomNumber: room } : {}),
    ...(filters.standard ? { failedItemId: filters.standard.id } : {}),
    limit,
    cursor,
  };
}

/** A stable identity for "this exact question", so an answer to an older question is never shown for a newer one. */
export function queryKey(filters: HistoryFilters, today: string): string {
  const range = filterRange(filters, today);
  return JSON.stringify([
    range?.from ?? null,
    range?.to ?? null,
    filters.result,
    filters.type,
    filters.room.trim().toLowerCase(),
    filters.inspectorId,
    filters.standard?.id ?? null,
  ]);
}

export type FilterChip =
  | { kind: "result"; value: HistoryResult }
  | { kind: "type"; value: HistoryInspectionType }
  | { kind: "room"; value: string }
  | { kind: "inspector"; value: string }
  | { kind: "standard"; value: FailedStandardFilter };

export function filterChips(filters: HistoryFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.result !== "all") chips.push({ kind: "result", value: filters.result });
  if (filters.type !== "all") chips.push({ kind: "type", value: filters.type });
  if (filters.room.trim()) chips.push({ kind: "room", value: filters.room.trim() });
  if (filters.inspectorId) chips.push({ kind: "inspector", value: filters.inspectorId });
  if (filters.standard) chips.push({ kind: "standard", value: filters.standard });
  return chips;
}

export function removeChip(filters: HistoryFilters, chip: FilterChip): HistoryFilters {
  switch (chip.kind) {
    case "result":
      return { ...filters, result: "all" };
    case "type":
      return { ...filters, type: "all" };
    case "room":
      return { ...filters, room: "" };
    case "inspector":
      return { ...filters, inspectorId: null };
    case "standard":
      return { ...filters, standard: null };
  }
}

/** Reset keeps nothing: back to Today with no other filter. */
export function resetFilters(): HistoryFilters {
  return DEFAULT_HISTORY_FILTERS;
}
