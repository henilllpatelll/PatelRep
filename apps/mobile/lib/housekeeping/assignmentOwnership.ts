import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";

/* ─── Supervisor Assignments — who owns a room ──────────────────────────────
   Pure. Ownership is ONE fact — "this room is tied to this user id" — read from the Room Board's
   `BoardRoom.assignment` (a dated `room_assignments` row, else the `room_status.assigned_to` mirror). This
   module adds no second ownership model; it only answers three questions about it:

     1. Is the room assigned?          `assigned`   — true whenever a user id is present
     2. Do we know the person's name?  `name`       — only from a verified staff list; null otherwise
     3. What must a write assert?      `expected`   — the compare-and-set fields the API understands

   A missing name NEVER means "unassigned": an owner the staff list cannot name (deactivated, not listed,
   or the list failed to load) is shown as an unknown person, and the room still counts as assigned. */

export type OwnerSource = "none" | "dated" | "status_mirror";

/** The conditional fields of POST /housekeeping/assignments (see `AssignmentInput`). */
export type ExpectedOwner = { expect_unassigned: true } | { expected_assigned_to: string };

export interface RoomOwnership {
  source: OwnerSource;
  /** True whenever a user id is present, whether or not it can be named. */
  assigned: boolean;
  userId: string | null;
  /** The dated assignment's id (needed to delete it); null for a mirror-only or absent assignment. */
  assignmentId: string | null;
  assignmentDate: string | null;
  /** A verified staff list names this person. */
  name: string | null;
  /** The staff list was available (verified or last-known) when this was resolved. */
  staffListKnown: boolean;
  /** Assigned to someone the staff list does not contain (or has no usable name for). */
  unlisted: boolean;
  /** What a write must assert about the current owner so it cannot silently overwrite a newer one. */
  expected: ExpectedOwner;
}

/** A usable display name: non-empty after trimming and not the "—" placeholder the staff normaliser emits. */
export function usableName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? "";
  return trimmed && trimmed !== "—" ? trimmed : null;
}

/**
 * `nameById` is null when the staff list is unavailable (never loaded or failed): then every owner is
 * an unknown person, and nothing is called "unlisted" because the list cannot say.
 */
export function resolveOwnership(
  room: Pick<BoardRoom, "assignment">,
  nameById: ReadonlyMap<string, string> | null,
): RoomOwnership {
  const { assignment } = room;
  const userId = assignment.userId;
  const staffListKnown = nameById !== null;
  const name = userId && nameById ? usableName(nameById.get(userId)) : null;
  return {
    source: assignment.source,
    assigned: userId !== null,
    userId,
    assignmentId: assignment.assignmentId,
    assignmentDate: assignment.assignmentDate,
    name,
    staffListKnown,
    unlisted: userId !== null && staffListKnown && name === null,
    expected: expectedOwnerOf(userId),
  };
}

/** Unassigned rooms assert "still unassigned"; assigned rooms assert the owner the supervisor saw. */
export function expectedOwnerOf(userId: string | null): ExpectedOwner {
  return userId ? { expected_assigned_to: userId } : { expect_unassigned: true };
}

/** The id an `ExpectedOwner` asserts, or null for "unassigned". */
export function expectedOwnerId(expected: ExpectedOwner): string | null {
  return "expected_assigned_to" in expected ? expected.expected_assigned_to : null;
}

/** Whether the room's current owner is still the one the write was prepared against. */
export function ownerUnchanged(room: Pick<BoardRoom, "assignment">, expected: ExpectedOwner): boolean {
  return room.assignment.userId === expectedOwnerId(expected);
}
