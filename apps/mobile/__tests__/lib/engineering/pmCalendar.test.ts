import type { PmScheduleRow } from "@/lib/api/assets";
import { adaptPmSchedules, type PmScheduleView } from "@/lib/engineering/pmSchedules";
import { countThisWeek, dayMarkers, monthGrid, planWeek, schedulesOnDay, shiftMonth, weekDayKeys, weekStartOf, weekdayIndex } from "@/lib/engineering/pmCalendar";

const ZONE = "America/Chicago";
// Wed 2026-11-04 10:00 in Chicago.
const NOW = new Date("2026-11-04T16:00:00Z");
const TODAY = "2026-11-04";

const row = (id: string, due: string | null, extra: Partial<PmScheduleRow> = {}): PmScheduleRow => ({
  id,
  asset_id: `asset-${id}`,
  name: `PM ${id}`,
  interval_type: "monthly",
  next_due_at: due,
  is_active: true,
  assets: { name: `Asset ${id}`, room_id: null },
  ...extra,
});

const views = (rows: PmScheduleRow[]): PmScheduleView[] => adaptPmSchedules(rows, ZONE, NOW);

describe("week maths", () => {
  it("starts weeks on Monday", () => {
    expect(weekdayIndex("2026-11-02")).toBe(0); // Monday
    expect(weekdayIndex("2026-11-08")).toBe(6); // Sunday
    expect(weekStartOf("2026-11-04")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
  });

  it("crosses month and year boundaries", () => {
    expect(weekDayKeys("2026-12-28")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
    expect(weekStartOf("2026-03-01")).toBe("2026-02-23");
  });

  it("is stable across the DST change in early November", () => {
    // Clocks fall back on Sun 2026-11-01; the week keys must still be seven distinct consecutive days.
    expect(weekDayKeys("2026-10-26")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});

describe("planWeek", () => {
  const all = views([
    row("a", "2026-11-02T18:00:00Z"), // Mon — overdue (before today)
    row("b", "2026-11-04T18:00:00Z"), // Wed today
    row("c", "2026-11-04T20:00:00Z"), // Wed today
    row("d", "2026-11-08T18:00:00Z"), // Sun
    row("e", "2026-11-09T18:00:00Z"), // next Mon
    row("f", "2026-10-20T18:00:00Z"), // long overdue, before this week
    row("g", null), // no due date
  ]);

  it("puts each schedule on its due day, once", () => {
    const plan = planWeek(all, "2026-11-02", TODAY);
    const byDay = Object.fromEntries(plan.days.map((d) => [d.dateKey, d.schedules.map((s) => s.id)]));
    expect(byDay["2026-11-02"]).toEqual(["a"]);
    expect(byDay["2026-11-04"].sort()).toEqual(["b", "c"]);
    expect(byDay["2026-11-08"]).toEqual(["d"]);
    const placed = [...plan.carriedOverdue, ...plan.days.flatMap((d) => d.schedules)].map((s) => s.id);
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed).not.toContain("e");
    expect(placed).not.toContain("g");
  });

  it("carries earlier overdue work onto the current week only, never duplicating it", () => {
    expect(planWeek(all, "2026-11-02", TODAY).carriedOverdue.map((s) => s.id)).toEqual(["f"]);
    expect(planWeek(all, "2026-11-09", TODAY).carriedOverdue).toEqual([]);
    expect(planWeek(all, "2026-10-26", TODAY).carriedOverdue).toEqual([]);
    expect(planWeek(all, "2026-10-19", TODAY).days.flatMap((d) => d.schedules).map((s) => s.id)).toEqual(["f"]);
  });

  it("marks today and reports the total", () => {
    const plan = planWeek(all, "2026-11-02", TODAY);
    expect(plan.days.find((d) => d.isToday)?.dateKey).toBe(TODAY);
    expect(plan.isCurrentWeek).toBe(true);
    expect(plan.total).toBe(5);
    expect(planWeek(all, "2026-11-09", TODAY).isCurrentWeek).toBe(false);
  });

  it("switching weeks back and forth never changes what a week holds", () => {
    const first = planWeek(all, "2026-11-09", TODAY);
    planWeek(all, "2026-11-02", TODAY);
    expect(planWeek(all, "2026-11-09", TODAY)).toEqual(first);
  });
});

describe("countThisWeek", () => {
  it("counts today through Sunday, includes today, excludes overdue and next week", () => {
    const set = views([
      row("old", "2026-11-02T18:00:00Z"),
      row("today", "2026-11-04T18:00:00Z"),
      row("fri", "2026-11-06T18:00:00Z"),
      row("sun", "2026-11-08T23:00:00Z"),
      row("next", "2026-11-09T18:00:00Z"),
      row("none", null),
    ]);
    expect(countThisWeek(set, TODAY)).toBe(3);
  });

  it("uses the hotel's calendar day, not UTC", () => {
    // 02:00 UTC on Mon 11-09 is still Sunday 20:00 in Chicago, so it counts this week.
    const set = views([row("late", "2026-11-09T02:00:00Z")]);
    expect(set[0].dueDate).toBe("2026-11-08");
    expect(countThisWeek(set, TODAY)).toBe(1);
  });
});

describe("month grid and markers", () => {
  it("builds whole Monday-first weeks around the month", () => {
    const grid = monthGrid("2026-11");
    expect(grid[0][0].dateKey).toBe("2026-10-26");
    expect(grid[0][0].inMonth).toBe(false);
    expect(grid[0][6].dateKey).toBe("2026-11-01");
    expect(grid.every((r) => r.length === 7)).toBe(true);
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });

  it("handles a leap February and a year boundary", () => {
    expect(monthGrid("2028-02").flat().filter((c) => c.inMonth)).toHaveLength(29);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-03", -14)).toBe("2025-01");
  });

  it("marks only dates with real schedules, with a count and an overdue flag", () => {
    const set = views([row("a", "2026-11-02T18:00:00Z"), row("b", "2026-11-02T20:00:00Z"), row("c", "2026-11-20T18:00:00Z")]);
    const markers = dayMarkers(set);
    expect(markers.get("2026-11-02")).toEqual({ count: 2, overdue: true });
    expect(markers.get("2026-11-20")).toEqual({ count: 1, overdue: false });
    expect(markers.size).toBe(2);
    expect(schedulesOnDay(set, "2026-11-02")).toHaveLength(2);
    expect(schedulesOnDay(set, "2026-11-03")).toEqual([]);
  });
});
