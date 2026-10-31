import type { ShiftAssignment } from "@/lib/api/scheduling";

/* The week My Schedule shows. Dates are plain `YYYY-MM-DD` strings handled with calendar arithmetic in UTC, never through the
   phone's local time, so a notification for a date three months away opens exactly that week on any device and across a DST
   change. A shift belongs to the day it STARTS (its work_date): an overnight shift stays on the day it began. */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A real calendar date or null. "2030-02-31" is rejected, not rolled over to March. */
export function validYmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = YMD.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const at = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const back = new Date(at);
  return back.getUTCFullYear() === Number(y) && back.getUTCMonth() === Number(m) - 1 && back.getUTCDate() === Number(d) ? value.trim() : null;
}

function toMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(ymd: string, days: number): string {
  return fromMs(toMs(ymd) + days * DAY_MS);
}

/** The Monday on or before `ymd` (the week the app has always shown starts on Monday). */
export function mondayOf(ymd: string): string {
  const weekday = new Date(toMs(ymd)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((weekday + 6) % 7));
}

export function weekOf(ymd: string): string[] {
  const start = mondayOf(ymd);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The calendar date on this phone right now, as the app has always read "today". */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Every shift of each day in start order: a person can hold two shifts on one date, and none may disappear. */
export function groupByDate(assignments: readonly ShiftAssignment[]): Record<string, ShiftAssignment[]> {
  const out: Record<string, ShiftAssignment[]> = {};
  for (const assignment of assignments) (out[assignment.work_date] ??= []).push(assignment);
  for (const day of Object.values(out)) day.sort((a, b) => (a.shifts?.start_time ?? "").localeCompare(b.shifts?.start_time ?? ""));
  return out;
}

export interface WeekTarget {
  /** The date the link names (validated), if any. */
  date: string | null;
  /** The shift the link names, if any. */
  assignmentId: string | null;
}

/** What the highlighted shift turned out to be once the week loaded: shown, or not on this person's schedule any more. */
export function resolveHighlight(target: WeekTarget, byDate: Record<string, ShiftAssignment[]>): "found" | "missing" | "none" {
  if (!target.date && !target.assignmentId) return "none";
  if (target.assignmentId) {
    for (const day of Object.values(byDate)) if (day.some((a) => a.id === target.assignmentId)) return "found";
    return "missing";
  }
  return (byDate[target.date as string]?.length ?? 0) > 0 ? "found" : "missing";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim().toLowerCase() : null;
}
