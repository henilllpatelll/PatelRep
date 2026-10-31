import { clockMinutes, dayOfMonth, formatLongDate, formatWallClock, formatWeekRange, formatWeekdayShort, isSameWeek, isYmd, shiftWeek, weekDays, weekStartOf } from "@/lib/scheduling/teamScheduleDates";

describe("week math (Monday start, UTC calendar arithmetic)", () => {
  it("finds the Monday of any day, including Sunday", () => {
    expect(weekStartOf("2026-10-28")).toBe("2026-10-26"); // Wed
    expect(weekStartOf("2026-10-26")).toBe("2026-10-26"); // Mon
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26"); // Sun
  });

  it("crosses a month boundary", () => {
    expect(weekDays("2026-10-28")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("crosses a year boundary", () => {
    expect(weekDays("2026-12-31")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(shiftWeek("2026-12-30", 1)).toBe("2027-01-06");
    expect(shiftWeek("2027-01-02", -1)).toBe("2026-12-26");
  });

  it("is not moved by a DST change (fall back 2026-11-01, spring forward 2026-03-08)", () => {
    expect(weekDays("2026-11-01")).toHaveLength(7);
    expect(new Set(weekDays("2026-11-01")).size).toBe(7);
    expect(weekDays("2026-03-08")[6]).toBe("2026-03-08");
    expect(shiftWeek("2026-03-04", 1)).toBe("2026-03-11");
  });

  it("handles a leap day", () => {
    expect(weekDays("2028-02-29")).toContain("2028-03-01");
    expect(isYmd("2027-02-29")).toBe(false);
    expect(isYmd("2028-02-29")).toBe(true);
  });

  it("knows whether two days share a week", () => {
    expect(isSameWeek("2026-10-26", "2026-11-01")).toBe(true);
    expect(isSameWeek("2026-11-01", "2026-11-02")).toBe(false);
  });
});

describe("validation", () => {
  it.each(["2026-13-01", "2026-02-30", "26-10-28", "2026-10-28T00:00", "", null, undefined, 20261028])("rejects %p", (value) => {
    expect(isYmd(value)).toBe(false);
  });
});

describe("locale-aware labels", () => {
  it("formats English and Spanish without the device zone shifting the weekday", () => {
    expect(formatLongDate("2026-10-28", "en")).toBe("Wednesday, October 28");
    expect(formatLongDate("2026-10-28", "es")).toMatch(/^miércoles,? 28 de octubre$/i);
    expect(formatWeekdayShort("2026-10-28", "en")).toBe("Wed");
    expect(formatWeekdayShort("2026-10-28", "es").toLowerCase()).toMatch(/^mi/);
    expect(dayOfMonth("2026-10-05")).toBe("5");
  });

  it("shows the year only when the week crosses a year boundary", () => {
    expect(formatWeekRange("2026-10-28", "en")).toBe("Oct 26 – Nov 1");
    expect(formatWeekRange("2026-12-30", "en")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("hotel wall clock", () => {
  it("parses clock text", () => {
    expect(clockMinutes("07:00:00")).toBe(420);
    expect(clockMinutes("23:59")).toBe(1439);
    expect(clockMinutes("24:00")).toBeNull();
    expect(clockMinutes(null)).toBeNull();
  });

  it("renders the HOTEL's wall clock regardless of the phone's zone", () => {
    expect(formatWallClock("2026-10-28", "07:00:00", "2026-10-28T12:00:00Z", "America/Chicago", "en")).toBe("7:00 AM");
    expect(formatWallClock("2026-10-28", "15:30", "2026-10-28T20:30:00Z", "America/Chicago", "en")).toBe("3:30 PM");
  });

  it("falls back to the absolute instant, in the hotel's zone, when the wall clock is missing", () => {
    expect(formatWallClock("2026-10-28", null, "2026-10-28T12:00:00Z", "America/Chicago", "en")).toBe("7:00 AM");
  });

  it("keeps the wall time across the fall-back DST change", () => {
    // Nov 1 2026, 7:00 CST (UTC−6) — the first morning after the clocks went back.
    expect(formatWallClock("2026-11-01", "07:00:00", "2026-11-01T13:00:00Z", "America/Chicago", "en")).toBe("7:00 AM");
  });
});
