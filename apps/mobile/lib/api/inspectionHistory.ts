import { api } from "./client";
import type { CorrectionKind } from "./inspections";

/* ─── Inspection history reads ────────────────────────────────────────────────
   Read-only. Every function is a strict parser: a body that is not the documented shape THROWS, so a malformed
   answer can never read as "no inspections". Dates are hotel-local calendar days (YYYY-MM-DD); the server resolves
   both local midnights itself, so a phone in another time zone gets the same period. */

export type HistoryResult = "passed" | "failed" | "conditional";
export type HistoryInspectionType = "initial" | "reinspection";

export interface HistoryRowRaw {
  id: string;
  room_id: string | null;
  room_number: string;
  floor: number | null;
  building: string | null;
  inspected_by: string | null;
  /** The real name or null. Never an id fragment (the legacy `inspector_name` can be one). */
  inspector_display_name: string | null;
  overall_result: string;
  notes: string | null;
  completed_at: string | null;
  reinspection_of: string | null;
  is_reinspection: boolean;
  correction_kind: CorrectionKind | null;
}

export interface HistoryQuery {
  dateFrom: string;
  dateTo: string;
  result?: HistoryResult;
  inspectionType?: HistoryInspectionType;
  inspectorId?: string;
  roomNumber?: string;
  failedItemId?: string;
  limit?: number;
  cursor?: string | null;
}

export interface HistoryPageRaw {
  rows: HistoryRowRaw[];
  hasMore: boolean;
  nextCursor: string | null;
  /** The exact number of matches. Only the first page carries it (null on later pages). */
  total: number | null;
}

function queryString(params: Record<string, string | number | null | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.join("&");
}

export function historyPath(query: HistoryQuery): string {
  return `/housekeeping/inspections?${queryString({
    date_from: query.dateFrom,
    date_to: query.dateTo,
    result: query.result,
    inspection_type: query.inspectionType,
    inspector_id: query.inspectorId,
    room_number: query.roomNumber?.trim(),
    failed_item_id: query.failedItemId,
    limit: query.limit,
    cursor: query.cursor,
  })}`;
}

function isRow(value: unknown): value is HistoryRowRaw {
  const row = value as Partial<HistoryRowRaw> | null;
  return Boolean(row) && typeof row?.id === "string" && typeof row?.overall_result === "string";
}

export async function fetchInspectionHistory(query: HistoryQuery): Promise<HistoryPageRaw> {
  const res = await api.get<{ data?: unknown; meta?: { has_more?: unknown; next_cursor?: unknown; total?: unknown } }>(historyPath(query));
  if (!res || !Array.isArray(res.data)) throw new Error("Malformed inspection history response");
  const rows = (res.data as unknown[]).filter(isRow);
  // A row that cannot be read is dropped, but a body that lost most of its rows is a malformed body, not a short page.
  if (rows.length !== (res.data as unknown[]).length && rows.length === 0 && (res.data as unknown[]).length > 0) {
    throw new Error("Malformed inspection history response");
  }
  const meta = res.meta ?? {};
  return {
    rows,
    hasMore: meta.has_more === true,
    nextCursor: typeof meta.next_cursor === "string" ? meta.next_cursor : null,
    total: typeof meta.total === "number" ? meta.total : null,
  };
}

export interface InspectorOption {
  id: string;
  name: string | null;
  count: number;
}

export async function fetchHistoryInspectors(dateFrom: string, dateTo: string): Promise<{ rows: InspectorOption[]; truncated: boolean }> {
  const res = await api.get<{ data?: unknown; meta?: { truncated?: unknown } }>(
    `/housekeeping/inspections/inspectors?${queryString({ date_from: dateFrom, date_to: dateTo })}`,
  );
  if (!res || !Array.isArray(res.data)) throw new Error("Malformed inspectors response");
  const rows = (res.data as InspectorOption[]).filter((row) => row && typeof row.id === "string");
  return { rows, truncated: res.meta?.truncated === true };
}

/* ─── Insights ─────────────────────────────────────────────────────────────── */

export interface InsightStandard {
  standard_id: string;
  label: string | null;
  section: string | null;
  count: number;
}

export interface InsightRepeatRoom {
  room_id: string;
  room_number: string | null;
  failed_count: number;
  inspection_ids: string[];
}

export interface InsightRepeatStandard extends InsightStandard {
  room_id: string;
  room_number: string | null;
}

export interface InsightDay {
  date: string;
  initial_passed: number;
  initial_failed: number;
  completed: number;
  /** null = no initial inspections that day: there is no rate, which is not 0%. */
  first_pass_rate: number | null;
}

export interface Insights {
  period: { date_from: string; date_to: string };
  counts: {
    completed: number;
    passed: number;
    failed: number;
    conditional: number;
    initial: number;
    reinspections: number;
    /** Records from before reinspection links existed: their re-checks can only be counted as initial. */
    without_lineage: number;
  };
  first_pass: { rate: number | null; passed: number; eligible: number; conditional_excluded: number };
  daily: InsightDay[];
  top_standards: InsightStandard[];
  failed_answers_unidentified: number;
  repeat_rooms: InsightRepeatRoom[];
  repeat_standards: InsightRepeatStandard[];
  corrections: { failed: number; verified: number; failed_again: number; no_reinspection_recorded: number };
  time_to_verification: { available: boolean; median_minutes: number | null; sample: number; minimum_sample: number };
  /** More inspections exist than the server aggregates: every rate is withheld. */
  truncated: boolean;
}

export async function fetchInspectionInsights(dateFrom: string, dateTo: string): Promise<Insights> {
  const res = await api.get<{ data?: Partial<Insights> }>(`/housekeeping/inspections/insights?${queryString({ date_from: dateFrom, date_to: dateTo })}`);
  const data = res?.data;
  if (!data || typeof data !== "object" || !data.counts || !data.first_pass || !Array.isArray(data.daily) || !Array.isArray(data.top_standards) || !data.corrections) {
    throw new Error("Malformed insights response");
  }
  return data as Insights;
}

/* ─── Timeline ─────────────────────────────────────────────────────────────── */

export interface TimelineFailedItem {
  template_item_id: string | null;
  section: string | null;
  description: string | null;
  note: string | null;
  severity: "minor" | "major" | null;
}

export interface TimelineInspection {
  id: string;
  overall_result: string;
  completed_at: string | null;
  inspected_by: string | null;
  inspector_name: string | null;
  reinspection_of: string | null;
  is_reinspection: boolean;
  correction_kind: CorrectionKind | null;
  failed_items: TimelineFailedItem[];
  /** The passing reinspection that verified this failure. */
  verified_by: string | null;
  /** The later failing reinspection that repeated it. */
  repeated_by: string | null;
}

export interface TimelineEvent {
  key: string;
  type: string;
  at: string;
  actor_name: string | null;
  assignee_name?: string | null;
  /** The inspection this event belongs to (for a reinspection event: the reinspection itself). */
  inspection_id?: string | null;
}

export interface InspectionTimeline {
  inspection_id: string;
  room_id: string;
  room_number: string | null;
  inspections: TimelineInspection[];
  events: TimelineEvent[];
  /** The chain or its events were cut at the server's bound. */
  truncated: boolean;
}

export async function fetchInspectionTimeline(inspectionId: string): Promise<InspectionTimeline> {
  const res = await api.get<{ data?: Partial<InspectionTimeline> }>(`/housekeeping/inspections/${encodeURIComponent(inspectionId)}/timeline`);
  const data = res?.data;
  if (!data || !Array.isArray(data.inspections) || !Array.isArray(data.events) || typeof data.inspection_id !== "string") {
    throw new Error("Malformed timeline response");
  }
  return data as InspectionTimeline;
}

/* ─── Evidence ─────────────────────────────────────────────────────────────── */

/** A fresh short-lived link to one stored photo. 404 = no photo recorded or it is no longer available. */
export async function fetchEvidenceUrl(inspectionId: string, templateItemId: string): Promise<{ url: string; expiresIn: number }> {
  const res = await api.get<{ data?: { url?: unknown; expires_in?: unknown } }>(
    `/housekeeping/inspections/${encodeURIComponent(inspectionId)}/evidence/${encodeURIComponent(templateItemId)}`,
  );
  const url = res?.data?.url;
  if (typeof url !== "string" || !url) throw new Error("Malformed evidence response");
  return { url, expiresIn: typeof res.data?.expires_in === "number" ? res.data.expires_in : 0 };
}
