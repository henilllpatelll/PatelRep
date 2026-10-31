/* ─── PM schedule view model ────────────────────────────────────────────────
   GET /assets/pm-schedules returns raw `pm_schedules` rows (+ joined `assets`):
   `name`, `next_due_at`, `last_completed_at`, `interval_type`, `assets.name`.
   It sends no `status`, `asset_name`, `task_name`, `frequency` or `next_due`.
   Due / overdue / upcoming is therefore derived here, by calendar day in the
   hotel's zone (same rule as the web console's getScheduleState), so Home and
   the PM screen can never disagree. */

import type { PmScheduleRow } from "@/lib/api/assets";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";

export type PmDueState = "overdue" | "due_today" | "due_soon" | "upcoming" | "unscheduled";

/** "Due soon" means due within the next 7 hotel-calendar days (matches the web console). */
export const PM_DUE_SOON_DAYS = 7;

export interface PmScheduleView {
  id: string;
  assetId: string | null;
  assetName: string | null;
  roomId: string | null;
  name: string;
  description: string | null;
  intervalType: PmScheduleRow["interval_type"] | null;
  intervalDays: number | null;
  estimatedMinutes: number | null;
  assignedToRole: string | null;
  recurrenceBasis: "scheduled_date" | "completion_date" | null;
  nextDueAt: string | null;
  lastCompletedAt: string | null;
  /** Hotel-local calendar day (YYYY-MM-DD) of `nextDueAt`; null when it is missing or unparseable. */
  dueDate: string | null;
  state: PmDueState;
  /** Whole hotel-calendar days until due; negative when overdue, null when unscheduled. */
  daysUntilDue: number | null;
}

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** Whole days from one YYYY-MM-DD key to another (DST-proof: both read as UTC midnight). */
export function dayDifference(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function pmDueState(daysUntilDue: number | null): PmDueState {
  if (daysUntilDue == null) return "unscheduled";
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue === 0) return "due_today";
  if (daysUntilDue <= PM_DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

export function adaptPmSchedule(
  row: PmScheduleRow,
  hotelTimezone: string | null | undefined,
  now: Date = new Date(),
): PmScheduleView | null {
  if (!row?.id) return null;
  const dueDate = hotelDateKey(row.next_due_at, hotelTimezone);
  const today = hotelDateKey(now, hotelTimezone);
  const daysUntilDue = dueDate && today ? dayDifference(today, dueDate) : null;
  return {
    id: row.id,
    assetId: row.asset_id ?? null,
    assetName: clean(row.assets?.name),
    roomId: row.assets?.room_id ?? null,
    name: clean(row.name) ?? "",
    description: clean(row.description),
    intervalType: row.interval_type ?? null,
    intervalDays: row.interval_days ?? null,
    estimatedMinutes: row.estimated_minutes ?? null,
    assignedToRole: row.assigned_to_role ?? null,
    recurrenceBasis: row.recurrence_basis ?? null,
    nextDueAt: row.next_due_at ?? null,
    lastCompletedAt: row.last_completed_at ?? null,
    dueDate,
    state: pmDueState(daysUntilDue),
    daysUntilDue,
  };
}

/** Active schedules only, most urgent first (overdue by longest, then soonest due; unscheduled last). */
export function adaptPmSchedules(
  rows: readonly PmScheduleRow[] | null | undefined,
  hotelTimezone: string | null | undefined,
  now: Date = new Date(),
): PmScheduleView[] {
  const views: PmScheduleView[] = [];
  for (const row of rows ?? []) {
    if (row?.is_active === false) continue;
    const view = adaptPmSchedule(row, hotelTimezone, now);
    if (view) views.push(view);
  }
  return views.sort((a, b) => {
    if (a.daysUntilDue == null && b.daysUntilDue == null) return a.name.localeCompare(b.name);
    if (a.daysUntilDue == null) return 1;
    if (b.daysUntilDue == null) return -1;
    return a.daysUntilDue - b.daysUntilDue || a.name.localeCompare(b.name);
  });
}

export interface PmCounts {
  total: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  upcoming: number;
  unscheduled: number;
}

export function countPmSchedules(views: readonly PmScheduleView[]): PmCounts {
  const counts: PmCounts = { total: views.length, overdue: 0, dueToday: 0, dueSoon: 0, upcoming: 0, unscheduled: 0 };
  for (const view of views) {
    if (view.state === "overdue") counts.overdue += 1;
    else if (view.state === "due_today") counts.dueToday += 1;
    else if (view.state === "due_soon") counts.dueSoon += 1;
    else if (view.state === "upcoming") counts.upcoming += 1;
    else counts.unscheduled += 1;
  }
  return counts;
}

/** "Nov 4" for a hotel calendar day key. Rendered in UTC because the key is already the hotel's day, not an instant. */
export function formatDueDate(dateKey: string | null | undefined, language?: string): string | null {
  const match = dateKey ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString(language?.toLowerCase().startsWith("es") ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Screen filters. "due" keeps the previous meaning (needs attention today): due today or overdue. */
export type PmFilter = "all" | "due" | "overdue";

export function filterPmSchedules(views: readonly PmScheduleView[], filter: PmFilter): PmScheduleView[] {
  if (filter === "overdue") return views.filter((v) => v.state === "overdue");
  if (filter === "due") return views.filter((v) => v.state === "due_today" || v.state === "overdue");
  return [...views];
}
