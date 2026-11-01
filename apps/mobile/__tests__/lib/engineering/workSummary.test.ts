import { EMPTY_FILTERS } from "@/lib/engineering/workQueue";
import { isSummaryActive, parseWorkSummary, summaryCount, summarySelection } from "@/lib/engineering/workSummary";

describe("parseWorkSummary", () => {
  it("reads the server's counts", () => {
    expect(parseWorkSummary({ urgent: 2, in_progress: 3, waiting: 4, total: 9 })).toEqual({ urgent: 2, inProgress: 3, waiting: 4 });
    expect(parseWorkSummary({ urgent: 0, in_progress: 0, waiting: 0 })).toEqual({ urgent: 0, inProgress: 0, waiting: 0 });
  });

  it("treats anything malformed as unknown, never as zero", () => {
    const bad = [
      null,
      undefined,
      {},
      "x",
      { urgent: 1 },
      { urgent: -1, in_progress: 0, waiting: 0 },
      { urgent: 1.5, in_progress: 0, waiting: 0 },
      { urgent: "2", in_progress: 0, waiting: 0 },
      { urgent: NaN, in_progress: 0, waiting: 0 },
    ];
    for (const raw of bad) expect(parseWorkSummary(raw)).toBeNull();
  });

  it("reports unknown counts as null", () => {
    expect(summaryCount(null, "urgent")).toBeNull();
    expect(summaryCount({ urgent: 0, inProgress: 5, waiting: 1 }, "urgent")).toBe(0);
    expect(summaryCount({ urgent: 0, inProgress: 5, waiting: 1 }, "inProgress")).toBe(5);
  });
});

describe("summarySelection", () => {
  it("Urgent narrows My Work to emergency + urgent and keeps other filters", () => {
    const next = summarySelection("urgent", { ...EMPTY_FILTERS, category: "hvac", priority: "low" });
    expect(next.view).toBe("mine");
    expect(next.filters).toMatchObject({ urgentOnly: true, priority: null, category: "hvac" });
    expect(isSummaryActive("urgent", next.filters)).toBe(true);
  });

  it("pressing an applied Urgent tile clears just that selection", () => {
    const applied = summarySelection("urgent", { ...EMPTY_FILTERS, category: "hvac" }).filters;
    const cleared = summarySelection("urgent", applied).filters;
    expect(cleared).toMatchObject({ urgentOnly: false, category: "hvac" });
    expect(isSummaryActive("urgent", cleared)).toBe(false);
  });

  it("In progress filters My Work to that status and toggles off again", () => {
    const on = summarySelection("inProgress", EMPTY_FILTERS);
    expect(on.view).toBe("mine");
    expect(on.filters.statuses).toEqual(["in_progress"]);
    expect(isSummaryActive("inProgress", on.filters)).toBe(true);
    expect(summarySelection("inProgress", on.filters).filters.statuses).toEqual([]);
  });

  it("does not call a multi-status filter 'In progress'", () => {
    expect(isSummaryActive("inProgress", { ...EMPTY_FILTERS, statuses: ["in_progress", "open"] })).toBe(false);
  });

  it("Waiting opens the on-hold view narrowed to my own held work, and is never 'applied' on My Work", () => {
    const next = summarySelection("waiting", { ...EMPTY_FILTERS, urgentOnly: true });
    expect(next.view).toBe("waiting");
    expect(next.filters).toEqual({ ...EMPTY_FILTERS, assignment: "mine" });
    expect(isSummaryActive("waiting", EMPTY_FILTERS)).toBe(false);
  });
});
