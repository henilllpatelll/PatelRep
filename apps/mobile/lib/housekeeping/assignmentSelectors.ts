import { groupByBuildingAndFloor, type BuildingGroupOf } from "@/lib/housekeeping/roomBoardSelectors";
import { ATTENDANCE_RANK, type Attendance, type AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { computePersonLoad, isRemainingWork, projectPersonLoad, type LoadContext, type PersonLoad } from "@/lib/housekeeping/assignmentWorkload";

/* ─── Supervisor Assignments — selectors ────────────────────────────────────
   Pure derivations over `AssignmentsModel`. Every count names its POPULATION, and the populations nest so
   the numbers can be cross-checked:

     inventory ⊇ inService ⊇ remainingWork ⊇ unassignedWork ⊇ assignable ⊇ autoAssignable

     inventory        every room on the board, out-of-service included
     inService        inventory minus out-of-service
     remainingWork    in-service rooms still to clean or being cleaned
     unassignedWork   remaining work nobody owns — EXACTLY Supervisor Today's "unassigned" count
     assignable       unassignedWork that the normal flow may hand out (to clean; an unowned in-progress
                      room is work that needs an owner but is NOT assignable)
     autoAssignable   assignable with no soft block — what bulk assignment / Smart Balance may propose

   Everything returns null (or is skipped) when the board is unknown, never zero. */

export interface AssignmentSummary {
  inventory: number;
  inService: number;
  remainingWork: number;
  assignedWork: number;
  unassignedWork: number;
  assignable: number;
  autoAssignable: number;
  /** unassignedWork − assignable: needs an owner, yet cannot be handed out through the normal flow. */
  unassignableUnowned: number;
  /** Assignable rooms that carry a priority tier above routine. */
  urgentAssignable: number;
  /** Remaining work with a soft block (DND, declined, return later, discrepancy), owned or not. */
  softBlocked: number;
}

export function selectSummary(model: AssignmentsModel): AssignmentSummary | null {
  if (!model.rooms) return null;
  const summary: AssignmentSummary = {
    inventory: model.rooms.length,
    inService: 0,
    remainingWork: 0,
    assignedWork: 0,
    unassignedWork: 0,
    assignable: 0,
    autoAssignable: 0,
    unassignableUnowned: 0,
    urgentAssignable: 0,
    softBlocked: 0,
  };
  for (const entry of model.rooms) {
    if (entry.room.statusInfo.stage === "unavailable") continue;
    summary.inService += 1;
    if (!isRemainingWork(entry.room)) continue;
    summary.remainingWork += 1;
    if (entry.eligibility.softBlocks.length > 0) summary.softBlocked += 1;
    if (entry.ownership.assigned) {
      summary.assignedWork += 1;
      continue;
    }
    summary.unassignedWork += 1;
    if (entry.eligibility.canAssign) {
      summary.assignable += 1;
      if (entry.eligibility.autoAssignable) summary.autoAssignable += 1;
      if (entry.priority.tier !== "routine") summary.urgentAssignable += 1;
    } else {
      summary.unassignableUnowned += 1;
    }
  }
  return summary;
}

/* ─── Room lists (priority order is the model's own order) ────────────────── */

/** Unowned rooms the normal flow can assign, most pressing first. */
export function selectUnassignedAssignable(rooms: readonly AssignmentRoom[]): AssignmentRoom[] {
  return rooms.filter((entry) => entry.eligibility.canAssign);
}

/** Remaining work with a priority tier above routine. */
export function selectUrgent(rooms: readonly AssignmentRoom[]): AssignmentRoom[] {
  return rooms.filter((entry) => isRemainingWork(entry.room) && entry.priority.tier !== "routine");
}

/** Remaining work a supervisor should look at before sending anyone in (any soft block). */
export function selectSoftBlocked(rooms: readonly AssignmentRoom[]): AssignmentRoom[] {
  return rooms.filter((entry) => isRemainingWork(entry.room) && entry.eligibility.softBlocks.length > 0);
}

/** Work that needs an owner but cannot be assigned through the normal flow (e.g. an unowned in-progress room). */
export function selectNeedsOwnerNotAssignable(rooms: readonly AssignmentRoom[]): AssignmentRoom[] {
  return rooms.filter((entry) => entry.eligibility.needsAssignee && !entry.eligibility.canAssign);
}

export function groupRoomsByLocation(
  rooms: readonly AssignmentRoom[],
  order: "number" | "given" = "number",
): BuildingGroupOf<AssignmentRoom>[] {
  return groupByBuildingAndFloor(rooms, order);
}

/* ─── Team lists ──────────────────────────────────────────────────────────── */

/** People with no rooms today — the capacity that can take work. Includes everyone listed, working or not. */
export function selectStaffWithoutRooms(team: readonly AssignmentTeamMember[]): AssignmentTeamMember[] {
  return team.filter((member) => member.rooms.length === 0);
}

export function selectStaffNeedingAttention(team: readonly AssignmentTeamMember[]): AssignmentTeamMember[] {
  return team.filter((member) => member.concerns.length > 0);
}

export function selectStaffByAttendance(team: readonly AssignmentTeamMember[], attendance: readonly Attendance[]): AssignmentTeamMember[] {
  const wanted = new Set(attendance);
  return team.filter((member) => wanted.has(member.attendance));
}

/* ─── Team counts ───────────────────────────────────────────────────────────
   The three numbers the Team header shows. Attendance counts exist only when the roster AND the staff list are
   verified (a failed roster is "unknown", never "nobody is working"). "Needs review" is a count of people with a
   supported concern; when some evidence is missing it is a lower bound (`needReviewAtLeast`) and a zero would be
   a guess, so it is reported as unknown instead. */

export interface TeamCounts {
  onShift: number | null;
  onBreak: number | null;
  needReview: number | null;
  /** The review count may be higher: roster, settings or schedule evidence is missing. */
  needReviewAtLeast: boolean;
}

export function selectTeamCounts(model: AssignmentsModel): TeamCounts {
  const team = model.team;
  if (!team) return { onShift: null, onBreak: null, needReview: null, needReviewAtLeast: false };
  const attendanceKnown = model.rosterTrust === "verified" && model.staffListKnown;
  const count = (attendance: Attendance) => team.filter((member) => member.attendance === attendance).length;
  const reviewCount = selectStaffNeedingAttention(team).length;
  const atLeast = model.rosterTrust !== "verified" || model.settings.value === null || model.schedule.trust !== "verified" || !model.staffListKnown;
  return {
    onShift: attendanceKnown ? count("on_shift") : null,
    onBreak: attendanceKnown ? count("on_break") : null,
    needReview: atLeast && reviewCount === 0 ? null : reviewCount,
    needReviewAtLeast: atLeast,
  };
}

/* ─── Recommended candidates ────────────────────────────────────────────────
   An ORDERED SHORTLIST with reasons, not a decision. Order: attendance (working first, then scheduled,
   break, unknown, definitely-not-working, clocked out), then people who would not end up overloaded, then the
   lowest projected load, then people already on this room's floor/building, then name. Anyone not working is
   still listed — with a caution — because the supervisor may know better than the roster. */

export type CandidateReason = "on_shift" | "scheduled" | "same_floor" | "same_building";
export type CandidateCaution =
  | "attendance_unknown"
  | "not_clocked_in"
  | "shift_ended"
  | "on_break"
  | "would_be_overloaded"
  | "estimate_incomplete";

export interface Candidate {
  member: AssignmentTeamMember;
  reasons: CandidateReason[];
  cautions: CandidateCaution[];
  before: PersonLoad;
  after: PersonLoad;
}

const ATTENDANCE_CAUTION: Partial<Record<Attendance, CandidateCaution>> = {
  unknown: "attendance_unknown",
  not_clocked_in: "not_clocked_in",
  shift_ended: "shift_ended",
  on_break: "on_break",
};

function loadContext(model: AssignmentsModel, member: AssignmentTeamMember): LoadContext {
  return { settings: model.settings.value, shiftTime: member.shift };
}

function overloadedAfter(load: PersonLoad): boolean {
  return load.warnings.some((warning) => warning === "over_credit_target" || warning === "exceeds_shift_time" || warning === "exceeds_full_day");
}

export function recommendCandidates(model: AssignmentsModel, roomId: string, limit = 5): Candidate[] {
  if (!model.rooms || !model.team) return [];
  const target = model.rooms.find((entry) => entry.room.roomId === roomId);
  if (!target) return [];
  const allRooms = model.rooms.map((entry) => entry.room);
  const { room } = target;

  const candidates = model.team
    .filter((member) => member.userId !== room.assignment.userId)
    .map<Candidate>((member) => {
      const context = loadContext(model, member);
      const before = computePersonLoad(member.userId, allRooms, context);
      const after = projectPersonLoad(member.userId, allRooms, { add: [room] }, context);
      const reasons: CandidateReason[] = [];
      if (member.attendance === "on_shift") reasons.push("on_shift");
      if (member.attendance === "scheduled_not_clocked_in") reasons.push("scheduled");
      if (room.floorKnown && member.floors.includes(room.floor)) reasons.push("same_floor");
      if (room.building && member.buildings.includes(room.building)) reasons.push("same_building");
      const cautions: CandidateCaution[] = [];
      const attendanceCaution = ATTENDANCE_CAUTION[member.attendance];
      if (attendanceCaution) cautions.push(attendanceCaution);
      if (overloadedAfter(after)) cautions.push("would_be_overloaded");
      if (!after.minutes.minutesComplete) cautions.push("estimate_incomplete");
      return { member, reasons, cautions, before, after };
    });

  const left = (candidate: Candidate) => (candidate.after.minutes.minutesComplete ? candidate.after.minutes.remainingMinutes : Number.POSITIVE_INFINITY);
  candidates.sort(
    (a, b) =>
      ATTENDANCE_RANK[a.member.attendance] - ATTENDANCE_RANK[b.member.attendance] ||
      Number(overloadedAfter(a.after)) - Number(overloadedAfter(b.after)) ||
      left(a) - left(b) ||
      Number(b.reasons.includes("same_floor")) - Number(a.reasons.includes("same_floor")) ||
      Number(b.reasons.includes("same_building")) - Number(a.reasons.includes("same_building")) ||
      (a.member.name === null ? 1 : 0) - (b.member.name === null ? 1 : 0) ||
      (a.member.name ?? "").localeCompare(b.member.name ?? "", undefined, { sensitivity: "base" }) ||
      a.member.userId.localeCompare(b.member.userId),
  );
  return candidates.slice(0, Math.max(0, limit));
}
