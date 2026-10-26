import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { isUnassignedWork } from "@/lib/housekeeping/roomBoardSelectors";
import { assignmentBlock, removalBlock } from "@/lib/housekeeping/roomAssignment";

/* ─── Supervisor Assignments — room eligibility ─────────────────────────────
   Pure: no React, no I/O. Answers ONE question per room — "what may a supervisor do with this room's
   assignment right now, and what must they be told first?" — on top of the rules the Room Board already
   enforces (`assignmentBlock` / `removalBlock` in roomAssignment.ts). It adds no second opinion about the
   room's stage: a stage that blocks on the Room Board blocks here.

   HARD blocks — the normal flow refuses (assign, reassign and remove all stay off):
     in_progress          being cleaned right now; its session belongs to the cleaner
     awaiting_inspection  housekeeping submitted it
     guest_ready          already inspected
     out_of_service       OOO / out of order / out of service
     unknown_status       a status this app does not recognise — never guessed at

   SOFT blocks — the room still needs cleaning, but sending a person in is a decision, not a default:
     service_declined     the guest declined housekeeping for this stay
     return_later         a "return later" time is recorded and has not arrived yet
     dnd                  do-not-disturb is on
     occupancy_discrepancy  front desk and housekeeping disagree about whether the room is occupied
   A soft-blocked room can be assigned only with an explicit acknowledgement, and bulk assignment / Smart
   Balance never picks it up on their own (`autoAssignable`).

   NEEDING ATTENTION IS NOT BEING REASSIGNABLE. An in-progress room nobody owns still "needs an owner"
   (`needsAssignee`, the same definition Supervisor Today counts), yet the normal flow cannot hand it to
   anyone (`canAssign` false). Callers must not conflate the two. */

export type HardBlock = "in_progress" | "awaiting_inspection" | "guest_ready" | "out_of_service" | "unknown_status";
export type SoftBlock = "service_declined" | "return_later" | "dnd" | "occupancy_discrepancy";
export type AssignabilityKind = "eligible" | HardBlock | SoftBlock;

/** Order in which soft blocks are reported; the first is the room's primary kind. */
const SOFT_ORDER: readonly SoftBlock[] = ["service_declined", "return_later", "dnd", "occupancy_discrepancy"];

export interface RoomEligibility {
  /** The one reason that best describes the room; `eligible` when nothing stands in the way. */
  kind: AssignabilityKind;
  hardBlock: HardBlock | null;
  /** Every soft block that applies, in `SOFT_ORDER`. Always empty when a hard block applies (it dominates). */
  softBlocks: SoftBlock[];
  /** The recorded return time while it is still in the future; null otherwise. */
  returnLaterUntil: string | null;
  /** Nobody owns it and no hard block applies. May still need `requiresAcknowledgement`. */
  canAssign: boolean;
  /** Somebody owns it and no hard block applies. */
  canReassign: boolean;
  /** There is an assignment to remove and no hard block applies. */
  canRemove: boolean;
  /** Soft blocks the supervisor must knowingly override to assign or reassign this room. */
  requiresAcknowledgement: SoftBlock[];
  /** Bulk assignment and Smart Balance may propose this room without asking: unowned, to clean, nothing soft. */
  autoAssignable: boolean;
  /** In-service work with no owner — Supervisor Today's "unassigned" definition (includes an unowned in-progress room). */
  needsAssignee: boolean;
}

function hardBlockOf(room: Pick<BoardRoom, "statusInfo">): HardBlock | null {
  const block = assignmentBlock(room);
  if (block === null) return null;
  return block === "unavailable" ? "out_of_service" : block;
}

/** A return time that exists and has not arrived yet. A time already past, or unparseable, blocks nothing. */
function pendingReturnTime(room: Pick<BoardRoom, "returnLaterAt">, now: number): string | null {
  if (!room.returnLaterAt) return null;
  const at = Date.parse(room.returnLaterAt);
  return Number.isNaN(at) || at <= now ? null : room.returnLaterAt;
}

export function evaluateEligibility(room: BoardRoom, now: number): RoomEligibility {
  const hardBlock = hardBlockOf(room);
  const returnLaterUntil = hardBlock ? null : pendingReturnTime(room, now);
  const softBlocks: SoftBlock[] = [];
  if (!hardBlock) {
    const present: Record<SoftBlock, boolean> = {
      service_declined: room.serviceDeclined.declined,
      return_later: returnLaterUntil !== null,
      dnd: room.dnd,
      occupancy_discrepancy: room.occupancyDiscrepancy,
    };
    for (const block of SOFT_ORDER) if (present[block]) softBlocks.push(block);
  }
  const owned = room.assignment.source !== "none";
  const removable = removalBlock(room) === null;
  return {
    kind: hardBlock ?? softBlocks[0] ?? "eligible",
    hardBlock,
    softBlocks,
    returnLaterUntil,
    canAssign: hardBlock === null && !owned,
    canReassign: hardBlock === null && owned,
    canRemove: removable,
    requiresAcknowledgement: softBlocks,
    autoAssignable: hardBlock === null && !owned && softBlocks.length === 0,
    needsAssignee: isUnassignedWork(room),
  };
}

/** Whether the room may be the target of the given workflow (acknowledgement, if any, is a separate step). */
export function mayAssign(eligibility: RoomEligibility): boolean {
  return eligibility.canAssign || eligibility.canReassign;
}
