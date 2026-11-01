import {
  isManagerSummaryActive,
  managerSummaryCount,
  managerSummarySelection,
  showsManagerSummary,
} from "@/lib/engineering/managerSummary";
import { EMPTY_FILTERS } from "@/lib/engineering/workQueue";
import type { TeamCounts } from "@/lib/api/engineeringTeam";

const counts: TeamCounts = { open: 9, overdue: 2, on_hold: 3, emergency: 1, unassigned: 4, needs_owner: 3, in_progress: 2, pm_overdue: 0 };

describe("manager summary", () => {
  it("shows only to managers, on the live queues", () => {
    expect(showsManagerSummary("team", "chief_engineer")).toBe(true);
    expect(showsManagerSummary("available", "gm")).toBe(true);
    expect(showsManagerSummary("waiting", "chief_engineer")).toBe(true);
    expect(showsManagerSummary("done", "chief_engineer")).toBe(false);
    expect(showsManagerSummary("mine", "gm")).toBe(false);
    for (const role of ["engineer", "housekeeper", null, undefined]) {
      expect(showsManagerSummary("team", role)).toBe(false);
      expect(showsManagerSummary("available", role)).toBe(false);
    }
  });

  it("reads each count from the field that matches the queue it opens", () => {
    expect(managerSummaryCount(counts, "needsOwner")).toBe(3); // not `unassigned` (4): that includes held orders Available does not list
    expect(managerSummaryCount(counts, "inProgress")).toBe(2);
    expect(managerSummaryCount(counts, "waiting")).toBe(3);
  });

  it("treats a missing or malformed count as unknown, never zero", () => {
    expect(managerSummaryCount(null, "waiting")).toBeNull();
    expect(managerSummaryCount({ ...counts, needs_owner: undefined }, "needsOwner")).toBeNull(); // older server
    expect(managerSummaryCount({ ...counts, in_progress: -1 }, "inProgress")).toBeNull();
    expect(managerSummaryCount({ ...counts, on_hold: 1.5 }, "waiting")).toBeNull();
    expect(managerSummaryCount({ ...counts, needs_owner: 0 }, "needsOwner")).toBe(0);
  });

  it("opens the queue it counted", () => {
    expect(managerSummarySelection("needsOwner", EMPTY_FILTERS)).toEqual({ view: "available", filters: null });
    expect(managerSummarySelection("waiting", EMPTY_FILTERS)).toEqual({ view: "waiting", filters: null });
    const applied = managerSummarySelection("inProgress", { ...EMPTY_FILTERS, category: "plumbing" });
    expect(applied.view).toBe("team");
    expect(applied.filters).toMatchObject({ statuses: ["in_progress"], category: "plumbing" });
  });

  it("a second press on In progress clears only its own narrowing", () => {
    const on = { ...EMPTY_FILTERS, statuses: ["in_progress" as const], category: "plumbing" as const };
    expect(isManagerSummaryActive("inProgress", "team", on)).toBe(true);
    expect(isManagerSummaryActive("inProgress", "available", on)).toBe(false);
    const off = managerSummarySelection("inProgress", on);
    expect(off.filters).toMatchObject({ statuses: [], category: "plumbing" });
  });

  it("marks the tile for the open queue as active", () => {
    expect(isManagerSummaryActive("needsOwner", "available", EMPTY_FILTERS)).toBe(true);
    expect(isManagerSummaryActive("needsOwner", "team", EMPTY_FILTERS)).toBe(false);
    expect(isManagerSummaryActive("waiting", "waiting", EMPTY_FILTERS)).toBe(true);
    expect(isManagerSummaryActive("waiting", "team", EMPTY_FILTERS)).toBe(false);
  });
});
