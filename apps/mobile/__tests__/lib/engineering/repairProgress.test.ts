import { deriveNextStep, deriveRepairProgress } from "@/lib/engineering/repairProgress";
import { deriveRepairActions } from "@/lib/engineering/repairWorkspace";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const order = (over: Partial<WorkOrder> = {}): WorkOrder =>
  ({ id: "wo-1", title: "Fix AC", status: "open", priority: "normal", assigned_to: null, ...over }) as WorkOrder;
const states = (wo: WorkOrder) => Object.fromEntries(deriveRepairProgress(wo).stages.map((s) => [s.id, s.state]));

describe("deriveRepairProgress", () => {
  it("starts at Claim for an unclaimed order and ticks nothing else", () => {
    expect(states(order())).toEqual({ claim: "current", diagnose: "pending", repair: "pending", verify: "pending", complete: "pending" });
  });

  it("marks Repair current while in progress without implying diagnosis or verification", () => {
    expect(states(order({ status: "in_progress", assigned_to: "u1" }))).toEqual({ claim: "done", diagnose: "pending", repair: "current", verify: "pending", complete: "pending" });
  });

  it("only marks Diagnose done when a diagnosis is recorded", () => {
    expect(states(order({ status: "in_progress", assigned_to: "u1", problem_code: { id: "p", code: "x", label: "No cooling" } })).diagnose).toBe("done");
    expect(states(order({ status: "in_progress", assigned_to: "u1", problem_other_text: "   " })).diagnose).toBe("pending");
  });

  it("shows a held or escalated order as paused", () => {
    expect(states(order({ status: "on_hold", assigned_to: "u1" })).repair).toBe("paused");
    expect(states(order({ status: "escalated", assigned_to: "u1" })).repair).toBe("paused");
  });

  it("uses neutral states for what a completed order never recorded", () => {
    expect(states(order({ status: "completed", assigned_to: "u1" }))).toEqual({ claim: "done", diagnose: "unknown", repair: "done", verify: "unknown", complete: "done" });
  });

  it("marks Verify done only when a passed verification exists", () => {
    expect(states(order({ status: "completed", assigned_to: "u1", verification_result: "passed" })).verify).toBe("done");
    expect(states(order({ status: "in_progress", assigned_to: "u1", verification_result: "failed" })).verify).toBe("pending");
  });

  it("makes every stage neutral for a cancelled order", () => {
    const progress = deriveRepairProgress(order({ status: "cancelled", assigned_to: "u1" }));
    expect(progress.cancelled).toBe(true);
    expect(progress.stages.every((s) => s.state === "unknown")).toBe(true);
  });
});

describe("deriveNextStep", () => {
  const step = (wo: WorkOrder, role = "engineer", userId = "u1") => deriveNextStep(wo, deriveRepairActions({ wo, role, userId, sessions: [] }));

  it("follows the same primary action the sticky bar uses", () => {
    expect(step(order())).toBe("claim");
    expect(step(order({ assigned_to: "u1" }))).toBe("start");
    expect(step(order({ status: "in_progress", assigned_to: "u1" }))).toBe("continue");
    expect(step(order({ status: "on_hold", assigned_to: "u1" }))).toBe("reviewHold");
    expect(step(order({ status: "escalated", assigned_to: "u1" }))).toBe("resume");
  });

  it("is read-only for closed, foreign and non-acting roles", () => {
    expect(step(order({ status: "completed", assigned_to: "u1" }))).toBe("viewRecord");
    expect(step(order({ status: "cancelled" }))).toBe("cancelled");
    expect(step(order({ status: "in_progress", assigned_to: "other" }))).toBe("elsewhere");
    expect(step(order({ status: "in_progress", assigned_to: "other" }), "chief_engineer", "chief-1")).toBe("viewOnly");
  });
});
