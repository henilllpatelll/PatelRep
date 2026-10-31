import type { PmScheduleRow } from "@/lib/api/assets";
import {
  adaptPmSchedule,
  adaptPmSchedules,
  countPmSchedules,
  dayDifference,
  filterPmSchedules,
  formatDueDate,
  pmDueState,
} from "@/lib/engineering/pmSchedules";

const ZONE = "America/Chicago";
// 2026-11-04 10:00 in Chicago (CST, UTC-6) — a Wednesday morning.
const NOW = new Date("2026-11-04T16:00:00Z");

const row = (overrides: Partial<PmScheduleRow> = {}): PmScheduleRow => ({
  id: "pm-1",
  asset_id: "asset-1",
  name: "Quarterly HVAC filter change",
  interval_type: "quarterly",
  next_due_at: "2026-11-04T18:00:00Z",
  is_active: true,
  assets: { name: "Rooftop unit 2", room_id: null },
  ...overrides,
});

describe("pm due state", () => {
  it("maps day distance onto the web console's states", () => {
    expect(pmDueState(-3)).toBe("overdue");
    expect(pmDueState(-1)).toBe("overdue");
    expect(pmDueState(0)).toBe("due_today");
    expect(pmDueState(1)).toBe("due_soon");
    expect(pmDueState(7)).toBe("due_soon");
    expect(pmDueState(8)).toBe("upcoming");
    expect(pmDueState(null)).toBe("unscheduled");
  });
});

describe("adaptPmSchedule", () => {
  it("reads the real backend fields (next_due_at, name, nested assets)", () => {
    const view = adaptPmSchedule(row(), ZONE, NOW)!;
    expect(view).toMatchObject({
      id: "pm-1",
      assetId: "asset-1",
      assetName: "Rooftop unit 2",
      name: "Quarterly HVAC filter change",
      intervalType: "quarterly",
      nextDueAt: "2026-11-04T18:00:00Z",
      dueDate: "2026-11-04",
    });
  });

  it("is overdue when the due day is before today in the hotel zone", () => {
    const view = adaptPmSchedule(row({ next_due_at: "2026-11-02T20:00:00Z" }), ZONE, NOW)!;
    expect(view.state).toBe("overdue");
    expect(view.daysUntilDue).toBe(-2);
  });

  it("is due today for any time on today's hotel date, even earlier in the day", () => {
    // 07:00 Chicago today is already past, but it is still today's calendar day — not overdue.
    const view = adaptPmSchedule(row({ next_due_at: "2026-11-04T13:00:00Z" }), ZONE, NOW)!;
    expect(view.state).toBe("due_today");
    expect(view.daysUntilDue).toBe(0);
  });

  it("is upcoming beyond a week and due soon within it", () => {
    expect(adaptPmSchedule(row({ next_due_at: "2026-11-09T18:00:00Z" }), ZONE, NOW)!.state).toBe("due_soon");
    expect(adaptPmSchedule(row({ next_due_at: "2026-11-11T18:00:00Z" }), ZONE, NOW)!.state).toBe("due_soon");
    expect(adaptPmSchedule(row({ next_due_at: "2026-11-12T18:00:00Z" }), ZONE, NOW)!.state).toBe("upcoming");
  });

  it("uses the hotel's calendar day, not UTC or the device's", () => {
    // 00:30 UTC on Nov 5 is still the evening of Nov 4 in Chicago: due today, not tomorrow.
    const view = adaptPmSchedule(row({ next_due_at: "2026-11-05T00:30:00Z" }), ZONE, NOW)!;
    expect(view.dueDate).toBe("2026-11-04");
    expect(view.state).toBe("due_today");
    // The same instant is already Nov 5 in a zone east of UTC-5, so the verdict follows the hotel.
    const tokyo = adaptPmSchedule(row({ next_due_at: "2026-11-05T00:30:00Z" }), "Asia/Tokyo", new Date("2026-11-04T16:00:00Z"))!;
    expect(tokyo.dueDate).toBe("2026-11-05");
  });

  it("rolls today over at the hotel's midnight", () => {
    const justBefore = new Date("2026-11-05T05:59:00Z"); // 23:59 Nov 4 in Chicago
    const justAfter = new Date("2026-11-05T06:01:00Z"); // 00:01 Nov 5 in Chicago
    const due = row({ next_due_at: "2026-11-04T18:00:00Z" });
    expect(adaptPmSchedule(due, ZONE, justBefore)!.state).toBe("due_today");
    expect(adaptPmSchedule(due, ZONE, justAfter)!.state).toBe("overdue");
  });

  it("stays correct across the November DST change", () => {
    // DST ends 2026-11-01 in Chicago; 12 days later is still exactly 12 calendar days away.
    const view = adaptPmSchedule(row({ next_due_at: "2026-11-13T18:00:00Z" }), ZONE, new Date("2026-11-01T12:00:00Z"))!;
    expect(view.daysUntilDue).toBe(12);
    expect(view.state).toBe("upcoming");
  });

  it("falls back to the default hotel zone for a missing or invalid zone", () => {
    expect(adaptPmSchedule(row(), null, NOW)!.dueDate).toBe("2026-11-04");
    expect(adaptPmSchedule(row(), "Not/AZone", NOW)!.dueDate).toBe("2026-11-04");
  });

  it("marks a schedule with no usable due date as unscheduled, not overdue", () => {
    for (const next_due_at of [undefined, null, "", "not-a-date"]) {
      const view = adaptPmSchedule(row({ next_due_at: next_due_at as string | null | undefined }), ZONE, NOW)!;
      expect(view.state).toBe("unscheduled");
      expect(view.daysUntilDue).toBeNull();
      expect(view.dueDate).toBeNull();
    }
  });

  it("tolerates missing optional fields", () => {
    const view = adaptPmSchedule({ id: "pm-2", asset_id: "a", name: "Check belts", interval_type: "monthly" }, ZONE, NOW)!;
    expect(view).toMatchObject({ assetName: null, roomId: null, description: null, estimatedMinutes: null, lastCompletedAt: null });
  });

  it("keeps canonical ids and returns null for a row with no id", () => {
    expect(adaptPmSchedule(row({ id: "" }), ZONE, NOW)).toBeNull();
    expect(adaptPmSchedule(row({ id: "pm-9", asset_id: "asset-9", assets: { name: "X", room_id: "room-5" } }), ZONE, NOW)).toMatchObject({
      id: "pm-9",
      assetId: "asset-9",
      roomId: "room-5",
    });
  });
});

describe("adaptPmSchedules", () => {
  const rows: PmScheduleRow[] = [
    row({ id: "future", name: "B future", next_due_at: "2026-12-30T18:00:00Z" }),
    row({ id: "late", name: "A late", next_due_at: "2026-10-30T18:00:00Z" }),
    row({ id: "none", name: "C none", next_due_at: null }),
    row({ id: "today", name: "D today", next_due_at: "2026-11-04T20:00:00Z" }),
    row({ id: "off", name: "E inactive", next_due_at: "2026-10-01T18:00:00Z", is_active: false }),
    row({ id: "later", name: "F later", next_due_at: "2026-11-06T18:00:00Z" }),
  ];

  it("drops inactive schedules and orders most urgent first, unscheduled last", () => {
    expect(adaptPmSchedules(rows, ZONE, NOW).map((v) => v.id)).toEqual(["late", "today", "later", "future", "none"]);
  });

  it("handles a missing list", () => {
    expect(adaptPmSchedules(null, ZONE, NOW)).toEqual([]);
    expect(adaptPmSchedules(undefined, ZONE, NOW)).toEqual([]);
  });

  it("counts every state once so Home and the PM screen agree", () => {
    const views = adaptPmSchedules(rows, ZONE, NOW);
    expect(countPmSchedules(views)).toEqual({ total: 5, overdue: 1, dueToday: 1, dueSoon: 1, upcoming: 1, unscheduled: 1 });
  });

  it("filters: due = today or overdue, overdue = overdue only", () => {
    const views = adaptPmSchedules(rows, ZONE, NOW);
    expect(filterPmSchedules(views, "all")).toHaveLength(5);
    expect(filterPmSchedules(views, "due").map((v) => v.id)).toEqual(["late", "today"]);
    expect(filterPmSchedules(views, "overdue").map((v) => v.id)).toEqual(["late"]);
  });
});

describe("date helpers", () => {
  it("dayDifference counts calendar days across month and year ends", () => {
    expect(dayDifference("2026-11-04", "2026-11-04")).toBe(0);
    expect(dayDifference("2026-11-04", "2026-11-06")).toBe(2);
    expect(dayDifference("2026-12-30", "2027-01-02")).toBe(3);
    expect(dayDifference("2026-11-04", "2026-10-30")).toBe(-5);
  });

  it("formats a hotel day key without shifting it by the device zone", () => {
    expect(formatDueDate("2026-11-04", "en")).toBe("Nov 4");
    expect(formatDueDate("2026-11-04", "es")).toMatch(/4/);
    expect(formatDueDate(null)).toBeNull();
    expect(formatDueDate("bad")).toBeNull();
  });
});
