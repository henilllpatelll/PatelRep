import type { DayRule, RequestItem } from "@/lib/api/schedulingRequests";
import {
  addWindow, ALL_DAY, clockLabel, dayError, dateRangeLabel, daysBetween, DEFAULT_WINDOW, draftFromWeek, emptyLeaveDraft, filterMine, firstDayError, fromMinutes,
  leaveError, normalizeClock, removeWindow, sameDrafts, stepClock, weekPayload, weekSummary, windowLabel, withPartial, withStartDate, withState, withWindow,
  type DayDraft,
} from "@/lib/scheduling/requestsModel";
import { makeTranslator } from "../helpers/i18n";

const t = makeTranslator("en");
const day = (weekday: number, state: DayDraft["state"], windows: DayDraft["windows"] = []): DayDraft => ({ weekday, state, windows });

describe("clock times", () => {
  it("steps in quarter hours and wraps around midnight", () => {
    expect(stepClock("07:00", 1)).toBe("07:15");
    expect(stepClock("07:00", -1)).toBe("06:45");
    expect(stepClock("23:45", 1)).toBe("00:00");
    expect(stepClock("00:00", -1)).toBe("23:45");
    expect(fromMinutes(-15)).toBe("23:45");
    expect(normalizeClock("7:00:00")).toBe("07:00");
  });

  it("reads clock text in the person's language without the phone's time zone shifting it", () => {
    expect(clockLabel("07:00")).toBe("7:00 AM");
    expect(clockLabel("15:30:00")).toBe("3:30 PM");
    expect(clockLabel("00:00")).toBe("12:00 AM");
    expect(clockLabel(null)).toBe("—");
  });

  it("words a window, an overnight window and all day", () => {
    expect(windowLabel({ start: "07:00", end: "15:00" }, "en", t)).toBe("7:00 AM – 3:00 PM");
    expect(windowLabel({ start: "22:00", end: "06:00" }, "en", t)).toBe("10:00 PM – 6:00 AM (next day)");
    expect(windowLabel(ALL_DAY, "en", t)).toBe("All day");
  });
});

describe("the availability editor", () => {
  it("starts from the server's week and treats a day with no rule as not submitted", () => {
    const rules: DayRule[] = [{ weekday: 0, state: "available", windows: [{ start: "07:00", end: "15:00" }] }, { weekday: 2, state: "unavailable", windows: [] }];
    const draft = draftFromWeek(rules);
    expect(draft).toHaveLength(7);
    expect(draft.map((d) => d.state)).toEqual(["available", "unset", "unavailable", "unset", "unset", "unset", "unset"]);
    expect(sameDrafts(draft, draftFromWeek(rules))).toBe(true);
    expect(sameDrafts(draft, draft.map((d) => (d.weekday === 0 ? withWindow(d, 0, { end: "16:00" }) : d)))).toBe(false);
  });

  it("choosing Available gives the usual hours so nothing has to be typed; the other states clear them", () => {
    const available = withState(day(0, "unset"), "available");
    expect(available.windows).toEqual([DEFAULT_WINDOW]);
    expect(withState(available, "unavailable")).toEqual(day(0, "unavailable"));
    expect(withState(available, "unset")).toEqual(day(0, "unset"));
    expect(withState(available, "available").windows).toEqual([DEFAULT_WINDOW]);
  });

  it("adds a window an hour after the last one, up to four, never overlapping, and removing the last one clears the day", () => {
    let d = withState(day(1, "unset"), "available");
    d = addWindow(d);
    expect(d.windows[1]).toEqual({ start: "16:00", end: "17:00" });
    expect(dayError(d)).toBeNull();
    d = addWindow(addWindow(d));
    expect(d.windows.map((w) => w.start)).toEqual(["07:00", "16:00", "18:00", "20:00"]);
    expect(dayError(d)).toBeNull();
    expect(addWindow(d).windows).toHaveLength(4);
    expect(addWindow(day(1, "available", [{ start: "21:00", end: "23:00" }])).windows).toHaveLength(1);      // no room before midnight
    expect(addWindow(day(1, "available", [{ start: "22:00", end: "06:00" }])).windows).toHaveLength(1);      // overnight already covers the evening
    expect(addWindow(day(1, "unset")).windows).toEqual([{ start: "17:00", end: "18:00" }]);
    expect(removeWindow(day(1, "available", [DEFAULT_WINDOW]), 0)).toEqual(day(1, "unset"));
  });

  it("catches overlapping windows, equal times and an empty available day before sending", () => {
    expect(dayError(day(0, "available"))).toBe("windows_required");
    expect(dayError(day(0, "available", [{ start: "07:00", end: "12:00" }, { start: "11:00", end: "15:00" }]))).toBe("windows_overlap");
    expect(dayError(day(0, "available", [{ start: "07:00", end: "07:00" }]))).toBe("same_times");
    expect(dayError(day(0, "available", [ALL_DAY]))).toBeNull();
    expect(dayError(day(0, "available", [{ start: "22:00", end: "06:00" }, { start: "05:00", end: "09:00" }]))).toBeNull();
    expect(dayError(day(0, "available", [{ start: "22:00", end: "06:00" }, { start: "23:00", end: "02:00" }]))).toBe("windows_overlap");
    expect(dayError(day(0, "unavailable"))).toBeNull();
    expect(firstDayError([day(0, "unavailable"), day(3, "available"), day(5, "available", [DEFAULT_WINDOW])])).toEqual({ weekday: 3, error: "windows_required" });
  });

  it("sends only the days that were set, and an unavailable day carries no hours", () => {
    expect(weekPayload([day(0, "available", [DEFAULT_WINDOW]), day(1, "unset"), day(2, "unavailable", [DEFAULT_WINDOW])])).toEqual([
      { weekday: 0, mode: "available", windows: [DEFAULT_WINDOW] },
      { weekday: 2, mode: "unavailable", windows: [] },
    ]);
  });

  it("summarises the week without claiming the blank days are free", () => {
    const rules = draftFromWeek([{ weekday: 0, state: "available", windows: [DEFAULT_WINDOW] }, { weekday: 2, state: "unavailable", windows: [] }]);
    expect(weekSummary(rules, t)).toBe("Available: Mon · Unavailable: Wed · Not submitted: Tue Thu Fri Sat Sun");
  });
});

describe("the time-off form", () => {
  const today = "2030-01-08";

  it("mirrors the server's checks in the server's order", () => {
    const draft = { ...emptyLeaveDraft(today), reason: "personal" as const };
    expect(leaveError(draft, today)).toBeNull();
    expect(leaveError({ ...draft, startDate: "2030-01-10", endDate: "2030-01-09" }, today)).toBe("end_before_start");
    expect(leaveError({ ...draft, startDate: "2030-01-01", endDate: "2030-01-05" }, today)).toBe("dates_in_past");
    expect(leaveError({ ...draft, startDate: "2030-01-01", endDate: "2030-01-08" }, today)).toBeNull();      // already started, still running
    expect(leaveError({ ...draft, endDate: "2030-03-10" }, today)).toBe("range_too_long");
    expect(leaveError({ ...draft, endDate: "2030-03-08" }, today)).toBeNull();                                   // exactly 60 days
    expect(leaveError({ ...draft, partial: true, endDate: "2030-01-09" }, today)).toBe("partial_must_be_one_day");
    expect(leaveError({ ...draft, partial: true, startTime: "09:00", endTime: "09:00" }, today)).toBe("invalid_partial_times");
    expect(leaveError({ ...draft, reason: null }, today)).toBe("reason_required");
  });

  it("keeps the end date from falling behind the start and a partial day on one date", () => {
    const base = emptyLeaveDraft(today);
    expect(withStartDate({ ...base, endDate: "2030-01-09" }, "2030-01-12")).toEqual(expect.objectContaining({ startDate: "2030-01-12", endDate: "2030-01-12" }));
    expect(withStartDate({ ...base, endDate: "2030-01-20" }, "2030-01-12").endDate).toBe("2030-01-20");
    expect(withPartial({ ...base, endDate: "2030-01-12" }, true).endDate).toBe(base.startDate);
    expect(daysBetween("2030-01-08", "2030-01-08")).toBe(1);
    expect(daysBetween("2030-01-08", "2030-01-10")).toBe(3);
  });

  it("words date ranges", () => {
    expect(dateRangeLabel("2030-01-08", "2030-01-08", "en")).toBe("Jan 8");
    expect(dateRangeLabel("2030-01-08", "2030-01-10", "en")).toBe("Jan 8 – Jan 10");
    expect(dateRangeLabel(null, null)).toBe("—");
  });
});

describe("My requests filters", () => {
  const item = (over: Partial<RequestItem>): RequestItem => ({
    type: "time_off", id: "x", status: "pending", statusGroup: "pending", user: { id: "u", name: "A", role: null }, counterpart: null, dateFrom: null, dateTo: null,
    submittedAt: null, version: 1, needsAction: false, needsMyResponse: false, leave: null, swap: null, shiftCount: null, ...over,
  });
  const items = [item({ id: "a" }), item({ id: "b", statusGroup: "approved", status: "approved" }), item({ id: "c", type: "shift_swap", needsMyResponse: true }), item({ id: "d", statusGroup: "cancelled", status: "expired" })];

  it("filters by the status group and by 'needs my answer'", () => {
    expect(filterMine(items, "all")).toHaveLength(4);
    expect(filterMine(items, "action").map((i) => i.id)).toEqual(["c"]);
    expect(filterMine(items, "approved").map((i) => i.id)).toEqual(["b"]);
    expect(filterMine(items, "cancelled").map((i) => i.id)).toEqual(["d"]);
    expect(filterMine(items, "pending").map((i) => i.id)).toEqual(["a", "c"]);
  });
});
