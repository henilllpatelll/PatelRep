import type { InspectionTimeline, TimelineEvent, TimelineInspection } from "@/lib/api/inspectionHistory";
import { buildTimelineLines, failedSummary, relatedInspections } from "@/lib/inspections/history/timeline";
import { makeTranslator } from "../../../helpers/i18n";

const en = makeTranslator("en");
const ZONE = "America/Chicago";

const inspection = (id: string, over: Partial<TimelineInspection> = {}): TimelineInspection => ({
  id,
  overall_result: "failed",
  completed_at: "2026-10-21T17:04:00.000Z",
  inspected_by: "sup-1",
  inspector_name: "Ana Supervisor",
  reinspection_of: null,
  is_reinspection: false,
  correction_kind: "reclean",
  failed_items: [{ template_item_id: "i1", section: "Bathroom", description: "Towels and amenities", note: null, severity: "minor" }],
  verified_by: null,
  repeated_by: null,
  ...over,
});

const event = (type: string, at: string, over: Partial<TimelineEvent> = {}): TimelineEvent => ({ key: `${type}:${at}`, type, at, actor_name: null, inspection_id: null, ...over });

const lines = (timeline: InspectionTimeline, currentId = "f1") => buildTimelineLines(timeline, { currentId, timeZone: ZONE, language: "en", t: en });

const base: InspectionTimeline = {
  inspection_id: "f1",
  room_id: "r1",
  room_number: "205",
  truncated: false,
  inspections: [inspection("f1", { verified_by: "p1" }), inspection("p1", { overall_result: "passed", reinspection_of: "f1", is_reinspection: true, completed_at: "2026-10-21T17:31:00.000Z", inspected_by: "sup-2", inspector_name: "Ben Supervisor", failed_items: [], correction_kind: null })],
  events: [
    event("inspection_failed", "2026-10-21T17:04:00.000Z", { inspection_id: "f1", actor_name: "Ana Supervisor" }),
    event("correction_created", "2026-10-21T17:04:30.000Z", { inspection_id: "f1" }),
    event("work_started", "2026-10-21T17:12:00.000Z", { inspection_id: "f1", actor_name: "Maria S." }),
    event("work_submitted", "2026-10-21T17:22:00.000Z", { inspection_id: "f1", actor_name: "Maria S." }),
    event("reinspection_passed", "2026-10-21T17:31:00.000Z", { inspection_id: "p1", actor_name: "Ben Supervisor" }),
  ],
};

describe("timeline lines", () => {
  it("words each recorded event, in the server's order, in the hotel's time", () => {
    const result = lines(base);
    expect(result.map((l) => l.title)).toEqual(["Original inspection", "Correction created", "Work started", "Correction submitted", "Reinspection passed, room approved"]);
    expect(result.map((l) => l.time)).toEqual(["12:04 PM", "12:04 PM", "12:12 PM", "12:22 PM", "12:31 PM"]);
    expect(result[0].detail).toBe("Failed: Towels and amenities · by Ana Supervisor");
    expect(result[2].detail).toBe("Maria S. began the correction");
    expect(result[3].detail).toBe("by Maria S. · Ready for supervisor verification");
    expect(result[4].detail).toBe("Verified by Ben Supervisor");
  });

  it("invents nothing: a cycle with no 'work started' event has no such line", () => {
    const noStart = { ...base, events: base.events.filter((e) => e.type !== "work_started") };
    expect(lines(noStart).map((l) => l.title)).not.toContain("Work started");
    expect(lines({ ...base, events: [] })).toEqual([]);
  });

  it("only inspection events link to a record, and the one being viewed is marked current", () => {
    const result = lines(base, "f1");
    expect(result.map((l) => l.inspectionId)).toEqual(["f1", null, null, null, "p1"]);
    expect(result.map((l) => l.current)).toEqual([true, false, false, false, false]);
    expect(lines(base, "p1").map((l) => l.current)).toEqual([false, false, false, false, true]);
  });

  it("a repeated failure keeps every failed inspection - the second is not called 'original'", () => {
    const repeat: InspectionTimeline = {
      ...base,
      inspections: [inspection("f1", { repeated_by: "f2" }), inspection("f2", { reinspection_of: "f1", is_reinspection: true, completed_at: "2026-10-21T17:40:00.000Z" })],
      events: [
        event("inspection_failed", "2026-10-21T17:04:00.000Z", { inspection_id: "f1" }),
        event("reinspection_failed", "2026-10-21T17:40:00.000Z", { inspection_id: "f2" }),
      ],
    };
    expect(lines(repeat).map((l) => l.title)).toEqual(["Original inspection", "Reinspection failed"]);
    expect(lines(repeat).map((l) => l.tone)).toEqual(["bad", "bad"]);
  });

  it("shows the date as well when the cycle crosses days", () => {
    const multi: InspectionTimeline = { ...base, events: [event("inspection_failed", "2026-10-21T17:04:00.000Z", { inspection_id: "f1" }), event("reinspection_passed", "2026-10-22T15:00:00.000Z", { inspection_id: "p1" })] };
    expect(lines(multi).map((l) => l.time)).toEqual(["Oct 21 · 12:04 PM", "Oct 22 · 10:00 AM"]);
  });

  it("a type it does not know is 'Update recorded'; an event with no readable time is left out", () => {
    const odd: InspectionTimeline = { ...base, events: [event("teleported", "2026-10-21T17:04:00.000Z"), event("work_started", "garbage")] };
    expect(lines(odd).map((l) => l.title)).toEqual(["Update recorded"]);
  });

  it("names a reassignment's new owner and who did it", () => {
    const reassigned: InspectionTimeline = { ...base, events: [event("reassigned", "2026-10-21T17:06:00.000Z", { inspection_id: "f1", actor_name: "Ana Supervisor", assignee_name: "Carlos C." })] };
    expect(lines(reassigned)[0].detail).toBe("Assigned to Carlos C. · by Ana Supervisor");
  });

  it("speaks Spanish", () => {
    const es = makeTranslator("es");
    const result = buildTimelineLines(base, { currentId: "f1", timeZone: ZONE, language: "es", t: es });
    expect(result[0].title).toBe("Inspección original");
    expect(result.every((l) => !l.title.startsWith("inspect."))).toBe(true);
  });
});

describe("failed summary", () => {
  it("lists up to two standards and counts the rest", () => {
    const many = inspection("x", { failed_items: ["A", "B", "C", "D"].map((d) => ({ template_item_id: d, section: null, description: d, note: null, severity: null })) });
    expect(failedSummary(many, en)).toBe("A, B and 2 more");
    expect(failedSummary(inspection("y"), en)).toBe("Towels and amenities");
  });

  it("falls back to a count when the wording is gone, and to nothing when nothing failed", () => {
    const nameless = inspection("z", { failed_items: [{ template_item_id: "i", section: null, description: null, note: null, severity: null }] });
    expect(failedSummary(nameless, en)).toBe("1 standard failed");
    expect(failedSummary(inspection("p", { failed_items: [] }), en)).toBeNull();
    expect(failedSummary(undefined, en)).toBeNull();
  });
});

describe("related inspections", () => {
  it("lists the whole cycle oldest first, marks the current one and the role of each", () => {
    const related = relatedInspections(base, "p1");
    expect(related.map((r) => [r.id, r.role, r.current])).toEqual([["f1", "initial", false], ["p1", "reinspection", true]]);
    expect(related[1].inspector).toBe("Ben Supervisor");
  });
});
