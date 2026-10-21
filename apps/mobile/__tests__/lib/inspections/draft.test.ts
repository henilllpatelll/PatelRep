import { carryOverAnswers, createDraft, judgeDraft, parseDraft, type InspectionDraft } from "@/lib/inspections/draft";
import { rawItem, template } from "../../helpers/inspectionFixtures";

const checklist = template("t", {
  fingerprint: "fp-1",
  items: [rawItem("a", { section: "Bed", description: "Bed made", sort_order: 1 }), rawItem("b", { section: "Bath", description: "Mirror clean", sort_order: 2 })],
});

function draft(overrides: Partial<InspectionDraft> = {}): InspectionDraft {
  return {
    ...createDraft({
      hotelId: "hotel-1", userId: "sup-1", roomId: "r204", businessDate: "2026-10-20", cleanCycleId: "cycle-1",
      reinspectionOf: null, template: checklist, submissionId: "sub-1", now: 1000,
    }),
    ...overrides,
  };
}

const current = {
  hotelId: "hotel-1", userId: "sup-1", roomId: "r204", businessDate: "2026-10-20", cleanCycleId: "cycle-1",
  reinspectionOf: null as string | null, template: checklist as typeof checklist | null,
};

describe("when a draft may be resumed", () => {
  it("resumes for the same hotel, person, room, day, cycle and checklist", () => {
    expect(judgeDraft(draft(), current)).toEqual({ usable: true });
  });

  it.each([
    [{ hotelId: "hotel-2" }, "other_hotel"],
    [{ userId: "sup-2" }, "other_user"],
    [{ roomId: "r305" }, "other_room"],
    [{ businessDate: "2026-10-21" }, "other_day"],
    [{ cleanCycleId: "cycle-2" }, "room_changed"],
    [{ reinspectionOf: "insp-9" }, "room_changed"],
  ])("refuses when %j differs (%s)", (override, reason) => {
    expect(judgeDraft(draft(), { ...current, ...override })).toEqual({ usable: false, reason });
  });

  it("checks identity before anything else, so another hotel's draft is never compared to a checklist", () => {
    expect(judgeDraft(draft(), { ...current, hotelId: "hotel-2", template: null })).toEqual({ usable: false, reason: "other_hotel" });
  });

  it("an unknown cycle on either side cannot disprove the draft", () => {
    expect(judgeDraft(draft({ cleanCycleId: null }), current)).toEqual({ usable: true });
    expect(judgeDraft(draft(), { ...current, cleanCycleId: null })).toEqual({ usable: true });
  });

  it("refuses a draft from an older app version", () => {
    expect(judgeDraft({ ...draft(), version: 0 as never }, current)).toEqual({ usable: false, reason: "unsupported_version" });
  });

  it("detects an edited or removed checklist, even with the same template id", () => {
    expect(judgeDraft(draft(), { ...current, template: template("t", { fingerprint: "fp-2", items: checklist.items.map((i) => rawItem(i.id, { description: i.description, section: i.section, sort_order: i.sortOrder })) }) })).toEqual({ usable: false, reason: "template_changed" });
    expect(judgeDraft(draft(), { ...current, template: null })).toEqual({ usable: false, reason: "template_changed" });
    expect(judgeDraft(draft(), { ...current, template: template("other", { fingerprint: "fp-1" }) })).toEqual({ usable: false, reason: "template_changed" });
  });

  it("without a digest, a structural edit is still detected", () => {
    const plain = template("t", { fingerprint: undefined, items: [rawItem("a", { description: "Bed made" })] });
    const stored = createDraft({ hotelId: "h", userId: "u", roomId: "r", businessDate: "d", cleanCycleId: null, reinspectionOf: null, template: plain, submissionId: "s", now: 1 });
    const base = { hotelId: "h", userId: "u", roomId: "r", businessDate: "d", cleanCycleId: null, reinspectionOf: null };
    expect(judgeDraft(stored, { ...base, template: plain })).toEqual({ usable: true });
    const edited = template("t", { fingerprint: undefined, items: [rawItem("a", { description: "Bed made neatly" })] });
    expect(judgeDraft(stored, { ...base, template: edited })).toEqual({ usable: false, reason: "template_changed" });
  });
});

describe("surviving a checklist edit", () => {
  const before = checklist.items;

  it("carries an answer to the new item when the question is unchanged, even though settings replaced the ids", () => {
    const after = template("t", {
      items: [rawItem("a2", { section: "Bed", description: "Bed made", sort_order: 1 }), rawItem("b2", { section: "Bath", description: "Mirror clean and dry", sort_order: 2 })],
    }).items;
    const carried = carryOverAnswers(before, after, { a: { result: "pass" }, b: { result: "fail" } }, { b: "file:///b.jpg" });
    expect(carried.answers).toEqual({ a2: { result: "pass" } });
    expect(carried.dropped).toEqual(["b"]); // reworded = a different question, never silently carried
    expect(carried.photos).toEqual({});
  });

  it("matches wording case-insensitively and carries a failed item's photo", () => {
    const after = template("t", { items: [rawItem("m", { section: "BATH", description: "mirror CLEAN", sort_order: 1 })] }).items;
    const carried = carryOverAnswers(before, after, { b: { result: "fail", severity: "minor" } }, { b: "file:///b.jpg" });
    expect(carried.answers).toEqual({ m: { result: "fail", severity: "minor" } });
    expect(carried.photos).toEqual({ m: "file:///b.jpg" });
  });

  it("never carries an answer onto an ambiguous question or two answers onto one item", () => {
    const twin = template("t", {
      items: [rawItem("x1", { section: "Bed", description: "Bed made", sort_order: 1 }), rawItem("x2", { section: "Bed", description: "Bed made", sort_order: 2 })],
    }).items;
    expect(carryOverAnswers(before, twin, { a: { result: "pass" } }).answers).toEqual({});
    const dupOld = [...before, { ...before[0], id: "a-dup" }];
    const one = template("t", { items: [rawItem("only", { section: "Bed", description: "Bed made", sort_order: 1 })] }).items;
    const carried = carryOverAnswers(dupOld, one, { a: { result: "pass" }, "a-dup": { result: "fail" } });
    expect(Object.keys(carried.answers)).toEqual(["only"]);
    expect(carried.dropped).toEqual(["a-dup"]);
  });
});

describe("reading a stored draft", () => {
  it("round-trips a valid draft", () => {
    const stored = draft();
    expect(parseDraft(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it.each([
    ["not an object", "x"],
    ["wrong version", { ...draft(), version: 2 }],
    ["missing hotel", { ...draft(), hotelId: undefined }],
    ["answers not an object", { ...draft(), answers: [] }],
    ["an answer with a bad result", { ...draft(), answers: { a: { result: "maybe" } } }],
    ["a photo that is not a string", { ...draft(), photos: { a: 5 } }],
    ["a non-numeric timestamp", { ...draft(), startedAt: "now" }],
  ])("discards %s instead of half-trusting it", (_label, raw) => {
    expect(parseDraft(raw)).toBeNull();
  });
});
