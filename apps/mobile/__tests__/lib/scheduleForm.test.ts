jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));

import { EMPTY_SCHEDULE_FORM, diffSchedule, formFromSchedule, hasChanges, toCreateBody, validateSchedule, warrantyState, type ScheduleFormValues, type ScheduleSnapshot } from "@/lib/engineering/scheduleForm";

const TZ = "America/Chicago";
const NOW = new Date("2026-11-02T15:00:00Z"); // Monday 9am in Chicago
const good: ScheduleFormValues = { ...EMPTY_SCHEDULE_FORM, assetId: "a1", name: "Chiller quarterly", firstDueDate: "2026-11-10", checklistId: "t1", intervalType: "quarterly" };

describe("validateSchedule", () => {
  it("accepts a complete create form", () => {
    expect(validateSchedule(good, "create", TZ, NOW)).toEqual([]);
  });

  it("names every missing or bad field", () => {
    const bad = { ...EMPTY_SCHEDULE_FORM, name: "  ", estimatedMinutes: "0", intervalType: "custom" as const, intervalDays: "abc" };
    expect(validateSchedule(bad, "create", TZ, NOW).sort()).toEqual(["asset_missing", "checklist_missing", "due_missing", "interval_days", "minutes", "name_missing"].sort());
  });

  it("refuses a first due date before today in the hotel, but accepts today", () => {
    expect(validateSchedule({ ...good, firstDueDate: "2026-11-01" }, "create", TZ, NOW)).toEqual(["due_past"]);
    expect(validateSchedule({ ...good, firstDueDate: "2026-11-02" }, "create", TZ, NOW)).toEqual([]);
  });

  it("custom intervals need whole days from 1 to 3650", () => {
    const custom = { ...good, intervalType: "custom" as const };
    for (const days of ["", "0", "3651", "1.5", "-2", "7a"]) expect(validateSchedule({ ...custom, intervalDays: days }, "create", TZ, NOW)).toContain("interval_days");
    expect(validateSchedule({ ...custom, intervalDays: "45" }, "create", TZ, NOW)).toEqual([]);
  });

  it("a new schedule always needs a procedure; a legacy unbound schedule may stay unbound while editing", () => {
    expect(validateSchedule({ ...good, checklistId: null }, "create", TZ, NOW)).toEqual(["checklist_missing"]);
    expect(validateSchedule({ ...good, checklistId: null }, "edit", TZ, NOW, false)).toEqual(["checklist_missing"]);
    expect(validateSchedule({ ...good, checklistId: null }, "edit", TZ, NOW, true)).toEqual([]);
  });

  it("edit mode ignores the equipment and the due date entirely", () => {
    expect(validateSchedule({ ...good, assetId: null, firstDueDate: "" }, "edit", TZ, NOW)).toEqual([]);
  });
});

describe("toCreateBody", () => {
  it("builds the exact request, with the first due at noon in the hotel", () => {
    expect(toCreateBody({ ...good, description: " Check belts ", estimatedMinutes: "45" }, TZ)).toEqual({
      asset_id: "a1", name: "Chiller quarterly", description: "Check belts", interval_type: "quarterly", interval_days: null,
      estimated_minutes: 45, next_due_at: "2026-11-10T18:00:00.000Z", recurrence_basis: "scheduled_date", checklist_template_id: "t1",
    });
  });

  it("carries days only for a custom interval, and refuses a body without equipment or a date", () => {
    expect(toCreateBody({ ...good, intervalType: "custom", intervalDays: "45" }, TZ)?.interval_days).toBe(45);
    expect(toCreateBody({ ...good, assetId: null }, TZ)).toBeNull();
    expect(toCreateBody({ ...good, firstDueDate: "" }, TZ)).toBeNull();
  });
});

describe("diffSchedule", () => {
  const original: ScheduleSnapshot = { name: "HVAC filter", description: "Old", intervalType: "monthly", intervalDays: null, estimatedMinutes: 30, recurrenceBasis: "scheduled_date", checklistId: "t1" };

  it("an untouched form changes nothing", () => {
    const changes = diffSchedule(original, formFromSchedule(original));
    expect(changes).toEqual({ fields: {}, checklistChanged: false });
    expect(hasChanges(changes)).toBe(false);
  });

  it("sends only the fields that changed and never a due date", () => {
    const values = { ...formFromSchedule(original), name: "  HVAC filter swap ", estimatedMinutes: "40", description: "" };
    const changes = diffSchedule(original, values);
    expect(changes.fields).toEqual({ name: "HVAC filter swap", estimated_minutes: 40, description: null });
    expect(Object.keys(changes.fields)).not.toContain("next_due_at");
  });

  it("switching to a custom interval sends the days, leaving custom does not", () => {
    expect(diffSchedule(original, { ...formFromSchedule(original), intervalType: "custom", intervalDays: "20" }).fields).toEqual({ interval_type: "custom", interval_days: 20 });
    const custom: ScheduleSnapshot = { ...original, intervalType: "custom", intervalDays: 20 };
    expect(diffSchedule(custom, { ...formFromSchedule(custom), intervalType: "weekly" }).fields).toEqual({ interval_type: "weekly" });
  });

  it("a procedure change is reported separately because it is a separate write", () => {
    const changes = diffSchedule(original, { ...formFromSchedule(original), checklistId: "t2" });
    expect(changes).toEqual({ fields: {}, checklistChanged: true });
    expect(hasChanges(changes)).toBe(true);
  });
});

describe("warrantyState", () => {
  it("uses the recorded date and the hotel's calendar only", () => {
    expect(warrantyState(null, TZ, NOW)).toBe("unknown");
    expect(warrantyState("soon", TZ, NOW)).toBe("unknown");
    expect(warrantyState("2026-11-01", TZ, NOW)).toBe("expired");
    expect(warrantyState("2026-11-02", TZ, NOW)).toBe("expiring_soon"); // the last day still counts
    expect(warrantyState("2027-01-31", TZ, NOW)).toBe("expiring_soon"); // exactly 90 days
    expect(warrantyState("2027-02-01", TZ, NOW)).toBe("active");
  });

  it("a late-evening UTC instant is still the hotel's previous day", () => {
    const lateUtc = new Date("2026-11-03T03:30:00Z"); // 9:30pm Nov 2 in Chicago
    expect(warrantyState("2026-11-02", TZ, lateUtc)).toBe("expiring_soon");
  });
});
