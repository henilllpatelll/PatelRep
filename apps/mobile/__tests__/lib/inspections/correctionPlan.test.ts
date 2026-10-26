import { planCorrection } from "@/lib/inspections/correctionPlan";
import type { ChecklistTemplate } from "@/lib/inspections/types";

const template: Pick<ChecklistTemplate, "items"> = {
  items: [
    { id: "towels", section: "Bathroom", description: "Towels and amenities", isRequired: true, requiresPhotoOnFail: true, allowsNa: false, sortOrder: 1 },
    { id: "mirror", section: "Bathroom", description: "Mirrors", isRequired: true, requiresPhotoOnFail: false, allowsNa: true, sortOrder: 2 },
    { id: "door", section: "Entry", description: "Door", isRequired: true, requiresPhotoOnFail: false, allowsNa: true, sortOrder: 3 },
  ],
};
const room = { housekeeperId: "hk-1", cleanedBy: "Maria S." };

describe("the correction plan", () => {
  it("is null when nothing failed - no correction is implied", () => {
    expect(planCorrection(template, { towels: { result: "pass" }, mirror: { result: "na" } }, room)).toBeNull();
  });

  it("is always a housekeeping correction, urgent, and pending final submission - never created, never engineering", () => {
    const plan = planCorrection(template, { towels: { result: "fail", severity: "minor", note: "Two bath towels missing." } }, room);
    expect(plan).toMatchObject({ track: "housekeeping", priority: "urgent", state: "pending_submission", kind: "touch_up" });
    expect(plan?.steps).toEqual([{ itemId: "towels", section: "Bathroom", label: "Towels and amenities", instruction: "Two bath towels missing.", severity: "minor" }]);
  });

  it("names the expected owner by stable id and recorded name, and never invents one", () => {
    expect(planCorrection(template, { towels: { result: "fail" } }, room)?.owner).toEqual({ housekeeperId: "hk-1", name: "Maria S." });
    expect(planCorrection(template, { towels: { result: "fail" } }, { housekeeperId: null, cleanedBy: "  " })?.owner).toEqual({ housekeeperId: null, name: null });
  });

  it("the kind follows the severities the supervisor chose; an unchosen one keeps it undecided rather than minor", () => {
    expect(planCorrection(template, { towels: { result: "fail" } }, room)?.kind).toBe("undecided");
    expect(planCorrection(template, { towels: { result: "fail", severity: "minor" }, mirror: { result: "fail" } }, room)?.kind).toBe("undecided");
    expect(planCorrection(template, { towels: { result: "fail", severity: "minor" }, mirror: { result: "fail", severity: "major" } }, room)?.kind).toBe("reclean");
    expect(planCorrection(template, { towels: { result: "fail", severity: "minor" }, mirror: { result: "fail", severity: "minor" } }, room)?.kind).toBe("touch_up");
  });

  it("lists failed standards in configured order with the supervisor's own words", () => {
    const plan = planCorrection(template, { door: { result: "fail", severity: "major", note: "Lock sticks" }, towels: { result: "fail", severity: "minor" } }, room);
    expect(plan?.steps.map((step) => [step.itemId, step.instruction])).toEqual([["towels", null], ["door", "Lock sticks"]]);
  });
});
