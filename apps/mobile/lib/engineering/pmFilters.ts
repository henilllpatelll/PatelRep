/* ─── PM search, filter and sort ────────────────────────────────────────────
   GET /assets/pm-schedules returns every active schedule in one response (no paging), so filtering here is over the
   complete dataset - it can never silently cover only a first page. Filters are limited to what the row really carries:
   the API has no technician assignment (only `assigned_to_role`) and the asset category/location come from the joined
   asset. Anything it cannot answer is simply not offered. */

import type { PmScheduleRow } from "@/lib/api/assets";
import type { PmDueState, PmScheduleView } from "./pmSchedules";

export type PmSort = "due_soonest" | "most_overdue" | "equipment";
export type PmFrequency = NonNullable<PmScheduleRow["interval_type"]>;

export interface PmFilterState {
  query: string;
  /** Empty = every state. */
  states: readonly PmDueState[];
  /** Empty = every frequency. */
  frequencies: readonly PmFrequency[];
  /** Asset category name; null = any. */
  category: string | null;
  sort: PmSort;
}

export const DEFAULT_PM_FILTERS: PmFilterState = { query: "", states: [], frequencies: [], category: null, sort: "due_soonest" };

export function activeFilterCount(filters: PmFilterState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    (filters.states.length ? 1 : 0) +
    (filters.frequencies.length ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.sort !== DEFAULT_PM_FILTERS.sort ? 1 : 0)
  );
}

function haystack(view: PmScheduleView): string {
  return [view.name, view.description, view.assetName, view.assetTag, view.location, view.roomNumber, view.categoryName, view.manufacturer]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesQuery(view: PmScheduleView, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(view);
  return terms.every((term) => text.includes(term));
}

export function categoriesOf(views: readonly PmScheduleView[]): string[] {
  return [...new Set(views.map((v) => v.categoryName).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
}

function compareDue(a: PmScheduleView, b: PmScheduleView): number {
  if (a.daysUntilDue == null && b.daysUntilDue == null) return a.name.localeCompare(b.name);
  if (a.daysUntilDue == null) return 1;
  if (b.daysUntilDue == null) return -1;
  return a.daysUntilDue - b.daysUntilDue || a.name.localeCompare(b.name);
}

export function applyPmFilters(views: readonly PmScheduleView[], filters: PmFilterState): PmScheduleView[] {
  const kept = views.filter(
    (v) =>
      matchesQuery(v, filters.query) &&
      (filters.states.length === 0 || filters.states.includes(v.state)) &&
      (filters.frequencies.length === 0 || (v.intervalType != null && filters.frequencies.includes(v.intervalType))) &&
      (!filters.category || v.categoryName === filters.category),
  );
  switch (filters.sort) {
    case "equipment":
      return kept.sort((a, b) => (a.assetName ?? "~").localeCompare(b.assetName ?? "~") || compareDue(a, b));
    case "most_overdue":
      // Overdue first, longest overdue at the top; everything else after, soonest first.
      return kept.sort((a, b) => {
        const ao = a.state === "overdue";
        const bo = b.state === "overdue";
        if (ao !== bo) return ao ? -1 : 1;
        return compareDue(a, b);
      });
    default:
      return kept.sort(compareDue);
  }
}

/** The Today view: overdue work first (longest overdue on top), then what is due today. */
export function todaySections(views: readonly PmScheduleView[]): { overdue: PmScheduleView[]; dueToday: PmScheduleView[]; next: PmScheduleView[] } {
  const sorted = [...views].sort(compareDue);
  return {
    overdue: sorted.filter((v) => v.state === "overdue"),
    dueToday: sorted.filter((v) => v.state === "due_today"),
    next: sorted.filter((v) => v.state === "due_soon"),
  };
}

export interface PmTodayPlan {
  /** Schedules with a real saved draft. Listed only here, never again below. */
  continueWork: PmScheduleView[];
  needsAttention: PmScheduleView[];
  dueToday: PmScheduleView[];
  comingUp: PmScheduleView[];
}

/**
 * The Today worklist. Each schedule lands in exactly one section: a saved draft wins (so the person resumes it), then
 * overdue (most overdue first), due today, and a short look ahead. Overdue work is never also "due today".
 */
export function todayPlan(views: readonly PmScheduleView[], draftIds: ReadonlySet<string>): PmTodayPlan {
  const sorted = [...views].sort(compareDue);
  const rest = sorted.filter((v) => !draftIds.has(v.id));
  return {
    continueWork: sorted.filter((v) => draftIds.has(v.id)),
    needsAttention: rest.filter((v) => v.state === "overdue"),
    dueToday: rest.filter((v) => v.state === "due_today"),
    comingUp: rest.filter((v) => v.state === "due_soon"),
  };
}
