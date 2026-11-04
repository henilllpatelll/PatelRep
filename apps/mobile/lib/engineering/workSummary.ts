/* ─── My Work summary ───────────────────────────────────────────────────────
   The Urgent / In progress / Waiting tiles at the top of My Work. The numbers come from the server
   (GET /work-orders/summary counts the caller's own active work exactly), never from the rows that happen to
   be loaded, so a long queue cannot produce a misleading figure. A number that is unknown is shown as unknown.

   Each tile is a shortcut into the same filter model the list already uses, so what it opens is what it counted. */

import { EMPTY_FILTERS, type QueueFilters, type QueueView } from "@/lib/engineering/workQueue";

export interface WorkSummary {
  urgent: number;
  inProgress: number;
  waiting: number;
  /** Every active order assigned to the caller, on-hold included. Absent from an older server. */
  total?: number;
}

export const SUMMARY_KEYS = ["urgent", "inProgress", "waiting"] as const;
export type SummaryKey = (typeof SUMMARY_KEYS)[number];

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Accepts only a well-formed answer; anything else is "unknown" (null), never zero. */
export function parseWorkSummary(raw: unknown): WorkSummary | null {
  const data = raw as { urgent?: unknown; in_progress?: unknown; waiting?: unknown; total?: unknown } | null | undefined;
  if (!data || !isCount(data.urgent) || !isCount(data.in_progress) || !isCount(data.waiting)) return null;
  const summary: WorkSummary = { urgent: data.urgent, inProgress: data.in_progress, waiting: data.waiting };
  if (isCount(data.total)) summary.total = data.total;
  return summary;
}

/** The count a tile shows; null when unknown. */
export function summaryCount(summary: WorkSummary | null, key: SummaryKey): number | null {
  return summary ? summary[key] : null;
}

/** Whether a tile's selection is currently applied to My Work (Waiting opens another view, so it never is). */
export function isSummaryActive(key: SummaryKey, filters: QueueFilters): boolean {
  switch (key) {
    case "urgent":
      return filters.urgentOnly;
    case "inProgress":
      return filters.statuses.length === 1 && filters.statuses[0] === "in_progress";
    case "waiting":
      return false;
  }
}

export interface SummaryNavigation {
  /** The view to show. */
  view: QueueView;
  /** The filters to apply to that view. */
  filters: QueueFilters;
}

/**
 * What pressing a tile does. Urgent and In progress narrow My Work (pressing again clears them, other filters
 * stay); Waiting opens the on-hold view narrowed to the person's own held work.
 */
export function summarySelection(key: SummaryKey, mineFilters: QueueFilters): SummaryNavigation {
  switch (key) {
    case "urgent":
      return {
        view: "mine",
        filters: mineFilters.urgentOnly ? { ...mineFilters, urgentOnly: false } : { ...mineFilters, urgentOnly: true, priority: null },
      };
    case "inProgress":
      return {
        view: "mine",
        filters: isSummaryActive("inProgress", mineFilters) ? { ...mineFilters, statuses: [] } : { ...mineFilters, statuses: ["in_progress"] },
      };
    case "waiting":
      return { view: "waiting", filters: { ...EMPTY_FILTERS, assignment: "mine" } };
  }
}
