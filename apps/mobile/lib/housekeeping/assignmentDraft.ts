import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import {
  draftChanges,
  planChange,
  stageChange,
  unstageChange,
  validateDraft,
  type AssignmentDraft,
  type ConflictDetail,
  type DraftIssueReason,
  type PlanRejection,
  type PlanSource,
  type PlannedChange,
} from "@/lib/housekeeping/assignmentPlan";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";

/* ─── Supervisor Assignments — the one unpublished draft ────────────────────
   Pure. The draft is the Phase 1 `AssignmentDraft` (proposed `PlannedChange`s, at most one per room, each prepared
   against the owner the supervisor SAW). Manual bulk distribution fills it today; Smart Balance and the AI editor
   will fill the SAME draft and publish through the SAME reviewed, atomic path — there is no second draft shape.

   A draft is only ever PROPOSED state. Nothing in it is live until the server confirms the publication, and the
   board it was prepared against can move underneath it: `checkDraft` re-reads every change against the live model
   and says which are still sound, `rebaseDraft` re-plans the ones whose owner moved so the supervisor can review
   them again (never silently publishing the old plan). */

/* ─── Staging ─────────────────────────────────────────────────────────────── */

export interface StageResult {
  draft: AssignmentDraft;
  /** Rooms now in the draft (added or replaced). */
  staged: string[];
  rejected: { roomId: string; roomNumber: string; rejection: PlanRejection }[];
  /** More changes were proposed than one publication can carry; the extra ones were left out. */
  overLimit: string[];
}

/**
 * Plans each `roomId → userId` against the live model and stages those that hold up. A room that is not assignable
 * (or whose person is not a verified, listed housekeeper) is returned in `rejected` with the exact reason and is NOT
 * staged. A room already in the draft is replaced. A soft-blocked room is rejected (`needs_acknowledgement`): `planChange`
 * is given no acknowledgement and a bulk publication never carries one. The draft never grows past one publication.
 */
export function stageAllocation(model: AssignmentsModel, draft: AssignmentDraft, assignments: Readonly<Record<string, string>>, source: PlanSource): StageResult {
  let next = draft;
  const staged: string[] = [];
  const rejected: StageResult["rejected"] = [];
  const overLimit: string[] = [];
  const order = (model.rooms ?? []).map((entry) => entry.room.roomId).filter((roomId) => roomId in assignments);
  // Ids the model does not contain still get a verdict (room_missing), in a stable order.
  for (const roomId of Object.keys(assignments).sort()) if (!order.includes(roomId)) order.push(roomId);
  for (const roomId of order) {
    const plan = planChange(model, { roomId, toUserId: assignments[roomId], source });
    if (!plan.ok) {
      const entry = (model.rooms ?? []).find((candidate) => candidate.room.roomId === roomId);
      rejected.push({ roomId, roomNumber: entry?.room.roomNumber ?? "", rejection: plan.rejection });
      continue;
    }
    if (!(roomId in next.changes) && Object.keys(next.changes).length >= MAX_BATCH_CHANGES) {
      overLimit.push(roomId);
      continue;
    }
    next = stageChange(next, plan.change);
    staged.push(roomId);
  }
  return { draft: next, staged, rejected, overLimit };
}

/**
 * Points an existing proposed change at a different person (re-planned against the live model). Moving a Smart Balance
 * recommendation makes it the supervisor's own decision (`ai_editor`), so it is never published as an untouched AI
 * suggestion. A manual (bulk / single) change keeps its source.
 */
export function moveChange(model: AssignmentsModel, draft: AssignmentDraft, roomId: string, toUserId: string): StageResult {
  const existing = draft.changes[roomId];
  const source: PlanSource = existing?.source === "smart_balance" ? "ai_editor" : (existing?.source ?? "bulk");
  return stageAllocation(model, draft, { [roomId]: toUserId }, source);
}

export function removeFromDraft(draft: AssignmentDraft, roomId: string): AssignmentDraft {
  return unstageChange(draft, roomId);
}

/** The proposed changes that hand rooms TO this person. */
export function changesTo(draft: AssignmentDraft, userId: string): PlannedChange[] {
  return draftChanges(draft).filter((change) => change.toUserId === userId);
}

/** Everyone the draft touches: gaining or losing a room. */
export function affectedUserIds(draft: AssignmentDraft): string[] {
  const ids = new Set<string>();
  for (const change of draftChanges(draft)) {
    if (change.toUserId) ids.add(change.toUserId);
    if (change.fromUserId) ids.add(change.fromUserId);
  }
  return [...ids];
}

/* ─── Health against the live board ───────────────────────────────────────── */

export type DraftProblemReason = DraftIssueReason | "soft_blocked";

export interface DraftProblem {
  change: PlannedChange;
  reason: DraftProblemReason;
}

export interface DraftHealth {
  /** Changes that are still sound against the live board. */
  ready: PlannedChange[];
  problems: DraftProblem[];
  /** Per-room detail for the conflict screen (who has it now, what stage). */
  conflicts: ConflictDetail[];
  /** The draft belongs to this hotel/person/day and the board is known. When false nothing in it can be published. */
  current: boolean;
}

/**
 * Re-checks the whole draft against `model`. Beyond `validateDraft` (room still there and assignable, owner
 * unchanged, person still listed, same hotel/person/day) it also catches a room that gained a soft block after
 * planning, which the server would refuse.
 */
export function checkDraft(draft: AssignmentDraft, model: AssignmentsModel, scopeKey: string | null): DraftHealth {
  const base = validateDraft(draft, model, scopeKey);
  const current = !base.issues.some((issue) => issue.reason === "scope_changed" || issue.reason === "board_unavailable");
  const problems: DraftProblem[] = base.issues.map((issue) => ({ change: issue.change, reason: issue.reason }));
  const ready: PlannedChange[] = [];
  for (const change of base.ready) {
    const entry = (model.rooms ?? []).find((candidate) => candidate.room.roomId === change.roomId);
    if (change.kind !== "remove" && entry && entry.eligibility.softBlocks.length > 0) problems.push({ change, reason: "soft_blocked" });
    else ready.push(change);
  }
  return { ready, problems, conflicts: base.conflicts, current };
}

/* ─── Rebasing onto a newer board ─────────────────────────────────────────── */

export interface RebaseResult {
  draft: AssignmentDraft;
  /** Rooms re-planned against the current owner: they need to be looked at again. */
  rebased: string[];
  /** Rooms that can no longer be proposed (and why); they are out of the draft. */
  dropped: { change: PlannedChange; reason: PlanRejection["reason"] | DraftProblemReason }[];
}

/**
 * Brings a draft that went stale up to date with `model`: unaffected changes are kept untouched; a change whose owner
 * moved (but whose room and person are still fine) is re-planned against the NEW owner and reported as `rebased`; one
 * that cannot be proposed any more is dropped and reported. Never publishes anything, and never keeps a change it could
 * not re-validate. A draft from another hotel/person/day is not rebased at all (the caller discards it).
 */
export function rebaseDraft(draft: AssignmentDraft, model: AssignmentsModel, scopeKey: string | null): RebaseResult {
  const health = checkDraft(draft, model, scopeKey);
  if (!health.current) return { draft, rebased: [], dropped: [] };
  let next = draft;
  const rebased: string[] = [];
  const dropped: RebaseResult["dropped"] = [];
  for (const problem of health.problems) {
    const { change } = problem;
    next = unstageChange(next, change.roomId);
    if (problem.reason === "room_missing" || problem.reason === "not_assignable" || problem.reason === "soft_blocked" || problem.reason === "employee_unknown") {
      dropped.push({ change, reason: problem.reason });
      continue;
    }
    const plan = planChange(model, { roomId: change.roomId, toUserId: change.toUserId, source: change.source });
    if (plan.ok) {
      next = stageChange(next, plan.change);
      rebased.push(change.roomId);
    } else {
      dropped.push({ change, reason: plan.rejection.reason });
    }
  }
  return { draft: next, rebased, dropped };
}

/* ─── Exclusions ──────────────────────────────────────────────────────────── */

/** A room the supervisor selected that did not make it into the draft, and why. Shown in the review. */
export interface DraftExclusion {
  roomId: string;
  roomNumber: string;
  reason: PlanRejection["reason"] | "no_longer_eligible" | "over_limit";
}
