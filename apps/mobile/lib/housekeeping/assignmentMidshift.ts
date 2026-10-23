import { proposeAllocation, type AllocationProposal } from "@/lib/housekeeping/assignmentAllocator";
import { buildAllocateCandidates, type AllocateCandidate } from "@/lib/housekeeping/assignmentAllocateView";
import { totalMinutes, type SelectionMinutes } from "@/lib/housekeeping/assignmentBulk";
import { stageAllocation, type StageResult } from "@/lib/housekeeping/assignmentDraft";
import { buildDraftReview, type DraftReview } from "@/lib/housekeeping/assignmentDraftReview";
import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { draftChanges, emptyDraft, type AssignmentDraft, type PlanRejection } from "@/lib/housekeeping/assignmentPlan";
import type { Attendance, AssignmentTeamMember } from "@/lib/housekeeping/assignmentStaff";

/* ─── Supervisor Assignments — midshift workforce recovery ──────────────────
   Pure. When the day stops matching the plan (someone leaves, does not show, falls behind), a supervisor moves the
   person's UNSTARTED rooms to other people. This module decides, from the live Phase 1 model only:

     • which of a person's rooms may move, and why each of the others may not (`classifyRoom`)
     • what a selection adds up to, and whether it is still sound (`summarizeSelection`)
     • who may receive it, from verified attendance (`buildDestinations`)
     • a proposal and the before/after review of it (`planMidshift`)
     • what changed under the supervisor's feet while the sheet was open (`diffSeen`)

   NOTHING HERE EDITS, SCHEDULES OR PUBLISHES. A proposal is staged into the one Phase 5 unpublished draft and goes through
   the same reviewed, guarded, ATOMIC publication as every other assignment change; the server re-checks every room's stage,
   owner and soft blocks. Moving rooms never changes attendance: no clock-out, absence or leave is recorded or implied.

   WHAT IS PROTECTED, ALWAYS
     in progress          cleaning has started; its session belongs to the cleaner. The normal flow cannot move it and
                          this module invents no override: the supervisor is pointed at the Room Board instead.
     completed            submitted for inspection or inspected.
     held back            DND, declined service, a pending return time, an occupancy discrepancy. Moving such a room is
                          a per-room decision that a batch publication cannot carry, so it is never moved here.
     out of service / unknown status
   A selection, a "select all" and the editor can only ever contain `eligible` rooms. */

/* ─── Reasons ─────────────────────────────────────────────────────────────── */

/** Why the supervisor is moving work. Descriptive only: it never changes attendance, leave or pay. */
export type MidshiftReason = "left_early" | "unavailable" | "workload_help" | "urgent_coverage" | "supervisor_adjustment";

export const MIDSHIFT_REASONS: readonly MidshiftReason[] = ["left_early", "unavailable", "workload_help", "urgent_coverage", "supervisor_adjustment"];

/* ─── Rooms ───────────────────────────────────────────────────────────────── */

export type MidshiftRoomClass =
  | { kind: "eligible" }
  | { kind: "in_progress" }
  | { kind: "completed"; stage: "awaiting_inspection" | "guest_ready" }
  | { kind: "held"; blocks: SoftBlock[] }
  | { kind: "unavailable" }
  | { kind: "unknown" };

export type MidshiftRoomKind = MidshiftRoomClass["kind"];

export interface MidshiftRoom {
  entry: AssignmentRoom;
  roomId: string;
  roomNumber: string;
  class: MidshiftRoomClass;
  /** May be selected and moved. Always `class.kind === "eligible"`. */
  movable: boolean;
}

/** One room's verdict. Reads the Phase 1 eligibility only: it holds no second opinion about stages or soft blocks. */
export function classifyRoom(entry: AssignmentRoom): MidshiftRoomClass {
  const { eligibility } = entry;
  switch (eligibility.hardBlock) {
    case "in_progress":
      return { kind: "in_progress" };
    case "awaiting_inspection":
    case "guest_ready":
      return { kind: "completed", stage: eligibility.hardBlock };
    case "out_of_service":
      return { kind: "unavailable" };
    case "unknown_status":
      return { kind: "unknown" };
    default:
      break;
  }
  if (eligibility.softBlocks.length > 0) return { kind: "held", blocks: [...eligibility.softBlocks] };
  // Owned, nothing blocks it, and Phase 1 says it can change hands.
  return entry.ownership.assigned && eligibility.canReassign ? { kind: "eligible" } : { kind: "unknown" };
}

/* ─── The source: one person's day ────────────────────────────────────────── */

export interface MidshiftCounts {
  assigned: number;
  completed: number;
  inProgress: number;
  /** Not started: eligible plus held back. */
  notStarted: number;
  eligible: number;
  held: number;
  /** Out of service or unknown status. */
  other: number;
  /** Rooms that stay with the person whatever happens: in progress and completed. */
  protectedRooms: number;
}

export type RecoveryAttention = "shift_ended" | "not_clocked_in" | "overloaded" | null;

export interface MidshiftSource {
  userId: string;
  member: AssignmentTeamMember;
  name: string | null;
  /** Every room the person owns, eligible ones first (in the model's priority order), then the rest by phase. */
  rooms: MidshiftRoom[];
  counts: MidshiftCounts;
  eligibleMinutes: SelectionMinutes;
  /** The most important verified reason this person may need help, or null. */
  attention: RecoveryAttention;
}

const PHASE_RANK: Record<MidshiftRoomKind, number> = { eligible: 0, held: 1, in_progress: 2, completed: 3, unavailable: 4, unknown: 5 };

function attentionOf(member: AssignmentTeamMember): RecoveryAttention {
  if (member.concerns.includes("shift_ended_with_open_rooms")) return "shift_ended";
  if (member.concerns.includes("not_clocked_in_with_open_rooms")) return "not_clocked_in";
  if (member.concerns.includes("overloaded")) return "overloaded";
  return null;
}

/** null when the board or team is unknown, or the person is not on it. */
export function buildMidshiftSource(model: AssignmentsModel, userId: string): MidshiftSource | null {
  if (!model.rooms || !model.team) return null;
  const member = model.team.find((candidate) => candidate.userId === userId);
  if (!member) return null;
  const order = new Map(model.rooms.map((entry, index) => [entry.room.roomId, index] as const));
  const rooms = model.rooms
    .filter((entry) => entry.ownership.userId === userId)
    .map<MidshiftRoom>((entry) => {
      const kind = classifyRoom(entry);
      return { entry, roomId: entry.room.roomId, roomNumber: entry.room.roomNumber, class: kind, movable: kind.kind === "eligible" };
    })
    .sort((a, b) => PHASE_RANK[a.class.kind] - PHASE_RANK[b.class.kind] || (order.get(a.roomId) ?? 0) - (order.get(b.roomId) ?? 0));
  const count = (kind: MidshiftRoomKind) => rooms.filter((room) => room.class.kind === kind).length;
  const eligible = count("eligible");
  const held = count("held");
  const inProgress = count("in_progress");
  const completed = count("completed");
  return {
    userId,
    member,
    name: member.name,
    rooms,
    counts: {
      assigned: rooms.length,
      completed,
      inProgress,
      notStarted: eligible + held,
      eligible,
      held,
      other: count("unavailable") + count("unknown"),
      protectedRooms: inProgress + completed,
    },
    eligibleMinutes: totalMinutes(rooms.filter((room) => room.movable).map((room) => room.entry)),
    attention: attentionOf(member),
  };
}

/* ─── The action in the staff drawer ──────────────────────────────────────── */

export type RecoveryUnavailable = "board_unavailable" | "nothing_assigned" | "all_held" | "nothing_unstarted";

export type RecoveryAction =
  | { kind: "available"; source: MidshiftSource }
  | { kind: "unavailable"; reason: RecoveryUnavailable; source: MidshiftSource | null };

/** Whether "Reassign remaining work" can start for this person, and if not, why — never a silent absence. */
export function recoveryAction(model: AssignmentsModel, userId: string): RecoveryAction {
  const source = buildMidshiftSource(model, userId);
  if (!source) return { kind: "unavailable", reason: "board_unavailable", source: null };
  if (source.counts.eligible > 0) return { kind: "available", source };
  const reason: RecoveryUnavailable = source.counts.assigned === 0 ? "nothing_assigned" : source.counts.held > 0 ? "all_held" : "nothing_unstarted";
  return { kind: "unavailable", reason, source };
}

/* ─── Selection ───────────────────────────────────────────────────────────── */

/**
 * The starting selection. When the person's shift ended or they have not clocked in, the whole unstarted list is the
 * recovery, so every movable room starts selected. For someone who is working (workload help) nothing is assumed: the
 * supervisor picks what to move.
 */
export function defaultSelection(source: MidshiftSource): ReadonlySet<string> {
  return source.attention === "shift_ended" || source.attention === "not_clocked_in" ? selectAllMovable(source) : new Set();
}

/** Every MOVABLE room — never a protected, held-back or unavailable one. */
export function selectAllMovable(source: MidshiftSource): ReadonlySet<string> {
  return new Set(source.rooms.filter((room) => room.movable).map((room) => room.roomId));
}

export type SelectionRefusal = "not_movable" | "not_owned";

export interface SelectionResult {
  selected: ReadonlySet<string>;
  refused?: SelectionRefusal;
}

/** Adds a movable room or removes any selected one. A protected room is refused, with the reason. */
export function toggleRoom(selected: ReadonlySet<string>, source: MidshiftSource, roomId: string): SelectionResult {
  if (selected.has(roomId)) {
    const next = new Set(selected);
    next.delete(roomId);
    return { selected: next };
  }
  const room = source.rooms.find((candidate) => candidate.roomId === roomId);
  if (!room) return { selected, refused: "not_owned" };
  if (!room.movable) return { selected, refused: "not_movable" };
  return { selected: new Set(selected).add(roomId) };
}

export type SelectedProblem = "gone" | "reassigned" | "started" | "completed" | "held" | "unavailable";

export interface SelectedInvalid {
  roomId: string;
  roomNumber: string;
  problem: SelectedProblem;
}

export interface SelectionSummary {
  /** The selected rooms that can still move, in the model's order. */
  valid: MidshiftRoom[];
  invalid: SelectedInvalid[];
  minutes: SelectionMinutes;
}

/** Re-derives the selection from the LIVE model: a room that started, finished, moved or left is `invalid` and never sent. */
export function summarizeSelection(model: AssignmentsModel, userId: string, selected: ReadonlySet<string>): SelectionSummary {
  const source = buildMidshiftSource(model, userId);
  const byId = new Map((model.rooms ?? []).map((entry) => [entry.room.roomId, entry] as const));
  const valid = source ? source.rooms.filter((room) => room.movable && selected.has(room.roomId)) : [];
  const validIds = new Set(valid.map((room) => room.roomId));
  const invalid: SelectedInvalid[] = [];
  for (const roomId of selected) {
    if (validIds.has(roomId)) continue;
    const entry = byId.get(roomId);
    if (!entry) {
      invalid.push({ roomId, roomNumber: "", problem: "gone" });
      continue;
    }
    const roomNumber = entry.room.roomNumber;
    if (entry.ownership.userId !== userId) {
      invalid.push({ roomId, roomNumber, problem: "reassigned" });
      continue;
    }
    const kind = classifyRoom(entry).kind;
    invalid.push({ roomId, roomNumber, problem: kind === "in_progress" ? "started" : kind === "completed" ? "completed" : kind === "held" ? "held" : "unavailable" });
  }
  return { valid, invalid, minutes: totalMinutes(valid.map((room) => room.entry)) };
}

/* ─── Destinations ────────────────────────────────────────────────────────── */

export interface MidshiftDestination extends AllocateCandidate {
  /** Verified on shift right now: the only people "the available team" is made of. */
  availableNow: boolean;
  /** Minutes of the scheduled shift still ahead, only from a readable schedule. */
  shiftMinutesLeft: number | null;
}

/**
 * Who could receive `rooms`, from the verified staff list, never including the person the work leaves. Attendance is
 * the roster's word only: a failed or stale roster makes everybody `unknown`, and unknown is never "available".
 */
export function buildDestinations(model: AssignmentsModel, sourceUserId: string, rooms: readonly AssignmentRoom[]): MidshiftDestination[] {
  return buildAllocateCandidates(model, rooms)
    .filter((candidate) => candidate.userId !== sourceUserId)
    .map((candidate) => ({
      ...candidate,
      availableNow: candidate.attendance === "on_shift",
      shiftMinutesLeft: (model.team ?? []).find((member) => member.userId === candidate.userId)?.shift?.minutesLeft ?? null,
    }));
}

export type DestinationMode = "team" | "person";

/* ─── The proposal ────────────────────────────────────────────────────────── */

export type LeftOutReason = "insufficient_capacity" | "no_eligible_staff" | PlanRejection["reason"];

export interface LeftOutRoom {
  roomId: string;
  roomNumber: string;
  reason: LeftOutReason;
}

export interface MidshiftPlanInput {
  model: AssignmentsModel;
  sourceUserId: string;
  /** The rooms to move: already checked movable (`summarizeSelection(...).valid`). */
  rooms: readonly MidshiftRoom[];
  mode: DestinationMode;
  /** `person` mode: the one receiver. */
  destinationId: string | null;
  /** Rooms the supervisor pointed at a different receiver than the proposal chose. */
  overrides?: Readonly<Record<string, string>>;
  scopeKey: string | null;
}

export interface MidshiftPlan {
  mode: DestinationMode;
  /** The effective room → receiver map: the proposal with the supervisor's overrides applied. */
  assignments: Record<string, string>;
  proposal: AllocationProposal;
  /** Everyone who may receive in this plan (the team, or the one person). */
  receiverIds: string[];
  leftOut: LeftOutRoom[];
  /** What staging these changes into an EMPTY draft would produce; the real draft is untouched. */
  scratch: AssignmentDraft;
  stage: StageResult;
  /** The before/after review of the scratch draft. Null while the board is unknown. */
  review: DraftReview | null;
  /** Nothing in the proposal can be sent: no room has a receiver. */
  empty: boolean;
}

/** People "the available team" means: listed, verified on shift, not the source. */
export function availableTeamIds(model: AssignmentsModel, sourceUserId: string): string[] {
  return (model.team ?? [])
    .filter((member) => member.listed && member.userId !== sourceUserId && member.attendance === "on_shift")
    .map((member) => member.userId);
}

/**
 * Proposes where the rooms go and previews the result. The proposal reuses the Phase 5 allocator (deterministic, existing
 * workload, estimates, capacity, closeness) with one difference for the whole team: a room every receiver would take past a
 * real capacity limit is LEFT OUT and reported, never forced. A single chosen person keeps the single-room rule — the room goes
 * to them and the review asks for the acknowledgement.
 *
 * Loads are computed from the live board, where the rooms still belong to the source: a receiver's "before" never includes
 * them, and the source's "after" in the review releases exactly the staged rooms.
 */
export function planMidshift(input: MidshiftPlanInput): MidshiftPlan {
  const { model, sourceUserId, rooms, mode, destinationId, overrides = {}, scopeKey } = input;
  const entries = rooms.map((room) => room.entry);
  const receiverIds = mode === "team" ? availableTeamIds(model, sourceUserId) : destinationId && destinationId !== sourceUserId ? [destinationId] : [];
  const proposal: AllocationProposal =
    receiverIds.length === 0
      ? { assignments: {}, shares: [], unresolved: [], unallocated: entries.map((entry) => entry.room.roomId), missingEstimates: 0 }
      : proposeAllocation({ model, rooms: entries, employeeIds: receiverIds, mode: mode === "team" ? "distribute" : "single", strictCapacity: mode === "team" });

  const leftOut: LeftOutRoom[] = [];
  const assignments: Record<string, string> = {};
  const numberOf = new Map(rooms.map((room) => [room.roomId, room.roomNumber] as const));
  const overCapacity = new Set(proposal.overCapacity ?? []);
  for (const room of rooms) {
    const override = overrides[room.roomId];
    const target = override ?? proposal.assignments[room.roomId];
    if (target && target !== sourceUserId) assignments[room.roomId] = target;
    else leftOut.push({ roomId: room.roomId, roomNumber: room.roomNumber, reason: overCapacity.has(room.roomId) ? "insufficient_capacity" : "no_eligible_staff" });
  }

  const hotelDate = model.hotelDate;
  const base = emptyDraft(scopeKey ?? "", hotelDate, model.generatedAt);
  const stage = stageAllocation(model, base, assignments, "midshift");
  for (const rejected of stage.rejected) leftOut.push({ roomId: rejected.roomId, roomNumber: rejected.roomNumber || (numberOf.get(rejected.roomId) ?? ""), reason: rejection(rejected.rejection) });
  for (const roomId of stage.overLimit) leftOut.push({ roomId, roomNumber: numberOf.get(roomId) ?? "", reason: "no_eligible_staff" });
  const staged = new Set(stage.staged);
  const effective = Object.fromEntries(Object.entries(assignments).filter(([roomId]) => staged.has(roomId)));
  return {
    mode,
    assignments: effective,
    proposal,
    receiverIds,
    leftOut,
    scratch: stage.draft,
    stage,
    review: staged.size > 0 && scopeKey ? buildDraftReview(model, stage.draft, scopeKey, new Set()) : null,
    empty: staged.size === 0,
  };
}

function rejection(value: PlanRejection): LeftOutReason {
  return value.reason;
}

/* ─── What changed while the sheet was open ───────────────────────────────── */

export interface SeenSnapshot {
  rooms: Record<string, string>;
  destinations: Record<string, Attendance>;
}

function roomSignature(entry: AssignmentRoom): string {
  return `${entry.ownership.userId ?? "-"}|${entry.room.statusInfo.stage}|${entry.eligibility.softBlocks.join(",")}`;
}

/** What the supervisor has looked at: the source's rooms and the attendance of every possible receiver. */
export function takeSeen(model: AssignmentsModel, sourceUserId: string): SeenSnapshot {
  const rooms: Record<string, string> = {};
  for (const entry of model.rooms ?? []) if (entry.ownership.userId === sourceUserId) rooms[entry.room.roomId] = roomSignature(entry);
  const destinations: Record<string, Attendance> = {};
  for (const member of model.team ?? []) if (member.listed && member.userId !== sourceUserId) destinations[member.userId] = member.attendance;
  return { rooms, destinations };
}

export type RoomChange = "reassigned" | "started" | "completed" | "held" | "gone" | "other";

export interface SeenChanges {
  rooms: { roomId: string; roomNumber: string; change: RoomChange }[];
  destinations: { userId: string; from: Attendance; to: Attendance }[];
}

export function hasChanges(changes: SeenChanges): boolean {
  return changes.rooms.length > 0 || changes.destinations.length > 0;
}

/**
 * Compares the live model with what was seen. Only things that can make a proposal wrong are reported: a room that moved,
 * started, finished, was held back or left, and a receiver whose attendance changed. A person who appears or disappears from
 * the team after the snapshot is reported by attendance only when they were seen.
 */
export function diffSeen(model: AssignmentsModel, sourceUserId: string, seen: SeenSnapshot): SeenChanges {
  const byId = new Map((model.rooms ?? []).map((entry) => [entry.room.roomId, entry] as const));
  const rooms: SeenChanges["rooms"] = [];
  for (const [roomId, signature] of Object.entries(seen.rooms)) {
    const entry = byId.get(roomId);
    if (!entry) {
      rooms.push({ roomId, roomNumber: "", change: "gone" });
      continue;
    }
    if (roomSignature(entry) === signature) continue;
    const kind = classifyRoom(entry).kind;
    const change: RoomChange =
      entry.ownership.userId !== sourceUserId ? "reassigned" : kind === "in_progress" ? "started" : kind === "completed" ? "completed" : kind === "held" ? "held" : "other";
    rooms.push({ roomId, roomNumber: entry.room.roomNumber, change });
  }
  const destinations: SeenChanges["destinations"] = [];
  for (const [userId, from] of Object.entries(seen.destinations)) {
    const member = (model.team ?? []).find((candidate) => candidate.userId === userId);
    const to: Attendance = member ? member.attendance : "unknown";
    if (to !== from) destinations.push({ userId, from, to });
  }
  return { rooms, destinations };
}

/* ─── The existing draft ──────────────────────────────────────────────────── */

/** Rooms of the proposal the unpublished draft already has a change for. */
export function draftOverlap(draft: AssignmentDraft | null, roomIds: Iterable<string>): string[] {
  if (!draft) return [];
  return [...roomIds].filter((roomId) => roomId in draft.changes);
}

/** The midshift part of a draft: how many of its changes came from this workflow, and whose rooms they were. */
export function midshiftChangesIn(draft: AssignmentDraft | null): { count: number; sourceUserIds: string[] } {
  if (!draft) return { count: 0, sourceUserIds: [] };
  const changes = draftChanges(draft).filter((change) => change.source === "midshift");
  return { count: changes.length, sourceUserIds: [...new Set(changes.map((change) => change.fromUserId).filter((id): id is string => id !== null))] };
}
