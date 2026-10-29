import type { ShiftTemplate } from "@/lib/api/schedulingManage";
import {
  buildInputs,
  buildPatch,
  diffShifts,
  draftForCopy,
  draftFromShift,
  emptyDraft,
  isDirty,
  isOvernight,
  matchesIntent,
  occurrenceDates,
  parseTimeText,
  recurrenceSpanDays,
  resolveTimes,
  templateClock,
  usesCustomTimes,
  validateDraft,
  wallMinutes,
  type ShiftDraft,
} from "@/lib/scheduling/shiftForm";
import { shift, TODAY } from "../helpers/teamScheduleFixtures";

const MORNING: ShiftTemplate = { id: "t1", name: "Morning", departmentId: "d1", startTime: "07:00:00", endTime: "15:30:00", isActive: true, archived: false, version: 1 };
const NIGHT: ShiftTemplate = { id: "t2", name: "Overnight", departmentId: "d1", startTime: "23:00:00", endTime: "07:00:00", isActive: true, archived: false, version: 3 };
const TOMORROW = "2026-10-29";

function draft(over: Partial<ShiftDraft> = {}): ShiftDraft {
  return { ...emptyDraft(TOMORROW), userId: "u1", templateId: "t1", ...over };
}

describe("times", () => {
  it("reads 12-hour and 24-hour text and nothing else", () => {
    expect(parseTimeText("7:00 AM")?.value).toBe("07:00");
    expect(parseTimeText("3pm")?.value).toBe("15:00");
    expect(parseTimeText("23:30")?.value).toBe("23:30");
    expect(parseTimeText("12:00 AM")?.value).toBe("00:00");
    for (const bad of ["", "25:00", "7:75", "noon", "13pm"]) expect(parseTimeText(bad)).toBeNull();
  });

  it("treats an end at or before the start as overnight and measures the wall-clock length", () => {
    const start = templateClock("23:00:00")!;
    const end = templateClock("07:00:00")!;
    expect(isOvernight(start, end)).toBe(true);
    expect(wallMinutes(start, end)).toBe(8 * 60);
    expect(isOvernight(templateClock("07:00")!, templateClock("15:30")!)).toBe(false);
    expect(wallMinutes(templateClock("07:00")!, templateClock("15:30")!)).toBe(510);
    expect(wallMinutes(templateClock("07:00")!, templateClock("07:00")!)).toBe(24 * 60);
  });

  it("uses the template's times unless custom times are on, and flags unusable custom text", () => {
    expect(resolveTimes(draft(), MORNING).times).toMatchObject({ override: null, start: { value: "07:00" }, end: { value: "15:30" } });
    expect(resolveTimes(draft({ customTimes: true, startText: "8am", endText: "4pm" }), MORNING).times?.override).toEqual({ startTime: "08:00", endTime: "16:00" });
    expect(resolveTimes(draft({ customTimes: true, startText: "", endText: "4pm" }), MORNING).errors).toEqual(["startTime"]);
    expect(resolveTimes(draft({ customTimes: true, startText: "9am", endText: "9:00 AM" }), MORNING).errors).toEqual(["sameTimes"]);
  });
});

describe("recurrence", () => {
  it("lists the matching weekdays inside the range, inclusive of both ends", () => {
    // 2026-10-26 is a Monday. Mon + Wed for two weeks.
    expect(occurrenceDates("2026-10-26", "2026-11-08", [0, 2])).toEqual(["2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04"]);
    expect(occurrenceDates("2026-10-28", "2026-10-28", [2])).toEqual(["2026-10-28"]);
  });

  it("is empty for an unusable range or no days, and never runs past the 42-day bound", () => {
    expect(occurrenceDates("2026-10-28", "2026-10-27", [0, 1, 2, 3, 4, 5, 6])).toEqual([]);
    expect(occurrenceDates("2026-10-28", "2026-12-31", [])).toEqual([]);
    expect(occurrenceDates("not-a-date", "2026-12-31", [1])).toEqual([]);
    expect(occurrenceDates("2026-10-26", "2027-12-31", [0, 1, 2, 3, 4, 5, 6]).length).toBeLessThanOrEqual(43);
  });

  it("counts dates by calendar, so the November DST change cannot add or drop a day", () => {
    // US clocks fall back on 2026-11-01. Daily over that weekend is still one entry per calendar day.
    expect(occurrenceDates("2026-10-30", "2026-11-03", [0, 1, 2, 3, 4, 5, 6])).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(recurrenceSpanDays("2026-10-30", "2026-11-03")).toBe(5);
    expect(recurrenceSpanDays("2026-10-30", "2026-10-29")).toBe(0);
  });
});

describe("validation", () => {
  const ctx = (template: ShiftTemplate | null = MORNING) => ({ today: TODAY, template });

  it("accepts a complete single shift", () => {
    expect(validateDraft(draft(), ctx(), "add")).toEqual([]);
  });

  it("asks for an employee, a shift and a real future date", () => {
    expect(validateDraft(draft({ userId: null, templateId: null }), ctx(null), "add")).toEqual(["employee", "template"]);
    expect(validateDraft(draft({ date: "2026-10-27" }), ctx(), "add")).toEqual(["pastDate"]);
    expect(validateDraft(draft({ date: "2026-13-40" }), ctx(), "add")).toEqual(["date"]);
    expect(validateDraft(draft({ date: TODAY }), ctx(), "add")).toEqual([]); // today is allowed
  });

  it("validates a recurring series: days, order, 42-day bound and a non-empty result", () => {
    const base = draft({ recurring: true, weekdays: [0], endDate: "2026-11-30" });
    expect(validateDraft(base, ctx(), "add")).toEqual([]);
    expect(validateDraft({ ...base, weekdays: [] }, ctx(), "add")).toEqual(["weekdays"]);
    expect(validateDraft({ ...base, endDate: "2026-10-01" }, ctx(), "add")).toEqual(["endDate"]);
    expect(validateDraft({ ...base, endDate: "2027-03-01" }, ctx(), "add")).toEqual(["rangeTooLong"]);
    // Oct 29 (Thursday) to Oct 30 has no Monday.
    expect(validateDraft({ ...base, endDate: "2026-10-30" }, ctx(), "add")).toEqual(["noOccurrences"]);
    expect(validateDraft({ ...base, endDate: "2027-03-01" }, ctx(), "edit")).toEqual([]); // edit never recurs
  });

  it("bounds notes", () => {
    expect(validateDraft(draft({ notes: "x".repeat(501) }), ctx(), "add")).toEqual(["notesTooLong"]);
  });
});

describe("what gets sent", () => {
  it("builds one input for a single shift, carrying times only when they differ from the template", () => {
    expect(buildInputs(draft({ notes: "  Deep clean  " }), MORNING)).toEqual([{ userId: "u1", shiftId: "t1", workDate: TOMORROW, startTime: null, endTime: null, notes: "Deep clean" }]);
    expect(buildInputs(draft({ customTimes: true, startText: "8am", endText: "4pm" }), MORNING)[0]).toMatchObject({ startTime: "08:00", endTime: "16:00" });
  });

  it("builds one input per matching date for a series, all in a single batch", () => {
    const inputs = buildInputs(draft({ recurring: true, weekdays: [0, 3], date: "2026-10-26", endDate: "2026-11-05" }), MORNING);
    expect(inputs.map((input) => input.workDate)).toEqual(["2026-10-26", "2026-10-29", "2026-11-02", "2026-11-05"]);
    expect(new Set(inputs.map((input) => input.shiftId))).toEqual(new Set(["t1"]));
  });

  it("builds nothing from an incomplete draft", () => {
    expect(buildInputs(draft({ userId: null }), MORNING)).toEqual([]);
    expect(buildInputs(draft({ customTimes: true, startText: "", endText: "" }), MORNING)).toEqual([]);
  });
});

describe("editing", () => {
  const original = shift({ id: "a1", userId: "u1", shiftId: "t1", workDate: TOMORROW, startTime: "07:00:00", endTime: "15:30:00", notes: null, version: 4 });

  it("starts from the shift and keeps its own times as a custom override only when they differ from the template", () => {
    expect(usesCustomTimes(original, MORNING)).toBe(false);
    expect(usesCustomTimes(shift({ startTime: "08:00:00", endTime: "15:30:00" }), MORNING)).toBe(true);
    expect(usesCustomTimes(original, null)).toBe(true);
    const custom = draftFromShift(shift({ startTime: "08:00:00", endTime: "16:00:00" }), MORNING, "d1");
    expect(custom).toMatchObject({ customTimes: true, startText: "08:00", endText: "16:00", templateId: "t1" });
  });

  it("sends nothing for no change and only the changed fields otherwise, with the version it read", () => {
    const same = draftFromShift(original, MORNING, "d1");
    expect(buildPatch(original, same, MORNING)).toBeNull();
    expect(buildPatch(original, { ...same, userId: "u2" }, MORNING)).toEqual({ expectedVersion: 4, userId: "u2" });
    expect(buildPatch(original, { ...same, date: "2026-10-30" }, MORNING)).toEqual({ expectedVersion: 4, workDate: "2026-10-30" });
    expect(buildPatch(original, { ...same, notes: " New " }, MORNING)).toEqual({ expectedVersion: 4, notes: "New" });
    expect(buildPatch(original, { ...same, customTimes: true, startText: "8am", endText: "3:30pm" }, MORNING)).toEqual({ expectedVersion: 4, startTime: "08:00" });
  });

  it("resets the times to the new template's when the template changes", () => {
    const next = { ...draftFromShift(original, MORNING, "d1"), templateId: "t2" };
    expect(buildPatch(original, next, NIGHT)).toEqual({ expectedVersion: 4, shiftId: "t2", startTime: "23:00", endTime: "07:00" });
  });

  it("recognises its own change in the server's row, and a stranger's", () => {
    const patch = { expectedVersion: 4, userId: "u2", notes: "x" };
    expect(matchesIntent(shift({ userId: "u2", notes: "x", version: 5 }), patch)).toBe(true);
    expect(matchesIntent(shift({ userId: "u3", notes: "x", version: 5 }), patch)).toBe(false);
    expect(matchesIntent(shift({ userId: "u2", notes: "y", version: 5 }), patch)).toBe(false);
  });

  it("lists what differs between my shift and the latest", () => {
    expect(diffShifts(original, shift({ ...original, userId: "u9", notes: "hi", startTime: "08:00:00" }))).toEqual(["employee", "startTime", "notes"]);
    expect(diffShifts(original, original)).toEqual([]);
  });
});

describe("copy", () => {
  it("copies everything but the date, which starts the day after and is never in the past", () => {
    const source = shift({ workDate: TOMORROW, userId: "u1" });
    expect(draftForCopy(source, MORNING, "d1", TODAY)).toMatchObject({ userId: "u1", templateId: "t1", date: "2026-10-30" });
    expect(draftForCopy(shift({ workDate: "2026-10-01" }), MORNING, "d1", TODAY).date).toBe(TODAY);
  });

  it("knows when a form has been touched", () => {
    const initial = draft();
    expect(isDirty(initial, initial)).toBe(false);
    expect(isDirty({ ...initial, notes: "x" }, initial)).toBe(true);
    expect(isDirty({ ...initial, weekdays: [1] }, initial)).toBe(true);
  });
});
