import { isYmd } from "@/lib/scheduling/teamScheduleDates";
import { safeLinkId } from "@/lib/navigation/assignmentsLink";

/* ─── Team Schedule deep-link contract ──────────────────────────────────────
   What other screens (Supervisor Today, a notification, a typed link) may ask the Team Schedule to open.

     view    "today" | "week"   which view to show (default today)
     date    YYYY-MM-DD         the hotel-local day to select; omitted = follow the hotel's today
     userId  a person           opens that person's shift sheet once the schedule has loaded
     compose "add"              opens the Add shift form for `date` (nothing is saved until the supervisor saves it)

   Parameters are INTENT, never authority. The screen is supervisor-only, re-fetches everything as the signed-in
   user, and says so when the named person is not in this supervisor's schedule — a link can never show another
   hotel's or department's staff. Malformed values are dropped, not guessed at. */

export type TeamScheduleView = "today" | "week";

export interface TeamScheduleLink {
  view: TeamScheduleView;
  /** null = follow the hotel's current day. */
  date: string | null;
  userId: string | null;
  compose: "add" | null;
}

export interface TeamScheduleIntent {
  view?: TeamScheduleView;
  date?: string | null;
  userId?: string | null;
  compose?: "add";
}

function single(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : null;
}

/** The route params for an intent; empty when it asks for nothing usable. */
export function teamScheduleParams(intent: TeamScheduleIntent): Record<string, string> {
  const params: Record<string, string> = {};
  if (intent.view === "week") params.view = "week";
  if (isYmd(intent.date)) params.date = intent.date;
  const userId = safeLinkId(intent.userId);
  if (userId) params.userId = userId;
  if (intent.compose === "add") params.compose = "add";
  return params;
}

/** The route params, read back and validated. Always returns a link: no params means "today". */
export function parseTeamScheduleParams(raw: Record<string, unknown> | null | undefined): TeamScheduleLink {
  const view = single(raw?.view);
  const date = single(raw?.date);
  return {
    view: view === "week" ? "week" : "today",
    date: isYmd(date) ? date : null,
    userId: safeLinkId(raw?.userId),
    compose: single(raw?.compose) === "add" ? "add" : null,
  };
}
