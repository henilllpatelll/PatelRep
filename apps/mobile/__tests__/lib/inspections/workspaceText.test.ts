import { checklistProgress } from "@/lib/inspections/checklist";
import { buildQueue } from "@/lib/inspections/queue";
import { inspectionHref, originHref, parseOrigin } from "@/lib/inspections/route";
import { progressText, roomFacts, saveText } from "@/lib/inspections/workspaceText";
import { rawItem, readyRoom, template } from "../../helpers/inspectionFixtures";
import { makeTranslator } from "../../helpers/i18n";

const en = makeTranslator("en");
const es = makeTranslator("es");
const ctx = { timeZone: "America/Chicago", language: "en" };
const checklist = template("t", { name: "Standard Departure", items: [rawItem("a"), rawItem("b"), rawItem("c", { is_required: false })] });

describe("the room header text", () => {
  const item = (over = {}) =>
    buildQueue([readyRoom("r205", { room_number: "205", floor: 2, clean_type: "DEP", cleaned_by: "Maria S.", cleaned_at: "2026-10-20T16:42:00Z", room_type_name: "Standard King", ...over })])[0];

  it("shows only recorded facts: type, clean type, floor, who and when, and the checklist", () => {
    const facts = roomFacts(item(), checklist, ctx, en);
    expect(facts).toMatchObject({
      room: "205",
      reinspection: false,
      details: "Standard King · Departure · Floor 2",
      cleaned: "Cleaned by Maria S. · 11:42 AM",
      checklist: "Checklist: Standard Departure",
    });
  });

  it("never invents a missing room type, cleaner or time", () => {
    const facts = roomFacts(item({ room_type_name: null, cleaned_by: "", cleaned_at: null, clean_type: null, floor: null }), { name: "" }, ctx, en);
    expect(facts).toMatchObject({ details: null, cleaned: null, checklist: null });
  });

  it("names a building only when one is recorded, and half-known cleaning stays half-known", () => {
    expect(roomFacts(item({ building: "East" }), checklist, ctx, en).details).toBe("Standard King · Departure · Floor 2 · Building East");
    expect(roomFacts(item({ cleaned_by: "" }), checklist, ctx, en).cleaned).toBe("Cleaned at 11:42 AM");
    expect(roomFacts(item({ cleaned_at: null }), checklist, ctx, en).cleaned).toBe("Cleaned by Maria S.");
  });

  it("is real Spanish", () => {
    const facts = roomFacts(item(), checklist, { ...ctx, language: "es" }, es);
    expect(facts.details).toBe("Standard King · Salida · Piso 2");
    expect(facts.cleaned).toMatch(/^Limpiada por Maria S\. · /);
  });
});

describe("progress text", () => {
  it("separates how much is reviewed from what is left and what was found", () => {
    const progress = checklistProgress(checklist, { a: { result: "pass" }, c: { result: "fail" } });
    const text = progressText(progress, 1, en);
    expect(text).toMatchObject({ fraction: "2 of 3", remaining: "1 required item left", issues: "1 issue found", percent: 67 });
    expect(text.a11y).toContain("Progress is not a result");
  });

  it("completion is not a verdict: all required reviewed and no issues says so in words, not 'passed'", () => {
    const progress = checklistProgress(checklist, { a: { result: "pass" }, b: { result: "pass" } });
    const text = progressText(progress, 0, en);
    expect(text.remaining).toBe("All required items reviewed");
    expect(text.issues).toBe("No issues so far");
    expect(text.percent).toBe(67); // the optional item is not reviewed
    expect(`${text.remaining} ${text.issues}`).not.toMatch(/pass/i);
  });

  it("an empty checklist is 0%, never complete", () => {
    expect(progressText(checklistProgress({ items: [] }, {}), 0, en).percent).toBe(0);
  });
});

describe("the draft line", () => {
  it("claims a save only from a completed write, with its time", () => {
    expect(saveText({ status: "saved", at: Date.parse("2026-10-20T16:57:00Z") }, null, ctx, en)).toEqual({ text: "Draft saved · 11:57 AM", tone: "ok" });
    expect(saveText({ status: "pending" }, null, ctx, en).tone).toBe("busy");
    expect(saveText({ status: "saving" }, null, ctx, en).text).toBe("Saving draft…");
    expect(saveText({ status: "failed" }, null, ctx, en)).toEqual({ text: "Couldn't save the draft", tone: "warn" });
  });

  it("an untouched checklist has nothing saved; a resumed one shows when it was last stored", () => {
    expect(saveText({ status: "idle" }, null, ctx, en)).toEqual({ text: "Answers are saved on this phone as you go", tone: "muted" });
    expect(saveText({ status: "idle" }, Date.parse("2026-10-20T16:30:00Z"), ctx, en).text).toBe("Draft saved · 11:30 AM");
  });
});

describe("the canonical route", () => {
  it("names the room by id, carries the number only as a label, and remembers where to go back", () => {
    expect(inspectionHref("room-205", "205", "board")).toEqual({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-205", from: "board", roomNumber: "205" } });
    expect(inspectionHref("room-205", null)).toEqual({ pathname: "/(app)/inspect/[roomId]", params: { roomId: "room-205", from: "queue" } });
  });

  it("only a known origin is honoured", () => {
    expect(parseOrigin("board")).toBe("board");
    expect(parseOrigin("queue")).toBe("queue");
    for (const bad of ["https://evil.example", "../../admin", "", null, undefined]) expect(parseOrigin(bad as never)).toBe("queue");
  });

  it("Back returns to the Room Board for that room, or to the queue screen as it was left", () => {
    expect(originHref("board", "room-205")).toEqual({ pathname: "/(app)/room-board", params: { roomId: "room-205" } });
    expect(originHref("board", null)).toEqual({ pathname: "/(app)/inspect" });
    expect(originHref("queue", "room-205")).toEqual({ pathname: "/(app)/inspect" });
  });
});
