import {
  adaptPmTemplates,
  buildCompletionPayload,
  draftCompatibility,
  draftHasContent,
  newDraft,
  pmProgress,
  rebaseDraft,
  templateSignature,
  validateInspection,
  type PmDraft,
  type PmTemplate,
  type PmTemplateRow,
} from "@/lib/engineering/pmChecklist";
import { PmCompletionBlockedError } from "@/lib/engineering/pmCompletion";
import { adaptPmMeters } from "@/lib/engineering/pmReadings";

const templateRow = (extra: Partial<PmTemplateRow> = {}): PmTemplateRow => ({
  id: "tpl-1",
  code: "boiler",
  name: "Boiler inspection",
  version: 3,
  is_active: true,
  items: {
    checklist: [
      { key: "relief_valve", label: "Relief valve operates", requires_evidence: true },
      { key: "leaks", label: "No visible leaks", requires_evidence: false },
      { label: "Burner flame is stable" },
    ],
  },
  ...extra,
});

const template = (): PmTemplate => adaptPmTemplates([templateRow()])[0];
const meters = adaptPmMeters([{ id: "m1", name: "Pressure", unit: "psi", warning_high: 20, critical_high: 25 }]);
const UUID_A = "11111111-1111-4111-8111-111111111111";

function answered(tpl = template()): PmDraft {
  const draft = newDraft("sched-1", tpl, new Date("2026-11-04T16:00:00Z"));
  draft.items.i0 = { result: "passed", note: "", evidence: [{ id: UUID_A }] };
  draft.items.i1 = { result: "failed", note: "Slow drip at fitting", evidence: [] };
  draft.items.i2 = { result: "not_applicable", note: "", evidence: [] };
  return draft;
}

describe("adaptPmTemplates", () => {
  it("keeps server item keys, order and evidence requirements, and the template version", () => {
    const tpl = template();
    expect(tpl).toMatchObject({ id: "tpl-1", version: 3, name: "Boiler inspection" });
    expect(tpl.items.map((i) => [i.id, i.key, i.label, i.requiresEvidence])).toEqual([
      ["i0", "relief_valve", "Relief valve operates", true],
      ["i1", "leaks", "No visible leaks", false],
      ["i2", null, "Burner flame is stable", false],
    ]);
  });

  it("drops templates with no usable checklist instead of inventing one", () => {
    const rows = [
      templateRow({ id: "empty", items: { checklist: [] } }),
      templateRow({ id: "none", items: null }),
      templateRow({ id: "blank", items: { checklist: [{ label: "  " }] } }),
      templateRow({ id: "off", is_active: false }),
      templateRow({ id: "ok" }),
    ];
    expect(adaptPmTemplates(rows).map((t) => t.id)).toEqual(["ok"]);
    expect(adaptPmTemplates(null)).toEqual([]);
  });
});

describe("a new draft", () => {
  it("starts with every step unanswered - nothing is defaulted to Pass", () => {
    const draft = newDraft("sched-1", template());
    expect(Object.values(draft.items).every((i) => i.result === null)).toBe(true);
    expect(pmProgress(template(), draft)).toMatchObject({ total: 3, answered: 0, percent: 0, unansweredIds: ["i0", "i1", "i2"] });
    expect(draftHasContent(draft)).toBe(false);
  });

  it("is recorded against the exact template version and content", () => {
    const draft = newDraft("sched-1", template());
    expect(draft).toMatchObject({ templateId: "tpl-1", templateVersion: 3, scheduleId: "sched-1" });
    expect(draft.templateSignature).toBe(templateSignature(template()));
  });
});

describe("progress", () => {
  it("counts answers by kind and flags controlled steps that still lack evidence", () => {
    const draft = answered();
    draft.items.i0.evidence = [];
    expect(pmProgress(template(), draft)).toMatchObject({ answered: 3, passed: 1, failed: 1, notApplicable: 1, percent: 100, evidenceMissingIds: ["i0"] });
  });

  it("does not ask for evidence on a step marked N/A", () => {
    const draft = answered();
    draft.items.i0 = { result: "not_applicable", note: "", evidence: [] };
    expect(pmProgress(template(), draft).evidenceMissingIds).toEqual([]);
  });
});

describe("validateInspection", () => {
  it("lists unanswered steps and missing evidence", () => {
    const draft = newDraft("sched-1", template());
    draft.items.i0 = { result: "passed", note: "", evidence: [] };
    expect(validateInspection(template(), draft, meters)).toEqual([
      { code: "unanswered", itemId: "i1" },
      { code: "unanswered", itemId: "i2" },
      { code: "evidence_required", itemId: "i0" },
    ]);
  });

  it("flags a reading that is not a number, bad labor, an unnamed part and an empty defect - but allows blank readings", () => {
    const draft = answered();
    expect(validateInspection(template(), draft, meters)).toEqual([]); // no reading entered is fine
    draft.readings.m1 = { value: "abc", note: "" };
    draft.laborMinutes = "2000";
    draft.parts = [{ id: "p1", name: " ", qty: "1" }, { id: "p2", name: "Filter", qty: "0" }];
    draft.defects = [{ id: "d1", description: "", severity: null }];
    expect(validateInspection(template(), draft, meters)).toEqual([
      { code: "reading_invalid", meterId: "m1" },
      { code: "labor_invalid" },
      { code: "part_invalid", partId: "p1" },
      { code: "part_invalid", partId: "p2" },
      { code: "defect_invalid", defectId: "d1" },
    ]);
  });
});

describe("buildCompletionPayload", () => {
  it("builds the real request: template id + version, ordered items with server keys, results, evidence ids and notes", () => {
    const draft = answered();
    draft.readings.m1 = { value: "18,5", note: "after warm-up" };
    draft.photos = [{ id: "photo-1" }];
    draft.laborMinutes = "45";
    draft.parts = [{ id: "p1", name: "Gasket", qty: "2" }];
    draft.defects = [{ id: "d1", description: "Corroded bracket", severity: "medium" }];
    draft.notes = "  All good otherwise  ";

    expect(buildCompletionPayload(template(), draft, meters)).toEqual({
      checklist_template_id: "tpl-1",
      checklist_version: 3,
      items: [
        { key: "relief_valve", label: "Relief valve operates", result: "passed", requires_evidence: true, evidence: [UUID_A] },
        { key: "leaks", label: "No visible leaks", result: "failed", requires_evidence: false, evidence: [], note: "Slow drip at fitting" },
        { label: "Burner flame is stable", result: "not_applicable", requires_evidence: false, evidence: [] },
      ],
      condition_readings: [{ meter_id: "m1", value: 18.5, notes: "after warm-up" }],
      photos: ["photo-1"],
      labor_minutes: 45,
      parts_used: [{ name: "Gasket", qty: 2 }],
      defects: [{ description: "Corroded bracket", severity: "medium" }],
      notes: "All good otherwise",
    });
  });

  it("never produces an empty or defaulted completion: unanswered steps throw before any request body exists", () => {
    const empty = newDraft("sched-1", template());
    expect(() => buildCompletionPayload(template(), empty, meters)).toThrow(PmCompletionBlockedError);
    const partial = answered();
    partial.items.i2 = { result: null, note: "", evidence: [] };
    expect(() => buildCompletionPayload(template(), partial, meters)).toThrow(PmCompletionBlockedError);
  });

  it("refuses a controlled step with no evidence, and never sends a URL as evidence", () => {
    const missing = answered();
    missing.items.i0.evidence = [];
    expect(() => buildCompletionPayload(template(), missing, meters)).toThrow(PmCompletionBlockedError);

    const url = answered();
    url.items.i0.evidence = [{ id: "https://example.com/photo.jpg" }];
    expect(() => buildCompletionPayload(template(), url, meters)).toThrow(PmCompletionBlockedError);
    const photoUrl = answered();
    photoUrl.photos = [{ id: "file:///tmp/p.jpg" }];
    expect(() => buildCompletionPayload(template(), photoUrl, meters)).toThrow(PmCompletionBlockedError);
  });

  it("omits optional sections that were not filled in, and does not turn a reading into a Pass", () => {
    const draft = answered();
    draft.items.i1 = { result: "failed", note: "", evidence: [] };
    draft.readings.m1 = { value: "12", note: "" }; // an in-range number
    const payload = buildCompletionPayload(template(), draft, meters);
    expect(payload).not.toHaveProperty("photos");
    expect(payload).not.toHaveProperty("labor_minutes");
    expect(payload).not.toHaveProperty("parts_used");
    expect(payload).not.toHaveProperty("defects");
    expect(payload).not.toHaveProperty("notes");
    expect(payload.items[1]).toEqual({ key: "leaks", label: "No visible leaks", result: "failed", requires_evidence: false, evidence: [] });
    expect(payload.condition_readings).toEqual([{ meter_id: "m1", value: 12 }]);
  });

  it("records a failed step as failed - the policy decision to open a work order belongs to the server", () => {
    const payload = buildCompletionPayload(template(), answered(), meters);
    expect(payload.items.filter((i) => i.result === "failed")).toHaveLength(1);
  });
});

describe("a draft meeting a changed checklist", () => {
  it("is compatible only with the identical checklist", () => {
    const draft = answered();
    expect(draftCompatibility(draft, template())).toBe("ok");
    expect(draftCompatibility(draft, undefined)).toBe("template_missing");
    const bumped = adaptPmTemplates([templateRow({ version: 4 })])[0];
    expect(draftCompatibility(draft, bumped)).toBe("template_changed");
    const editedInPlace = adaptPmTemplates([templateRow({ items: { checklist: [{ key: "relief_valve", label: "Relief valve operates", requires_evidence: true }, { key: "leaks", label: "No leaks at all" }] } })])[0];
    expect(draftCompatibility(draft, editedInPlace)).toBe("template_changed");
  });

  it("refuses to build a payload against the wrong checklist: the screen blocks on compatibility before submit", () => {
    const draft = answered();
    const changed = adaptPmTemplates([templateRow({ version: 4 })])[0];
    expect(draftCompatibility(draft, changed)).not.toBe("ok");
  });

  it("rebase carries answers only for steps that still exist and leaves new steps unanswered", () => {
    const draft = answered();
    draft.notes = "keep me";
    draft.laborMinutes = "30";
    const next = adaptPmTemplates([
      templateRow({
        version: 4,
        items: {
          checklist: [
            { key: "new_first", label: "Brand new step" },
            { key: "leaks", label: "No visible leaks" },
            { key: "relief_valve", label: "Relief valve operates", requires_evidence: true },
          ],
        },
      }),
    ])[0];
    const rebased = rebaseDraft(draft, next, new Date("2026-11-05T00:00:00Z"));
    expect(draftCompatibility(rebased, next)).toBe("ok");
    expect(rebased.templateVersion).toBe(4);
    expect(rebased.items.i0.result).toBeNull(); // new step
    expect(rebased.items.i1).toMatchObject({ result: "failed", note: "Slow drip at fitting" });
    expect(rebased.items.i2).toMatchObject({ result: "passed", evidence: [{ id: UUID_A }] });
    expect(rebased).toMatchObject({ notes: "keep me", laborMinutes: "30", startedAt: draft.startedAt });
    expect(pmProgress(next, rebased).unansweredIds).toEqual(["i0"]);
  });
});
