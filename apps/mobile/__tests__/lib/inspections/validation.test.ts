import { checklistProgress, firstUnansweredRequired, pruneAnswers } from "@/lib/inspections/checklist";
import {
  canAnswerNa,
  evaluateChecklist,
  failedItems,
  naNeedsNote,
  photoRequirements,
} from "@/lib/inspections/validation";
import type { AnswerMap } from "@/lib/inspections/types";
import { rawItem, template } from "../../helpers/inspectionFixtures";

const checklist = template("t", {
  items: [
    rawItem("bed", { section: "Bed", description: "Bed made", sort_order: 1 }),
    rawItem("mirror", { section: "Bath", description: "Mirror clean", sort_order: 2, requires_photo_on_fail: true }),
    rawItem("floor", { section: "Floor", description: "Floor vacuumed", sort_order: 3, allows_na: false }),
    rawItem("extra", { section: "Floor", description: "Balcony swept", sort_order: 4, is_required: false }),
  ],
});

const allPass: AnswerMap = { bed: { result: "pass" }, mirror: { result: "pass" }, floor: { result: "pass" } };

describe("progress", () => {
  it("counts required items separately and ignores answers that are not on the checklist", () => {
    const p = checklistProgress(checklist, { bed: { result: "pass" }, ghost: { result: "pass" } });
    expect(p).toMatchObject({ total: 4, answered: 1, requiredTotal: 3, requiredAnswered: 1, requiredPercent: 33, requiredComplete: false });
    expect(checklistProgress(checklist, allPass)).toMatchObject({ requiredPercent: 100, requiredComplete: true });
  });

  it("an unanswered item is never counted as a pass, and Continue points at the first one", () => {
    expect(firstUnansweredRequired(checklist, { bed: { result: "pass" } })?.id).toBe("mirror");
    expect(firstUnansweredRequired(checklist, allPass)).toBeNull();
  });

  it("drops answers whose item left the checklist before anything is sent", () => {
    expect(Object.keys(pruneAnswers(checklist, { bed: { result: "pass" }, ghost: { result: "fail" } }))).toEqual(["bed"]);
  });
});

describe("evaluating a checklist", () => {
  it("passes only when every required item has a valid answer", () => {
    const e = evaluateChecklist(checklist, allPass);
    expect(e).toMatchObject({ canSubmit: true, outcome: "passed", correctionKind: null, blocker: null });
    expect(e.failed).toEqual([]);
  });

  it("blocks completion while a required item is unanswered and reports which", () => {
    const e = evaluateChecklist(checklist, { bed: { result: "pass" } });
    expect(e.canSubmit).toBe(false);
    expect(e.outcome).toBeNull();
    expect(e.blocker).toMatchObject({ code: "required_items_unanswered", missingItemIds: ["mirror", "floor"] });
    expect(e.unanswered.map((i) => i.id)).toEqual(["mirror", "floor"]);
  });

  it("derives failed from the answers and extracts the failed items in configured order with their notes", () => {
    const answers: AnswerMap = {
      bed: { result: "fail", note: " tight sheets ", severity: "minor" },
      mirror: { result: "pass" },
      floor: { result: "fail", severity: "minor" },
    };
    const e = evaluateChecklist(checklist, answers);
    expect(e.outcome).toBe("failed");
    expect(e.failed.map((f) => [f.item.id, f.note, f.severity])).toEqual([["bed", "tight sheets", "minor"], ["floor", null, "minor"]]);
    expect(failedItems(checklist, answers)).toHaveLength(2);
  });

  it("a failed required item cannot be silently treated as passed: the outcome is failed, never passed", () => {
    expect(evaluateChecklist(checklist, { ...allPass, bed: { result: "fail" } }).outcome).toBe("failed");
  });

  it("a touch-up needs every failed item explicitly minor; unclassified is a full re-clean", () => {
    expect(evaluateChecklist(checklist, { ...allPass, bed: { result: "fail", severity: "minor" } }).correctionKind).toBe("touch_up");
    expect(evaluateChecklist(checklist, { ...allPass, bed: { result: "fail" } }).correctionKind).toBe("reclean");
    expect(evaluateChecklist(checklist, { ...allPass, bed: { result: "fail", severity: "major" } }).correctionKind).toBe("reclean");
  });

  it("a failed item that requires a photo blocks completion until one is attached", () => {
    const answers: AnswerMap = { ...allPass, mirror: { result: "fail", severity: "major" } };
    const without = evaluateChecklist(checklist, answers);
    expect(without.canSubmit).toBe(false);
    expect(without.blocker).toMatchObject({ code: "required_photos_missing", missingItemIds: ["mirror"] });
    const withPhoto = evaluateChecklist(checklist, answers, { mirror: "file:///m.jpg" });
    expect(withPhoto.canSubmit).toBe(true);
    expect(withPhoto.photos.missing).toEqual([]);
  });

  it("a photo for an item that is no longer failed is orphaned and must not be sent", () => {
    const reqs = photoRequirements(checklist, allPass, { mirror: "file:///m.jpg" });
    expect(reqs.orphaned).toEqual(["mirror"]);
    expect(reqs.required).toEqual([]);
  });

  it("N/A where the item forbids it is rejected", () => {
    const e = evaluateChecklist(checklist, { ...allPass, floor: { result: "na" } });
    expect(e.blocker).toMatchObject({ code: "na_not_allowed", itemId: "floor" });
  });

  it("property policy governs N/A on required items", () => {
    const answers: AnswerMap = { ...allPass, bed: { result: "na" } };
    expect(evaluateChecklist(checklist, answers).canSubmit).toBe(true);
    expect(evaluateChecklist(checklist, answers, {}, "forbid").blocker).toMatchObject({ code: "na_not_allowed" });
    expect(evaluateChecklist(checklist, answers, {}, "require_note").blocker).toMatchObject({ code: "na_note_required" });
    expect(evaluateChecklist(checklist, { ...allPass, bed: { result: "na", note: "No bed in this room" } }, {}, "require_note").canSubmit).toBe(true);
  });

  it("the N/A choice is offered only where it is valid", () => {
    const [bed, , floor, extra] = checklist.items;
    expect(canAnswerNa(bed)).toBe(true);
    expect(canAnswerNa(floor)).toBe(false);
    expect(canAnswerNa(bed, "forbid")).toBe(false);
    expect(canAnswerNa(extra, "forbid")).toBe(true);
    expect(naNeedsNote(bed, "require_note")).toBe(true);
    expect(naNeedsNote(extra, "require_note")).toBe(false);
  });

  it("an empty checklist cannot approve a room", () => {
    const empty = template("empty", { items: [] });
    const e = evaluateChecklist(empty, {});
    expect(e).toMatchObject({ canSubmit: false, outcome: null });
    expect(e.blocker).toMatchObject({ code: "no_checklist" });
  });

  it("a checklist of only optional items still needs something reviewed", () => {
    const optional = template("opt", { items: [rawItem("o1", { is_required: false })] });
    expect(evaluateChecklist(optional, {}).blocker).toMatchObject({ code: "no_answers" });
    expect(evaluateChecklist(optional, { o1: { result: "pass" } }).canSubmit).toBe(true);
  });
});
