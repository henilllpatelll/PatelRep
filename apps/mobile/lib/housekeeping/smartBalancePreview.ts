import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { emptyDraft, previewDraft, type PlannedChange, type PlanRejection } from "@/lib/housekeeping/assignmentPlan";
import { stageAllocation } from "@/lib/housekeeping/assignmentDraft";
import { loadView, type LoadView } from "@/lib/housekeeping/assignmentPicker";
import { GATING_WARNINGS } from "@/lib/housekeeping/assignmentPicker";
import type { Attendance } from "@/lib/housekeeping/assignmentStaff";
import type { WorkloadWarning } from "@/lib/housekeeping/assignmentWorkload";
import { addableRooms, changesOf, stagePayloads, type LeftOut, type SmartPlan, type SmartProposal } from "@/lib/housekeeping/smartBalancePlan";
import type { WireReason } from "@/lib/housekeeping/smartBalanceWire";

/* ─── Smart Balance — what the preview shows ────────────────────────────────
   Pure. Every figure is derived from the plan AND the live model, never typed in:

     - the changes are exactly what "Add to draft" would stage (`canonicalChanges` runs the same `stageAllocation`),
       so the preview, the draft and the review cannot disagree;
     - the before / after workload of each person is the shared workload model's (`previewDraft`), so it matches Team;
     - a missing estimate stays visible ("at least", "N rooms without an estimate") - nothing is padded to look complete;
     - an unallocated room is reported as capacity / solver, a blocked room as blocked: the two are never mixed. */

export interface CanonicalChanges {
  changes: PlannedChange[];
  /** Proposed changes the app's own checks refuse right now (e.g. the person is no longer a verified, listed housekeeper). */
  unplaceable: { roomId: string; roomNumber: string; rejection: PlanRejection }[];
}

/** The plan as the Phase 5 draft would hold it. Reads the model only; stages nothing anywhere. */
export function canonicalChanges(model: AssignmentsModel, plan: SmartPlan): CanonicalChanges {
  const payload = stagePayloads(plan);
  let draft = emptyDraft(plan.scopeKey, plan.hotelDate, plan.snapshotVerifiedAt);
  const unplaceable: CanonicalChanges["unplaceable"] = [];
  for (const [assignments, source] of [[payload.optimizer, "smart_balance"], [payload.edited, "ai_editor"]] as const) {
    if (Object.keys(assignments).length === 0) continue;
    const result = stageAllocation(model, draft, assignments, source);
    draft = result.draft;
    for (const rejected of result.rejected) unplaceable.push({ roomId: rejected.roomId, roomNumber: rejected.roomNumber, rejection: rejected.rejection });
  }
  return { changes: Object.values(draft.changes).sort((a, b) => a.roomId.localeCompare(b.roomId)), unplaceable };
}

/* ─── The preview ─────────────────────────────────────────────────────────── */

export interface PreviewStaff {
  userId: string;
  name: string | null;
  attendance: Attendance;
  before: LoadView;
  after: LoadView;
  /** Rooms this person would gain, by number (room order): previously unassigned and moved from someone else. */
  gains: string[];
  gainsNew: string[];
  gainsMoved: string[];
  /** Rooms this person would lose. */
  releases: string[];
  /** Warnings the plan would CREATE for them. */
  newWarnings: WorkloadWarning[];
  /** The property let this person through a rule that normally excludes them; the review will ask for an acknowledgement. */
  admitted: "on_break" | "not_on_shift" | null;
  /** Known remaining minutes change; `partial` when either side is a lower bound. null = not computable. */
  deltaMinutes: { value: number; partial: boolean } | null;
}

export interface SmartCounts {
  /** Rooms the plan covered (verified by the server). */
  eligible: number;
  planned: number;
  newRooms: number;
  moved: number;
  /** Existing assignments that stay exactly as they are. */
  preserved: number;
  unallocated: number;
  takenOut: number;
  urgentCovered: number;
  urgentUnallocated: number;
  excludedRooms: number;
  blockedRooms: number;
  protectedInProgress: number;
  affectedStaff: number;
  excludedStaff: number;
  missingEstimates: number;
  capacityWarnings: number;
  edited: number;
}

export interface SmartPreview {
  counts: SmartCounts;
  staff: PreviewStaff[];
  leftOut: LeftOut[];
  changes: PlannedChange[];
  unplaceable: CanonicalChanges["unplaceable"];
}

const URGENT = new Set(["critical", "high"]);

export function buildPreview(model: AssignmentsModel, plan: SmartPlan): SmartPreview | null {
  if (!model.rooms || !model.team) return null;
  const { changes, unplaceable } = canonicalChanges(model, plan);
  const draftPreview = previewDraft(model, changes);
  if (!draftPreview) return null;
  const byRoom = new Map(model.rooms.map((entry) => [entry.room.roomId, entry] as const));

  const staff = draftPreview.staff
    .map<PreviewStaff>((delta) => {
      const member = model.team?.find((candidate) => candidate.userId === delta.userId);
      const before = loadView(delta.before);
      const after = loadView(delta.after);
      const known = before.minutes.minutes !== null && after.minutes.minutes !== null;
      return {
        userId: delta.userId,
        name: delta.name,
        attendance: member?.attendance ?? "unknown",
        before,
        after,
        gains: changes.filter((change) => change.toUserId === delta.userId).map((change) => change.roomNumber).sort(compareNumbers),
        gainsNew: changes.filter((change) => change.toUserId === delta.userId && change.kind === "assign").map((change) => change.roomNumber).sort(compareNumbers),
        gainsMoved: changes.filter((change) => change.toUserId === delta.userId && change.kind === "reassign").map((change) => change.roomNumber).sort(compareNumbers),
        releases: changes.filter((change) => change.fromUserId === delta.userId).map((change) => change.roomNumber).sort(compareNumbers),
        newWarnings: delta.newWarnings,
        admitted: plan.admitted[delta.userId] ?? null,
        deltaMinutes: known ? { value: (after.minutes.minutes as number) - (before.minutes.minutes as number), partial: before.minutes.partial || after.minutes.partial } : null,
      };
    })
    .sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? "").localeCompare(b.name ?? "") || a.userId.localeCompare(b.userId));

  const leftOut = Object.values(plan.leftOut).sort((a, b) => compareNumbers(a.roomNumber, b.roomNumber));
  const retained = Object.values(plan.proposals).filter((proposal) => proposal.kind === "retained").length;
  const stagedRoomIds = new Set(changes.map((change) => change.roomId));
  const serverRejected = plan.excludedRooms.filter((room) => room.exclusion.kind === "server").length;
  const counts: SmartCounts = {
    eligible: plan.poolRoomIds.length - serverRejected,
    planned: changes.length,
    newRooms: changes.filter((change) => change.kind === "assign").length,
    moved: changes.filter((change) => change.kind === "reassign").length,
    preserved: retained + plan.preservedAssignments,
    unallocated: leftOut.filter((item) => item.reason !== "taken_out").length,
    takenOut: leftOut.filter((item) => item.reason === "taken_out").length,
    urgentCovered: changesOf(plan).filter((proposal) => stagedRoomIds.has(proposal.roomId) && URGENT.has(proposal.tier)).length,
    urgentUnallocated: leftOut.filter((item) => URGENT.has(item.tier)).length,
    excludedRooms: plan.excludedRooms.length,
    blockedRooms: plan.excludedRooms.filter((room) => room.exclusion.kind === "soft_blocked" || (room.exclusion.kind === "server" && room.exclusion.reason === "room_blocked")).length,
    protectedInProgress: plan.protectedInProgress,
    affectedStaff: staff.length,
    excludedStaff: plan.excludedStaff.length,
    missingEstimates: changes.filter((change) => byRoom.get(change.roomId)?.estimate === null).length,
    capacityWarnings: staff.filter((person) => person.newWarnings.some((warning) => GATING_WARNINGS.includes(warning))).length,
    edited: changesOf(plan).filter((proposal) => proposal.origin === "edited").length,
  };
  return { counts, staff, leftOut, changes, unplaceable };
}

export function compareNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/* ─── One person's part of the plan ───────────────────────────────────────── */

export type ExistingStatus = "protected" | "retained" | "moving_out";

export interface ExistingRow {
  roomId: string;
  roomNumber: string;
  stage: "completed" | "in_progress" | "not_started";
  status: ExistingStatus;
  movingToUserId: string | null;
}

export interface ProposedRow {
  roomId: string;
  roomNumber: string;
  kind: "new" | "moved";
  origin: SmartProposal["origin"];
  fromUserId: string | null;
  tier: SmartProposal["tier"];
  reasons: WireReason[];
  priority: string[];
  estimateMissing: boolean;
}

export interface StaffPlanDetail {
  userId: string;
  name: string | null;
  attendance: Attendance;
  before: LoadView | null;
  after: LoadView | null;
  existing: ExistingRow[];
  proposed: ProposedRow[];
  canAddMore: boolean;
}

export function buildStaffDetail(model: AssignmentsModel, plan: SmartPlan, userId: string): StaffPlanDetail | null {
  const preview = buildPreview(model, plan);
  const member = model.team?.find((candidate) => candidate.userId === userId);
  if (!preview || !member || !model.rooms) return null;
  const delta = preview.staff.find((person) => person.userId === userId);
  const existing: ExistingRow[] = [];
  for (const entry of model.rooms) {
    if (entry.ownership.userId !== userId) continue;
    const stage = entry.room.statusInfo.stage;
    const proposal = plan.proposals[entry.room.roomId];
    const completed = stage === "awaiting_inspection" || stage === "guest_ready";
    const row: ExistingRow = {
      roomId: entry.room.roomId,
      roomNumber: entry.room.roomNumber,
      stage: completed ? "completed" : stage === "in_progress" ? "in_progress" : "not_started",
      status: "protected",
      movingToUserId: null,
    };
    if (stage === "to_clean" && proposal) {
      if (proposal.kind === "moved") {
        row.status = "moving_out";
        row.movingToUserId = proposal.toUserId;
      } else if (proposal.kind === "retained") row.status = "retained";
    }
    existing.push(row);
  }
  existing.sort((a, b) => compareNumbers(a.roomNumber, b.roomNumber));
  const live = new Map(model.rooms.map((entry) => [entry.room.roomId, entry] as const));
  const proposed = changesOf(plan)
    .filter((proposal) => proposal.toUserId === userId)
    .map<ProposedRow>((proposal) => ({
      roomId: proposal.roomId,
      roomNumber: proposal.roomNumber,
      kind: proposal.kind === "moved" ? "moved" : "new",
      origin: proposal.origin,
      fromUserId: proposal.fromUserId,
      tier: proposal.tier,
      reasons: proposal.reasons,
      priority: live.get(proposal.roomId)?.priority.reasons ?? [],
      estimateMissing: live.get(proposal.roomId)?.estimate === null,
    }))
    .sort((a, b) => compareNumbers(a.roomNumber, b.roomNumber));
  return {
    userId,
    name: member.name,
    attendance: member.attendance,
    before: delta?.before ?? loadView(member.load),
    after: delta?.after ?? loadView(member.load),
    existing,
    proposed,
    canAddMore: plan.receiverIds.includes(userId) && addableRooms(model, plan).length > 0,
  };
}

/* ─── Explanations: facts only ────────────────────────────────────────────── */

export interface ExplainLine {
  /** Key under assignments.v2.smart.why. */
  key: string;
  params: Record<string, string | number>;
}

/**
 * Sentences for one proposed change, each backed by a structured fact the planner returned. An EDITED change gets only
 * the one true sentence: the supervisor chose it. Nothing here infers performance, attendance, distance or a deadline.
 */
export function explain(row: Pick<ProposedRow, "origin" | "reasons" | "kind">, nameOf: (userId: string) => string): ExplainLine[] {
  if (row.origin === "edited") return [{ key: "edited", params: {} }];
  const lines: ExplainLine[] = [];
  for (const reason of row.reasons) {
    if (reason.code === "urgent") lines.push({ key: `urgent.${reason.reason}`, params: {} });
    else if (reason.code === "lowest_workload") lines.push({ key: "lowestWorkload", params: { minutes: reason.minutes } });
    else if (reason.code === "same_floor") lines.push({ key: "sameFloor", params: { floor: reason.floor } });
    else if (reason.code === "same_building") lines.push({ key: "sameBuilding", params: { building: reason.building } });
    else if (reason.code === "moved_from_owner") lines.push({ key: "movedFrom", params: { name: nameOf(reason.from) } });
  }
  return lines;
}

export function addableCount(model: AssignmentsModel, plan: SmartPlan): number {
  return addableRooms(model, plan).length;
}
