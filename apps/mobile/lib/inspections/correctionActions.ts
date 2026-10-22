import type { CorrectionActivity, InspectionCorrection } from "@/lib/api/inspections";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { correctionStage } from "@/lib/inspections/corrections";
import { readableActivity } from "@/lib/inspections/outcome";
import { statusOf } from "@/lib/housekeeping/roomPanelErrors";
import type { Translate } from "@/lib/inspections/viewText";

/* ─── Managing a correction: what failed, what to say, what may be offered (pure) ─── */

export type ActionFailure =
  /** The person cannot be given this correction (not active here, not a housekeeper / supervisor). */
  | "owner_ineligible"
  /** Somebody else changed it first (owner changed, finished, escalated). Reload before trying again. */
  | "correction_changed"
  /** A later inspection or a cancellation already settled it. */
  | "correction_closed"
  | "correction_missing"
  | "forbidden"
  | "not_found"
  /** No answer at all: the change may or may not have gone through. */
  | "no_response"
  | "server";

const KNOWN: ReadonlySet<string> = new Set(["owner_ineligible", "correction_changed", "correction_closed", "correction_missing"]);

export function classifyActionError(error: unknown): ActionFailure {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && KNOWN.has(code)) return code as ActionFailure;
  const status = statusOf(error);
  if (status === null) return "no_response";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "server";
}

/** A failure that means the screen's picture is out of date, so the caller should reload it. */
export function shouldReload(failure: ActionFailure): boolean {
  return failure === "correction_changed" || failure === "correction_closed" || failure === "not_found" || failure === "no_response";
}

/* ─── What the supervisor may do from the drawer ──────────────────────────── */

export interface DrawerActions {
  reassign: boolean;
  escalate: boolean;
  reinspect: boolean;
  repair: boolean;
}

/**
 * Only offered when the correction is open and the server would accept it. Escalating something already escalated, or
 * reassigning a settled correction, is not offered (and the server refuses it regardless).
 */
export function drawerActions(correction: Pick<InspectionCorrection, "status" | "room_status"> | null, roomAwaitingInspection: boolean): DrawerActions {
  const none: DrawerActions = { reassign: false, escalate: false, reinspect: false, repair: false };
  if (!correction) return none;
  const stage = correctionStage(correction.status);
  if (stage === "closed") return none;
  if (correction.status === "correction_missing") return { ...none, repair: true };
  const open = correction.status === "unassigned" || correction.status === "assigned" || correction.status === "in_progress" || correction.status === "escalated";
  return {
    reassign: open,
    escalate: open && correction.status !== "escalated",
    reinspect: stage === "awaiting_reinspection" && roomAwaitingInspection,
    repair: false,
  };
}

/* ─── The activity list ───────────────────────────────────────────────────── */

export interface ActivityLine {
  key: string;
  time: string;
  text: string;
}

/** "12:04 PM", "Inspection failed by Sam". Events with no readable time are left out rather than dated by guesswork. */
export function activityLines(activity: readonly CorrectionActivity[] | undefined, timeZone: string | null | undefined, language: string, t: Translate): ActivityLine[] {
  return readableActivity(activity).map((event, index) => {
    const actor = event.actor_name?.trim() || null;
    const assignee = event.assignee_name?.trim() || null;
    const time = formatHotelTime(new Date(event.atMs), timeZone, language) ?? "";
    const known = ACTIVITY_TYPES.has(event.type);
    const text = !known
      ? t("inspect.activity.other")
      : t(actor ? `inspect.activity.${event.type}_by` : `inspect.activity.${event.type}`, { actor, assignee: assignee ?? t("inspect.activity.someone") });
    return { key: `${event.type}-${event.atMs}-${index}`, time, text };
  });
}

const ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  "inspection_failed",
  "correction_created",
  "reassigned",
  "escalated",
  "work_started",
  "work_submitted",
  "task_completed",
  "reinspection_passed",
  "reinspection_failed",
]);

/** The "what happens next" line. It is a status, not an event: it carries no time. */
export function pendingStep(correction: Pick<InspectionCorrection, "status"> | null): "assign" | "work" | "reinspect" | null {
  if (!correction) return null;
  switch (correction.status) {
    case "correction_missing":
    case "unassigned":
      return "assign";
    case "assigned":
    case "in_progress":
    case "escalated":
      return "work";
    case "resubmitted":
      return "reinspect";
    default:
      return null;
  }
}
