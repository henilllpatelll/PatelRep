/* ─── PM management rules (pure) ────────────────────────────────────────────
   What the Chief Engineer's screens decide locally: how a refused write is explained, how a requested deferral date
   becomes an instant, how a count or rate is shown when it is unknown. The server enforces every rule; nothing here
   grants a permission. */

import { addDaysToYmd, hotelDateKey, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import type { PmWorkloadCard } from "@/lib/api/pmManagement";

export const DEFERRAL_REASON_MIN = 5;
export const DEFERRAL_REASON_MAX = 500;
export const CRITICALITY_REASON_MAX = 500;

export type ManagementFailure =
  /** Someone else changed the record since this screen loaded. */
  | { kind: "version_conflict" }
  | { kind: "schedule_inactive" }
  | { kind: "assignee_ineligible" }
  /** The person signed in asked for this deferral; someone else must decide it. */
  | { kind: "self_review" }
  | { kind: "already_decided" }
  | { kind: "stale" }
  | { kind: "expired" }
  | { kind: "pending_exists" }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "validation"; message: string | null }
  /** No answer: the write may or may not have landed. The caller must re-read before trying again. */
  | { kind: "unconfirmed" }
  | { kind: "failed" };

export function classifyManagementFailure(error: unknown): ManagementFailure {
  const e = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  const code = typeof e?.code === "string" ? e.code : null;
  if (status == null) {
    const message = typeof e?.message === "string" ? e.message : "";
    return /network request failed|failed to fetch|timed out|timeout|offline|aborted/i.test(message) ? { kind: "unconfirmed" } : { kind: "failed" };
  }
  switch (code) {
    case "version_conflict":
    case "asset_conflict":
      return { kind: "version_conflict" };
    case "schedule_inactive":
      return { kind: "schedule_inactive" };
    case "assignee_ineligible":
      return { kind: "assignee_ineligible" };
    case "self_review":
      return { kind: "self_review" };
    case "already_decided":
      return { kind: "already_decided" };
    case "stale":
      return { kind: "stale" };
    case "expired":
      return { kind: "expired" };
    case "assignment_unavailable":
    case "deferral_unavailable":
      return { kind: "unavailable" };
    default:
      break;
  }
  if (status === 401 || status === 403) return { kind: "forbidden" };
  if (status === 404) return { kind: "not_found" };
  // The deferral endpoint reports "already has a request awaiting review" as a plain 409 without a code.
  if (status === 409 && /awaiting review/i.test(typeof e?.message === "string" ? e.message : "")) return { kind: "pending_exists" };
  if (status === 400 || status === 422) return { kind: "validation", message: typeof e?.message === "string" ? e.message : null };
  return { kind: "failed" };
}

/** A failure that proves nothing changed on the server (the person may simply edit and try again). */
export function failureLeftNothingChanged(failure: ManagementFailure): boolean {
  return failure.kind !== "unconfirmed" && failure.kind !== "failed";
}

/* ── deferral request ── */

export interface DeferralDraft {
  reason: string;
  /** YYYY-MM-DD in the hotel's calendar. */
  requestedDate: string;
}

export type DeferralProblem = "reason_short" | "reason_long" | "date_missing" | "date_not_later" | "date_past";

/** Local checks only; the server re-checks all of them against the live schedule. */
export function validateDeferral(draft: DeferralDraft, currentDueAt: string | null, timezone: string | null | undefined, now: Date = new Date()): DeferralProblem[] {
  const problems: DeferralProblem[] = [];
  const reason = draft.reason.trim();
  if (reason.length < DEFERRAL_REASON_MIN) problems.push("reason_short");
  if (reason.length > DEFERRAL_REASON_MAX) problems.push("reason_long");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.requestedDate)) {
    problems.push("date_missing");
    return problems;
  }
  const today = hotelDateKey(now, timezone);
  const dueKey = hotelDateKey(currentDueAt, timezone);
  if (today && draft.requestedDate <= today) problems.push("date_past");
  else if (dueKey && draft.requestedDate <= dueKey) problems.push("date_not_later");
  return problems;
}

/** The instant a requested calendar date means: noon in the hotel, so no timezone can roll it onto a neighbouring day. */
export function deferralInstant(requestedDate: string, timezone: string | null | undefined): string | null {
  return zonedTimeToInstant(requestedDate, 12, 0, timezone)?.toISOString() ?? null;
}

/** The earliest date a deferral can ask for: the day after the later of today and the current due date. */
export function earliestDeferralDate(currentDueAt: string | null, timezone: string | null | undefined, now: Date = new Date()): string | null {
  const today = hotelDateKey(now, timezone);
  const due = hotelDateKey(currentDueAt, timezone);
  const base = [today, due].filter((k): k is string => !!k).sort().pop();
  return base ? addDaysToYmd(base, 1) : null;
}

/* ── numbers shown to a manager ── */

/** "67%" for a known rate, null when there is nothing to rate (never "0%" for no data). */
export function formatRate(rate: number | null | undefined): string | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return `${Math.round(rate * 100)}%`;
}

/** Most overdue first, then most assigned, then name; an assignee who is no longer eligible stays visible. */
export function sortWorkload(cards: readonly PmWorkloadCard[]): PmWorkloadCard[] {
  return [...cards].sort(
    (a, b) => b.overdue - a.overdue || b.assigned - a.assigned || (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export type CoverageHealth = "attention" | "ok" | "unknown";

/** Whether the coverage cards need action. Unknown (a failed read) is never "ok". */
export function coverageHealth(summary: { overdue: number; unassigned: number; pending_approvals: number } | null): CoverageHealth {
  if (!summary) return "unknown";
  return summary.overdue + summary.unassigned + summary.pending_approvals > 0 ? "attention" : "ok";
}
