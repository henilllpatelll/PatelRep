/* ─── PM top-level views ────────────────────────────────────────────────────
   Today | Plan | History. Plan holds the Week and Calendar subviews. Older deep links (`?view=week`, `?view=calendar`)
   still land on the right subview. */

export type PmView = "today" | "plan" | "history";
export type PmPlanMode = "week" | "calendar";

export const PM_VIEWS: readonly PmView[] = ["today", "plan", "history"];
export const PM_PLAN_MODES: readonly PmPlanMode[] = ["week", "calendar"];

export function parsePmNavigation(value: string | string[] | undefined): { view: PmView; plan: PmPlanMode } {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "week" || v === "calendar") return { view: "plan", plan: v };
  if (v === "plan" || v === "history") return { view: v, plan: "week" };
  return { view: "today", plan: "week" };
}
