import type { InspectionDetail, InspectionDetailItem } from "@/lib/api/inspections";
import { buildRecord, buildSections, correctionSummary, failedIssues, infoRows, recordDateLabel } from "@/lib/inspections/history/record";

const item = (id: string, section: string | null, result: string, over: Partial<InspectionDetailItem> = {}): InspectionDetailItem => ({
  template_item_id: id,
  section,
  description: `Standard ${id}`,
  is_required: true,
  requires_photo_on_fail: false,
  result,
  note: null,
  severity: null,
  photo_url: null,
  ...over,
});

const detail = (over: Partial<InspectionDetail> = {}): InspectionDetail => ({
  id: "insp-1",
  room_id: "room-1",
  room_number: "205",
  floor: 2,
  building: null,
  room_type_id: null,
  template_id: "t1",
  template_name: "Standard King",
  overall_result: "passed",
  notes: null,
  completed_at: "2026-10-21T17:04:00.000Z",
  inspected_by: "sup-1",
  inspector_name: "Ana Supervisor",
  housekeeper_id: "hk-1",
  housekeeper_name: "Maria S.",
  service_type: "DEP",
  correction_kind: null,
  reinspection_of: null,
  items: [],
  correction: null,
  ...over,
});

describe("checklist sections", () => {
  const items = [
    item("a", "Bathroom", "pass"),
    item("b", "Bathroom", "pass"),
    item("c", "Bathroom", "na"),
    item("d", "Bedroom", "pass"),
    item("e", "Bedroom", "fail"),
    item("f", null, "pass"),
  ];

  it("groups in the recorded order and tallies pass out of what was answered, leaving N/A out", () => {
    const sections = buildSections(items);
    expect(sections.map((s) => [s.title, s.passed, s.answered, s.na, s.failed])).toEqual([
      ["Bathroom", 2, 2, 1, 0],
      ["Bedroom", 1, 2, 0, 1],
      [null, 1, 1, 0, 0],
    ]);
  });

  it("keeps the wording that was recorded, per item", () => {
    expect(buildSections(items)[0].answers.map((a) => a.description)).toEqual(["Standard a", "Standard b", "Standard c"]);
  });

  it("two sections with the same title (after a template edit) stay two sections", () => {
    const sections = buildSections([item("a", "Bath", "pass"), item("b", "Bed", "pass"), item("c", "Bath", "pass")]);
    expect(sections).toHaveLength(3);
    expect(new Set(sections.map((s) => s.key)).size).toBe(3);
  });

  it("an answer value it does not know is shown as recorded, not as a pass", () => {
    expect(buildSections([item("a", "Bath", "maybe")])[0].answers[0].result).toBe("unknown");
    expect(buildSections([item("a", "Bath", "maybe")])[0].passed).toBe(0);
  });

  it("an item whose wording is gone has an empty description for the screen to label, never an invented one", () => {
    expect(buildSections([item("a", "Bath", "pass", { description: null })])[0].answers[0].description).toBe("");
  });
});

describe("a historical inspection with no checklist rows", () => {
  it("is called what it is - the overall Passed does not invent a checklist of passes", () => {
    const view = buildRecord(detail({ items: [] }));
    expect(view.checklistMissing).toBe(true);
    expect(view.sections).toEqual([]);
    expect(view.tally).toEqual({ passed: 0, failed: 0, na: 0 });
    expect(view.result).toBe("passed");
  });

  it("a historical conditional stays conditional", () => {
    expect(buildRecord(detail({ overall_result: "conditional" })).result).toBe("conditional");
  });
});

describe("issues found", () => {
  const failed = detail({
    overall_result: "failed",
    items: [
      item("a", "Bathroom", "pass"),
      item("b", "Bathroom", "fail", { note: "Two bath towels missing.", severity: "minor", photo_url: "https://signed/x", has_evidence: true }),
      item("c", "Bedroom", "fail", { has_evidence: true }),
      item("d", "Bedroom", "fail", { severity: "major" }),
    ],
  });

  it("lists every recorded failed standard with its note, severity and section", () => {
    const issues = failedIssues(failed.items);
    expect(issues.map((i) => [i.id, i.section, i.severity, i.note])).toEqual([
      ["b", "Bathroom", "minor", "Two bath towels missing."],
      ["c", "Bedroom", null, null],
      ["d", "Bedroom", "major", null],
    ]);
  });

  it("tells a photo with a link from one that exists but can't be opened from none at all", () => {
    const [b, c, d] = failedIssues(failed.items);
    expect([b.evidence, c.evidence, d.evidence]).toEqual(["available", "unavailable", "none"]);
  });

  it("a failed inspection with no recorded failed items is shown honestly empty", () => {
    expect(buildRecord(detail({ overall_result: "failed", items: [] })).issues).toEqual([]);
  });
});

describe("information rows", () => {
  it("says 'not recorded' as null, and words the fixed values by key", () => {
    const rows = Object.fromEntries(infoRows(detail({ housekeeper_name: null, template_name: null, service_type: "STAY" })).map((r) => [r.key, r]));
    expect(rows.inspector.value).toBe("Ana Supervisor");
    expect(rows.housekeeper.value).toBeNull();
    expect(rows.template.value).toBeNull();
    expect(rows.service.valueKey).toBe("inspect.history.record.service.STAY");
    expect(rows.type.valueKey).toBe("inspect.history.record.type.initial");
  });

  it("an unfamiliar service code is shown as recorded; a missing one is not recorded", () => {
    const service = (code: string | null) => infoRows(detail({ service_type: code })).find((r) => r.key === "service")!;
    expect(service("TOUCH").value).toBe("TOUCH");
    expect(service(null).value).toBeNull();
  });

  it("a reinspection says so", () => {
    expect(infoRows(detail({ reinspection_of: "insp-0" })).find((r) => r.key === "type")!.valueKey).toBe("inspect.history.record.type.reinspection");
  });
});

describe("the correction", () => {
  const correction = (status: string, reinspection_id: string | null = null) =>
    ({ status, reinspection_id, kind: "reclean", task: null }) as unknown as InspectionDetail["correction"];

  it("only a passing reinspection that names this failure counts as verified", () => {
    expect(correctionSummary(detail({ correction: correction("verified", "insp-2") }))).toEqual({ outcome: "verified", followUpId: "insp-2", statusKey: "inspect.correction.detail.verified" });
  });

  it("a correction task that exists - even a completed one - is not proof of a fix", () => {
    expect(correctionSummary(detail({ correction: correction("resubmitted") })).outcome).toBe("open");
    expect(correctionSummary(detail({ correction: correction("in_progress") })).outcome).toBe("open");
    expect(correctionSummary(detail({ correction: correction("assigned") })).outcome).toBe("open");
  });

  it("a later failing reinspection means it failed again, and links to it", () => {
    expect(correctionSummary(detail({ correction: correction("superseded", "insp-3") }))).toMatchObject({ outcome: "failed_again", followUpId: "insp-3" });
  });

  it("no correction, cancelled and missing are each their own thing", () => {
    expect(correctionSummary(detail()).outcome).toBe("none");
    expect(correctionSummary(detail({ correction: correction("cancelled") })).outcome).toBe("cancelled");
    expect(correctionSummary(detail({ correction: correction("correction_missing") })).outcome).toBe("missing");
  });

  it("the original failure stays Failed after the correction is verified", () => {
    const view = buildRecord(detail({ overall_result: "failed", correction: correction("verified", "insp-2") }));
    expect(view.result).toBe("failed");
    expect(view.correction.outcome).toBe("verified");
  });
});

describe("record dates", () => {
  it("reads the date in the hotel's zone", () => {
    const ms = Date.parse("2026-10-22T02:30:00Z"); // 9:30 PM on Oct 21 in Chicago
    expect(recordDateLabel(ms, "America/Chicago", "en")).toBe("Oct 21");
    expect(recordDateLabel(ms, "UTC", "en")).toBe("Oct 22");
    expect(recordDateLabel(null, "America/Chicago", "en")).toBeNull();
  });
});
