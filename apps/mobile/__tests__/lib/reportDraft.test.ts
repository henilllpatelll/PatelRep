import {
  EMPTY_PROVENANCE,
  appendPhotoNote,
  applyDescriptionField,
  applyDescriptionSuggestion,
  applyPhotoSuggestion,
  descriptionSuggestionFrom,
  descriptionSuggestionIsCurrent,
  hasSuggestedFields,
  photoSuggestionIsCurrent,
  reportSummaryRows,
  touchField,
  type DescriptionSuggestion,
  type PhotoSuggestion,
} from "@/lib/housekeeping/reportDraft";
import { EMPTY_MAINTENANCE_DRAFT, MAINTENANCE_DETAILS_MAX, type MaintenanceDraft } from "@/lib/housekeeping/maintenanceReport";
import type { WorkOrderDraft } from "@/lib/ai/drafts";

const SUGGESTION: DescriptionSuggestion = { basis: "The bathroom sink is leaking", title: "Bathroom sink leaking", category: "plumbing", priority: "normal" };
const NOTE = { observation: "Photo note (AI, unverified): Moisture under the sink", answer: null };

describe("descriptionSuggestionFrom", () => {
  const preview = (over: Partial<WorkOrderDraft> = {}): WorkOrderDraft => ({
    title: "  Bathroom sink leaking  ",
    description: "",
    category: "plumbing",
    priority: "normal",
    locationText: "",
    roomNumber: "999",
    roomId: "other",
    ...over,
  });

  it("keeps the title, category and priority and takes no room from the model", () => {
    const suggestion = descriptionSuggestionFrom(preview(), "basis");
    expect(suggestion).toEqual({ basis: "basis", title: "Bathroom sink leaking", category: "plumbing", priority: "normal" });
    expect(JSON.stringify(suggestion)).not.toContain("999");
  });

  it("returns nothing when there is nothing usable, and caps a long title", () => {
    expect(descriptionSuggestionFrom(preview({ title: "   ", category: "general" }), "b")).toMatchObject({ category: "general" });
    expect(descriptionSuggestionFrom(preview({ title: "x".repeat(300) }), "b")?.title).toHaveLength(120);
  });
});

describe("currency: a suggestion belongs to the exact input it was made from", () => {
  it("is current only while the description is unchanged (whitespace aside)", () => {
    expect(descriptionSuggestionIsCurrent(SUGGESTION, "  The bathroom sink is leaking ")).toBe(true);
    expect(descriptionSuggestionIsCurrent(SUGGESTION, "The bathroom sink is leaking badly")).toBe(false);
    expect(descriptionSuggestionIsCurrent(null, "anything")).toBe(false);
  });

  it("a photo suggestion is void once the photo changes or is removed", () => {
    const suggestion: PhotoSuggestion = { version: 3, answer: null, analysis: { outcome: "suggestion", observation: "x", category: null, question: null } };
    expect(photoSuggestionIsCurrent(suggestion, 3, true)).toBe(true);
    expect(photoSuggestionIsCurrent(suggestion, 4, true)).toBe(false);
    expect(photoSuggestionIsCurrent(suggestion, 3, false)).toBe(false);
    expect(photoSuggestionIsCurrent(null, 3, true)).toBe(false);
  });
});

describe("applyDescriptionSuggestion — consent and the person's own entries", () => {
  it("fills empty fields and labels them as suggestions", () => {
    const result = applyDescriptionSuggestion({ ...EMPTY_MAINTENANCE_DRAFT, details: "The bathroom sink is leaking" }, EMPTY_PROVENANCE, SUGGESTION);
    expect(result.draft).toMatchObject({ title: "Bathroom sink leaking", category: "plumbing", priority: "normal" });
    // The default "normal" priority already matches, so the model changed nothing there and gets no label.
    expect(result.applied).toEqual(["title", "category"]);
    expect(result.provenance.suggested).toEqual({ title: "description", category: "description" });
    expect(hasSuggestedFields(result.provenance)).toBe(true);
    expect(result.draft.details).toBe("The bathroom sink is leaking"); // the person's words are untouched
  });

  it("never overwrites a field the person set; it reports what it kept", () => {
    let provenance = touchField(EMPTY_PROVENANCE, "title");
    provenance = touchField(provenance, "category");
    const draft: MaintenanceDraft = { title: "My own title", category: "furniture", priority: "normal", details: "" };

    const result = applyDescriptionSuggestion(draft, provenance, SUGGESTION);

    expect(result.draft.title).toBe("My own title");
    expect(result.draft.category).toBe("furniture");
    expect(result.kept.sort()).toEqual(["category", "title"]);
    expect(result.applied).toEqual([]);
  });

  it("treats a touched-but-emptied field as free again", () => {
    const provenance = touchField(EMPTY_PROVENANCE, "title");
    const result = applyDescriptionSuggestion({ ...EMPTY_MAINTENANCE_DRAFT, title: "" }, provenance, SUGGESTION);
    expect(result.draft.title).toBe("Bathroom sink leaking");
  });

  it("never applies an urgent priority in bulk", () => {
    const result = applyDescriptionSuggestion(EMPTY_MAINTENANCE_DRAFT, EMPTY_PROVENANCE, { ...SUGGESTION, priority: "urgent" });
    expect(result.draft.priority).toBe("normal");
    expect(result.applied).not.toContain("priority");
  });

  it("applies one field on purpose, even over the person's own value, including urgent", () => {
    const provenance = touchField(EMPTY_PROVENANCE, "priority");
    const result = applyDescriptionField({ ...EMPTY_MAINTENANCE_DRAFT, priority: "low" }, provenance, { ...SUGGESTION, priority: "urgent" }, "priority");
    expect(result.draft.priority).toBe("urgent");
    expect(result.provenance.suggested.priority).toBe("description");
  });

  it("editing a suggested field makes it the person's own again", () => {
    const applied = applyDescriptionSuggestion(EMPTY_MAINTENANCE_DRAFT, EMPTY_PROVENANCE, SUGGESTION);
    const edited = touchField(applied.provenance, "title");
    expect(edited.suggested.title).toBeUndefined();
    expect(edited.touched.title).toBe(true);
    expect(edited.suggested.category).toBe("description");
  });
});

describe("photo notes", () => {
  it("adds a labelled note after what the employee wrote, once", () => {
    const first = appendPhotoNote("Water under the sink.", NOTE);
    expect(first).toEqual({ details: `Water under the sink.\n${NOTE.observation}`, appended: true });
    expect(appendPhotoNote(first.details, NOTE)).toEqual({ details: first.details, appended: false });
  });

  it("includes the employee's answer to the model's question as their own words", () => {
    const result = appendPhotoNote("", { observation: NOTE.observation, answer: "Is water actively leaking? Yes (your answer)" });
    expect(result.details.split("\n")).toEqual([NOTE.observation, "Is water actively leaking? Yes (your answer)"]);
  });

  it("refuses to push the details past the limit", () => {
    const long = "x".repeat(MAINTENANCE_DETAILS_MAX - 5);
    expect(appendPhotoNote(long, NOTE)).toEqual({ details: long, appended: false });
  });

  it("applies the suggested category only if the person has not chosen one, and adds the note", () => {
    const suggestion: PhotoSuggestion = { version: 1, answer: null, analysis: { outcome: "suggestion", observation: "Moisture under the sink", category: "plumbing", question: null } };
    const fresh = applyPhotoSuggestion({ ...EMPTY_MAINTENANCE_DRAFT, details: "Sink" }, EMPTY_PROVENANCE, suggestion, NOTE);
    expect(fresh.draft.category).toBe("plumbing");
    expect(fresh.draft.details).toContain(NOTE.observation);
    expect(fresh.provenance.suggested).toMatchObject({ category: "photo", details: "photo" });
    expect(fresh.noteAdded).toBe(true);

    const chosen = applyPhotoSuggestion({ ...EMPTY_MAINTENANCE_DRAFT, category: "electrical" }, touchField(EMPTY_PROVENANCE, "category"), suggestion, NOTE);
    expect(chosen.draft.category).toBe("electrical");
    expect(chosen.kept).toEqual(["category"]);
  });

  it("an 'unable to determine' result changes nothing", () => {
    const suggestion: PhotoSuggestion = { version: 1, answer: null, analysis: { outcome: "unable_to_determine", observation: null, category: null, question: null } };
    const result = applyPhotoSuggestion(EMPTY_MAINTENANCE_DRAFT, EMPTY_PROVENANCE, suggestion, NOTE);
    expect(result.draft).toEqual(EMPTY_MAINTENANCE_DRAFT);
    expect(result.applied).toEqual([]);
    expect(result.noteAdded).toBe(false);
  });

  it("reports when the note did not fit", () => {
    const suggestion: PhotoSuggestion = { version: 1, answer: null, analysis: { outcome: "suggestion", observation: "Moisture", category: null, question: null } };
    const result = applyPhotoSuggestion({ ...EMPTY_MAINTENANCE_DRAFT, details: "x".repeat(MAINTENANCE_DETAILS_MAX) }, EMPTY_PROVENANCE, suggestion, NOTE);
    expect(result.noteTooLong).toBe(true);
    expect(result.draft.details).toHaveLength(MAINTENANCE_DETAILS_MAX);
  });
});

describe("reportSummaryRows", () => {
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);

  it("lists everything that will be created, marks suggested values, and says whether the photo is uploaded", () => {
    const applied = applyDescriptionSuggestion({ ...EMPTY_MAINTENANCE_DRAFT, details: "Sink leaks" }, EMPTY_PROVENANCE, SUGGESTION);
    const rows = reportSummaryRows({ roomNumber: "312", draft: applied.draft, provenance: applied.provenance, photo: "pending" }, t);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    expect(rows.map((row) => row.key)).toEqual(["action", "room", "title", "category", "priority", "details", "photo"]);
    expect(byKey.priority).toBe("reportIssue.priorities.normal"); // unchanged default: not tagged
    expect(byKey.room).toContain('"room":"312"');
    expect(byKey.title).toBe("Bathroom sink leaking · reportIssue.ai.suggestedTag");
    expect(byKey.category).toContain("reportIssue.categories.plumbing");
    expect(byKey.details).toBe("Sink leaks"); // the employee's own words are not tagged
    expect(byKey.photo).toBe("reportIssue.review.photoPending");
  });

  it("says a photo note was added to the details instead of calling the employee's own words AI-made", () => {
    const suggestion: PhotoSuggestion = { version: 1, answer: null, analysis: { outcome: "suggestion", observation: "Moisture", category: null, question: null } };
    const applied = applyPhotoSuggestion({ ...EMPTY_MAINTENANCE_DRAFT, title: "Sink", details: "Water under the sink" }, EMPTY_PROVENANCE, suggestion, NOTE);
    const rows = reportSummaryRows({ roomNumber: "312", draft: applied.draft, provenance: applied.provenance, photo: "pending" }, t);
    const details = rows.find((row) => row.key === "details")?.value ?? "";
    expect(details).toContain("Water under the sink");
    expect(details).toContain("reportIssue.ai.photoNoteTag");
    expect(details).not.toContain("reportIssue.ai.suggestedTag");
  });

  it("a plain manual report has no AI tags and no photo row noise", () => {
    const rows = reportSummaryRows(
      { roomNumber: "312", draft: { title: "Lamp broken", category: "furniture", priority: "low", details: "" }, provenance: EMPTY_PROVENANCE, photo: "none" },
      t,
    );
    expect(rows.some((row) => row.value.includes("suggestedTag"))).toBe(false);
    expect(rows.find((row) => row.key === "photo")?.value).toBe("reportIssue.review.photoNone");
    expect(rows.find((row) => row.key === "details")).toBeUndefined();
  });
});
