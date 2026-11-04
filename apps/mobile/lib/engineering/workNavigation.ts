/* ─── Work tab navigation ───────────────────────────────────────────────────
   Which queue views are primary tabs, which are secondary shortcuts, and where a role lands. Pure: the screen
   and header render the answer. What a role may *see* comes from `availableViews` (the server enforces it);
   this only decides how those views are presented.

   Primary tabs are the work a person acts on now. Waiting (on hold) and Done (history) stay one tap away as
   secondary shortcuts and are still reachable by deep link (`?view=waiting`, `?view=done`). */

import { MY_JOBS_STATUSES } from "@/lib/engineering/homeContract";
import { EMPTY_FILTERS, availableViews, type QueueFilters, type QueueView } from "@/lib/engineering/workQueue";

export const SECONDARY_VIEWS: readonly QueueView[] = ["waiting", "done"];

/** Views with no tab or shortcut: reached only from a link (Home's Urgent) and left with Back, like a secondary view. */
export const LINK_ONLY_VIEWS: readonly QueueView[] = ["all"];

export function isSecondaryView(view: QueueView): boolean {
  return SECONDARY_VIEWS.includes(view) || LINK_ONLY_VIEWS.includes(view);
}

/**
 * Tabs shown in the header. A role with no My Work (the chief engineer) leads with Team, since managing the
 * team's queue is their primary job; everyone else keeps My Work first.
 */
export function primaryViews(role: string | null | undefined): QueueView[] {
  const views = availableViews(role).filter((view) => !isSecondaryView(view));
  if (!views.includes("mine") && views.includes("team")) return ["team", ...views.filter((view) => view !== "team")];
  return views;
}

export function secondaryViews(role: string | null | undefined): QueueView[] {
  return availableViews(role).filter((view) => SECONDARY_VIEWS.includes(view));
}

/** The Work screen a person lands on and the one "back" returns to. */
export function defaultView(role: string | null | undefined): QueueView {
  return primaryViews(role)[0] ?? "available";
}

export function isReachableView(value: unknown, role: string | null | undefined): value is QueueView {
  return typeof value === "string" && (availableViews(role) as string[]).includes(value);
}

/** A requested view (deep link, saved state) if this role can reach it; otherwise the role's default. */
export function resolveView(requested: unknown, role: string | null | undefined): QueueView {
  return isReachableView(requested, role) ? requested : defaultView(role);
}

/** The summary tiles describe the person's own assignments, so they exist only where My Work does. */
export function showsSummary(view: QueueView, role: string | null | undefined): boolean {
  return view === "mine" && availableViews(role).includes("mine");
}

/** Filters a link may ask a Work view to open with. Only values listed here are honoured. */
export const WORK_LINK_FILTERS = ["urgent", "in_progress"] as const;
export type WorkLinkFilter = (typeof WORK_LINK_FILTERS)[number];

export interface WorkLink {
  view: QueueView;
  /** Replaces that view's filters; null leaves whatever the person already set. */
  filters: QueueFilters | null;
}

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

/**
 * What a deep link / Home link to Work asks for, or null when it asks for nothing this role can open. An unknown or
 * unreachable view is ignored (never rewritten to a different queue), and an unknown filter is dropped while the
 * view still opens, so a malformed link can only ever land on a screen the person could reach by hand.
 */
export function resolveWorkLink(viewParam: unknown, filterParam: unknown, role: string | null | undefined): WorkLink | null {
  const view = first(viewParam);
  if (!isReachableView(view, role)) return null;
  const filter = first(filterParam);
  // `in_progress` is the manager's In Progress count: Team narrowed to that one status (the same selection the Work tile makes).
  const filters =
    filter === "urgent"
      ? { ...EMPTY_FILTERS, urgentOnly: true }
      : filter === "in_progress" && view === "team"
        ? { ...EMPTY_FILTERS, statuses: ["in_progress" as const] }
        : // `actionable` is Home's My Jobs count: my open, escalated and in-progress work (on-hold work is waiting).
          filter === "actionable" && view === "mine"
          ? { ...EMPTY_FILTERS, statuses: [...MY_JOBS_STATUSES] }
          : null;
  return { view, filters };
}
