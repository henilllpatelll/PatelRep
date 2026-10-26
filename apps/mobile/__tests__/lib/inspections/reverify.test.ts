import { createDraft } from "@/lib/inspections/draft";
import { reverifyDraft } from "@/lib/inspections/reverify";
import { rawItem, rawTemplate, readyRoom, template } from "../../helpers/inspectionFixtures";

const checklist = template("t", { is_default: true, fingerprint: "fp-1", items: [rawItem("a", { section: "Bath", description: "Mirror clean" })] });
const draft = createDraft({
  hotelId: "h1", userId: "u1", roomId: "room-205", businessDate: "2026-10-20", cleanCycleId: "cycle-1", reinspectionOf: null, template: checklist, submissionId: "sub-1", now: 1,
});
const who = { hotelId: "h1", userId: "u1", businessDate: "2026-10-20" };
const room = (over = {}) => readyRoom("room-205", { clean_cycle_id: "cycle-1", room_type_id: "type-king", ...over });
const templates = (over = {}) => ({ data: [rawTemplate("t", { is_default: true, fingerprint: "fp-1", items: [rawItem("a", { section: "Bath", description: "Mirror clean" })], ...over })] });

function fetchers(queue: unknown, tpl: unknown) {
  return {
    queue: jest.fn(() => (queue instanceof Error ? Promise.reject(queue) : Promise.resolve(queue as never))),
    templates: jest.fn(() => (tpl instanceof Error ? Promise.reject(tpl) : Promise.resolve(tpl as never))),
  };
}

describe("is a stored draft still good right now?", () => {
  it("reads the room and the checklist again from the server, for the hotel's business date", async () => {
    const f = fetchers([room()], templates());
    const result = await reverifyDraft(draft, who, f);
    expect(result).toMatchObject({ kind: "ok", item: { roomId: "room-205" }, template: { id: "t" } });
    expect(f.queue).toHaveBeenCalledWith("2026-10-20");
    expect(f.templates).toHaveBeenCalledTimes(1);
  });

  it("a room no longer waiting is not resumable", async () => {
    expect(await reverifyDraft(draft, who, fetchers([readyRoom("room-999")], templates()))).toEqual({ kind: "not_awaiting" });
    expect(await reverifyDraft(draft, who, fetchers([], templates()))).toEqual({ kind: "not_awaiting" });
  });

  it("a new clean cycle, another day, or a different earlier failure makes it unusable", async () => {
    expect(await reverifyDraft(draft, who, fetchers([room({ clean_cycle_id: "cycle-2" })], templates()))).toEqual({ kind: "unusable", reason: "room_changed" });
    expect(await reverifyDraft(draft, { ...who, businessDate: "2026-10-21" }, fetchers([room()], templates()))).toEqual({ kind: "unusable", reason: "other_day" });
    const failure = { inspection_id: "i9", inspected_at: null, overall_result: "failed", notes: null, correction_kind: "reclean" as const, items: [] };
    expect(await reverifyDraft(draft, who, fetchers([room({ previous_failure: failure })], templates()))).toEqual({ kind: "unusable", reason: "room_changed" });
  });

  it("a different account's draft is refused before anything else is compared", async () => {
    expect(await reverifyDraft(draft, { ...who, hotelId: "h2" }, fetchers([room()], templates()))).toEqual({ kind: "unusable", reason: "other_hotel" });
    expect(await reverifyDraft(draft, { ...who, userId: "u2" }, fetchers([room()], templates()))).toEqual({ kind: "unusable", reason: "other_user" });
  });

  it("an edited checklist is its own outcome, carrying the one that applies now", async () => {
    const result = await reverifyDraft(draft, who, fetchers([room()], templates({ fingerprint: "fp-2" })));
    expect(result).toMatchObject({ kind: "template_changed", template: { fingerprint: "fp-2" } });
  });

  it("names why no checklist can be used", async () => {
    expect(await reverifyDraft(draft, who, fetchers([room()], templates({ is_active: false })))).toEqual({ kind: "template_unavailable", reason: "no_usable_template" });
    expect(await reverifyDraft(draft, who, fetchers([room()], { data: [] }))).toEqual({ kind: "template_unavailable", reason: "no_templates" });
  });

  it("not knowing is not permission: a failed read is unavailable", async () => {
    expect(await reverifyDraft(draft, who, fetchers(new Error("offline"), templates()))).toEqual({ kind: "unavailable" });
    expect(await reverifyDraft(draft, who, fetchers([room()], new Error("offline")))).toEqual({ kind: "unavailable" });
  });
});
