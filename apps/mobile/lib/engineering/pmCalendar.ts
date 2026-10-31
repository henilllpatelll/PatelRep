/* ─── PM week / month grouping ──────────────────────────────────────────────
   Pure date maths over the already-normalised schedule views (see pmSchedules.ts). Every date here is a hotel-local
   calendar day key (YYYY-MM-DD) - never an instant - so a schedule lands on the same day the engineer sees on the
   wall, regardless of the phone's zone, and a DST change or month/year boundary cannot shift it.

   Only real schedule data is placed on the calendar: one marker per schedule at its `next_due_at` day. The API does
   not project future recurrences, so none are invented here. Weeks start on Monday. */

import { addDaysToYmd } from "@/lib/housekeeping/hotelTime";
import type { PmScheduleView } from "./pmSchedules";

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function weekStartOf(dateKey: string): string {
  return addDaysToYmd(dateKey, -weekdayIndex(dateKey));
}

export function weekDayKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToYmd(weekStart, i));
}

export interface PmDayBucket {
  dateKey: string;
  schedules: PmScheduleView[];
  isToday: boolean;
}

export interface PmWeekPlan {
  weekStart: string;
  weekEnd: string;
  isCurrentWeek: boolean;
  /** Overdue work from before this week - shown only on the current week so it is never lost, never duplicated. */
  carriedOverdue: PmScheduleView[];
  days: PmDayBucket[];
  total: number;
}

/** Each schedule appears exactly once: on its due day if that is inside the week, or as carried overdue. */
export function planWeek(views: readonly PmScheduleView[], weekStart: string, today: string): PmWeekPlan {
  const keys = weekDayKeys(weekStart);
  const weekEnd = keys[6];
  const isCurrentWeek = today >= weekStart && today <= weekEnd;
  const byDay = new Map<string, PmScheduleView[]>(keys.map((k) => [k, []]));
  const carriedOverdue: PmScheduleView[] = [];
  for (const view of views) {
    if (!view.dueDate) continue;
    if (byDay.has(view.dueDate)) byDay.get(view.dueDate)!.push(view);
    else if (isCurrentWeek && view.dueDate < weekStart) carriedOverdue.push(view);
  }
  const days = keys.map((dateKey) => ({ dateKey, schedules: byDay.get(dateKey)!, isToday: dateKey === today }));
  const total = carriedOverdue.length + days.reduce((sum, day) => sum + day.schedules.length, 0);
  return { weekStart, weekEnd, isCurrentWeek, carriedOverdue, days, total };
}

/**
 * "This week" for the summary cards: due from today through the end of the current Monday-Sunday week. It includes today
 * and excludes overdue work (counted separately), so Overdue + This Week never double-counts a schedule. Today's items
 * are therefore also part of "This week" - the cards are three independent questions, not slices of one pie.
 */
export function countThisWeek(views: readonly PmScheduleView[], today: string): number {
  const end = addDaysToYmd(weekStartOf(today), 6);
  return views.filter((v) => v.dueDate != null && v.dueDate >= today && v.dueDate <= end).length;
}

export interface PmMonthCell {
  dateKey: string;
  inMonth: boolean;
}

/** Monday-first grid of whole weeks covering `monthKey` (YYYY-MM). */
export function monthGrid(monthKey: string): PmMonthCell[][] {
  const first = `${monthKey}-01`;
  const start = weekStartOf(first);
  const rows: PmMonthCell[][] = [];
  for (let cursor = start; ; cursor = addDaysToYmd(cursor, 7)) {
    const row = weekDayKeys(cursor).map((dateKey) => ({ dateKey, inMonth: dateKey.slice(0, 7) === monthKey }));
    if (!row.some((cell) => cell.inMonth)) break;
    rows.push(row);
    if (rows.length >= 6) break;
  }
  return rows;
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface PmDayMarker {
  count: number;
  overdue: boolean;
}

/** Marker per day. A day with several tasks is one dot plus a count, so a busy day stays readable on a small phone. */
export function dayMarkers(views: readonly PmScheduleView[]): Map<string, PmDayMarker> {
  const markers = new Map<string, PmDayMarker>();
  for (const view of views) {
    if (!view.dueDate) continue;
    const marker = markers.get(view.dueDate) ?? { count: 0, overdue: false };
    marker.count += 1;
    marker.overdue = marker.overdue || view.state === "overdue";
    markers.set(view.dueDate, marker);
  }
  return markers;
}

export function schedulesOnDay(views: readonly PmScheduleView[], dateKey: string): PmScheduleView[] {
  return views.filter((v) => v.dueDate === dateKey);
}
