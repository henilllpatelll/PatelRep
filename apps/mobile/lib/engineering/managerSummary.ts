/* ─── Team Work summary (chief engineer / GM) ───────────────────────────────
   The Needs owner · In progress · Waiting tiles above the manager's queues. The numbers are the server's exact
   counts from GET /engineering/team/overview (never the rows that happen to be loaded), and each one is defined to
   match the queue it opens, so the tile and the list agree. A count the server did not give is unknown, never zero.

   Overdue is deliberately not a tile: the list's overdue filter and the team overview disagree about held work, so a
   tile would not match what it opens. Overdue and urgent work stays in the Team Overview's attention list. */

import type { TeamCounts } from "@/lib/api/engineeringTeam";
import { canViewTeamWork, type QueueFilters, type QueueView, EMPTY_FILTERS } from "@/lib/engineering/workQueue";

export const MANAGER_SUMMARY_KEYS = ["needsOwner", "inProgress", "waiting"] as const;
export type ManagerSummaryKey = (typeof MANAGER_SUMMARY_KEYS)[number];

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Views a manager sees the tiles on; Done is history, so counts of current work do not belong there. */
const SUMMARY_VIEWS: readonly QueueView[] = ["team", "available", "waiting"];

export function showsManagerSummary(view: QueueView, role: string | null | undefined): boolean {
  return canViewTeamWork(role) && SUMMARY_VIEWS.includes(view);
}

/** The count a tile shows; null when the server did not give a well-formed number. */
export function managerSummaryCount(counts: TeamCounts | null | undefined, key: ManagerSummaryKey): number | null {
  if (!counts) return null;
  const value = key === "needsOwner" ? counts.needs_owner : key === "inProgress" ? counts.in_progress : counts.on_hold;
  return isCount(value) ? value : null;
}

/** Whether a tile's selection is what the queue is showing right now. */
export function isManagerSummaryActive(key: ManagerSummaryKey, view: QueueView, filters: QueueFilters): boolean {
  switch (key) {
    case "needsOwner":
      return view === "available";
    case "inProgress":
      return view === "team" && filters.statuses.length === 1 && filters.statuses[0] === "in_progress";
    case "waiting":
      return view === "waiting";
  }
}

export interface ManagerSummaryNavigation {
  view: QueueView;
  /** Replaces the filters of `view`; null leaves them as they are. */
  filters: QueueFilters | null;
}

/**
 * What pressing a tile does. Needs owner and Waiting open their queue; In progress narrows Team, and a second press
 * on it clears the narrowing (other Team filters stay).
 */
export function managerSummarySelection(key: ManagerSummaryKey, teamFilters: QueueFilters): ManagerSummaryNavigation {
  switch (key) {
    case "needsOwner":
      return { view: "available", filters: null };
    case "waiting":
      return { view: "waiting", filters: null };
    case "inProgress":
      return {
        view: "team",
        filters: isManagerSummaryActive("inProgress", "team", teamFilters) ? { ...teamFilters, statuses: [] } : { ...EMPTY_FILTERS, ...teamFilters, statuses: ["in_progress"] },
      };
  }
}
