import {
  checklistSignature,
  detectTemplateChange,
  normalizeTemplate,
  normalizeTemplates,
  selectTemplate,
} from "@/lib/inspections/templates";
import { groupSections } from "@/lib/inspections/checklist";
import { rawItem, rawTemplate, template } from "../../helpers/inspectionFixtures";

describe("normalising what the server sends", () => {
  it("resolves optional fields to the database defaults and keeps requires_photo_on_fail", () => {
    const normalized = normalizeTemplate({
      id: "t1",
      name: " Standard ",
      items: [{ id: "a", description: "Bed made" }, { id: "b", description: "Mirror", requires_photo_on_fail: true, allows_na: false, is_required: false, section: "Bath" }],
    })!;
    expect(normalized.name).toBe("Standard");
    expect(normalized.isActive).toBe(true);
    expect(normalized.isDefault).toBe(false);
    expect(normalized.roomTypeId).toBeNull();
    expect(normalized.fingerprint).toBeNull();
    expect(normalized.items[0]).toMatchObject({ section: "General", isRequired: true, requiresPhotoOnFail: false, allowsNa: true });
    expect(normalized.items[1]).toMatchObject({ section: "Bath", isRequired: false, requiresPhotoOnFail: true, allowsNa: false });
  });

  it("only an explicit false deactivates a template or removes a requirement", () => {
    expect(normalizeTemplate({ ...rawTemplate("t"), is_active: false })!.isActive).toBe(false);
    expect(normalizeTemplate({ ...rawTemplate("t"), is_active: undefined })!.isActive).toBe(true);
  });

  it.each([
    ["no id", { items: [] }],
    ["items not a list", { id: "t", items: "nope" }],
    ["an item without an id", { id: "t", items: [{ description: "x" }] }],
    ["an item without wording", { id: "t", items: [{ id: "a", description: "  " }] }],
    ["duplicate item ids", { id: "t", items: [{ id: "a", description: "x" }, { id: "a", description: "y" }] }],
    ["not an object", "t"],
  ])("rejects a template with %s instead of guessing", (_label, raw) => {
    expect(normalizeTemplate(raw)).toBeNull();
  });

  it("counts unreadable templates and keeps the readable ones", () => {
    const { templates, invalid } = normalizeTemplates([rawTemplate("ok"), { id: "bad", items: [{}] }, null]);
    expect(templates.map((t) => t.id)).toEqual(["ok"]);
    expect(invalid).toBe(2);
    expect(normalizeTemplates({ data: [] })).toEqual({ templates: [], invalid: 1 });
  });

  it("keeps configured item order, breaking ties by id", () => {
    const t = normalizeTemplate({
      id: "t",
      items: [
        { id: "c", description: "c", sort_order: 3 },
        { id: "b", description: "b", sort_order: 1 },
        { id: "a", description: "a", sort_order: 1 },
      ],
    })!;
    expect(t.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("orders sections by their first configured item and keeps item order inside them", () => {
    const t = normalizeTemplate({
      id: "t",
      items: [
        { id: "1", description: "x", section: "Bath", sort_order: 1 },
        { id: "2", description: "x", section: "Bed", sort_order: 2 },
        { id: "3", description: "x", section: "Bath", sort_order: 3 },
      ],
    })!;
    expect(groupSections(t).map((s) => [s.name, s.items.map((i) => i.id)])).toEqual([
      ["Bath", ["1", "3"]],
      ["Bed", ["2"]],
    ]);
  });
});

describe("choosing the checklist for a room", () => {
  const king = template("king", { room_type_id: "type-king" });
  const suite = template("suite", { room_type_id: "type-suite" });
  const standard = template("standard", { is_default: true });

  it("prefers the template configured for the room's own type", () => {
    const result = selectTemplate([standard, suite, king], "type-king");
    expect(result).toMatchObject({ ok: true, basis: "room_type" });
    expect(result.ok && result.template.id).toBe("king");
  });

  it("falls back to the property's designated default when nothing matches the type", () => {
    const result = selectTemplate([suite, standard], "type-king");
    expect(result).toMatchObject({ ok: true, basis: "default" });
    expect(result.ok && result.template.id).toBe("standard");
  });

  it("never takes whichever template the server lists first", () => {
    const result = selectTemplate([suite, king, standard], "type-king");
    expect(result.ok && result.template.id).toBe("king");
    const noMatch = selectTemplate([suite, standard], "type-king");
    expect(noMatch.ok && noMatch.template.id).toBe("standard");
  });

  it("never selects an inactive template", () => {
    const inactiveKing = template("king", { room_type_id: "type-king", is_active: false });
    const result = selectTemplate([inactiveKing, standard], "type-king");
    expect(result.ok && result.template.id).toBe("standard");
    expect(selectTemplate([template("standard", { is_default: true, is_active: false })], "type-king")).toEqual({
      ok: false,
      reason: "no_usable_template",
    });
  });

  it("never selects an empty checklist", () => {
    const empty = template("king", { room_type_id: "type-king", items: [] });
    const chosen = selectTemplate([empty, standard], "type-king");
    expect(chosen.ok && chosen.template.id).toBe("standard");
    expect(selectTemplate([empty], "type-king")).toEqual({ ok: false, reason: "no_usable_template" });
  });

  it("never selects a template for a different room type when there is no default", () => {
    expect(selectTemplate([suite], "type-king")).toEqual({ ok: false, reason: "no_default" });
  });

  it("with no designated default, a lone general checklist is used (nothing to choose between) and flagged", () => {
    const untyped = template("untyped", { room_type_id: null, is_default: false });
    const result = selectTemplate([suite, untyped], "type-king");
    expect(result).toMatchObject({ ok: true, basis: "sole_general" });
    expect(result.ok && result.template.id).toBe("untyped");
    expect(result.ok && result.warnings).toContain("no_designated_default");
  });

  it("with no designated default, two general checklists would be a guess", () => {
    const a = template("a", { room_type_id: null, is_default: false });
    const b = template("b", { room_type_id: null, is_default: false });
    expect(selectTemplate([a, b], "type-king")).toEqual({ ok: false, reason: "no_default" });
    expect(selectTemplate([suite], "type-king")).toEqual({ ok: false, reason: "no_default" });
  });

  it("explains an empty or unreadable list", () => {
    expect(selectTemplate([], "type-king")).toEqual({ ok: false, reason: "no_templates" });
    expect(selectTemplate([], "type-king", { unreadable: 2 })).toEqual({ ok: false, reason: "invalid_templates" });
  });

  it("does not guess when the room type is unknown and a type-specific checklist exists", () => {
    expect(selectTemplate([suite, standard], null)).toEqual({ ok: false, reason: "room_type_unknown" });
    expect(selectTemplate([suite, standard], undefined)).toEqual({ ok: false, reason: "room_type_unknown" });
  });

  it("an unknown room type is fine when the default is the only checklist that could apply", () => {
    const result = selectTemplate([standard], null);
    expect(result.ok && result.template.id).toBe("standard");
    const typedDefault = template("typed-default", { is_default: true, room_type_id: "type-suite" });
    expect(selectTemplate([typedDefault], null).ok).toBe(true);
  });

  it("a typed template that is also the default applies to every room", () => {
    const typedDefault = template("typed-default", { is_default: true, room_type_id: "type-suite" });
    const result = selectTemplate([typedDefault], "type-king");
    expect(result.ok && result.template.id).toBe("typed-default");
  });

  it("chooses deterministically among duplicates and says so", () => {
    const a = template("a", { is_default: true, name: "Alpha" });
    const b = template("b", { is_default: true, name: "Beta" });
    const forward = selectTemplate([a, b], "type-king");
    const reversed = selectTemplate([b, a], "type-king");
    expect(forward.ok && forward.template.id).toBe("a");
    expect(reversed.ok && reversed.template.id).toBe("a");
    expect(forward.ok && forward.warnings).toContain("multiple_defaults");
    const k1 = template("k1", { room_type_id: "type-king", name: "King A" });
    const k2 = template("k2", { room_type_id: "type-king", name: "King B" });
    const both = selectTemplate([k2, k1], "type-king");
    expect(both.ok && both.warnings).toContain("multiple_room_type_templates");
    expect(both.ok && both.template.id).toBe("k1");
  });

  it("reports that some templates could not be read without blocking a usable one", () => {
    const result = selectTemplate([standard], "type-king", { unreadable: 1 });
    expect(result.ok && result.warnings).toContain("some_templates_unreadable");
  });
});

describe("detecting a checklist edited mid-inspection", () => {
  const shown = template("t", { fingerprint: "fp-1" });

  it("is the same when the digest matches", () => {
    expect(detectTemplateChange(shown, [template("t", { fingerprint: "fp-1" })])).toBe("same");
  });

  it("detects a changed digest even though the template id is unchanged", () => {
    expect(detectTemplateChange(shown, [template("t", { fingerprint: "fp-2" })])).toBe("changed");
  });

  it("without digests, compares the structure so a same-id edit is still caught", () => {
    const oldShape = template("t", { fingerprint: undefined });
    const same = template("t", { fingerprint: undefined });
    expect(detectTemplateChange(oldShape, [same])).toBe("same");
    const edited = template("t", {
      fingerprint: undefined,
      items: [rawItem("t-a", { sort_order: 1, description: "Reworded" }), rawItem("t-b", { sort_order: 2 })],
    });
    expect(detectTemplateChange(oldShape, [edited])).toBe("changed");
    expect(checklistSignature(oldShape)).not.toBe(checklistSignature(edited));
  });

  it("treats a deactivated, emptied or missing template as removed", () => {
    expect(detectTemplateChange(shown, [])).toBe("removed");
    expect(detectTemplateChange(shown, [template("t", { is_active: false })])).toBe("removed");
    expect(detectTemplateChange(shown, [template("t", { items: [] })])).toBe("removed");
  });

  it("one-sided digests fall back to structure rather than assuming sameness", () => {
    const withDigest = template("t", { fingerprint: "fp-1" });
    const withoutDigest = template("t", { fingerprint: undefined });
    expect(detectTemplateChange(withDigest, [withoutDigest])).toBe("same");
  });
});
