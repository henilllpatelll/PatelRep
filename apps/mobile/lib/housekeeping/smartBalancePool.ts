import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import type { AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import type { StaffPolicy } from "@/lib/housekeeping/smartBalancePolicy";

/* ─── Smart Balance — what may be planned, and who may receive it ───────────
   Pure. Smart Balance introduces NO second opinion about eligibility: a room is plannable exactly when the Phase 1
   `RoomEligibility` says nothing hard and nothing soft stands in its way, and a person is a receiver only when the
   Phase 1 team model says they are listed and their VERIFIED attendance (plus two stored property rules) allows it.

   THE THREE SCOPES
     unassigned     rooms nobody owns (the default). Every existing owner is left alone.
     all_unstarted  every room that still has to be cleaned, owned or not. Work being cleaned, submitted, inspected or
                    out of service is outside the pool and is never touched; its owners' workload still counts.
     selected       the rooms the supervisor selected, and only those. A selected room that is no longer plannable is
                    reported (not silently dropped, not silently added to).

   WHAT IS NEVER IN A POOL (and why it is reported as an exclusion, not hidden)
     soft-blocked rooms     DND, declined service, return-later, occupancy discrepancy: sending someone in is a decision
                            for the supervisor on that single room, and a bulk publication carries no acknowledgement.
     started work           being cleaned right now: the cleaner's session owns it. Counted, not listed one by one.
     one publication's limit  more than MAX_BATCH_CHANGES rooms: the first by priority are planned, the rest counted. */

export type SmartScope = "unassigned" | "all_unstarted" | "selected";

/** Why a room that might have been planned was not. `soft_blocked` carries the real blocks for the exceptions sheet. */
export type RoomExclusion =
  | { kind: "soft_blocked"; blocks: SoftBlock[] }
  /** Selected, but somebody owns it now (the supervisor chose it as unassigned work). */
  | { kind: "now_assigned"; ownerName: string | null }
  /** Selected, but it can no longer be planned (started, finished, out of service). */
  | { kind: "no_longer_plannable" }
  /** The server found the room different from what the app saw. */
  | { kind: "server"; reason: "not_found" | "not_assignable" | "room_blocked" | "owner_changed"; blocks?: string[] };

export interface ExcludedRoom {
  roomId: string;
  roomNumber: string;
  exclusion: RoomExclusion;
}

export interface SmartPool {
  rooms: AssignmentRoom[];
  excluded: ExcludedRoom[];
  /** Rooms being cleaned: protected, counted rather than listed. */
  protectedInProgress: number;
  /** In scope but beyond one publication's limit (planned in priority order, the rest left for the next run). */
  truncated: number;
  /** Rooms in scope that already have an owner and are NOT being moved (unassigned / selected scope). */
  preservedAssignments: number;
}

/** A room Smart Balance may propose: nothing hard, nothing soft. Ownership is a separate, scope-specific question. */
export function isPlannable(entry: AssignmentRoom): boolean {
  return entry.eligibility.hardBlock === null && entry.eligibility.softBlocks.length === 0 && entry.room.statusInfo.stage === "to_clean";
}

export function buildPool(model: AssignmentsModel, scope: SmartScope, selectedIds: ReadonlySet<string>): SmartPool {
  const entries = model.rooms ?? [];
  const rooms: AssignmentRoom[] = [];
  const excluded: ExcludedRoom[] = [];
  let protectedInProgress = 0;
  let preservedAssignments = 0;

  for (const entry of entries) {
    const { eligibility, ownership, room } = entry;
    const base = { roomId: room.roomId, roomNumber: room.roomNumber };
    const stage = room.statusInfo.stage;

    if (scope === "selected") {
      if (!selectedIds.has(room.roomId)) continue;
      if (isPlannable(entry) && !ownership.assigned) rooms.push(entry);
      else if (ownership.assigned && eligibility.hardBlock === null) excluded.push({ ...base, exclusion: { kind: "now_assigned", ownerName: ownership.name } });
      else if (eligibility.softBlocks.length > 0 && eligibility.hardBlock === null) excluded.push({ ...base, exclusion: { kind: "soft_blocked", blocks: [...eligibility.softBlocks] } });
      else excluded.push({ ...base, exclusion: { kind: "no_longer_plannable" } });
      continue;
    }

    if (stage === "in_progress") {
      protectedInProgress += 1;
      continue;
    }
    if (eligibility.hardBlock !== null || stage !== "to_clean") continue; // finished / awaiting inspection / out of service / unknown
    if (eligibility.softBlocks.length > 0) {
      excluded.push({ ...base, exclusion: { kind: "soft_blocked", blocks: [...eligibility.softBlocks] } });
      continue;
    }
    if (scope === "unassigned" && ownership.assigned) {
      preservedAssignments += 1;
      continue;
    }
    rooms.push(entry);
  }

  // The model is already in priority order; the cap keeps the most urgent rooms.
  const kept = rooms.slice(0, MAX_BATCH_CHANGES);
  return { rooms: kept, excluded, protectedInProgress, truncated: rooms.length - kept.length, preservedAssignments };
}

/* ─── Receivers ───────────────────────────────────────────────────────────── */

export type StaffExclusion =
  | "on_break"
  | "shift_ended"
  | "not_on_shift"
  | "attendance_unknown"
  /** The server found no capacity under the property's limits for any pool room. */
  | "no_capacity"
  /** The server did not accept this person as a housekeeper of this hotel. */
  | "not_eligible";

export interface ExcludedStaff {
  userId: string;
  name: string | null;
  reason: StaffExclusion;
}

export interface Receiver {
  member: AssignmentTeamMember;
  /** The property allowed this person through a rule that normally excludes them: the review will ask for an acknowledgement. */
  admittedDespite: "on_break" | "not_on_shift" | null;
}

export interface Receivers {
  receivers: Receiver[];
  excluded: ExcludedStaff[];
}

function exclusionFor(member: AssignmentTeamMember, policy: StaffPolicy): { excluded: StaffExclusion | null; admittedDespite: Receiver["admittedDespite"] } {
  switch (member.attendance) {
    case "on_shift":
      return { excluded: null, admittedDespite: null };
    case "on_break":
      return policy.avoidOnBreak ? { excluded: "on_break", admittedDespite: null } : { excluded: null, admittedDespite: "on_break" };
    case "shift_ended":
      return policy.excludeOffShift ? { excluded: "shift_ended", admittedDespite: null } : { excluded: null, admittedDespite: "not_on_shift" };
    case "scheduled_not_clocked_in":
    case "not_clocked_in":
      return policy.excludeOffShift ? { excluded: "not_on_shift", admittedDespite: null } : { excluded: null, admittedDespite: "not_on_shift" };
    default:
      // `unknown`: not evidence of availability, whatever the property stored.
      return { excluded: "attendance_unknown", admittedDespite: null };
  }
}

/** Everyone the verified staff list names, split into who may receive rooms and who may not (with the reason). */
export function buildReceivers(model: AssignmentsModel, policy: StaffPolicy): Receivers {
  const receivers: Receiver[] = [];
  const excluded: ExcludedStaff[] = [];
  const listed = [...(model.team ?? [])].filter((member) => member.listed).sort((a, b) => a.userId.localeCompare(b.userId));
  for (const member of listed) {
    const verdict = exclusionFor(member, policy);
    if (verdict.excluded) excluded.push({ userId: member.userId, name: member.name, reason: verdict.excluded });
    else receivers.push({ member, admittedDespite: verdict.admittedDespite });
  }
  return { receivers, excluded };
}

/* ─── Whether a plan can be asked for at all ──────────────────────────────── */

export type SmartUnavailable =
  | "board_unavailable"
  | "not_live"
  | "offline"
  | "staff_unavailable"
  | "attendance_unavailable"
  | "no_rooms"
  | "selection_empty"
  | "no_staff";

/**
 * The first reason a plan cannot be generated, or null. Order matters: the data problems come before the "nothing to
 * do" answers, so a failed roster is never reported as "no one is available".
 */
export function smartReadiness(args: {
  model: AssignmentsModel;
  gateAllowed: boolean;
  isOnline: boolean;
  scope: SmartScope;
  pool: SmartPool;
  receivers: Receivers;
}): SmartUnavailable | null {
  const { model, gateAllowed, isOnline, scope, pool, receivers } = args;
  if (!model.rooms || !model.team) return "board_unavailable";
  if (!isOnline) return "offline";
  if (!gateAllowed) return "not_live";
  if (!model.staffListKnown) return "staff_unavailable";
  if (model.rosterTrust !== "verified") return "attendance_unavailable";
  if (pool.rooms.length === 0) return scope === "selected" ? "selection_empty" : "no_rooms";
  if (receivers.receivers.length === 0) return "no_staff";
  return null;
}
