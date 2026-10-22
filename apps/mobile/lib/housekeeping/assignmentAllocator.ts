import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { GATING_WARNINGS, contextFor } from "@/lib/housekeeping/assignmentPicker";
import { comparePriority } from "@/lib/housekeeping/assignmentPriority";
import type { AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import { projectPersonLoad } from "@/lib/housekeeping/assignmentWorkload";
import { floorKeyOf } from "@/lib/housekeeping/roomBoardFilters";

/* ─── Supervisor Assignments — manual bulk allocation ───────────────────────
   Pure and deterministic: the same rooms, people and board always give the same proposal, whatever order the
   caller passes things in. This is deliberately SIMPLE and EXPLAINABLE — it spreads work, it does not optimise it.
   The Smart Balance engine (a later phase) can replace `distribute` behind the same `AllocationProposal` shape;
   the supervisor can edit a proposal either way, and nothing here is saved.

   WHAT IT USES, AND WHAT IT REFUSES TO GUESS
   - Only people the verified staff list names (`member.listed`). An unknown id is reported, never assigned.
   - Existing workload: each person starts from the minutes they already have. Rooms WITHOUT an estimate are never
     counted as zero minutes: they add to the room count (so unknown-length rooms still spread out) and are
     reported as `missingEstimates`; they do not make a person look free.
   - Capacity: a person whose real configuration (credit target, scheduled shift time left) would be exceeded by
     a room is passed over while anyone else can take it. If everybody would exceed it the room still goes to
     someone — the review then shows the warning and asks for an acknowledgement; nothing is silently dropped.
   - Attendance is NOT a filter here: the supervisor chose these people. The review demands the acknowledgement
     (not clocked in, on break, unverified) per person, exactly as the single-room flow does.

   THE RULE FOR EACH ROOM, in priority order (critical rooms first; within one tier the longest known estimate
   first, so big rooms are placed while there is still room to balance):
     1. avoid a person the room would push over a real capacity limit
     2. a room WITH an estimate goes to the lowest projected known minutes (compared in 5-minute steps, so
        near-equal people tie); a room WITHOUT one goes to the person with the fewest rooms, because minutes cannot
        tell the people apart and an unknown room must not pile onto whoever looks "free"
     3. closest: already working this floor (now or earlier in this proposal), else this building
     4. the fewer rooms (or, for an unknown-length room, the lower known minutes)
     5. the person id — a final total order, so there are no random ties and the input order never matters. */

export type AllocationMode = "single" | "distribute";

/** Known minutes closer than this are a tie for step 2, so proximity can decide between near-equal people. */
const MINUTES_STEP = 5;

export interface AllocationInput {
  model: AssignmentsModel;
  /** The rooms to hand out (already checked eligible), in the model's priority order. */
  rooms: readonly AssignmentRoom[];
  /** The people the supervisor chose. `single` uses the first. */
  employeeIds: readonly string[];
  mode: AllocationMode;
}

export interface EmployeeShare {
  userId: string;
  roomIds: string[];
}

export interface AllocationProposal {
  /** room id → new owner, for every room that got one. */
  assignments: Record<string, string>;
  /** Per chosen person, in the order they were chosen; people who got nothing are present with no rooms. */
  shares: EmployeeShare[];
  /** Chosen ids the verified staff list does not contain (never assigned). */
  unresolved: string[];
  /** Rooms nobody could take (no resolvable person was chosen). */
  unallocated: string[];
  /** Rooms in this proposal that have no estimate. */
  missingEstimates: number;
}

interface Slot {
  member: AssignmentTeamMember;
  rooms: AssignmentRoom[];
  knownMinutes: number;
  floors: Set<string>;
  buildings: Set<string>;
}

function resolveMembers(model: AssignmentsModel, ids: readonly string[]): { members: AssignmentTeamMember[]; unresolved: string[] } {
  const members: AssignmentTeamMember[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const member = (model.team ?? []).find((candidate) => candidate.userId === id && candidate.listed);
    if (member) members.push(member);
    else unresolved.push(id);
  }
  return { members, unresolved };
}

/** Critical rooms first; inside a tier the longest KNOWN estimate first (unknown last); then the model's own order. */
function placementOrder(rooms: readonly AssignmentRoom[]): AssignmentRoom[] {
  const tierRank = new Map<string, number>();
  [...rooms].sort(comparePriority).forEach((entry) => {
    if (!tierRank.has(entry.priority.tier)) tierRank.set(entry.priority.tier, tierRank.size);
  });
  return [...rooms].sort(
    (a, b) =>
      (tierRank.get(a.priority.tier) ?? 0) - (tierRank.get(b.priority.tier) ?? 0) ||
      (b.estimate?.minutes ?? -1) - (a.estimate?.minutes ?? -1) ||
      comparePriority(a, b) ||
      a.room.roomId.localeCompare(b.room.roomId),
  );
}

function proximityRank(slot: Slot, entry: AssignmentRoom): number {
  if (entry.room.floorKnown && slot.floors.has(floorKeyOf(entry.room))) return 0;
  if (entry.room.building && slot.buildings.has(entry.room.building)) return 1;
  return 2;
}

function wouldExceed(model: AssignmentsModel, slot: Slot, entry: AssignmentRoom): boolean {
  const all = (model.rooms ?? []).map((item) => item.room);
  const after = projectPersonLoad(slot.member.userId, all, { add: [...slot.rooms.map((item) => item.room), entry.room] }, contextFor(model, slot.member));
  return after.warnings.some((warning) => GATING_WARNINGS.includes(warning));
}

export function proposeAllocation({ model, rooms, employeeIds, mode }: AllocationInput): AllocationProposal {
  const { members, unresolved } = resolveMembers(model, mode === "single" ? employeeIds.slice(0, 1) : employeeIds);
  const empty: AllocationProposal = { assignments: {}, shares: [], unresolved, unallocated: rooms.map((entry) => entry.room.roomId), missingEstimates: 0 };
  if (members.length === 0) return empty;

  const slots: Slot[] = members.map((member) => ({
    member,
    rooms: [],
    knownMinutes: member.load.minutes.remainingMinutes,
    floors: new Set<string>(),
    buildings: new Set(member.buildings),
  }));
  // A member records floor NUMBERS only; the floor key also carries the building, so a person's starting floors are
  // read from the rooms they already own.
  seedFloors(model, slots);

  const assignments: Record<string, string> = {};
  const ordered = mode === "single" ? [...rooms] : placementOrder(rooms);
  for (const entry of ordered) {
    let best: Slot = slots[0];
    if (mode === "distribute" && slots.length > 1) {
      const candidates = slots.map((slot) => ({
        slot,
        exceeds: wouldExceed(model, slot, entry) ? 1 : 0,
        minutes: Math.floor((slot.knownMinutes + (entry.estimate?.minutes ?? 0)) / MINUTES_STEP),
        proximity: proximityRank(slot, entry),
        count: slot.member.load.minutes.remainingRooms + slot.rooms.length,
      }));
      const unknown = entry.estimate === null;
      candidates.sort(
        (a, b) =>
          a.exceeds - b.exceeds ||
          (unknown ? a.count - b.count || a.minutes - b.minutes : a.minutes - b.minutes) ||
          a.proximity - b.proximity ||
          (unknown ? 0 : a.count - b.count) ||
          a.slot.member.userId.localeCompare(b.slot.member.userId),
      );
      best = candidates[0].slot;
    }
    best.rooms.push(entry);
    best.knownMinutes += entry.estimate?.minutes ?? 0;
    if (entry.room.floorKnown) best.floors.add(floorKeyOf(entry.room));
    if (entry.room.building) best.buildings.add(entry.room.building);
    assignments[entry.room.roomId] = best.member.userId;
  }

  return {
    assignments,
    shares: slots.map((slot) => ({ userId: slot.member.userId, roomIds: slot.rooms.map((item) => item.room.roomId) })),
    unresolved,
    unallocated: [],
    missingEstimates: rooms.filter((entry) => entry.estimate === null).length,
  };
}

/** Starts each person's closeness from the rooms they already own (their floors carry the building). */
function seedFloors(model: AssignmentsModel, slots: Slot[]): void {
  const byUser = new Map(slots.map((slot) => [slot.member.userId, slot] as const));
  for (const entry of model.rooms ?? []) {
    const owner = entry.ownership.userId;
    const slot = owner ? byUser.get(owner) : undefined;
    if (!slot) continue;
    if (entry.room.floorKnown) slot.floors.add(floorKeyOf(entry.room));
    if (entry.room.building) slot.buildings.add(entry.room.building);
  }
}
