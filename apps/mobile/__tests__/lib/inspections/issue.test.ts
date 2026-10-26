import { createDraft, type InspectionDraft } from "@/lib/inspections/draft";
import {
  applyIssue,
  hasIssueErrors,
  isIssueFormDirty,
  issueDetailsAtStake,
  issueFormOf,
  photoStatus,
  referencedPhotos,
  validateIssue,
} from "@/lib/inspections/issue";
import type { ChecklistTemplate } from "@/lib/inspections/types";
import { NOTE_MAX_LENGTH, chooseAnswer } from "@/lib/inspections/workspace";

const NOW = 1000;
const template: ChecklistTemplate = {
  id: "t1",
  name: "Standard",
  roomTypeId: null,
  isDefault: true,
  isActive: true,
  fingerprint: "fp",
  items: [
    { id: "towels", section: "Bathroom", description: "Towels and amenities", isRequired: true, requiresPhotoOnFail: true, allowsNa: false, sortOrder: 1 },
    { id: "mirror", section: "Bathroom", description: "Mirrors", isRequired: true, requiresPhotoOnFail: false, allowsNa: true, sortOrder: 2 },
    { id: "door", section: "Entry", description: "Door", isRequired: true, requiresPhotoOnFail: false, allowsNa: true, sortOrder: 3 },
  ],
};

function failed(...ids: string[]): InspectionDraft {
  let draft = createDraft({ hotelId: "h", userId: "u", roomId: "r", businessDate: "2026-10-20", cleanCycleId: null, reinspectionOf: null, template, submissionId: "s", now: NOW });
  for (const id of ids) {
    const out = chooseAnswer(draft, template, id, "fail", NOW);
    if (!out.ok) throw new Error("refused");
    draft = out.draft;
  }
  return draft;
}

describe("the issue form", () => {
  it("starts from what the draft holds, and never offers a photo whose file is gone", () => {
    expect(issueFormOf({ result: "fail", note: "Two towels missing", severity: "minor" }, "file:///a.jpg")).toEqual({ note: "Two towels missing", severity: "minor", photoUri: "file:///a.jpg" });
    expect(issueFormOf({ result: "fail" }, "file:///a.jpg", true).photoUri).toBeNull();
    expect(issueFormOf(undefined, undefined)).toEqual({ note: "", severity: null, photoUri: null });
  });

  it("severity is never defaulted: an unchosen severity is an error, not Minor", () => {
    expect(validateIssue({ note: "x", severity: null, photoUri: null })).toEqual({ severity: "severity_required" });
    expect(validateIssue({ note: "", severity: "major", photoUri: null })).toEqual({});
  });

  it("an over-long description is refused rather than quietly cut", () => {
    const errors = validateIssue({ note: "x".repeat(NOTE_MAX_LENGTH + 1), severity: "minor", photoUri: null });
    expect(errors).toEqual({ note: "note_too_long" });
    expect(hasIssueErrors(errors)).toBe(true);
    expect(hasIssueErrors({})).toBe(false);
  });

  it("whitespace-only edits are not unsaved changes; real edits are", () => {
    const base = { note: "Two towels missing", severity: "minor" as const, photoUri: null };
    expect(isIssueFormDirty(base, { ...base, note: "  Two towels missing  " })).toBe(false);
    expect(isIssueFormDirty(base, { ...base, note: "Two towels" })).toBe(true);
    expect(isIssueFormDirty(base, { ...base, severity: "major" })).toBe(true);
    expect(isIssueFormDirty(base, { ...base, photoUri: "file:///a.jpg" })).toBe(true);
  });
});

describe("photo requirements follow the configured item", () => {
  it("a required photo is missing until one is attached; an optional one never forces the camera", () => {
    expect(photoStatus(template.items[0], false)).toBe("required_missing");
    expect(photoStatus(template.items[0], true)).toBe("required_attached");
    expect(photoStatus(template.items[1], false)).toBe("optional_empty");
    expect(photoStatus(template.items[1], true)).toBe("optional_attached");
  });
});

describe("saving an issue", () => {
  it("stores the trimmed description, the chosen severity and the photo against that item only", () => {
    const draft = failed("towels", "mirror");
    const out = applyIssue(draft, template, "towels", { note: "  Two bath towels missing.  ", severity: "minor", photoUri: "file:///towels.jpg" }, NOW + 5);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.answers.towels).toEqual({ result: "fail", severity: "minor", note: "Two bath towels missing." });
    expect(out.draft.photos).toEqual({ towels: "file:///towels.jpg" });
    expect(out.draft.answers.mirror).toEqual({ result: "fail" });
    expect(out.releasedPhoto).toBeNull();
    expect(out.draft.updatedAt).toBe(NOW + 5);
  });

  it("notes never leak between items", () => {
    let draft = failed("towels", "mirror");
    const first = applyIssue(draft, template, "towels", { note: "Towels gone", severity: "minor", photoUri: null }, NOW);
    if (!first.ok) throw new Error("save failed");
    draft = first.draft;
    const second = applyIssue(draft, template, "mirror", { note: "Streaks", severity: "major", photoUri: null }, NOW);
    if (!second.ok) throw new Error("save failed");
    expect(second.draft.answers.towels?.note).toBe("Towels gone");
    expect(second.draft.answers.mirror?.note).toBe("Streaks");
  });

  it("independent photos for different failed items stay independent", () => {
    let draft = failed("towels", "mirror");
    for (const [id, uri] of [["towels", "file:///t.jpg"], ["mirror", "file:///m.jpg"]] as const) {
      const out = applyIssue(draft, template, id, { note: "", severity: "minor", photoUri: uri }, NOW);
      if (!out.ok) throw new Error("save failed");
      draft = out.draft;
    }
    expect(draft.photos).toEqual({ towels: "file:///t.jpg", mirror: "file:///m.jpg" });
    expect(referencedPhotos(draft).sort()).toEqual(["file:///m.jpg", "file:///t.jpg"]);
  });

  it("replacing a photo releases the old file; removing one releases it and drops the reference", () => {
    const base = failed("towels");
    const withPhoto = applyIssue(base, template, "towels", { note: "", severity: "minor", photoUri: "file:///old.jpg" }, NOW);
    if (!withPhoto.ok) throw new Error("save failed");
    const replaced = applyIssue(withPhoto.draft, template, "towels", { note: "", severity: "minor", photoUri: "file:///new.jpg" }, NOW);
    expect(replaced.ok && replaced.releasedPhoto).toBe("file:///old.jpg");
    const removed = applyIssue(withPhoto.draft, template, "towels", { note: "", severity: "minor", photoUri: null }, NOW);
    expect(removed.ok && removed.releasedPhoto).toBe("file:///old.jpg");
    expect(removed.ok && removed.draft.photos).toEqual({});
    const same = applyIssue(withPhoto.draft, template, "towels", { note: "x", severity: "minor", photoUri: "file:///old.jpg" }, NOW);
    expect(same.ok && same.releasedPhoto).toBeNull();
  });

  it("an empty description stores no note at all", () => {
    const out = applyIssue(failed("towels"), template, "towels", { note: "   ", severity: "major", photoUri: null }, NOW);
    expect(out.ok && out.draft.answers.towels).toEqual({ result: "fail", severity: "major" });
  });

  it("refuses without a severity, with an over-long note, for a passed item, and for an unknown item", () => {
    const draft = failed("towels");
    expect(applyIssue(draft, template, "towels", { note: "x", severity: null, photoUri: null }, NOW)).toMatchObject({ ok: false, reason: "invalid", errors: { severity: "severity_required" } });
    expect(applyIssue(draft, template, "towels", { note: "x".repeat(NOTE_MAX_LENGTH + 1), severity: "minor", photoUri: null }, NOW)).toMatchObject({ ok: false, reason: "invalid" });
    const passed = chooseAnswer(createDraft({ hotelId: "h", userId: "u", roomId: "r", businessDate: "d", cleanCycleId: null, reinspectionOf: null, template, submissionId: "s", now: NOW }), template, "door", "pass", NOW);
    if (!passed.ok) throw new Error("refused");
    expect(applyIssue(passed.draft, template, "door", { note: "x", severity: "minor", photoUri: "file:///x.jpg" }, NOW)).toMatchObject({ ok: false, reason: "not_failed" });
    expect(applyIssue(draft, template, "ghost", { note: "", severity: "minor", photoUri: null }, NOW)).toMatchObject({ ok: false, reason: "unknown_item" });
  });

  it("does not change the draft it was given", () => {
    const draft = failed("towels");
    const snapshot = JSON.stringify(draft);
    applyIssue(draft, template, "towels", { note: "x", severity: "minor", photoUri: "file:///x.jpg" }, NOW);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});

describe("changing an answer after reporting an issue", () => {
  const withIssue = (): InspectionDraft => {
    const out = applyIssue(failed("towels"), template, "towels", { note: "Two towels missing", severity: "major", photoUri: "file:///t.jpg" }, NOW);
    if (!out.ok) throw new Error("save failed");
    return out.draft;
  };

  it("an issue with a description, severity or photo has details at stake; a bare one does not", () => {
    expect(issueDetailsAtStake(withIssue(), "towels")).toBe(true);
    expect(issueDetailsAtStake(failed("towels"), "towels")).toBe(false);
    expect(issueDetailsAtStake({ answers: { towels: { result: "fail" } }, photos: { towels: "file:///t.jpg" } }, "towels")).toBe(true);
    expect(issueDetailsAtStake({ answers: { towels: { result: "pass", note: "ok" } }, photos: {} }, "towels")).toBe(false);
  });

  it.each(["pass", "na"] as const)("Issue → %s drops the issue's note, severity and photo, and hands the file back for deletion", (to) => {
    const out = chooseAnswer(withIssue(), { items: template.items.map((i) => ({ ...i, allowsNa: true })) }, "towels", to, NOW + 1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.answers.towels).toEqual({ result: to });
    expect(out.draft.photos).toEqual({});
    expect(out.released).toEqual(["file:///t.jpg"]);
  });

  it("clearing an issue releases its photo too", () => {
    const out = chooseAnswer(withIssue(), template, "towels", "fail", NOW + 1);
    expect(out.ok && out.draft.answers.towels).toBeUndefined();
    expect(out.ok && out.released).toEqual(["file:///t.jpg"]);
  });

  it("Pass → Issue keeps a note already written and starts with no severity", () => {
    const base = createDraft({ hotelId: "h", userId: "u", roomId: "r", businessDate: "d", cleanCycleId: null, reinspectionOf: null, template, submissionId: "s", now: NOW });
    const passed = chooseAnswer(base, template, "mirror", "pass", NOW);
    if (!passed.ok) throw new Error("refused");
    const noted = { ...passed.draft, answers: { mirror: { result: "pass" as const, note: "small streak" } } };
    const out = chooseAnswer(noted, template, "mirror", "fail", NOW);
    expect(out.ok && out.draft.answers.mirror).toEqual({ result: "fail", note: "small streak" });
  });

  it("never marks other items as passed", () => {
    const draft = withIssue();
    const out = chooseAnswer(draft, template, "towels", "fail", NOW);
    expect(out.ok && Object.keys(out.draft.answers)).toEqual([]);
  });
});
