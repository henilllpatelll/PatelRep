import {
  canReassign,
  canReinspect,
  correctionStage,
  itemsToRecheck,
  ownerAcknowledged,
  reinspectionContext,
} from "@/lib/inspections/corrections";
import type { CorrectionStatus } from "@/lib/api/inspections";
import { readyRoom } from "../../helpers/inspectionFixtures";

const failure = {
  inspection_id: "insp-1",
  inspected_at: "2026-10-20T14:00:00Z",
  overall_result: "failed",
  notes: "Rushed",
  correction_kind: "touch_up" as const,
  items: [{ id: "item-1", label: "Mirror streaked", note: "left side" }, { id: null, label: "Smells of smoke", note: null }],
};

describe("correction stages", () => {
  it.each<[CorrectionStatus, string]>([
    ["correction_missing", "needs_action"],
    ["unassigned", "needs_action"],
    ["escalated", "needs_action"],
    ["cancelled", "needs_action"],
    ["assigned", "with_housekeeper"],
    ["in_progress", "with_housekeeper"],
    ["resubmitted", "awaiting_reinspection"],
    ["verified", "closed"],
    ["superseded", "closed"],
  ])("%s → %s", (status, stage) => {
    expect(correctionStage(status)).toBe(stage);
  });

  it("only open corrections can be reassigned", () => {
    expect(canReassign("unassigned")).toBe(true);
    expect(canReassign("assigned")).toBe(true);
    expect(canReassign("in_progress")).toBe(true);
    expect(canReassign("correction_missing")).toBe(true);
    expect(canReassign("resubmitted")).toBe(false);
    expect(canReassign("verified")).toBe(false);
  });

  it("being assigned is not being acknowledged", () => {
    const task = (overrides: Record<string, unknown>) => ({
      task: { id: "t", status: "open", priority: "urgent", assigned_to: "hk-1", assigned_name: "Hana", due_at: null, started_at: null, completed_at: null, ...overrides },
    });
    expect(ownerAcknowledged(task({}))).toBe(false);
    expect(ownerAcknowledged(task({ started_at: "2026-10-20T14:05:00Z" }))).toBe(true);
    expect(ownerAcknowledged(task({ status: "in_progress" }))).toBe(true);
    expect(ownerAcknowledged(task({ status: "completed" }))).toBe(true);
    expect(ownerAcknowledged({ task: null })).toBe(false);
    expect(ownerAcknowledged(null)).toBe(false);
  });
});

describe("reinspection", () => {
  it("a queue row with a previous failure carries exactly what failed", () => {
    const context = reinspectionContext(readyRoom("r204", { previous_failure: failure }));
    expect(context).toMatchObject({ isReinspection: true, failureInspectionId: "insp-1", kind: "touch_up", notes: "Rushed" });
    expect(context.failedItems.map((i) => i.label)).toEqual(["Mirror streaked", "Smells of smoke"]);
    expect([...itemsToRecheck(context)]).toEqual(["item-1"]);
  });

  it("a first inspection is not a reinspection", () => {
    expect(reinspectionContext(readyRoom("r204")).isReinspection).toBe(false);
    expect(reinspectionContext(readyRoom("r204", { previous_failure: null })).isReinspection).toBe(false);
  });

  it("a touch-up (conditional) that blocked the room is re-checked like a failure; a pass never is", () => {
    expect(reinspectionContext(readyRoom("r204", { previous_failure: { ...failure, overall_result: "conditional" } })).isReinspection).toBe(true);
    expect(reinspectionContext(readyRoom("r204", { previous_failure: { ...failure, overall_result: "passed" } })).isReinspection).toBe(false);
  });

  it("a room can only be re-checked from the verified queue", () => {
    expect(canReinspect({ inQueue: false, correction: null })).toBe(false);
    expect(canReinspect({ inQueue: true, correction: null })).toBe(true);
  });

  it("a correction still with the housekeeper or stuck blocks reinspection until resubmitted", () => {
    for (const status of ["correction_missing", "unassigned", "assigned", "in_progress", "escalated", "cancelled"] as CorrectionStatus[]) {
      expect(canReinspect({ inQueue: true, correction: { status } })).toBe(false);
    }
    expect(canReinspect({ inQueue: true, correction: { status: "resubmitted" } })).toBe(true);
    expect(canReinspect({ inQueue: true, correction: { status: "verified" } })).toBe(true);
  });
});
