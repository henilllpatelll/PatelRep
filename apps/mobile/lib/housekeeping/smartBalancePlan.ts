import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { Attendance } from "@/lib/housekeeping/assignmentStaff";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import type { RosterTrust } from "@/lib/housekeeping/roomBoardState";
import {
  isPlannable,
  type ExcludedRoom,
  type ExcludedStaff,
  type SmartScope,
} from "@/lib/housekeeping/smartBalancePool";
import type { SmartInput } from "@/lib/housekeeping/smartBalanceRequest";
import type { SmartToggles } from "@/lib/housekeeping/smartBalancePolicy";
import type {
  MoveKind,
  PlanStatus,
  SmartBalanceResponse,
  UnallocatedReason,
  WireAssumption,
  WireReason,
} from "@/lib/housekeeping/smartBalanceWire";

/* ─── Smart Balance — the proposal the supervisor reviews and edits ──────────
   Pure. A `SmartPlan` is PROPOSED state only: nothing here is live, and nothing in this file talks to the server.
   It is built from the planner's answer after the app has CHECKED that answer against its own request (a plan that
   hands a room to someone who was never offered it, or that disagrees with the owner the supervisor saw, is refused as
   unverified, never shown).

   PROVENANCE. Every proposed change remembers whether it is still exactly what the optimizer recommended
   (`optimizer`) or the supervisor changed it (`edited`). Only an untouched recommendation is published as an AI
   suggestion; an edited one is the supervisor's own decision, and a restore to the optimizer's own answer is the
   optimizer's again. That is what the audit trail later shows.

   WHAT AN EDIT CAN AND CANNOT DO
     - only a CHANGE (a new or moved room) can be moved to another receiver or taken out of the plan;
     - a room that stays with its current owner (`retained`), and any started / finished work, is shown but is not editable;
     - the receiver of an edit must be someone the planner was allowed to offer rooms to;
     - taking a moved room out restores its current owner; taking a new room out leaves it unassigned. */

export type Origin = "optimizer" | "edited";

export interface SmartProposal {
  roomId: string;
  roomNumber: string;
  kind: MoveKind;
  fromUserId: string | null;
  toUserId: string;
  origin: Origin;
  tier: "critical" | "high" | "elevated" | "routine";
  /** Grounded reasons from the planner; only meaningful while `origin` is `optimizer`. */
  reasons: WireReason[];
}

export type LeftOutReason = UnallocatedReason | "taken_out";

export interface LeftOut {
  roomId: string;
  roomNumber: string;
  reason: LeftOutReason;
  tier: SmartProposal["tier"];
}

export interface SmartPlan {
  planId: string;
  status: PlanStatus;
  hotelDate: string;
  scope: SmartScope;
  scopeKey: string;
  /** When the app received the answer (epoch ms). */
  generatedAt: number;
  /** When the board it was built from was verified (epoch ms). */
  snapshotVerifiedAt: number;
  toggles: SmartToggles;
  poolRoomIds: string[];
  /** The optimizer's own answer for each changed room, to recognise a restore (and bring its reasons back). */
  original: Readonly<Record<string, { toUserId: string; reasons: WireReason[] }>>;
  proposals: Readonly<Record<string, SmartProposal>>;
  leftOut: Readonly<Record<string, LeftOut>>;
  receiverIds: string[];
  /** Receivers the property let through despite a rule that normally excludes them. */
  admitted: Readonly<Record<string, "on_break" | "not_on_shift">>;
  excludedRooms: ExcludedRoom[];
  excludedStaff: ExcludedStaff[];
  assumptions: WireAssumption[];
  warnings: string[];
  protectedInProgress: number;
  truncated: number;
  preservedAssignments: number;
  /** Facts the plan assumed, re-checked on every newer board to say the plan is out of date. */
  seen: {
    owners: Readonly<Record<string, string | null>>;
    attendance: Readonly<Record<string, Attendance>>;
    settingsKey: string;
  };
}

/* ─── Building a plan from an answer ──────────────────────────────────────── */

export type PlanRefusal = "wrong_day" | "wrong_scope" | "unverified";

export function settingsKeyOf(model: AssignmentsModel): string {
  const settings = model.settings.value;
  return settings ? JSON.stringify([settings.targetCredits, settings.creditWeights, Object.entries(settings.capacityOverrides).sort()]) : "none";
}

/**
 * Reads the planner's answer against the request that asked for it. Returns null when the answer is not about this
 * request (wrong day / scope) or does not account for the rooms and people that were sent — the caller reports the plan
 * as unverified rather than showing part of it.
 */
export function buildSmartPlan(
  input: SmartInput,
  response: SmartBalanceResponse,
  context: { scopeKey: string; now: number; model: AssignmentsModel },
): { ok: true; plan: SmartPlan } | { ok: false; refusal: PlanRefusal } {
  if (response.date !== input.hotelDate) return { ok: false, refusal: "wrong_day" };
  if (response.scope !== input.scope) return { ok: false, refusal: "wrong_scope" };

  const sent = new Map(input.pool.rooms.map((entry) => [entry.room.roomId, entry] as const));
  const receiverIds = new Set(input.receivers.map((receiver) => receiver.member.userId));
  const accounted = new Set<string>();
  const proposals: Record<string, SmartProposal> = {};
  const original: Record<string, { toUserId: string; reasons: WireReason[] }> = {};
  const leftOut: Record<string, LeftOut> = {};

  for (const row of response.assignments) {
    const entry = sent.get(row.room_id);
    if (!entry || accounted.has(row.room_id)) return { ok: false, refusal: "unverified" };
    // The answer must agree with the owner the supervisor saw and may only name people who were offered rooms.
    if (row.from_user_id !== entry.ownership.userId) return { ok: false, refusal: "unverified" };
    if (row.kind === "retained" ? row.to_user_id !== row.from_user_id : !receiverIds.has(row.to_user_id)) return { ok: false, refusal: "unverified" };
    accounted.add(row.room_id);
    proposals[row.room_id] = {
      roomId: row.room_id,
      roomNumber: entry.room.roomNumber,
      kind: row.kind,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      origin: "optimizer",
      tier: row.tier,
      reasons: row.reasons,
    };
    if (row.kind !== "retained") original[row.room_id] = { toUserId: row.to_user_id, reasons: row.reasons };
  }
  for (const row of response.unallocated) {
    const entry = sent.get(row.room_id);
    if (!entry || accounted.has(row.room_id) || entry.ownership.assigned) return { ok: false, refusal: "unverified" };
    accounted.add(row.room_id);
    leftOut[row.room_id] = { roomId: row.room_id, roomNumber: entry.room.roomNumber, reason: row.reason, tier: row.tier };
  }
  const excludedRooms: ExcludedRoom[] = [...input.pool.excluded];
  for (const row of response.rejectedRooms) {
    if (!sent.has(row.room_id) || accounted.has(row.room_id)) return { ok: false, refusal: "unverified" };
    accounted.add(row.room_id);
    excludedRooms.push({
      roomId: row.room_id,
      roomNumber: sent.get(row.room_id)?.room.roomNumber ?? row.room_number,
      exclusion: { kind: "server", reason: row.reason, ...(row.blocks ? { blocks: row.blocks } : {}) },
    });
  }
  if (response.status === "no_safe_plan") {
    // The planner found no allocation it could validate: it returns no assignments at all. Every unowned room it was
    // given is reported as unplanned (the solver could not allocate it); owned rooms are simply untouched.
    if (response.assignments.length > 0 || response.unallocated.length > 0) return { ok: false, refusal: "unverified" };
    for (const [id, entry] of sent) {
      if (accounted.has(id) || entry.ownership.assigned) continue;
      accounted.add(id);
      leftOut[id] = { roomId: id, roomNumber: entry.room.roomNumber, reason: "solver_no_solution", tier: entry.priority.tier };
    }
    for (const [id, entry] of sent) if (entry.ownership.assigned) accounted.add(id);
  }
  // Every room that was sent is accounted for exactly once.
  if (accounted.size !== sent.size) return { ok: false, refusal: "unverified" };

  const rejectedStaff = new Set(response.rejectedStaff);
  const noCapacity = new Set(response.staff.filter((row) => row.no_capacity).map((row) => row.user_id));
  const excludedStaff: ExcludedStaff[] = [...input.excludedStaff];
  const kept: string[] = [];
  const admitted: Record<string, "on_break" | "not_on_shift"> = {};
  const attendance: Record<string, Attendance> = {};
  for (const receiver of input.receivers) {
    const id = receiver.member.userId;
    attendance[id] = receiver.member.attendance;
    if (rejectedStaff.has(id)) excludedStaff.push({ userId: id, name: receiver.member.name, reason: "not_eligible" });
    else if (noCapacity.has(id)) excludedStaff.push({ userId: id, name: receiver.member.name, reason: "no_capacity" });
    else {
      kept.push(id);
      if (receiver.admittedDespite) admitted[id] = receiver.admittedDespite;
    }
  }

  const owners: Record<string, string | null> = {};
  for (const [id, entry] of sent) owners[id] = entry.ownership.userId;

  return {
    ok: true,
    plan: {
      planId: response.planId,
      status: response.status,
      hotelDate: input.hotelDate,
      scope: input.scope,
      scopeKey: context.scopeKey,
      generatedAt: context.now,
      snapshotVerifiedAt: input.snapshotVerifiedAt,
      toggles: input.toggles,
      poolRoomIds: input.pool.rooms.map((entry) => entry.room.roomId),
      original,
      proposals,
      leftOut,
      receiverIds: kept,
      admitted,
      excludedRooms,
      excludedStaff,
      assumptions: response.assumptions,
      warnings: response.warnings,
      protectedInProgress: input.pool.protectedInProgress,
      truncated: input.pool.truncated,
      preservedAssignments: input.pool.preservedAssignments,
      seen: { owners, attendance, settingsKey: settingsKeyOf(context.model) },
    },
  };
}

/* ─── Reading a plan ──────────────────────────────────────────────────────── */

/** Changes only: rooms that would get a new owner. A retained room is not a change. */
export function changesOf(plan: SmartPlan): SmartProposal[] {
  return Object.values(plan.proposals)
    .filter((proposal) => proposal.kind !== "retained")
    .sort((a, b) => a.roomId.localeCompare(b.roomId));
}

export function editedCount(plan: SmartPlan): number {
  return changesOf(plan).filter((proposal) => proposal.origin === "edited").length;
}

/** The two groups the draft is staged in: an untouched recommendation keeps its AI provenance, an edit does not. */
export function stagePayloads(plan: SmartPlan): { optimizer: Record<string, string>; edited: Record<string, string> } {
  const optimizer: Record<string, string> = {};
  const edited: Record<string, string> = {};
  for (const proposal of changesOf(plan)) (proposal.origin === "optimizer" ? optimizer : edited)[proposal.roomId] = proposal.toUserId;
  return { optimizer, edited };
}

/* ─── Editing ─────────────────────────────────────────────────────────────── */

export type EditRefusal = "unknown_room" | "protected" | "not_a_receiver" | "same_person" | "limit" | "not_addable" | "already_planned";
export type EditResult = { ok: true; plan: SmartPlan } | { ok: false; refusal: EditRefusal };

function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function withProposal(plan: SmartPlan, proposal: SmartProposal): SmartPlan {
  return { ...plan, proposals: { ...plan.proposals, [proposal.roomId]: proposal }, leftOut: omit(plan.leftOut, proposal.roomId) };
}

/** A change after an edit: the optimizer's again - with its reasons - only if it equals the optimizer's own answer. */
function settle(current: SmartProposal, plan: SmartPlan, toUserId: string): SmartProposal {
  const kind: MoveKind = current.fromUserId === toUserId ? "retained" : current.fromUserId === null ? "new" : "moved";
  const original = plan.original[current.roomId];
  if (kind !== "retained" && original && original.toUserId === toUserId) return { ...current, toUserId, kind, origin: "optimizer", reasons: original.reasons };
  return { ...current, toUserId, kind, origin: "edited", reasons: [] };
}

/** Takes a change out of the plan: a moved room goes back to its owner, a new room stays unassigned. */
export function removeProposal(plan: SmartPlan, roomId: string): EditResult {
  const current = plan.proposals[roomId];
  if (!current) return { ok: false, refusal: "unknown_room" };
  if (current.kind === "retained") return { ok: false, refusal: "protected" };
  if (current.fromUserId !== null) return { ok: true, plan: withProposal(plan, settle(current, plan, current.fromUserId)) };
  return {
    ok: true,
    plan: {
      ...plan,
      proposals: omit(plan.proposals, roomId),
      leftOut: { ...plan.leftOut, [roomId]: { roomId, roomNumber: current.roomNumber, reason: "taken_out", tier: current.tier } },
    },
  };
}

export function moveProposal(plan: SmartPlan, roomId: string, toUserId: string): EditResult {
  const current = plan.proposals[roomId];
  if (!current) return { ok: false, refusal: "unknown_room" };
  if (current.kind === "retained") return { ok: false, refusal: "protected" };
  if (current.toUserId === toUserId) return { ok: false, refusal: "same_person" };
  // Moving a room back to the person who already owns it is restoring it, whoever they are today.
  if (toUserId === current.fromUserId) return removeProposal(plan, roomId);
  if (!plan.receiverIds.includes(toUserId)) return { ok: false, refusal: "not_a_receiver" };
  return { ok: true, plan: withProposal(plan, settle(current, plan, toUserId)) };
}

/** A room the plan left out, or one outside the pool the supervisor chose to add, given to a receiver. */
export function addProposal(plan: SmartPlan, entry: AssignmentRoom, toUserId: string): EditResult {
  const roomId = entry.room.roomId;
  if (roomId in plan.proposals) return { ok: false, refusal: "already_planned" };
  if (!plan.receiverIds.includes(toUserId)) return { ok: false, refusal: "not_a_receiver" };
  // Only a room Smart Balance itself could have planned (unowned, nothing hard or soft in the way).
  if (!isPlannable(entry) || entry.ownership.assigned) return { ok: false, refusal: "not_addable" };
  if (changesOf(plan).length >= MAX_BATCH_CHANGES) return { ok: false, refusal: "limit" };
  const base: SmartProposal = { roomId, roomNumber: entry.room.roomNumber, kind: "new", fromUserId: null, toUserId, origin: "edited", tier: entry.priority.tier, reasons: [] };
  return { ok: true, plan: withProposal(plan, settle(base, plan, toUserId)) };
}

/** Rooms the supervisor could still add: unowned, plannable, not already in the plan. */
export function addableRooms(model: AssignmentsModel, plan: SmartPlan): AssignmentRoom[] {
  return (model.rooms ?? []).filter((entry) => entry.eligibility.autoAssignable && !(entry.room.roomId in plan.proposals));
}

/* ─── Is the plan still true? ─────────────────────────────────────────────── */

export type StaleReason =
  | { kind: "day" }
  | { kind: "scope" }
  | { kind: "board_unavailable" }
  | { kind: "attendance_unverified" }
  | { kind: "settings_changed" }
  | { kind: "rooms_changed"; roomNumbers: string[] }
  | { kind: "staff_changed"; userIds: string[] };

/**
 * Re-reads the plan against the live model. An empty list means every fact the plan assumed still holds. A non-empty list
 * blocks adding the plan to the draft: the supervisor refreshes and generates a new one - the old plan is never silently
 * recalculated, and a local preview is never enough to publish (the server re-validates every change at the write).
 */
export function planFreshness(model: AssignmentsModel, plan: SmartPlan, scopeKey: string | null): StaleReason[] {
  const reasons: StaleReason[] = [];
  if (scopeKey === null || plan.scopeKey !== scopeKey) reasons.push({ kind: "scope" });
  if (model.hotelDate !== plan.hotelDate) reasons.push({ kind: "day" });
  if (!model.rooms || !model.team) {
    reasons.push({ kind: "board_unavailable" });
    return reasons;
  }
  const trust: RosterTrust = model.rosterTrust;
  if (trust !== "verified") reasons.push({ kind: "attendance_unverified" });
  if (settingsKeyOf(model) !== plan.seen.settingsKey) reasons.push({ kind: "settings_changed" });

  const live = new Map(model.rooms.map((entry) => [entry.room.roomId, entry] as const));
  const changed: string[] = [];
  for (const roomId of plan.poolRoomIds) {
    const entry = live.get(roomId);
    const proposal = plan.proposals[roomId];
    const roomNumber = proposal?.roomNumber ?? plan.leftOut[roomId]?.roomNumber ?? entry?.room.roomNumber ?? roomId;
    if (!entry || entry.ownership.userId !== (plan.seen.owners[roomId] ?? null) || !isPlannable(entry)) changed.push(roomNumber);
  }
  // Rooms the supervisor added from outside the pool must also still be plannable and unowned.
  for (const proposal of Object.values(plan.proposals)) {
    if (plan.poolRoomIds.includes(proposal.roomId)) continue;
    const entry = live.get(proposal.roomId);
    if (!entry || entry.ownership.assigned || !isPlannable(entry)) changed.push(proposal.roomNumber);
  }
  if (changed.length > 0) reasons.push({ kind: "rooms_changed", roomNumbers: [...new Set(changed)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) });

  const members = new Map((model.team ?? []).map((member) => [member.userId, member] as const));
  const receiving = new Set(changesOf(plan).map((proposal) => proposal.toUserId));
  const staffChanged = [...receiving].filter((userId) => {
    const member = members.get(userId);
    return !member || !member.listed || member.attendance !== plan.seen.attendance[userId];
  });
  if (staffChanged.length > 0) reasons.push({ kind: "staff_changed", userIds: staffChanged.sort() });
  return reasons;
}
