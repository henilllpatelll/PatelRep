import type { CorrectionStatus, InspectionCorrection, PreviousFailure, ReadyRoom } from "@/lib/api/inspections";
import type { CorrectionKind } from "@/lib/inspections/types";

/* ─── Failed-inspection corrections and reinspection (pure) ──────────────────
   A failed inspection owns ONE correction task. Its journey, as the server reports it:

     correction_missing → the inspection is recorded but the task could not be created (needs repair)
     unassigned         → a task exists, nobody owns it
     assigned           → an owner is set. This is RESPONSIBILITY, not receipt: it does not mean they have seen it
     in_progress        → the owner started (task started / in progress)
     escalated          → the SLA ladder escalated it
     resubmitted        → corrected work was resubmitted; waiting for the supervisor to re-check
     verified           → a later passing inspection verified the room (final)
     superseded         → a newer failed inspection took over (final for this one)
     cancelled          → the task was cancelled without a passing re-check

   The room stays blocked from guest-ready release through all of it, until a passing reinspection. */

/** Where the supervisor's attention is needed. */
export type CorrectionStage =
  /** Something is wrong or stuck: unowned, missing, escalated, cancelled. */
  | "needs_action"
  /** With the housekeeper. */
  | "with_housekeeper"
  /** Done by the housekeeper; the supervisor must re-check. */
  | "awaiting_reinspection"
  /** Nothing left to do on this inspection. */
  | "closed";

export function correctionStage(status: CorrectionStatus): CorrectionStage {
  switch (status) {
    case "correction_missing":
    case "unassigned":
    case "escalated":
    case "cancelled":
      return "needs_action";
    case "assigned":
    case "in_progress":
      return "with_housekeeper";
    case "resubmitted":
      return "awaiting_reinspection";
    case "verified":
    case "superseded":
      return "closed";
  }
}

/** Statuses the supervisor can act on by (re)assigning, repairing or restarting the correction. */
export function canReassign(status: CorrectionStatus): boolean {
  return correctionStage(status) === "needs_action" || status === "assigned" || status === "in_progress";
}

/**
 * Has the owner actually acknowledged the work? Only evidence counts: the task started or progressed. Being assigned
 * is not acknowledgement, and the UI must not say "assigned to Hana" as if she knows.
 */
export function ownerAcknowledged(correction: Pick<InspectionCorrection, "task"> | null): boolean {
  const task = correction?.task;
  if (!task) return false;
  return Boolean(task.started_at) || task.status === "in_progress" || task.status === "completed";
}

/* ─── Reinspection ──────────────────────────────────────────────────────── */

export interface ReinspectionContext {
  /** True when this queue row is a re-check of an earlier failure. */
  isReinspection: boolean;
  failureInspectionId: string | null;
  kind: CorrectionKind | null;
  failedAt: string | null;
  /** Exactly what failed, in the words of the earlier inspection. */
  failedItems: { id: string | null; label: string; note: string | null }[];
  notes: string | null;
}

const NOT_A_REINSPECTION: ReinspectionContext = {
  isReinspection: false,
  failureInspectionId: null,
  kind: null,
  failedAt: null,
  failedItems: [],
  notes: null,
};

export function reinspectionContext(room: Pick<ReadyRoom, "previous_failure">): ReinspectionContext {
  const failure: PreviousFailure | null | undefined = room.previous_failure;
  // `conditional` (the legacy touch-up) blocks the room since migration 219, so it too is re-checked; the server only
  // sends this for a room that still has an open correction.
  if (!failure || (failure.overall_result !== "failed" && failure.overall_result !== "conditional")) return NOT_A_REINSPECTION;
  return {
    isReinspection: true,
    failureInspectionId: failure.inspection_id,
    kind: failure.correction_kind,
    failedAt: failure.inspected_at,
    failedItems: failure.items,
    notes: failure.notes,
  };
}

/**
 * May the supervisor re-check this room now? Only a room that is back in the awaiting-inspection queue (CLEAN) can be
 * inspected at all, and a room under correction is only re-checkable once the work was resubmitted — the housekeeper
 * putting it back to CLEAN is that resubmission. A correction that is merely assigned or in progress is not.
 */
export function canReinspect(input: {
  /** Whether the room is in the verified awaiting-inspection queue. */
  inQueue: boolean;
  /** The room's open correction, if the detail was loaded. null = unknown or none. */
  correction: Pick<InspectionCorrection, "status"> | null;
}): boolean {
  if (!input.inQueue) return false;
  if (!input.correction) return true;
  const stage = correctionStage(input.correction.status);
  return stage === "awaiting_reinspection" || stage === "closed";
}

/** Items to re-check first: the ones that failed, matched against the checklist by id (labels are display only). */
export function itemsToRecheck(context: ReinspectionContext): Set<string> {
  return new Set(context.failedItems.flatMap((item) => (item.id ? [item.id] : [])));
}
