import type { AssignmentRoom, AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import { totalMinutes, type SelectionMinutes } from "@/lib/housekeeping/assignmentBulk";
import { checkDraft, type DraftHealth, type DraftProblem } from "@/lib/housekeeping/assignmentDraft";
import { GATING_WARNINGS, attendanceAckFor, loadView, type AttendanceAck, type LoadView } from "@/lib/housekeeping/assignmentPicker";
import { draftChanges, previewDraft, type AssignmentDraft, type PlannedChange } from "@/lib/housekeeping/assignmentPlan";
import type { PriorityReason } from "@/lib/housekeeping/assignmentPriority";
import type { Attendance } from "@/lib/housekeeping/assignmentStaff";
import type { WorkloadWarning } from "@/lib/housekeeping/assignmentWorkload";

/* ─── Supervisor Assignments — the draft review ─────────────────────────────
   Pure. Everything the review screen shows before anything is published, derived once from the live model and the
   draft so the screen, the tests and the Publish button cannot disagree.

   THE REVIEW NEVER SPEAKS IN THE PAST TENSE. Every figure is CURRENT (live, published) versus PROPOSED (after
   this draft), per person, from the same workload functions as the Team tab. A missing estimate is "at least",
   never zero; an unverified attendance or a real capacity limit is an acknowledgement the supervisor must give,
   per person, before Publish unlocks; a problem with a proposed change (room moved on, owner changed, new DND)
   blocks Publish until it is removed or re-planned. */

/** A person-level fact the supervisor must knowingly accept before this draft may be published. */
export type PersonAck = AttendanceAck | "over_capacity";

export interface ReviewItem {
  roomId: string;
  roomNumber: string;
  kind: PlannedChange["kind"];
  cleanTypeLabel: string | null;
  estimateMinutes: number | null;
  priorityReasons: PriorityReason[];
  fromUserId: string | null;
  fromName: string | null;
  toUserId: string | null;
}

export interface EmployeeReview {
  userId: string;
  name: string | null;
  attendance: Attendance;
  rosterVerified: boolean;
  /** Published workload today. */
  current: LoadView;
  /** Workload if this draft were published. */
  proposed: LoadView;
  newWarnings: WorkloadWarning[];
  /** Rooms this draft would give them. */
  added: ReviewItem[];
  /** Rooms this draft would take from them. */
  released: ReviewItem[];
  addedMinutes: SelectionMinutes;
  /** Acknowledgements this person needs (only when they receive rooms). */
  acks: PersonAck[];
}

export type ValidationId = "rooms_eligible" | "staff_verified" | "ownership_unchanged" | "capacity_rules";
export type ValidationState = "pass" | "fail" | "attention" | "unknown";

export interface ReviewValidation {
  id: ValidationId;
  state: ValidationState;
  /** How many changes (or people) the state is about; 0 for a pass. */
  count: number;
}

export type ReviewBlocker = "empty" | "scope" | "board" | "problems" | "acknowledgements" | "too_many" | "unsendable";

export interface DraftReview {
  changeCount: number;
  employeeCount: number;
  counts: { assign: number; reassign: number; remove: number };
  /** Work being handed to people (assign + reassign); a lower bound when `partial`. */
  minutes: SelectionMinutes;
  employees: EmployeeReview[];
  unassignedBefore: number;
  unassignedAfter: number;
  health: DraftHealth;
  problems: DraftProblem[];
  validations: ReviewValidation[];
  /** `${userId}:${ack}` keys the supervisor must tick. */
  requiredAckKeys: string[];
  unmetAckKeys: string[];
  blockers: ReviewBlocker[];
  /** Everything holds: nothing is stale, nothing is unacknowledged. (The caller still gates on online/fresh.) */
  canPublish: boolean;
}

export function ackKey(userId: string, ack: PersonAck): string {
  return `${userId}:${ack}`;
}

function itemOf(change: PlannedChange, entry: AssignmentRoom | undefined, nameOf: (userId: string | null) => string | null): ReviewItem {
  return {
    roomId: change.roomId,
    roomNumber: change.roomNumber,
    kind: change.kind,
    cleanTypeLabel: entry?.room.cleanTypeLabel ?? null,
    estimateMinutes: entry?.estimate ? Math.round(entry.estimate.minutes) : null,
    priorityReasons: entry ? [...entry.priority.reasons] : [],
    fromUserId: change.fromUserId,
    fromName: nameOf(change.fromUserId),
    toUserId: change.toUserId,
  };
}

/**
 * The review of `draft` against `model`, or null when the board is not known (there is nothing honest to compare to).
 * `given` are the acknowledgement keys the supervisor has ticked.
 */
export function buildDraftReview(model: AssignmentsModel, draft: AssignmentDraft, scopeKey: string | null, given: ReadonlySet<string>): DraftReview | null {
  if (!model.rooms || !model.team) return null;
  const changes = draftChanges(draft);
  const health = checkDraft(draft, model, scopeKey);
  const preview = previewDraft(model, changes);
  if (!preview) return null;

  const entryById = new Map(model.rooms.map((entry) => [entry.room.roomId, entry] as const));
  const memberById = new Map(model.team.map((member) => [member.userId, member] as const));
  const nameOf = (userId: string | null): string | null => (userId ? (memberById.get(userId)?.name ?? null) : null);

  const employees: EmployeeReview[] = preview.staff.map((delta) => {
    const member = memberById.get(delta.userId);
    const added = changes.filter((change) => change.toUserId === delta.userId).map((change) => itemOf(change, entryById.get(change.roomId), nameOf));
    const released = changes.filter((change) => change.fromUserId === delta.userId && change.toUserId !== delta.userId).map((change) => itemOf(change, entryById.get(change.roomId), nameOf));
    const attendance: Attendance = member?.attendance ?? "unknown";
    const acks: PersonAck[] = [];
    if (added.length > 0) {
      const attendanceAck = attendanceAckFor(attendance);
      if (attendanceAck) acks.push(attendanceAck);
      if (delta.after.warnings.some((warning) => GATING_WARNINGS.includes(warning))) acks.push("over_capacity");
    }
    return {
      userId: delta.userId,
      name: delta.name ?? member?.name ?? null,
      attendance,
      rosterVerified: member?.rosterVerified ?? false,
      current: loadView(delta.before),
      proposed: loadView(delta.after),
      newWarnings: delta.newWarnings,
      added,
      released,
      addedMinutes: totalMinutes(added.map((item) => entryById.get(item.roomId)).filter((entry): entry is AssignmentRoom => entry !== undefined)),
      acks,
    };
  });
  // People who gain rooms first, by name; people who only lose rooms after.
  employees.sort(
    (a, b) =>
      Number(b.added.length > 0) - Number(a.added.length > 0) || (a.name ?? "￿").localeCompare(b.name ?? "￿") || a.userId.localeCompare(b.userId),
  );

  const requiredAckKeys = employees.flatMap((employee) => employee.acks.map((ack) => ackKey(employee.userId, ack)));
  const unmetAckKeys = requiredAckKeys.filter((key) => !given.has(key));

  const counts = {
    assign: changes.filter((change) => change.kind === "assign").length,
    reassign: changes.filter((change) => change.kind === "reassign").length,
    remove: changes.filter((change) => change.kind === "remove").length,
  };
  const handedOut = changes
    .filter((change) => change.toUserId !== null)
    .map((change) => entryById.get(change.roomId))
    .filter((entry): entry is AssignmentRoom => entry !== undefined);

  const has = (reasons: readonly string[]) => health.problems.filter((problem) => reasons.includes(problem.reason)).length;
  const ineligible = has(["room_missing", "not_assignable", "soft_blocked"]);
  const changedOwner = has(["assignee_changed", "already_assigned"]);
  const staffGone = has(["employee_unknown"]);
  const overCapacity = employees.filter((employee) => employee.acks.includes("over_capacity")).length;
  const needsAttendance = employees.filter((employee) => employee.acks.some((ack) => ack !== "over_capacity")).length;
  const capacityKnown = model.settings.value !== null;
  const validations: ReviewValidation[] = [
    { id: "rooms_eligible", state: ineligible > 0 ? "fail" : "pass", count: ineligible },
    { id: "staff_verified", state: !model.staffListKnown || staffGone > 0 ? "fail" : needsAttendance > 0 ? "attention" : "pass", count: !model.staffListKnown ? changes.length : staffGone || needsAttendance },
    { id: "ownership_unchanged", state: changedOwner > 0 ? "fail" : "pass", count: changedOwner },
    { id: "capacity_rules", state: overCapacity > 0 ? "attention" : capacityKnown ? "pass" : "unknown", count: overCapacity },
  ];

  const blockers: ReviewBlocker[] = [];
  if (changes.length === 0) blockers.push("empty");
  if (changes.length > MAX_BATCH_CHANGES) blockers.push("too_many");
  if (!health.current) blockers.push("scope");
  if (model.availability.kind !== "ready" && model.availability.kind !== "verified_empty") blockers.push("board");
  if (health.problems.length > 0) blockers.push("problems");
  if (unmetAckKeys.length > 0) blockers.push("acknowledgements");
  // A change that carries a room acknowledgement cannot travel in a bulk publication.
  if (changes.some((change) => change.acknowledged.length > 0)) blockers.push("unsendable");

  return {
    changeCount: changes.length,
    employeeCount: employees.length,
    counts,
    minutes: totalMinutes(handedOut),
    employees,
    unassignedBefore: preview.unassignedBefore,
    unassignedAfter: preview.unassignedAfter,
    health,
    problems: health.problems,
    validations,
    requiredAckKeys,
    unmetAckKeys,
    blockers,
    canPublish: blockers.length === 0,
  };
}
