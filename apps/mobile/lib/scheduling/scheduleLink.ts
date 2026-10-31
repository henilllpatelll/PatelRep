import { canViewTeamSchedule } from "@/lib/scheduling/teamScheduleAccess";

/* Where a schedule notification may take the person. The payload is data from the network, so it is never used as a route:
   `screen` is matched against this closed list, every id must be a well-formed UUID, and a manager-only screen is offered
   to a manager only. The destination re-reads its record as the signed-in person, so a stale tap, a cancelled shift, another
   hotel's id or another account's message shows "no longer available" instead of someone else's data. */

export type ScheduleScreen = "my_schedule" | "offers" | "open_shifts" | "my_requests" | "team_requests" | "coverage";

export interface ScheduleTarget {
  screen: ScheduleScreen;
  pathname: string;
  params: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const MANAGER_ONLY: ReadonlySet<ScheduleScreen> = new Set(["team_requests", "coverage"]);
const PATHS: Record<ScheduleScreen, string> = {
  my_schedule: "/(app)/scheduling",
  offers: "/(app)/scheduling/offers",
  open_shifts: "/(app)/scheduling/offers",
  my_requests: "/(app)/scheduling/requests",
  team_requests: "/(app)/team-schedule/requests",
  coverage: "/(app)/team-schedule/coverage",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveScheduleTarget(data: unknown, role: string | null | undefined): ScheduleTarget | null {
  if (!data || typeof data !== "object" || !role) return null;
  const record = data as Record<string, unknown>;
  if (record.kind !== "schedule") return null;
  const screen = text(record.screen) as ScheduleScreen | null;
  if (!screen || !(screen in PATHS)) return null;
  if (MANAGER_ONLY.has(screen) && !canViewTeamSchedule(role)) return null;

  const params: Record<string, string> = {};
  const offerId = text(record.offer_id);
  if (offerId && UUID.test(offerId)) params.offerId = offerId.toLowerCase();
  const gapId = text(record.gap_id);
  if (gapId && UUID.test(gapId) && (screen === "coverage" || screen === "open_shifts")) params.gapId = gapId.toLowerCase();
  const swapId = text(record.swap_id) ?? text(record.request_id);
  if (swapId && UUID.test(swapId)) params.requestId = swapId.toLowerCase();
  const params2 = record.params && typeof record.params === "object" ? (record.params as Record<string, unknown>) : null;
  const firstDate = text(params2?.first_date) ?? text(params2?.work_date);
  // `YMD.test` is only the shape; My Schedule re-validates the calendar day and opens the current week for anything else.
  if (firstDate && YMD.test(firstDate) && screen === "my_schedule") params.date = firstDate;
  const assignmentId = text(record.assignment_id);
  if (assignmentId && UUID.test(assignmentId) && screen === "my_schedule") params.assignmentId = assignmentId.toLowerCase();
  if (screen === "open_shifts") params.tab = "open";
  if (screen === "offers") params.tab = "offers";
  if (screen === "coverage" && !params.gapId) return null; // coverage needs the gap it names
  return { screen, pathname: PATHS[screen], params };
}
