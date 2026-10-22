import { planAssignmentRemoval, type AssignmentRemovalPlan, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { detectConflict, judgeOutcome, type AssignmentFailure, type ConflictKind, type VerifiedOutcome } from "@/lib/housekeeping/roomAssignment";
import type { AssignmentInput } from "@/lib/api/housekeepingSupervisor";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import { expectedOwnerId, expectedOwnerOf, type ExpectedOwner } from "@/lib/housekeeping/assignmentOwnership";
import {
  computePersonLoad,
  projectPersonLoad,
  type LoadContext,
  type PersonLoad,
  type WorkloadWarning,
} from "@/lib/housekeeping/assignmentWorkload";

/* ─── Supervisor Assignments — planning and publication contracts ───────────
   Pure types and validation for everything that EDITS assignments: one room, a selected batch, a bulk
   allocation, a Smart Balance plan, the AI allocation editor. Nothing here talks to the server.

   A PLAN is a set of `PlannedChange`s, at most one per room, each prepared against the owner the supervisor
   SAW (`expected`). Publishing sends them with that expectation so the server can refuse a stale one.

   WHAT THE SERVER GUARANTEES TODAY (POST /housekeeping/assignments, apps/api/routers/housekeeping.py)
     • Items WITH an expectation (`expected_assigned_to` / `expect_unassigned`) are pre-checked together:
       a room that already started or finished, or whose owner changed, makes the WHOLE request 409 before
       anything is written. The write itself is then done ONE ITEM AT A TIME, each carrying the expected
       owner, so a change landing between the pre-check and item N makes item N 409 after items 1..N-1 are
       saved.
     • Items WITHOUT an expectation are one upsert and are NOT checked against the room's stage or owner —
       they can overwrite a started room. Nothing in Assignments may send them (`toSaveRequests` never does).
     • The room_status mirror, clean-type reconciliation and push notifications run after the rows, outside
       any transaction. Removals are a separate DELETE per room.
     • A request holds at most MAX_ASSIGNMENTS_PER_REQUEST items and carries one `is_ai_suggested` flag.
   THEREFORE there is NO atomic multi-room publish. A publication can be partly applied. This module never
   claims otherwise: `PublicationSummary.atomic` is the literal `false`, results are per room, and an
   unclear outcome is `unknown_outcome` until a fresh read of the room settles it (`settleUncertain`). A
   guarded all-or-nothing batch endpoint belongs to Phase 5. */

export const MAX_ASSIGNMENTS_PER_REQUEST = 200;

/* ─── Changes and the draft ───────────────────────────────────────────────── */

export type PlanSource = "single" | "bulk" | "smart_balance" | "ai_editor";
export type ChangeKind = "assign" | "reassign" | "remove";

export interface PlannedChange {
  roomId: string;
  roomNumber: string;
  kind: ChangeKind;
  /** The owner the supervisor saw; null = unassigned. */
  fromUserId: string | null;
  /** The new owner; null only for `remove`. */
  toUserId: string | null;
  /** What the write asserts about the current owner. Always equal to `fromUserId`. */
  expected: ExpectedOwner;
  /** Soft blocks the supervisor knowingly accepted. Must cover every soft block the room had when planned. */
  acknowledged: SoftBlock[];
  /** How a `remove` is carried out (dated row vs status mirror); `none` for assign/reassign. */
  removal: AssignmentRemovalPlan;
  source: PlanSource;
}

/** Unpublished changes. Bound to ONE hotel/user scope and ONE hotel date: it is discarded, never carried over. */
export interface AssignmentDraft {
  scopeKey: string;
  hotelDate: string;
  /** When the board the changes were prepared against was verified (epoch ms). */
  baseVerifiedAt: number;
  changes: Readonly<Record<string, PlannedChange>>;
}

export function emptyDraft(scopeKey: string, hotelDate: string, baseVerifiedAt: number): AssignmentDraft {
  return { scopeKey, hotelDate, baseVerifiedAt, changes: {} };
}

export function draftChanges(draft: AssignmentDraft): PlannedChange[] {
  return Object.values(draft.changes);
}

/** Add or replace the change for a room. */
export function stageChange(draft: AssignmentDraft, change: PlannedChange): AssignmentDraft {
  return { ...draft, changes: { ...draft.changes, [change.roomId]: change } };
}

export function unstageChange(draft: AssignmentDraft, roomId: string): AssignmentDraft {
  if (!(roomId in draft.changes)) return draft;
  const changes = { ...draft.changes };
  delete changes[roomId];
  return { ...draft, changes };
}

/** Whether the draft still belongs to the screen's current scope and hotel date. */
export function draftIsCurrent(draft: AssignmentDraft, scopeKey: string | null, hotelDate: string): boolean {
  return scopeKey !== null && draft.scopeKey === scopeKey && draft.hotelDate === hotelDate;
}

/* ─── Planning one change ─────────────────────────────────────────────────── */

export type PlanRejection =
  | { reason: "board_unavailable" }
  | { reason: "room_missing" }
  /** A hard block (in progress, awaiting inspection, ready, out of service, unknown status). */
  | { reason: "room_blocked"; block: string }
  | { reason: "nothing_to_remove" }
  /** A soft block the caller did not acknowledge. */
  | { reason: "needs_acknowledgement"; missing: SoftBlock[] }
  | { reason: "employee_unknown" }
  | { reason: "employee_unverifiable" }
  | { reason: "already_assigned_to_employee" };

export type PlanResult = { ok: true; change: PlannedChange } | { ok: false; rejection: PlanRejection };

export interface PlanRequest {
  roomId: string;
  /** The new owner, or null to remove the assignment. */
  toUserId: string | null;
  acknowledged?: readonly SoftBlock[];
  source: PlanSource;
}

/** Prepares one change against the CURRENT model, or says exactly why it cannot be made. */
export function planChange(model: AssignmentsModel, request: PlanRequest): PlanResult {
  if (!model.rooms || !model.team) return { ok: false, rejection: { reason: "board_unavailable" } };
  const entry = model.rooms.find((candidate) => candidate.room.roomId === request.roomId);
  if (!entry) return { ok: false, rejection: { reason: "room_missing" } };
  const { eligibility, ownership, room } = entry;
  const fromUserId = ownership.userId;

  if (request.toUserId === null) {
    if (!ownership.assigned) return { ok: false, rejection: { reason: "nothing_to_remove" } };
    if (!eligibility.canRemove) return { ok: false, rejection: { reason: "room_blocked", block: eligibility.hardBlock ?? eligibility.kind } };
    return {
      ok: true,
      change: {
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        kind: "remove",
        fromUserId,
        toUserId: null,
        expected: expectedOwnerOf(fromUserId),
        acknowledged: [],
        removal: planAssignmentRemoval(room),
        source: request.source,
      },
    };
  }

  if (eligibility.hardBlock) return { ok: false, rejection: { reason: "room_blocked", block: eligibility.hardBlock } };
  if (!model.staffListKnown) return { ok: false, rejection: { reason: "employee_unverifiable" } };
  const member = model.team.find((candidate) => candidate.userId === request.toUserId);
  if (!member || !member.listed) return { ok: false, rejection: { reason: "employee_unknown" } };
  if (fromUserId === request.toUserId) return { ok: false, rejection: { reason: "already_assigned_to_employee" } };
  const acknowledged = new Set(request.acknowledged ?? []);
  const missing = eligibility.requiresAcknowledgement.filter((block) => !acknowledged.has(block));
  if (missing.length > 0) return { ok: false, rejection: { reason: "needs_acknowledgement", missing } };

  return {
    ok: true,
    change: {
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      kind: fromUserId ? "reassign" : "assign",
      fromUserId,
      toUserId: request.toUserId,
      expected: expectedOwnerOf(fromUserId),
      acknowledged: [...eligibility.requiresAcknowledgement],
      removal: { kind: "none" },
      source: request.source,
    },
  };
}

/* ─── Validating a draft against a newer model ───────────────────────────── */

export type DraftIssueReason = "scope_changed" | "board_unavailable" | ConflictKind | "employee_unknown";

export interface DraftIssue {
  change: PlannedChange;
  reason: DraftIssueReason;
}

export interface ConflictDetail {
  roomId: string;
  roomNumber: string;
  kind: ConflictKind;
  /** The owner the supervisor planned against (null = unassigned). */
  expectedOwnerId: string | null;
  /** The owner now (null = unassigned; undefined when the room is gone). */
  currentOwnerId: string | null | undefined;
  currentStage: BoardRoom["statusInfo"]["stage"] | null;
}

export interface DraftValidation {
  /** Changes still valid against the model: safe to send. */
  ready: PlannedChange[];
  issues: DraftIssue[];
  conflicts: ConflictDetail[];
}

/**
 * Re-checks every change against `model` (normally a fresh read taken just before publishing). A change is
 * `ready` only if its room still exists, is still assignable (or removable), still has the owner the supervisor
 * saw, and its employee is still known. A draft prepared for another hotel/user/date is entirely refused.
 */
export function validateDraft(draft: AssignmentDraft, model: AssignmentsModel, scopeKey: string | null): DraftValidation {
  const changes = draftChanges(draft);
  if (!draftIsCurrent(draft, scopeKey, model.hotelDate)) {
    return { ready: [], issues: changes.map((change) => ({ change, reason: "scope_changed" })), conflicts: [] };
  }
  if (!model.rooms || !model.team) {
    return { ready: [], issues: changes.map((change) => ({ change, reason: "board_unavailable" })), conflicts: [] };
  }
  const byRoom = new Map(model.rooms.map((entry) => [entry.room.roomId, entry.room]));
  const ready: PlannedChange[] = [];
  const issues: DraftIssue[] = [];
  const conflicts: ConflictDetail[] = [];
  for (const change of changes) {
    const fresh = byRoom.get(change.roomId);
    const kind = detectConflict(fresh, expectedOwnerId(change.expected), {
      forRemoval: change.kind === "remove",
      ...(change.toUserId ? { targetId: change.toUserId } : {}),
    });
    if (kind) {
      issues.push({ change, reason: kind });
      conflicts.push({
        roomId: change.roomId,
        roomNumber: change.roomNumber,
        kind,
        expectedOwnerId: expectedOwnerId(change.expected),
        currentOwnerId: fresh ? fresh.assignment.userId : undefined,
        currentStage: fresh ? fresh.statusInfo.stage : null,
      });
      continue;
    }
    if (change.toUserId && !model.team.some((member) => member.userId === change.toUserId && member.listed)) {
      issues.push({ change, reason: "employee_unknown" });
      continue;
    }
    ready.push(change);
  }
  return { ready, issues, conflicts };
}

/* ─── Preview: what the plan does to the team ─────────────────────────────── */

export interface StaffDelta {
  userId: string;
  name: string | null;
  roomsAdded: number;
  roomsReleased: number;
  before: PersonLoad;
  after: PersonLoad;
  /** Warnings the plan would CREATE for this person (present after, absent before). */
  newWarnings: WorkloadWarning[];
}

export interface DraftPreview {
  changeCount: number;
  staff: StaffDelta[];
  /** Remaining work nobody owns, before and after the plan. */
  unassignedBefore: number;
  unassignedAfter: number;
}

export function previewDraft(model: AssignmentsModel, changes: readonly PlannedChange[]): DraftPreview | null {
  if (!model.rooms || !model.team) return null;
  const rooms = model.rooms.map((entry) => entry.room);
  const roomById = new Map(rooms.map((room) => [room.roomId, room]));
  const touched = new Set<string>();
  for (const change of changes) {
    if (change.fromUserId) touched.add(change.fromUserId);
    if (change.toUserId) touched.add(change.toUserId);
  }

  const staff: StaffDelta[] = [];
  for (const member of model.team) {
    if (!touched.has(member.userId)) continue;
    const context: LoadContext = { settings: model.settings.value, shiftTime: member.shift, ...(model.learned ? { learned: model.learned } : {}) };
    const add: BoardRoom[] = [];
    const release: string[] = [];
    for (const change of changes) {
      const room = roomById.get(change.roomId);
      if (!room) continue;
      if (change.toUserId === member.userId && change.fromUserId !== member.userId) add.push(room);
      if (change.fromUserId === member.userId && change.toUserId !== member.userId) release.push(change.roomId);
    }
    const before = computePersonLoad(member.userId, rooms, context);
    const after = projectPersonLoad(member.userId, rooms, { add, release }, context);
    staff.push({
      userId: member.userId,
      name: member.name,
      roomsAdded: add.length,
      roomsReleased: release.length,
      before,
      after,
      newWarnings: after.warnings.filter((warning) => !before.warnings.includes(warning)),
    });
  }

  let delta = 0;
  for (const change of changes) {
    const room = roomById.get(change.roomId);
    const remaining = room && (room.statusInfo.stage === "to_clean" || room.statusInfo.stage === "in_progress");
    if (!remaining) continue;
    if (change.fromUserId === null && change.toUserId !== null) delta -= 1;
    if (change.fromUserId !== null && change.toUserId === null) delta += 1;
  }
  const unassignedBefore = model.property?.unassignedRooms ?? 0;
  return { changeCount: changes.length, staff, unassignedBefore, unassignedAfter: unassignedBefore + delta };
}

/* ─── Turning changes into requests ───────────────────────────────────────── */

export interface SaveRequests {
  /** Conditional items only, grouped by the `is_ai_suggested` flag they must be sent with, at most MAX per request. */
  assignmentBatches: { isAiSuggested: boolean; assignments: AssignmentInput[] }[];
  /** Removals, each its own DELETE. */
  removals: { roomId: string; roomNumber: string; plan: AssignmentRemovalPlan }[];
}

/**
 * Every assignment item carries its expected owner; an item that could not carry one is never produced.
 * Smart Balance and AI-editor items are flagged AI-suggested, manual ones are not — a request holds one flag.
 */
export function toSaveRequests(changes: readonly PlannedChange[]): SaveRequests {
  const items = (ai: boolean): AssignmentInput[] =>
    changes
      .filter((change) => change.toUserId !== null && (change.source === "smart_balance" || change.source === "ai_editor") === ai)
      .map((change) => ({
        room_id: change.roomId,
        housekeeper_id: change.toUserId as string,
        ...change.expected,
        // The server re-derives the room's soft blocks and refuses unless all of them are listed here. An empty
        // list asserts "nothing was acknowledged", so a room that became DND after planning is refused too.
        acknowledged_blocks: [...change.acknowledged],
      }));
  const assignmentBatches: SaveRequests["assignmentBatches"] = [];
  for (const isAiSuggested of [false, true]) {
    const all = items(isAiSuggested);
    for (let index = 0; index < all.length; index += MAX_ASSIGNMENTS_PER_REQUEST) {
      assignmentBatches.push({ isAiSuggested, assignments: all.slice(index, index + MAX_ASSIGNMENTS_PER_REQUEST) });
    }
  }
  const removals = changes
    .filter((change) => change.kind === "remove")
    .map((change) => ({ roomId: change.roomId, roomNumber: change.roomNumber, plan: change.removal }));
  return { assignmentBatches, removals };
}

/* ─── Outcomes ────────────────────────────────────────────────────────────── */

export type RoomOutcome = "applied" | "conflict" | "rejected" | "failed" | "unknown_outcome" | "not_attempted";

export interface RoomResult {
  roomId: string;
  roomNumber: string;
  outcome: RoomOutcome;
  failure?: AssignmentFailure;
}

export interface PublicationSummary {
  /** Always false: see the module header. A publication can be partly applied. */
  readonly atomic: false;
  applied: number;
  conflicts: number;
  rejected: number;
  failed: number;
  unknown: number;
  notAttempted: number;
  /** Every change was confirmed applied. */
  allApplied: boolean;
  /** At least one outcome is unclear and must be read back before anything is retried. */
  needsVerification: boolean;
}

export function summarizePublication(results: readonly RoomResult[]): PublicationSummary {
  const count = (outcome: RoomOutcome) => results.filter((result) => result.outcome === outcome).length;
  const applied = count("applied");
  const unknown = count("unknown_outcome");
  return {
    atomic: false,
    applied,
    conflicts: count("conflict"),
    rejected: count("rejected"),
    failed: count("failed"),
    unknown,
    notAttempted: count("not_attempted"),
    allApplied: results.length > 0 && applied === results.length,
    needsVerification: unknown > 0,
  };
}

/**
 * Settles an `unknown_outcome` from a fresh read of the room. `applied` and `not_applied` are definite;
 * `unverifiable` (the room is gone, or someone else changed it) must not be retried blindly.
 */
export function settleUncertain(change: PlannedChange, fresh: BoardRoom | null | undefined): VerifiedOutcome {
  const expected = change.toUserId ? ({ kind: "assigned", userId: change.toUserId } as const) : ({ kind: "unassigned" } as const);
  return judgeOutcome(fresh, expected, change.fromUserId);
}
