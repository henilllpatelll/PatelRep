/* ─── Work tab navigation ───────────────────────────────────────────────────
   Which queue views are primary tabs, which are secondary shortcuts, and where a role lands. Pure: the screen
   and header render the answer. What a role may *see* comes from `availableViews` (the server enforces it);
   this only decides how those views are presented.

   Primary tabs are the work a person acts on now. Waiting (on hold) and Done (history) stay one tap away as
   secondary shortcuts and are still reachable by deep link (`?view=waiting`, `?view=done`). */

import { availableViews, type QueueView } from "@/lib/engineering/workQueue";

export const SECONDARY_VIEWS: readonly QueueView[] = ["waiting", "done"];

export function isSecondaryView(view: QueueView): boolean {
  return SECONDARY_VIEWS.includes(view);
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
  return availableViews(role).filter(isSecondaryView);
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
