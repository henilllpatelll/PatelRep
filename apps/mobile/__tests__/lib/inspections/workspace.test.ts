import { loadingSource } from "@/lib/housekeeping/supervisorSources";
import { groupSections } from "@/lib/inspections/checklist";
import { createDraft, type InspectionDraft } from "@/lib/inspections/draft";
import { buildQueue } from "@/lib/inspections/queue";
import { selectTemplate } from "@/lib/inspections/templates";
import {
  LONG_DESCRIPTION,
  buildReview,
  buildRows,
  chooseAnswer,
  clearAnswer,
  draftContext,
  failedCount,
  hasGuidance,
  hasProgress,
  initialExpanded,
  isVerifiedFresh,
  nextToReview,
  reconcileTemplate,
  resolveGate,
  reviewReadiness,
  sessionIssue,
  setItemNote,
  summarizeSections,
  type Gate,
} from "@/lib/inspections/workspace";
import { rawItem, readyRoom, template } from "../../helpers/inspectionFixtures";

const NOW = 1_000;
const checklist = template("t", {
  fingerprint: "fp-1",
  items: [
    rawItem("toilet", { section: "Bathroom", description: "Toilet sanitized", sort_order: 1 }),
    rawItem("mirror", { section: "Bathroom", description: "Bathroom mirrors", sort_order: 2 }),
    rawItem("towels", { section: "Bathroom", description: "Towels and amenities", sort_order: 3, allows_na: false }),
    rawItem("bed", { section: "Bedroom", description: "Bedding", sort_order: 4 }),
    rawItem("lamp", { section: "Bedroom", description: "Lighting", sort_order: 5, is_required: false }),
    rawItem("door", { section: "Entry", description: "Door closes and locks", sort_order: 6, requires_photo_on_fail: true }),
  ],
});

function fresh(overrides: Partial<InspectionDraft> = {}): InspectionDraft {
  return {
    ...createDraft({
      hotelId: "hotel-1", userId: "sup-1", roomId: "room-205", businessDate: "2026-10-20", cleanCycleId: "cycle-1",
      reinspectionOf: null, template: checklist, submissionId: "sub-1", now: NOW,
    }),
    ...overrides,
  };
}

function answered(draft: InspectionDraft, id: string, result: "pass" | "fail" | "na", note?: string): InspectionDraft {
  const out = chooseAnswer(draft, checklist, id, result, NOW + 1);
  if (!out.ok) throw new Error(`refused ${id}`);
  return note === undefined ? out.draft : setItemNote(out.draft, id, note, NOW + 2);
}

describe("answers", () => {
  it("records an explicit answer and never an implicit pass", () => {
    const start = fresh();
    expect(start.answers).toEqual({});
    expect(failedCount(start.answers)).toBe(0);
    const next = answered(start, "toilet", "pass");
    expect(next.answers).toEqual({ toilet: { result: "pass" } });
    expect(next.answers.mirror).toBeUndefined();
    expect(next.questions.toilet).toEqual({ section: "Bathroom", description: "Toilet sanitized" });
  });

  it("switching an answer replaces it; choosing the selected answer again clears it", () => {
    let draft = answered(fresh(), "mirror", "pass");
    draft = answered(draft, "mirror", "fail");
    expect(draft.answers.mirror).toEqual({ result: "fail" });
    const cleared = chooseAnswer(draft, checklist, "mirror", "fail", NOW + 5);
    expect(cleared.ok && cleared.draft.answers.mirror).toBeUndefined();
    expect(cleared.ok && cleared.draft.questions.mirror).toBeUndefined();
  });

  it("keeps a written note across answers, and drops a severity once the item is not a failure", () => {
    let draft = answered(fresh(), "mirror", "pass", "streak on the left");
    draft = answered(draft, "mirror", "na");
    expect(draft.answers.mirror).toEqual({ result: "na", note: "streak on the left" });
    const withSeverity: InspectionDraft = { ...draft, answers: { ...draft.answers, mirror: { result: "fail", severity: "minor" } } };
    const passed = chooseAnswer(withSeverity, checklist, "mirror", "pass", NOW + 9);
    expect(passed.ok && passed.draft.answers.mirror).toEqual({ result: "pass" });
  });

  it("refuses N/A where the item does not allow it, and says why (not silently)", () => {
    expect(chooseAnswer(fresh(), checklist, "towels", "na", NOW)).toEqual({ ok: false, refusal: "na_not_allowed" });
    expect(chooseAnswer(fresh(), checklist, "toilet", "na", NOW).ok).toBe(true);
    expect(chooseAnswer(fresh(), checklist, "toilet", "na", NOW, "forbid")).toEqual({ ok: false, refusal: "na_not_allowed" });
    expect(chooseAnswer(fresh(), checklist, "lamp", "na", NOW, "forbid").ok).toBe(true); // optional items are not covered by the policy
  });

  it("refuses an item that is not on this checklist", () => {
    expect(chooseAnswer(fresh(), checklist, "ghost", "pass", NOW)).toEqual({ ok: false, refusal: "unknown_item" });
  });

  it("a photo only ever belongs to a failed item", () => {
    const draft: InspectionDraft = { ...answered(fresh(), "door", "fail"), photos: { door: "file:///d.jpg" } };
    const passed = chooseAnswer(draft, checklist, "door", "pass", NOW + 4);
    expect(passed.ok && passed.draft.photos).toEqual({});
  });

  it("notes: only on answered items, whitespace is no note, unchanged returns the same draft", () => {
    const base = answered(fresh(), "toilet", "pass");
    expect(setItemNote(fresh(), "toilet", "hello", NOW)).toEqual(fresh());
    const noted = setItemNote(base, "toilet", "  fine  ", NOW + 3);
    expect(noted.answers.toilet.note).toBe("  fine  ");
    expect(setItemNote(noted, "toilet", "  fine  ", NOW + 4)).toBe(noted);
    expect(setItemNote(noted, "toilet", "   ", NOW + 5).answers.toilet).toEqual({ result: "pass" });
    expect(setItemNote(base, "toilet", "x".repeat(900), NOW).answers.toilet.note).toHaveLength(500);
  });

  it("clearing an unanswered item changes nothing", () => {
    const draft = fresh();
    expect(clearAnswer(draft, "toilet", NOW)).toEqual({ ok: true, draft });
  });

  it("an untouched draft has no progress; one answer or note is progress", () => {
    expect(hasProgress(fresh())).toBe(false);
    expect(hasProgress(answered(fresh(), "toilet", "pass"))).toBe(true);
    expect(hasProgress(fresh({ notes: "  " }))).toBe(false);
    expect(hasProgress(fresh({ notes: "x" }))).toBe(true);
  });
});

describe("sections and rows", () => {
  const sections = groupSections(checklist);

  it("keeps the configured section and item order", () => {
    expect(sections.map((s) => s.name)).toEqual(["Bathroom", "Bedroom", "Entry"]);
    expect(sections[0].items.map((i) => i.id)).toEqual(["toilet", "mirror", "towels"]);
  });

  it("counts reviewed, required-missing and failed per section", () => {
    let draft = answered(fresh(), "toilet", "pass");
    draft = answered(draft, "mirror", "fail");
    expect(summarizeSections(sections, draft.answers)).toEqual([
      { name: "Bathroom", total: 3, answered: 2, requiredMissing: 1, failed: 1 },
      { name: "Bedroom", total: 2, answered: 0, requiredMissing: 1, failed: 0 },
      { name: "Entry", total: 1, answered: 0, requiredMissing: 1, failed: 0 },
    ]);
  });

  it("opens the first section that still needs an answer, and only that one", () => {
    const empty = summarizeSections(sections, {});
    expect(initialExpanded(empty)).toEqual({ Bathroom: true, Bedroom: false, Entry: false });
    let draft = fresh();
    for (const id of ["toilet", "mirror", "towels"]) draft = answered(draft, id, "pass");
    expect(initialExpanded(summarizeSections(sections, draft.answers))).toEqual({ Bathroom: false, Bedroom: true, Entry: false });
  });

  it("falls back to an optional-only gap, then to the top of a finished checklist", () => {
    let draft = fresh();
    for (const id of ["toilet", "mirror", "towels", "bed", "door"]) draft = answered(draft, id, "pass");
    expect(initialExpanded(summarizeSections(sections, draft.answers))).toEqual({ Bathroom: false, Bedroom: true, Entry: false }); // lamp is optional but unreviewed
    draft = answered(draft, "lamp", "pass");
    expect(initialExpanded(summarizeSections(sections, draft.answers))).toEqual({ Bathroom: true, Bedroom: false, Entry: false });
  });

  it("a collapsed section contributes only its header; an open one lists its items in order", () => {
    const summaries = summarizeSections(sections, {});
    const rows = buildRows(sections, summaries, { Bathroom: true, Bedroom: false, Entry: false }, {});
    expect(rows.map((r) => r.key)).toEqual(["section:Bathroom", "item:toilet", "item:mirror", "item:towels", "section:Bedroom", "section:Entry"]);
    const answers = answered(fresh(), "mirror", "fail").answers;
    const item = buildRows(sections, summarizeSections(sections, answers), { Bathroom: true }, answers).find((r) => r.kind === "item" && r.item.id === "mirror");
    expect(item && item.kind === "item" && item.answer).toEqual({ result: "fail" });
  });

  it("keeps an unchanged answer's identity so unchanged rows can skip rendering", () => {
    const first = answered(fresh(), "toilet", "pass");
    const second = answered(first, "mirror", "pass");
    expect(second.answers.toilet).toBe(first.answers.toilet);
  });

  it("goes to the next unanswered REQUIRED item after the last touched one, wrapping, else any open item", () => {
    expect(nextToReview(checklist, {}, null)?.id).toBe("toilet");
    expect(nextToReview(checklist, answered(fresh(), "toilet", "pass").answers, "toilet")?.id).toBe("mirror");
    expect(nextToReview(checklist, answered(fresh(), "door", "pass").answers, "door")?.id).toBe("toilet"); // wraps past the end
    let draft = fresh();
    for (const id of ["toilet", "mirror", "towels", "bed", "door"]) draft = answered(draft, id, "pass");
    expect(nextToReview(checklist, draft.answers, "door")?.id).toBe("lamp"); // only an optional item is left
    expect(nextToReview(checklist, answered(draft, "lamp", "pass").answers, "lamp")).toBeNull();
  });
});

describe("guidance", () => {
  it("is offered only when there is something to read beyond the row", () => {
    const [toilet, , towels, , , door] = [...checklist.items].sort((a, b) => a.sortOrder - b.sortOrder).filter((i) => ["toilet", "mirror", "towels", "bed", "lamp", "door"].includes(i.id)).map((i) => i);
    expect(hasGuidance(toilet)).toBe(false);
    expect(hasGuidance(towels)).toBe(true); // N/A not allowed
    expect(hasGuidance(door)).toBe(true); // photo needed on failure
    const long = { ...toilet, description: "x".repeat(LONG_DESCRIPTION + 1) };
    expect(hasGuidance(long)).toBe(true);
    expect(hasGuidance({ ...toilet, description: "x".repeat(LONG_DESCRIPTION) })).toBe(false);
  });
});

describe("review readiness", () => {
  function all(draft: InspectionDraft, ids: string[], result: "pass" | "fail" | "na" = "pass") {
    return ids.reduce((d, id) => answered(d, id, result), draft);
  }

  it("sends the supervisor to the first required item still unanswered, with the count", () => {
    const draft = all(fresh(), ["toilet"]);
    expect(reviewReadiness(checklist, draft)).toEqual({ kind: "unanswered", itemId: "mirror", remaining: 4 });
  });

  it("an optional item never blocks review", () => {
    const draft = all(fresh(), ["toilet", "mirror", "towels", "bed", "door"]);
    expect(reviewReadiness(checklist, draft).kind).toBe("ready");
  });

  it("an N/A that needs its note blocks review at that item (policy: require_note)", () => {
    const draft = all(fresh(), ["mirror", "toilet", "towels", "bed", "door"]);
    const na = answered(draft, "bed", "na");
    expect(reviewReadiness(checklist, na, "require_note")).toEqual({ kind: "invalid", code: "na_note_required", itemId: "bed" });
    expect(reviewReadiness(checklist, setItemNote(na, "bed", "no bed here", NOW + 9), "require_note").kind).toBe("ready");
    expect(reviewReadiness(checklist, na, "forbid")).toEqual({ kind: "invalid", code: "na_not_allowed", itemId: "bed" });
  });

  it("a failed item whose photo or details only a later step can supply still lets the supervisor REVIEW", () => {
    const draft = answered(all(fresh(), ["toilet", "mirror", "towels", "bed"]), "door", "fail");
    const ready = reviewReadiness(checklist, draft);
    expect(ready.kind).toBe("ready");
    expect(ready.kind === "ready" && ready.evaluation.canSubmit).toBe(false); // the photo is still missing
    expect(ready.kind === "ready" && ready.evaluation.outcome).toBe("failed");
  });

  it("the review lists what is outstanding and counts each answer", () => {
    let draft = all(fresh(), ["toilet", "bed"]);
    draft = answered(draft, "mirror", "fail", "streaks");
    draft = answered(draft, "towels", "pass");
    draft = answered(draft, "door", "fail");
    const review = buildReview(checklist, draft);
    expect(review).toMatchObject({ passed: 3, failed: 2, na: 0, optionalUnreviewed: 1, outstanding: 2 });
    expect(review.failures.find((f) => f.item.id === "mirror")).toMatchObject({ note: "streaks", needsDetails: true, photoRequired: false, photoMissing: false });
    expect(review.failures.find((f) => f.item.id === "door")).toMatchObject({ photoRequired: true, photoMissing: true, needsDetails: true });
  });

  it("an issue with a recorded severity and no photo requirement is not outstanding", () => {
    const base = answered(fresh(), "mirror", "fail");
    const withSeverity: InspectionDraft = { ...base, answers: { ...base.answers, mirror: { result: "fail", severity: "minor" } } };
    expect(buildReview(checklist, withSeverity).outstanding).toBe(0);
  });
});

describe("a changed checklist", () => {
  const edited = template("t", {
    fingerprint: "fp-2",
    items: [
      rawItem("n-toilet", { section: "Bathroom", description: "Toilet sanitized", sort_order: 1 }), // same question, new id
      rawItem("n-mirror", { section: "Bathroom", description: "Bathroom mirrors cleaned", sort_order: 2 }), // reworded
      rawItem("n-towels", { section: "Bathroom", description: "Towels and amenities", sort_order: 3, allows_na: false }),
      rawItem("n-bed", { section: "Bedroom", description: "Bedding", sort_order: 4 }),
      rawItem("n-lamp", { section: "Bedroom", description: "Lighting", sort_order: 5, is_required: false }),
      rawItem("n-door", { section: "Entry", description: "Door closes and locks", sort_order: 6, requires_photo_on_fail: true }),
      rawItem("n-new", { section: "Entry", description: "Safety card in place", sort_order: 7 }), // brand new required item
    ],
  });

  it("keeps only the answers whose question is unchanged, never by position, and mints a new submission id", () => {
    let draft = fresh();
    draft = answered(draft, "toilet", "pass");
    draft = answered(draft, "mirror", "pass");
    draft = answered(draft, "bed", "fail");
    const plan = reconcileTemplate(draft, edited, { now: NOW + 50, submissionId: "sub-2" });
    expect(plan.draft.answers).toEqual({ "n-toilet": { result: "pass" }, "n-bed": { result: "fail" } });
    expect(plan.draft.answers["n-mirror"]).toBeUndefined(); // reworded: a different question
    expect(plan).toMatchObject({ carried: 2, dropped: 1 });
    expect(plan.draft).toMatchObject({ templateFingerprint: "fp-2", submissionId: "sub-2", roomId: "room-205", cleanCycleId: "cycle-1", updatedAt: NOW + 50 });
    expect(plan.draft.questions["n-toilet"]).toEqual({ section: "Bathroom", description: "Toilet sanitized" });
  });

  it("a new required item is never treated as passed - it still needs an answer", () => {
    const plan = reconcileTemplate(answered(fresh(), "toilet", "pass"), edited, { now: NOW, submissionId: "s" });
    expect(plan.stillToAnswer).toBe(edited.items.filter((i) => i.isRequired).length - 1);
    expect(reviewReadiness(edited, plan.draft).kind).toBe("unanswered");
  });

  it("an N/A the new rules refuse is dropped, not carried", () => {
    const strict = template("t", { fingerprint: "fp-3", items: [rawItem("x", { section: "Bathroom", description: "Toilet sanitized", allows_na: false })] });
    const plan = reconcileTemplate(answered(fresh(), "toilet", "na"), strict, { now: NOW, submissionId: "s" });
    expect(plan.draft.answers).toEqual({});
    expect(plan.dropped).toBe(1);
  });

  it("answers with no recorded question cannot be matched and are counted as dropped", () => {
    const draft = fresh({ answers: { toilet: { result: "pass" } }, questions: {} });
    const plan = reconcileTemplate(draft, edited, { now: NOW, submissionId: "s" });
    expect(plan).toMatchObject({ carried: 0, dropped: 1 });
  });
});

describe("which room and checklist a link names", () => {
  const rooms = [readyRoom("room-205", { room_type_id: "type-king", room_type_name: "Standard King" }), readyRoom("room-305", { room_type_id: "type-suite" })];
  const queue = { status: "available", data: rooms, fetchedAt: NOW } as const;
  const items = buildQueue(rooms);
  const known = { status: "available", data: {}, fetchedAt: NOW } as const;
  const base = {
    roomId: "room-205",
    signedIn: true,
    isOnline: true,
    queue,
    items,
    templates: known,
    selectionFor: (typeId: string | null | undefined) => selectTemplate([checklist], typeId),
  };

  it("resolves the room by its stable id and gives it the applicable checklist", () => {
    const gate = resolveGate(base);
    expect(gate.kind).toBe("ready");
    expect(gate.kind === "ready" && gate.item.roomNumber).toBe("205");
    expect(gate.kind === "ready" && gate.template.id).toBe("t");
  });

  it.each([null, "", "../../x", "a b", "x".repeat(80)])("rejects an invalid link %j", (roomId) => {
    expect(resolveGate({ ...base, roomId })).toEqual({ kind: "unavailable", reason: "invalid_link" });
  });

  it("a foreign or already-inspected room is not in the verified queue: not awaiting", () => {
    expect(resolveGate({ ...base, roomId: "room-999" })).toEqual({ kind: "unavailable", reason: "not_awaiting" });
  });

  it("never judges a room missing while the queue is unverified", () => {
    expect(resolveGate({ ...base, queue: loadingSource(), items: null })).toEqual({ kind: "loading" });
    expect(resolveGate({ ...base, queue: { status: "failed", failure: { kind: "error", status: 500 } }, items: null })).toEqual({ kind: "unavailable", reason: "queue_failed" });
    expect(resolveGate({ ...base, queue: loadingSource(), items: null, isOnline: false })).toEqual({ kind: "unavailable", reason: "needs_connection" });
  });

  it("signed out is its own state", () => {
    expect(resolveGate({ ...base, signedIn: false })).toEqual({ kind: "unavailable", reason: "signed_out" });
  });

  it("names why a checklist cannot be used instead of guessing", () => {
    expect(resolveGate({ ...base, selectionFor: () => selectTemplate([], "type-king") })).toEqual({ kind: "unavailable", reason: "no_templates" });
    expect(resolveGate({ ...base, selectionFor: () => null, templates: loadingSource() })).toEqual({ kind: "loading" });
    expect(resolveGate({ ...base, selectionFor: () => null, templates: { status: "failed", failure: { kind: "error", status: 500 } } })).toEqual({ kind: "unavailable", reason: "templates_failed" });
  });

  it("only a fresh, verified answer may start or resume", () => {
    expect(isVerifiedFresh(queue)).toBe(true);
    expect(isVerifiedFresh({ status: "empty", fetchedAt: NOW })).toBe(true);
    expect(isVerifiedFresh({ status: "stale", data: rooms, fetchedAt: NOW, reason: "offline", failure: null })).toBe(false);
    expect(isVerifiedFresh(loadingSource())).toBe(false);
  });
});

describe("may an unfinished inspection continue?", () => {
  const rooms = [readyRoom("room-205", { room_type_id: "type-king", clean_cycle_id: "cycle-1" })];
  const items = buildQueue(rooms);
  const ready = (over: Partial<Extract<Gate, { kind: "ready" }>> = {}): Gate => ({ kind: "ready", item: items[0], template: checklist, ...over });
  const base = { draft: fresh(), hotelId: "hotel-1", userId: "sup-1", businessDate: "2026-10-20" };

  it("carries on when everything still matches", () => {
    expect(sessionIssue({ ...base, gate: ready() })).toBeNull();
  });

  it("stops when the room is no longer awaiting inspection", () => {
    expect(sessionIssue({ ...base, gate: { kind: "unavailable", reason: "not_awaiting" } })).toBe("not_awaiting");
  });

  it("stops when a new clean cycle began or the earlier failure being re-checked changed", () => {
    const recleaned = buildQueue([readyRoom("room-205", { room_type_id: "type-king", clean_cycle_id: "cycle-2" })]);
    expect(sessionIssue({ ...base, gate: ready({ item: recleaned[0] }) })).toBe("room_changed");
    const failure = { inspection_id: "insp-9", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "reclean" as const, items: [] };
    const reinspect = buildQueue([readyRoom("room-205", { room_type_id: "type-king", clean_cycle_id: "cycle-1", previous_failure: failure })]);
    expect(sessionIssue({ ...base, gate: ready({ item: reinspect[0] }) })).toBe("room_changed");
  });

  it("stops when the checklist changed or went away", () => {
    const edited = template("t", { fingerprint: "fp-9", items: checklist.items.map((i) => rawItem(i.id, { section: i.section, description: i.description, sort_order: i.sortOrder })) });
    expect(sessionIssue({ ...base, gate: ready({ template: edited }) })).toBe("template_changed");
    expect(sessionIssue({ ...base, gate: { kind: "unavailable", reason: "no_usable_template" } })).toBe("template_changed");
  });

  it("stops when the hotel day rolled over or the account is not the draft's", () => {
    expect(sessionIssue({ ...base, businessDate: "2026-10-21", gate: ready() })).toBe("other_day");
    expect(sessionIssue({ ...base, userId: "sup-2", gate: ready() })).toBe("room_changed");
    expect(sessionIssue({ ...base, hotelId: "hotel-2", gate: ready() })).toBe("room_changed");
  });

  it("does not interrupt for what it simply cannot know right now (offline, still loading)", () => {
    expect(sessionIssue({ ...base, gate: { kind: "loading" } })).toBeNull();
    expect(sessionIssue({ ...base, gate: { kind: "unavailable", reason: "queue_failed" } })).toBeNull();
    expect(sessionIssue({ ...base, gate: { kind: "unavailable", reason: "needs_connection" } })).toBeNull();
  });

  it("the draft context is built from the queue row, not from the label", () => {
    expect(draftContext({ hotelId: "h", userId: "u", businessDate: "d", item: items[0], template: checklist })).toMatchObject({ roomId: "room-205", cleanCycleId: "cycle-1", reinspectionOf: null });
  });
});
