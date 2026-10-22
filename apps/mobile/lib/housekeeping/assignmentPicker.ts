import { statusLabelKey, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { shownMinutes, type RoomEstimate } from "@/lib/housekeeping/roomAssignment";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import type { PriorityReason } from "@/lib/housekeeping/assignmentPriority";
import type { Attendance, AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";
import {
  projectPersonLoad,
  type CapacityState,
  type LoadContext,
  type PersonLoad,
  type WorkloadWarning,
} from "@/lib/housekeeping/assignmentWorkload";

/* ─── Supervisor Assignments — the housekeeper picker, projections and review ─
   Pure: no React, no I/O. Everything the single-room picker, its review step and the removal confirmation SHOW is
   derived here from the composed `AssignmentsModel`, so the card, the review and the tests cannot disagree.

   WHAT THIS NEVER DOES
   - It never calls someone "available" because they appear in the staff list. Attendance comes only from the
     Phase 1 model: a failed, stale or missing roster makes everybody `unknown`, not working and not absent.
   - It never treats an unknown estimate as zero. A person with rooms that have no estimate shows "at least N min",
     with the number of missing estimates; a projection that adds a room with no estimate shows exactly that.
   - It never caps a total and never assumes an eight-hour day: a "full day" warning is shown as a warning only; an
     acknowledgement is asked for only when a REAL configuration says the person would be over (their credit
     target, or the scheduled shift time they have left).
   - It never ranks someone "best" without evidence: a suggestion needs at least two comparable, verified,
     fully-estimated candidates, and says what made the difference. Sorting is a total order, so it is deterministic.
   - Minutes, credits and percentages stay separate measurements (see assignmentWorkload.ts). */

/* ─── Acknowledgements ────────────────────────────────────────────────────── */

/** Why choosing this person, specifically, is a decision rather than a default. */
export type AttendanceAck = "attendance_unverified" | "on_break" | "not_clocked_in" | "shift_ended";

/**
 * Every condition a supervisor can knowingly accept for one assignment. The first four (`SoftBlock`) are facts
 * about the ROOM and are re-checked by the server; the rest are facts about the PERSON and exist only on this
 * device, because the server has no attendance or capacity model to check them against.
 */
export type AssignAck = SoftBlock | AttendanceAck | "over_capacity";

/** The order acknowledgements are listed in, so the review is stable. */
export const ACK_ORDER: readonly AssignAck[] = [
  "service_declined",
  "return_later",
  "dnd",
  "occupancy_discrepancy",
  "attendance_unverified",
  "shift_ended",
  "not_clocked_in",
  "on_break",
  "over_capacity",
];

const SOFT_BLOCKS: readonly string[] = ["service_declined", "return_later", "dnd", "occupancy_discrepancy"];

export function isSoftBlockAck(ack: AssignAck): ack is SoftBlock {
  return SOFT_BLOCKS.includes(ack);
}

/** The attendance acknowledgement a person needs, or null when they are verified on shift. */
export function attendanceAckFor(attendance: Attendance): AttendanceAck | null {
  switch (attendance) {
    case "on_shift":
      return null;
    case "on_break":
      return "on_break";
    case "shift_ended":
      return "shift_ended";
    case "scheduled_not_clocked_in":
    case "not_clocked_in":
      return "not_clocked_in";
    default:
      return "attendance_unverified";
  }
}

/** Warnings backed by real configuration. `exceeds_full_day` is a constant, not a setting, so it never gates. */
const GATING_WARNINGS: readonly WorkloadWarning[] = ["over_credit_target", "exceeds_shift_time"];

/** Warnings that say the person would carry too much. The "missing estimate / credit" warnings only say data is incomplete. */
const OVERLOAD_WARNINGS: readonly WorkloadWarning[] = ["over_credit_target", "exceeds_shift_time", "exceeds_full_day"];

function overloads(warnings: readonly WorkloadWarning[]): boolean {
  return warnings.some((warning) => OVERLOAD_WARNINGS.includes(warning));
}

function overCapacity(after: PersonLoad | null): boolean {
  return after !== null && after.warnings.some((warning) => GATING_WARNINGS.includes(warning));
}

export function sortAcks(acks: Iterable<AssignAck>): AssignAck[] {
  const set = new Set(acks);
  return ACK_ORDER.filter((ack) => set.has(ack));
}

/* ─── Load views ──────────────────────────────────────────────────────────── */

export interface MinutesView {
  /** The figure to show; null when every remaining room lacks an estimate. A lower bound when `partial`. */
  minutes: number | null;
  /** `minutes` is "at least": some remaining rooms have no estimate. */
  partial: boolean;
  missing: number;
  /** Remaining rooms (to clean or being cleaned). */
  rooms: number;
}

export interface LoadView {
  minutes: MinutesView;
  /** Every room tied to the person today, whatever its stage. */
  assignedRooms: number;
  completedRooms: number;
  /** Capacity used, e.g. 81 for 81%; null unless the credits are complete and the target is known. */
  percent: number | null;
  capacityState: CapacityState | null;
  /** Credits left against the target (negative = over); same reliability as `percent`. */
  creditsLeft: number | null;
  warnings: WorkloadWarning[];
}

export function loadView(load: PersonLoad): LoadView {
  const shown = shownMinutes(load.minutes);
  return {
    minutes: {
      minutes: shown,
      partial: shown !== null && !load.minutes.minutesComplete,
      missing: load.minutes.roomsWithoutEstimate,
      rooms: load.minutes.remainingRooms,
    },
    assignedRooms: load.minutes.total,
    completedRooms: load.minutes.completed,
    percent: load.capacity.utilization === null ? null : Math.round(load.capacity.utilization * 100),
    capacityState: load.capacity.state,
    creditsLeft: load.capacity.creditsLeft,
    warnings: load.warnings,
  };
}

function newWarningsOf(before: PersonLoad, after: PersonLoad | null): WorkloadWarning[] {
  return after ? after.warnings.filter((warning) => !before.warnings.includes(warning)) : [];
}

/* ─── Candidates ──────────────────────────────────────────────────────────── */

export type Proximity = "same_floor" | "same_building";
export type SuggestionReason = "most_capacity" | "least_remaining_time" | "same_floor" | "same_building";

export interface AssignCandidate {
  userId: string;
  /** null = the staff list has no usable name for this person. */
  name: string | null;
  attendance: Attendance;
  rosterVerified: boolean;
  /** Already this room's owner: shown, never selectable. */
  isCurrentOwner: boolean;
  current: LoadView;
  /** Their load if they took this room; null for the current owner. */
  after: LoadView | null;
  /** Warnings the room would CREATE for them. */
  newWarnings: WorkloadWarning[];
  /** The room has no estimate, so the projection cannot add time (it shows "at least"). */
  roomEstimateMissing: boolean;
  proximity: Proximity | null;
  floors: number[];
  /** Person-level acknowledgements choosing them would need. */
  acks: AssignAck[];
  suggested: SuggestionReason | null;
}

export type PickerFilter = "on_shift" | "all";
export type PickerEmpty = "no_staff" | "no_on_shift" | "no_match" | null;

export interface AssignPicker {
  roomId: string;
  roomNumber: string;
  intent: "assign" | "reassign";
  cleanTypeLabel: string | null;
  estimate: RoomEstimate | null;
  /** The verified roster exists: "On shift" is a meaningful list. */
  rosterVerified: boolean;
  /** The filter actually applied (forced to "all" without a verified roster). */
  filter: PickerFilter;
  counts: { onShift: number; all: number };
  candidates: AssignCandidate[];
  suggestedId: string | null;
  empty: PickerEmpty;
}

function proximityOf(room: BoardRoom, member: AssignmentTeamMember): Proximity | null {
  if (room.floorKnown && member.floors.includes(room.floor)) return "same_floor";
  if (room.building && member.buildings.includes(room.building)) return "same_building";
  return null;
}

const PROXIMITY_RANK: Record<Proximity, number> = { same_floor: 0, same_building: 1 };

function attendanceTier(attendance: Attendance): number {
  return attendance === "on_shift" ? 0 : 1;
}

/** The numeric keys of the candidate order, most important first. Every key is a finite number or Infinity. */
function sortKey(candidate: AssignCandidate): number[] {
  const view = candidate.after ?? candidate.current;
  const overAfter = candidate.after?.capacityState === "over" || overloads(candidate.newWarnings) ? 1 : 0;
  return [
    candidate.isCurrentOwner ? 1 : 0,
    attendanceTier(candidate.attendance),
    overAfter,
    // More credits left is better; unknown sorts after every known figure.
    candidate.current.creditsLeft === null ? Number.POSITIVE_INFINITY : -candidate.current.creditsLeft,
    candidate.current.minutes.minutes === null && candidate.current.minutes.rooms > 0 ? Number.POSITIVE_INFINITY : (candidate.current.minutes.minutes ?? 0),
    candidate.proximity === null ? 2 : PROXIMITY_RANK[candidate.proximity],
    view.assignedRooms,
  ];
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

function compareCandidates(a: AssignCandidate, b: AssignCandidate): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] === kb[i]) continue;
    return ka[i] < kb[i] ? -1 : 1;
  }
  return (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || collator.compare(a.name ?? "", b.name ?? "") || a.userId.localeCompare(b.userId);
}

/** A candidate whose numbers can be compared honestly: verified on shift, nothing unknown in the picture. */
function isComparable(candidate: AssignCandidate): boolean {
  return (
    !candidate.isCurrentOwner &&
    candidate.attendance === "on_shift" &&
    candidate.current.minutes.missing === 0 &&
    candidate.after !== null &&
    candidate.after.minutes.missing === 0 &&
    !overloads(candidate.after.warnings) &&
    candidate.after.capacityState !== "over"
  );
}

/** What made `first` come out ahead of `second`, or null when nothing in the evidence separates them. */
function suggestionReason(first: AssignCandidate, second: AssignCandidate): SuggestionReason | null {
  if (first.current.creditsLeft !== null && second.current.creditsLeft !== null && first.current.creditsLeft !== second.current.creditsLeft) {
    return "most_capacity";
  }
  const a = first.current.minutes.minutes ?? 0;
  const b = second.current.minutes.minutes ?? 0;
  if (a !== b) return "least_remaining_time";
  if (first.proximity !== second.proximity && first.proximity !== null) return first.proximity;
  return null;
}

function contextFor(model: AssignmentsModel, member: AssignmentTeamMember): LoadContext {
  return { settings: model.settings.value, shiftTime: member.shift, ...(model.learned ? { learned: model.learned } : {}) };
}

function cleanQuery(query: string): string {
  return query.trim().toLowerCase();
}

export interface PickerInput {
  roomId: string;
  query: string;
  filter: PickerFilter;
}

/**
 * The picker for one room, or null when the room is not on the verified board (or the team is unknown). Only
 * people in the verified staff list are offered: an owner the list cannot name is not someone the server will
 * accept a new assignment for.
 */
export function buildAssignPicker(model: AssignmentsModel, input: PickerInput): AssignPicker | null {
  if (!model.rooms || !model.team) return null;
  const entry = model.rooms.find((candidate) => candidate.room.roomId === input.roomId);
  if (!entry) return null;
  const rooms = model.rooms.map((item) => item.room);
  const { room } = entry;
  const rosterVerified = model.rosterTrust === "verified";
  const filter: PickerFilter = rosterVerified ? input.filter : "all";

  const all = model.team
    .filter((member) => member.listed)
    .map<AssignCandidate>((member) => {
      const isCurrentOwner = room.assignment.userId === member.userId;
      const after = isCurrentOwner ? null : projectPersonLoad(member.userId, rooms, { add: [room] }, contextFor(model, member));
      const attendanceAck = attendanceAckFor(member.attendance);
      return {
        userId: member.userId,
        name: member.name,
        attendance: member.attendance,
        rosterVerified: member.rosterVerified,
        isCurrentOwner,
        current: loadView(member.load),
        after: after ? loadView(after) : null,
        newWarnings: newWarningsOf(member.load, after),
        roomEstimateMissing: entry.estimate === null,
        proximity: proximityOf(room, member),
        floors: member.floors,
        acks: sortAcks([...(attendanceAck ? [attendanceAck] : []), ...(overCapacity(after) ? (["over_capacity"] as const) : [])]),
        suggested: null,
      };
    })
    .sort(compareCandidates);

  // A suggestion needs a real comparison: two or more candidates whose numbers are all known and verified.
  const comparable = all.filter(isComparable);
  let suggestedId: string | null = null;
  if (comparable.length >= 2) {
    const reason = suggestionReason(comparable[0], comparable[1]);
    if (reason) {
      comparable[0].suggested = reason;
      suggestedId = comparable[0].userId;
    }
  }

  const onShift = all.filter((candidate) => candidate.attendance === "on_shift");
  const pool = filter === "on_shift" ? onShift : all;
  const needle = cleanQuery(input.query);
  const candidates = needle ? pool.filter((candidate) => candidate.name?.toLowerCase().includes(needle)) : pool;

  let empty: PickerEmpty = null;
  if (candidates.length === 0) {
    if (all.length === 0) empty = "no_staff";
    else if (needle) empty = "no_match";
    else if (filter === "on_shift") empty = "no_on_shift";
  }

  return {
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    intent: room.assignment.source === "none" ? "assign" : "reassign",
    cleanTypeLabel: room.cleanTypeLabel,
    estimate: entry.estimate,
    rosterVerified,
    filter,
    counts: { onShift: onShift.length, all: all.length },
    candidates,
    suggestedId,
    empty,
  };
}

/* ─── Impact & review ─────────────────────────────────────────────────────── */

export interface PersonImpact {
  userId: string;
  name: string | null;
  before: LoadView;
  after: LoadView;
  newWarnings: WorkloadWarning[];
}

function impactOf(model: AssignmentsModel, member: AssignmentTeamMember, change: { add?: BoardRoom[]; release?: string[] }): PersonImpact {
  const rooms = (model.rooms ?? []).map((item) => item.room);
  const after = projectPersonLoad(member.userId, rooms, change, contextFor(model, member));
  return { userId: member.userId, name: member.name, before: loadView(member.load), after: loadView(after), newWarnings: newWarningsOf(member.load, after) };
}

export interface AssignReview {
  intent: "assign" | "reassign";
  roomId: string;
  roomNumber: string;
  cleanTypeLabel: string | null;
  estimate: RoomEstimate | null;
  priorityReasons: PriorityReason[];
  /** The room's stage, so the review can say "Not started". */
  stage: BoardRoom["statusInfo"]["stage"];
  /** The current owner (reassign); null when the room is unassigned. */
  from: { userId: string; name: string | null } | null;
  to: { userId: string; name: string | null; attendance: Attendance; rosterVerified: boolean };
  toImpact: PersonImpact;
  fromImpact: PersonImpact | null;
  /** Every acknowledgement the supervisor must give before confirming (room + person), in a stable order. */
  requiredAcks: AssignAck[];
  /** The room-level soft blocks among them (the ones the server re-checks). */
  softBlocks: SoftBlock[];
  /** The room's hard block, if any. Confirming is impossible while it is set. */
  hardBlock: AssignmentRoom["eligibility"]["hardBlock"];
  /** The selected person is already the owner: nothing to change. */
  alreadyOwner: boolean;
}

export type ReviewRejection = "room_missing" | "board_unavailable" | "employee_unknown";

/** The review for moving `roomId` to `toUserId`, or why there is none. */
export function buildAssignReview(
  model: AssignmentsModel,
  input: { roomId: string; toUserId: string },
): { ok: true; review: AssignReview } | { ok: false; rejection: ReviewRejection } {
  if (!model.rooms || !model.team) return { ok: false, rejection: "board_unavailable" };
  const entry = model.rooms.find((candidate) => candidate.room.roomId === input.roomId);
  if (!entry) return { ok: false, rejection: "room_missing" };
  const to = model.team.find((member) => member.userId === input.toUserId && member.listed);
  if (!to) return { ok: false, rejection: "employee_unknown" };

  const { room, eligibility, ownership } = entry;
  const from = ownership.userId ? (model.team.find((member) => member.userId === ownership.userId) ?? null) : null;
  const alreadyOwner = ownership.userId === to.userId;
  const toImpact = impactOf(model, to, { add: [room] });
  const fromImpact = from && !alreadyOwner ? impactOf(model, from, { release: [room.roomId] }) : null;
  const attendanceAck = attendanceAckFor(to.attendance);
  const rooms = model.rooms.map((item) => item.room);
  const afterLoad = projectPersonLoad(to.userId, rooms, { add: [room] }, contextFor(model, to));

  const requiredAcks = sortAcks([
    ...eligibility.requiresAcknowledgement,
    ...(attendanceAck ? [attendanceAck] : []),
    ...(overCapacity(alreadyOwner ? null : afterLoad) ? (["over_capacity"] as const) : []),
  ]);

  return {
    ok: true,
    review: {
      intent: ownership.assigned ? "reassign" : "assign",
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      cleanTypeLabel: room.cleanTypeLabel,
      estimate: entry.estimate,
      priorityReasons: entry.priority.reasons,
      stage: room.statusInfo.stage,
      from: ownership.userId ? { userId: ownership.userId, name: ownership.name } : null,
      to: { userId: to.userId, name: to.name, attendance: to.attendance, rosterVerified: to.rosterVerified },
      toImpact,
      fromImpact,
      requiredAcks,
      softBlocks: [...eligibility.requiresAcknowledgement],
      hardBlock: eligibility.hardBlock,
      alreadyOwner,
    },
  };
}

/** True when every acknowledgement the review demands has been given. */
export function acksSatisfied(required: readonly AssignAck[], given: readonly AssignAck[]): boolean {
  const have = new Set(given);
  return required.every((ack) => have.has(ack));
}

/** The soft blocks among the acknowledgements actually given, restricted to those the room currently has. */
export function softAcksOf(given: readonly AssignAck[]): SoftBlock[] {
  return given.filter(isSoftBlockAck);
}

/* ─── Removal ─────────────────────────────────────────────────────────────── */

export interface RemovalReview {
  roomId: string;
  roomNumber: string;
  owner: { userId: string; name: string | null };
  /** `dated` = a room_assignments row; `status_mirror` = only room_status.assigned_to. */
  source: "dated" | "status_mirror";
  stage: BoardRoom["statusInfo"]["stage"];
  /** i18n key of the room's status meaning ("Dirty", …). */
  statusKey: string;
  cleanTypeLabel: string | null;
  /** The owner's load before and after the room is taken off them; null when the staff list cannot place them. */
  impact: PersonImpact | null;
  /** A reason removal is refused right now, or null. */
  blocked: AssignmentRoom["eligibility"]["hardBlock"];
}

export function buildRemovalReview(model: AssignmentsModel, roomId: string): RemovalReview | null {
  if (!model.rooms || !model.team) return null;
  const entry = model.rooms.find((candidate) => candidate.room.roomId === roomId);
  if (!entry || !entry.ownership.userId) return null;
  const { room, ownership, eligibility } = entry;
  const member = model.team.find((candidate) => candidate.userId === ownership.userId) ?? null;
  return {
    roomId: room.roomId,
    roomNumber: room.roomNumber,
    owner: { userId: ownership.userId as string, name: ownership.name },
    source: ownership.source === "status_mirror" ? "status_mirror" : "dated",
    stage: room.statusInfo.stage,
    statusKey: statusLabelKey(room.statusInfo),
    cleanTypeLabel: room.cleanTypeLabel,
    impact: member ? impactOf(model, member, { release: [room.roomId] }) : null,
    blocked: eligibility.canRemove ? null : (eligibility.hardBlock ?? "unknown_status"),
  };
}

/* ─── Choosing a room for a person ────────────────────────────────────────── */

export interface ChooserRoom {
  roomId: string;
  roomNumber: string;
  cleanTypeLabel: string | null;
  estimateMinutes: number | null;
  priorityReasons: PriorityReason[];
  floor: number | null;
  building: string | null;
  /** Soft blocks: the room can still be given to someone, but only with a condition-specific acknowledgement. */
  heldBack: SoftBlock[];
}

/**
 * The rooms a supervisor can give to a chosen person: nobody owns them and no hard block applies. They keep the
 * model's priority order. A held-back room is listed (the review asks for the acknowledgement); a room being
 * cleaned, submitted, inspected or out of service is not.
 */
export function listAssignableRooms(model: AssignmentsModel): ChooserRoom[] {
  return (model.rooms ?? [])
    .filter((entry) => entry.eligibility.canAssign)
    .map((entry) => ({
      roomId: entry.room.roomId,
      roomNumber: entry.room.roomNumber,
      cleanTypeLabel: entry.room.cleanTypeLabel,
      estimateMinutes: entry.estimate ? entry.estimate.minutes : null,
      priorityReasons: entry.priority.reasons,
      floor: entry.room.floorKnown ? entry.room.floor : null,
      building: entry.room.building,
      heldBack: [...entry.eligibility.requiresAcknowledgement],
    }));
}
