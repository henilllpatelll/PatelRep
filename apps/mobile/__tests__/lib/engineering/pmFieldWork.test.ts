import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import {
  adaptPmTemplates,
  buildCompletionPayload,
  evidenceSummary,
  issueSection,
  newDraft,
  pmProgress,
  sectionStatuses,
  validateInspection,
  type PmDraft,
} from "@/lib/engineering/pmChecklist";
import { PmCompletionBlockedError } from "@/lib/engineering/pmCompletion";
import { adaptPmMeters, toggleReadingSign } from "@/lib/engineering/pmReadings";
import { configuredRange } from "@/lib/engineering/assetReadings";
import { clearPmDraft, loadPmDraft, savePmDraft } from "@/lib/engineering/pmDraftStore";

const template = adaptPmTemplates([
  {
    id: "t1",
    name: "Boiler",
    version: 2,
    items: { checklist: [{ key: "valve", label: "Relief valve", requires_evidence: true }, { key: "leaks", label: "No leaks" }, { key: "tag", label: "Tag signed", requires_evidence: true }] },
  },
])[0];
const meters = adaptPmMeters([{ id: "m1", name: "Pressure", unit: "psi", warning_high: 20, critical_high: 25 }]);

function answered(overrides: Partial<PmDraft["items"]> = {}): PmDraft {
  const draft = newDraft("s1", template);
  draft.items.i0 = { result: "passed", note: "", evidence: [{ id: "ev-1" }] };
  draft.items.i1 = { result: "passed", note: "", evidence: [] };
  draft.items.i2 = { result: "passed", note: "", evidence: [{ id: "ev-2" }] };
  Object.assign(draft.items, overrides);
  return draft;
}

describe("a failed step needs a written finding", () => {
  it("blocks completion until the technician says what failed, and names the step", () => {
    const draft = answered({ i1: { result: "failed", note: "   ", evidence: [] } });
    expect(pmProgress(template, draft).findingMissingIds).toEqual(["i1"]);
    expect(validateInspection(template, draft, meters)).toEqual([{ code: "finding_required", itemId: "i1" }]);
    expect(() => buildCompletionPayload(template, draft, meters)).toThrow(PmCompletionBlockedError);
  });

  it("is satisfied by the finding, which travels as the step's note", () => {
    const draft = answered({ i1: { result: "failed", note: "  Drips at the union ", evidence: [] } });
    expect(validateInspection(template, draft, meters)).toEqual([]);
    expect(buildCompletionPayload(template, draft, meters).items[1]).toMatchObject({ result: "failed", note: "Drips at the union" });
  });

  it("does not ask for a finding on a Pass or N/A", () => {
    const draft = answered({ i1: { result: "not_applicable", note: "", evidence: [] } });
    expect(pmProgress(template, draft).findingMissingIds).toEqual([]);
  });
});

describe("fixing an issue lands in the right part of the inspection", () => {
  it.each([
    [{ code: "unanswered", itemId: "i0" }, "checklist"],
    [{ code: "evidence_required", itemId: "i0" }, "checklist"],
    [{ code: "finding_required", itemId: "i0" }, "checklist"],
    [{ code: "reading_invalid", meterId: "m1" }, "measurements"],
    [{ code: "labor_invalid" }, "findings"],
    [{ code: "part_invalid", partId: "p" }, "findings"],
    [{ code: "defect_invalid", defectId: "d" }, "findings"],
  ] as const)("%j -> %s", (issue, section) => {
    expect(issueSection(issue)).toBe(section);
  });
});

describe("photos are counted per step", () => {
  it("a photo on one step never satisfies another step's requirement", () => {
    const draft = answered({ i2: { result: "passed", note: "", evidence: [] } });
    const summary = evidenceSummary(template, draft);
    expect(summary).toMatchObject({ required: 2, satisfied: 1, missingIds: ["i2"], photos: 1 });
    expect(validateInspection(template, draft, meters)).toContainEqual({ code: "evidence_required", itemId: "i2" });
  });

  it("a required step answered N/A needs no photo, and general photos count as photos but never as step evidence", () => {
    const draft = answered({ i2: { result: "not_applicable", note: "", evidence: [] } });
    draft.photos = [{ id: "g-1" }, { id: "g-2" }];
    expect(evidenceSummary(template, draft)).toMatchObject({ required: 1, satisfied: 1, missingIds: [], photos: 3 });
    const noPhotoOnStep = answered({ i0: { result: "passed", note: "", evidence: [] } });
    noPhotoOnStep.photos = [{ id: "g-1" }];
    expect(evidenceSummary(template, noPhotoOnStep).missingIds).toEqual(["i0"]);
  });
});

describe("what the stepper shows", () => {
  it("marks a part for attention only after review was tried, except an unreadable reading", () => {
    const draft = answered({ i1: { result: null, note: "", evidence: [] } });
    const issues = validateInspection(template, draft, meters);
    expect(sectionStatuses(template, draft, meters, issues, false).checklist).toBe("todo");
    expect(sectionStatuses(template, draft, meters, issues, true).checklist).toBe("attention");

    draft.readings.m1 = { value: "12abc", note: "" };
    const withBadReading = validateInspection(template, draft, meters);
    expect(sectionStatuses(template, draft, meters, withBadReading, false).measurements).toBe("attention");
  });

  it("shows a finished checklist, optional readings left empty, and an untouched findings part honestly", () => {
    const draft = answered();
    const status = sectionStatuses(template, draft, meters, validateInspection(template, draft, meters), true);
    expect(status).toEqual({ checklist: "complete", measurements: "todo", findings: "todo", review: "todo" });
    draft.laborMinutes = "30";
    expect(sectionStatuses(template, draft, meters, [], false).findings).toBe("complete");
    expect(sectionStatuses(template, draft, [], [], false).measurements).toBe("complete"); // nothing to measure
  });
});

describe("reading entry", () => {
  it("lets a technician type a negative value on a keypad with no minus key", () => {
    expect(toggleReadingSign("")).toBe("-");
    expect(toggleReadingSign("4.5")).toBe("-4.5");
    expect(toggleReadingSign("-4.5")).toBe("4.5");
    expect(toggleReadingSign("-")).toBe("");
  });

  it("shows a meter's configured band and never invents one", () => {
    expect(configuredRange({ warning_low: 15, warning_high: 20, critical_low: 10, critical_high: 25 })).toEqual({ low: 15, high: 20 });
    expect(configuredRange({ critical_high: 25 })).toEqual({ low: null, high: 25 });
    expect(configuredRange({ warning_low: 0, warning_high: 5 })).toEqual({ low: 0, high: 5 }); // zero is a real limit
    expect(configuredRange({})).toBeNull();
  });
});

describe("local draft writes", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setQueueOwner("hotel-1:user-1");
  });

  /** Runs `body` with AsyncStorage.setItem slowed down, calling through to the real mock afterwards. */
  async function withSlowWrites(delays: number[], body: () => Promise<void>) {
    const store = AsyncStorage as unknown as { setItem: (key: string, value: string) => Promise<void> };
    const original = store.setItem;
    let call = 0;
    store.setItem = async (key, value) => {
      const wait = delays[Math.min(call, delays.length - 1)];
      call += 1;
      await new Promise((resolve) => setTimeout(resolve, wait));
      return original(key, value);
    };
    try {
      await body();
    } finally {
      store.setItem = original;
    }
  }

  it("keeps the newest save even when an older write is still in flight", async () => {
    const first = answered();
    first.notes = "first";
    const second = answered();
    second.notes = "second";
    await withSlowWrites([60, 0], async () => {
      await Promise.all([savePmDraft(first), savePmDraft(second)]);
    });
    expect((await loadPmDraft("s1"))?.notes).toBe("second");
  });

  it("does not bring back a draft that was cleared while a save was still pending", async () => {
    await withSlowWrites([40], async () => {
      await Promise.all([savePmDraft(answered()), clearPmDraft("s1")]);
    });
    expect(await loadPmDraft("s1")).toBeNull();
  });

  it("reports that a draft could not be stored instead of pretending it was", async () => {
    const store = AsyncStorage as unknown as { setItem: (key: string, value: string) => Promise<void> };
    const original = store.setItem;
    store.setItem = () => Promise.reject(new Error("disk full"));
    expect(await savePmDraft(answered())).toBe(false);
    store.setItem = original;
    expect(await savePmDraft(answered())).toBe(true);
  });
});
