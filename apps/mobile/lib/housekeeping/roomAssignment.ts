import type { BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { planAssignmentRemoval } from "@/lib/housekeeping/roomBoardModel";
import { selectAvailableStaff } from "@/lib/housekeeping/roomBoardSelectors";
import type { BoardStaffMember, RosterTrust } from "@/lib/housekeeping/roomBoardState";
import { MAX_SHIFT_MINUTES } from "@/lib/housekeeping/supervisor";
import type { StaffAvailability } from "@/lib/housekeeping/supervisorTeam";

/* ─── Room assignment — rules, workload and outcomes ────────────────────────
   Pure: no React, no I/O. Everything the assignment drawer shows or decides is derived here from the verified
   Room Board model (`BoardRoom`s + `BoardStaffMember`s), so the picker, the review step and the tests cannot
   disagree.

   WHAT THIS NEVER DOES
   - It never reads attendance from assignments: an employee is "on shift" only when the VERIFIED roster says so
     (`BoardStaffMember.availability`); otherwise it is `unknown`, and the drawer says so.
   - It never invents a duration. A room's estimate is a learned figure for its room/clean type or the room
     type's configured minutes; a room with neither has NO estimate, and a total that needs it is withheld
     (`roomsWithoutEstimate`), never padded with a default.
   - It never caps a total. `remainingMinutes` is the real sum; "overloaded" compares it to a working day.
   - It never claims a check guarantees the write cannot race: the server upserts, so `detectConflict` narrows the
     window (it compares a fresh read to what the supervisor reviewed) but cannot close it. */

/* ─── Eligibility ─────────────────────────────────────────────────────────── */

export type AssignmentIntent = "assign" | "reassign";

/** Why a room cannot be assigned or reassigned right now. */
export type AssignmentBlock = "in_progress" | "awaiting_inspection" | "guest_ready" | "unavailable" | "unknown_status";

const BLOCK_BY_STAGE: Record<string, AssignmentBlock | null> = {
  to_clean: null,
  in_progress: "in_progress",
  awaiting_inspection: "awaiting_inspection",
  guest_ready: "guest_ready",
  unavailable: "unavailable",
  unknown: "unknown_status",
};

/**
 * Only a room that still needs cleaning and is not being cleaned may be (re)assigned. A room being cleaned has a
 * live session owned by its cleaner — moving it would hand the work to someone else mid-clean — and a submitted,
 * inspected or out-of-service room is not an unstarted assignment at all.
 */
export function assignmentBlock(room: Pick<BoardRoom, "statusInfo">): AssignmentBlock | null {
  const stage = room.statusInfo.stage;
  return stage in BLOCK_BY_STAGE ? BLOCK_BY_STAGE[stage] : "unknown_status";
}

/** The workflow the room needs right now: assign when nobody is tied to it, reassign when somebody is. */
export function intentFor(room: Pick<BoardRoom, "assignment">): AssignmentIntent {
  return room.assignment.source === "none" ? "assign" : "reassign";
}

/** Removal follows the same rule as reassignment, and there must be something to remove. */
export function removalBlock(room: Pick<BoardRoom, "statusInfo" | "roomId" | "assignment">): AssignmentBlock | "nothing_to_remove" | null {
  if (planAssignmentRemoval(room).kind === "none") return "nothing_to_remove";
  return assignmentBlock(room);
}

/* ─── Estimates & workload ────────────────────────────────────────────────── */

export type EstimateBasis = "history" | "room_type";

export interface RoomEstimate {
  minutes: number;
  basis: EstimateBasis;
}

/** Looks up a learned figure for a room-type code and clean type, or null. Injected so this module stays pure. */
export type LearnedLookup = (roomTypeCode: string | null, cleanType: string | null) => { minutes: number } | null;

/**
 * An estimate for one room, or null when there is none. It follows the order the rest of the app uses
 * (`resolveEstimate`): this hotel's learned figure for the room type + clean type (never for a stayover pickup),
 * then the room type's configured minutes. Unlike `resolveEstimate` it does NOT fall back to a general default —
 * a made-up figure would be summed into a workload total that looks measured.
 */
export function estimateRoom(room: BoardRoom, learned?: LearnedLookup): RoomEstimate | null {
  if (room.status !== "PICKUP" && learned) {
    const found = learned(room.roomType, room.cleanType);
    if (found && Number.isFinite(found.minutes) && found.minutes > 0) return { minutes: Math.round(found.minutes), basis: "history" };
  }
  if (room.baseMinutes !== null && room.baseMinutes > 0) return { minutes: Math.round(room.baseMinutes), basis: "room_type" };
  return null;
}

export interface StaffWorkload {
  /** Rooms tied to this person today, whatever stage. */
  total: number;
  /** Submitted for inspection or inspected. */
  completed: number;
  inProgress: number;
  /** Rooms still to clean or being cleaned — what is left to do. */
  remainingRooms: number;
  /** The sum of the estimates that exist; a LOWER BOUND when `roomsWithoutEstimate > 0`. Never capped. */
  remainingMinutes: number;
  /** Remaining rooms with no estimate at all. */
  roomsWithoutEstimate: number;
  /** True when every remaining room has an estimate, so `remainingMinutes` is the whole estimate. */
  minutesComplete: boolean;
  /** Remaining work already exceeds a working day. Sound even for a lower bound. */
  overloaded: boolean;
}

export function buildWorkload(userId: string, rooms: readonly BoardRoom[], learned?: LearnedLookup): StaffWorkload {
  const workload: StaffWorkload = {
    total: 0,
    completed: 0,
    inProgress: 0,
    remainingRooms: 0,
    remainingMinutes: 0,
    roomsWithoutEstimate: 0,
    minutesComplete: true,
    overloaded: false,
  };
  for (const room of rooms) {
    if (room.assignment.userId !== userId) continue;
    workload.total += 1;
    const stage = room.statusInfo.stage;
    if (stage === "awaiting_inspection" || stage === "guest_ready") {
      workload.completed += 1;
      continue;
    }
    if (stage !== "to_clean" && stage !== "in_progress") continue;
    if (stage === "in_progress") workload.inProgress += 1;
    workload.remainingRooms += 1;
    const estimate = estimateRoom(room, learned);
    if (estimate) workload.remainingMinutes += estimate.minutes;
    else workload.roomsWithoutEstimate += 1;
  }
  workload.minutesComplete = workload.roomsWithoutEstimate === 0;
  workload.overloaded = workload.remainingMinutes > MAX_SHIFT_MINUTES;
  return workload;
}

/** The remaining-minutes figure to SHOW, or null when there is nothing honest to show (all remaining rooms lack one). */
export function shownMinutes(workload: StaffWorkload): number | null {
  if (workload.remainingRooms === 0) return 0;
  if (workload.roomsWithoutEstimate === workload.remainingRooms) return null;
  return workload.remainingMinutes;
}

export interface Projection {
  currentMinutes: number;
  roomMinutes: number;
  projectedMinutes: number;
  /** The projected total passes a working day. */
  overload: boolean;
}

/**
 * What adding (or moving) this room does to the receiver's remaining work. Null — omitted, not guessed — when
 * the room has no estimate or the person's current total is itself incomplete.
 */
export function projectAssignment(workload: StaffWorkload, room: RoomEstimate | null): Projection | null {
  if (!room || !workload.minutesComplete) return null;
  const projectedMinutes = workload.remainingMinutes + room.minutes;
  return {
    currentMinutes: workload.remainingMinutes,
    roomMinutes: room.minutes,
    projectedMinutes,
    overload: projectedMinutes > MAX_SHIFT_MINUTES,
  };
}

/* ─── Picker ──────────────────────────────────────────────────────────────── */

export type PickerFilter = "on_shift" | "all";

/** Why choosing this person needs an explicit acknowledgement, if it does. */
export type AckReason = "unverified" | "not_on_shift";

export interface PickerCandidate {
  userId: string;
  /** null = the staff list has no usable name for this id. */
  name: string | null;
  availability: StaffAvailability;
  workload: StaffWorkload;
  /** Floors of the rooms already assigned to them (known floors only), ascending. */
  floors: number[];
  /** Already this room's assignee: shown, not selectable. */
  isCurrent: boolean;
  ack: AckReason | null;
  projection: Projection | null;
}

export type PickerEmpty = "no_staff" | "no_on_shift" | "no_match" | null;

export interface PickerModel {
  filter: PickerFilter;
  candidates: PickerCandidate[];
  counts: { onShift: number; all: number };
  /** A verified roster exists: the "On shift" list is meaningful. */
  rosterVerified: boolean;
  empty: PickerEmpty;
}

function cleanName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed && trimmed !== "—" ? trimmed : null;
}

function floorsOf(userId: string, rooms: readonly BoardRoom[]): number[] {
  const floors = new Set<number>();
  for (const room of rooms) {
    if (room.assignment.userId === userId && room.floorKnown) floors.add(room.floor);
  }
  return [...floors].sort((a, b) => a - b);
}

export interface PickerInput {
  staff: readonly BoardStaffMember[];
  rosterTrust: RosterTrust;
  rooms: readonly BoardRoom[];
  /** The room being assigned. */
  room: BoardRoom;
  query: string;
  filter: PickerFilter;
  learned?: LearnedLookup;
}

export function buildPicker(input: PickerInput): PickerModel {
  const { staff, rosterTrust, rooms, room, learned } = input;
  const verified = rosterTrust === "verified";
  // With a verified roster "On shift" is the default pool; without one everyone is listed, unverified.
  const filter: PickerFilter = verified ? input.filter : "all";
  const { members: onShiftMembers } = selectAvailableStaff(staff, rosterTrust);
  const onShiftIds = new Set(verified ? onShiftMembers.map((member) => member.userId) : []);
  const roomEstimate = estimateRoom(room, learned);
  const needle = input.query.trim().toLowerCase();

  const all = staff.map<PickerCandidate>((member) => {
    const workload = buildWorkload(member.userId, rooms, learned);
    const isCurrent = room.assignment.userId === member.userId;
    return {
      userId: member.userId,
      name: cleanName(member.name),
      availability: verified ? member.availability : "unknown",
      workload,
      floors: floorsOf(member.userId, rooms),
      isCurrent,
      ack: !verified ? "unverified" : onShiftIds.has(member.userId) ? null : "not_on_shift",
      projection: isCurrent ? null : projectAssignment(workload, roomEstimate),
    };
  });

  // On shift first, then the least work left (an unknown total sorts after a known one), then name.
  const rank = (candidate: PickerCandidate) => (candidate.ack === null ? 0 : 1);
  const left = (candidate: PickerCandidate) => shownMinutes(candidate.workload) ?? Number.POSITIVE_INFINITY;
  all.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      left(a) - left(b) ||
      (a.name ?? "￿").localeCompare(b.name ?? "￿", undefined, { sensitivity: "base" }) ||
      a.userId.localeCompare(b.userId),
  );

  const counts = { onShift: all.filter((candidate) => candidate.ack === null).length, all: all.length };
  const pool = filter === "on_shift" ? all.filter((candidate) => candidate.ack === null) : all;
  const candidates = needle ? pool.filter((candidate) => candidate.name?.toLowerCase().includes(needle)) : pool;

  let empty: PickerEmpty = null;
  if (candidates.length === 0) {
    if (all.length === 0) empty = "no_staff";
    else if (needle) empty = "no_match";
    else if (filter === "on_shift") empty = "no_on_shift";
  }
  return { filter, candidates, counts, rosterVerified: verified, empty };
}

/* ─── Review ──────────────────────────────────────────────────────────────── */

export interface AssignmentReview {
  intent: AssignmentIntent;
  roomId: string;
  roomNumber: string;
  employeeId: string;
  employeeName: string | null;
  employeeAvailability: StaffAvailability;
  /** The person the room is moving away from (reassign); null for a first assignment. */
  previousId: string | null;
  previousName: string | null;
  cleanTypeLabel: string | null;
  estimate: RoomEstimate | null;
  projection: Projection | null;
  ack: AckReason | null;
}

export function buildReview(args: {
  room: BoardRoom;
  candidate: PickerCandidate;
  previousName: string | null;
  learned?: LearnedLookup;
}): AssignmentReview {
  const { room, candidate } = args;
  return {
    intent: intentFor(room),
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    employeeId: candidate.userId,
    employeeName: candidate.name,
    employeeAvailability: candidate.availability,
    previousId: room.assignment.userId,
    previousName: args.previousName,
    cleanTypeLabel: room.cleanTypeLabel,
    estimate: estimateRoom(room, args.learned),
    projection: candidate.projection,
    ack: candidate.ack,
  };
}

/* ─── Conflicts ───────────────────────────────────────────────────────────── */

export type ConflictKind = "room_missing" | "not_assignable" | "assignee_changed" | "already_assigned";

/**
 * Compares a FRESH read of the room with what the supervisor reviewed. This narrows the race window; it does not
 * remove it (the write is an upsert and carries no expected-assignee condition).
 *  - `expectedAssigneeId` null = the supervisor saw the room unassigned.
 *  - For a removal, `blockCheck` is false: the room's stage was already checked by `removalBlock` on the live view.
 */
export function detectConflict(
  fresh: BoardRoom | null | undefined,
  expectedAssigneeId: string | null,
  options: { forRemoval?: boolean; targetId?: string } = {},
): ConflictKind | null {
  if (!fresh) return "room_missing";
  if (assignmentBlock(fresh) !== null) return "not_assignable";
  const current = fresh.assignment.userId;
  if (current === expectedAssigneeId) return null;
  // The room is already where the supervisor is sending it: nothing to overwrite, and nothing to undo.
  if (!options.forRemoval && options.targetId && current === options.targetId) return "already_assigned";
  return "assignee_changed";
}

/* ─── Failures ────────────────────────────────────────────────────────────── */

export type AssignmentFailure =
  | "offline"
  | "permission"
  | "conflict"
  | "employee_ineligible"
  | "room_unavailable"
  | "save_failed"
  | "session"
  | "unknown_outcome";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

/**
 * Turns whatever a write threw into a reason the supervisor can act on.
 * `definite` is true only when the server ANSWERED with a client error (4xx): the write did not happen. A
 * network failure, a timeout or a 5xx may have happened anyway — those are `unknown_outcome` and must be checked
 * against the server before anyone retries.
 */
export function classifyFailure(error: unknown, isOnline = true): { failure: AssignmentFailure; definite: boolean } {
  if (!isOnline) return { failure: "offline", definite: true };
  const { status, code } = (error as { status?: unknown; code?: unknown } | null) ?? {};
  const message = messageOf(error);
  if (typeof status === "number") {
    if (status === 401 || status === 403) return { failure: "permission", definite: true };
    if (status === 409) return { failure: "conflict", definite: true };
    if (status === 404) {
      if (/housekeeper/i.test(message)) return { failure: "employee_ineligible", definite: true };
      if (/assignment/i.test(message)) return { failure: "conflict", definite: true };
      return { failure: "room_unavailable", definite: true };
    }
    if (status >= 400 && status < 500) return { failure: "save_failed", definite: true };
    return { failure: "unknown_outcome", definite: false };
  }
  if (/session expired/i.test(message) || code === "session_expired") return { failure: "session", definite: true };
  return { failure: "unknown_outcome", definite: false };
}

/** The server's current word on one room after an uncertain write. */
export type VerifiedOutcome = "applied" | "not_applied" | "unverifiable";

export function judgeOutcome(
  fresh: BoardRoom | null | undefined,
  expected: { kind: "assigned"; userId: string } | { kind: "unassigned" },
  priorAssigneeId: string | null,
): VerifiedOutcome {
  if (!fresh) return "unverifiable";
  const current = fresh.assignment.userId;
  if (expected.kind === "assigned") {
    if (current === expected.userId) return "applied";
    return current === priorAssigneeId ? "not_applied" : "unverifiable";
  }
  if (current === null) return "applied";
  return current === priorAssigneeId ? "not_applied" : "unverifiable";
}
