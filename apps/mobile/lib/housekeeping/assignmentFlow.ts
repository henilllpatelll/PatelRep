import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { AssignmentFailure } from "@/lib/housekeeping/roomAssignment";
import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";

/* ─── Supervisor Assignments — single-room write outcomes and conflicts ──────
   Pure. Turns what a write THREW into one of a few outcomes the sheet can word, and turns "the room changed
   while you were reviewing" into a view the supervisor can read — who had it, who has it now, what stage it is in.

   THE RULE THAT MATTERS: only an HTTP answer in the 4xx range proves the write did not happen. A dropped
   connection, a timeout or a 5xx may have been applied by the server anyway, so those are `unknown` and are
   resolved by READING the room back — never by sending the write a second time. */

export type ConflictReason =
  /** Someone else changed who owns the room (or removed the assignment). */
  | "assignee_changed"
  /** Cleaning started, the room was submitted, inspected or taken out of service. */
  | "not_assignable"
  /** A condition (DND, declined service, …) appeared that this review had not acknowledged. */
  | "acknowledgement_changed"
  /** The room left the board. */
  | "room_missing"
  /** The person chosen is no longer a listed housekeeper. */
  | "employee_unavailable";

export type WriteVerdict =
  | { kind: "definite"; failure: AssignmentFailure | "conflict"; conflict: ConflictReason | null }
  | { kind: "unknown" };

interface ErrorLike {
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

function messageOf(error: ErrorLike | null): string {
  return typeof error?.message === "string" ? error.message : "";
}

/**
 * Classifies a thrown write error. The caller has already refused to send while offline, so an error that carries
 * no HTTP status is a lost connection or a timeout: the server may have applied the write.
 */
export function classifyWrite(error: unknown): WriteVerdict {
  const info = (error as ErrorLike | null) ?? null;
  const status = typeof info?.status === "number" ? info.status : null;
  const code = typeof info?.code === "string" ? info.code : null;
  const message = messageOf(info);

  if (status === null) {
    if (/session expired/i.test(message) || code === "session_expired") return { kind: "definite", failure: "session", conflict: null };
    return { kind: "unknown" };
  }
  if (status === 401 || status === 403) return { kind: "definite", failure: "permission", conflict: null };
  if (status === 409) {
    if (code === "acknowledgement_required") return { kind: "definite", failure: "conflict", conflict: "acknowledgement_changed" };
    if (code === "room_not_assignable" || /no longer be assigned|being cleaned|is closed/i.test(message)) {
      return { kind: "definite", failure: "conflict", conflict: "not_assignable" };
    }
    return { kind: "definite", failure: "conflict", conflict: "assignee_changed" };
  }
  if (status === 404) {
    if (/housekeeper/i.test(message)) return { kind: "definite", failure: "employee_ineligible", conflict: "employee_unavailable" };
    if (/assignment/i.test(message)) return { kind: "definite", failure: "conflict", conflict: "assignee_changed" };
    return { kind: "definite", failure: "room_unavailable", conflict: "room_missing" };
  }
  if (status >= 400 && status < 500) return { kind: "definite", failure: "save_failed", conflict: null };
  return { kind: "unknown" };
}

/* ─── Conflict view ───────────────────────────────────────────────────────── */

export interface ConflictView {
  reason: ConflictReason;
  roomNumber: string;
  /** The owner the supervisor reviewed (null = they saw it unassigned). */
  previous: { userId: string | null; name: string | null };
  /** The owner now, from the newest verified board; `undefined` when the room is not on it. */
  current: { userId: string | null; name: string | null } | undefined;
  /** The room's stage now, when it matters ("cleaning started", "submitted for inspection", …). */
  stage: BoardRoom["statusInfo"]["stage"] | null;
}

export function buildConflictView(
  model: AssignmentsModel,
  input: { roomId: string; roomNumber: string; reason: ConflictReason; reviewedOwnerId: string | null },
): ConflictView {
  const nameOf = (userId: string | null): string | null => (userId ? ((model.team ?? []).find((member) => member.userId === userId)?.name ?? null) : null);
  const entry = (model.rooms ?? []).find((candidate) => candidate.room.roomId === input.roomId);
  return {
    reason: input.reason,
    roomNumber: entry?.room.roomNumber ?? input.roomNumber,
    previous: { userId: input.reviewedOwnerId, name: nameOf(input.reviewedOwnerId) },
    current: entry ? { userId: entry.ownership.userId, name: entry.ownership.name ?? nameOf(entry.ownership.userId) } : undefined,
    stage: entry ? entry.room.statusInfo.stage : null,
  };
}

/**
 * A conflict visible in the LIVE model while a review is open — before any write: the room left the board,
 * can no longer be changed, or belongs to somebody else than the supervisor reviewed.
 */
export function detectLiveConflict(
  model: AssignmentsModel,
  input: { roomId: string; reviewedOwnerId: string | null; targetUserId?: string | null },
): ConflictReason | null {
  const entry = (model.rooms ?? []).find((candidate) => candidate.room.roomId === input.roomId);
  if (!entry) return model.rooms === null ? null : "room_missing";
  if (entry.eligibility.hardBlock) return "not_assignable";
  if (entry.ownership.userId !== input.reviewedOwnerId) return "assignee_changed";
  if (input.targetUserId && !(model.team ?? []).some((member) => member.userId === input.targetUserId && member.listed)) return "employee_unavailable";
  return null;
}
