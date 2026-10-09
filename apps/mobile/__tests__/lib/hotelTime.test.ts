import {
  currentShiftDate,
  formatHotelTime,
  formatShiftDate,
  hotelDateKey,
  isValidTimeZone,
  parseClockText,
  resolveReturnTime,
  resolveTimeZone,
  zonedTimeToInstant,
} from "@/lib/housekeeping/hotelTime";

const plain = (text: string | null) => text?.replace(/ /g, " ") ?? null;
const CHICAGO = "America/Chicago";

describe("formatHotelTime", () => {
  it("renders one instant in the hotel's zone, not the device's", () => {
    const instant = "2026-10-08T18:30:00.000Z";
    expect(plain(formatHotelTime(instant, CHICAGO))).toBe("1:30 PM");
    expect(plain(formatHotelTime(instant, "America/New_York"))).toBe("2:30 PM");
    expect(plain(formatHotelTime(instant, "America/Los_Angeles"))).toBe("11:30 AM");
  });

  it("converts exactly once (an offset-bearing ISO string and the equivalent UTC one agree)", () => {
    expect(plain(formatHotelTime("2026-10-08T13:30:00-05:00", CHICAGO))).toBe("1:30 PM");
    expect(plain(formatHotelTime("2026-10-08T18:30:00Z", CHICAGO))).toBe("1:30 PM");
  });

  it("follows daylight saving: the same wall time maps to a different UTC hour in winter", () => {
    expect(plain(formatHotelTime("2026-12-01T19:30:00.000Z", CHICAGO))).toBe("1:30 PM"); // CST
    expect(plain(formatHotelTime("2026-10-08T19:30:00.000Z", CHICAGO))).toBe("2:30 PM"); // CDT
  });

  it("falls back to the established default zone when none or a bad one is configured", () => {
    const instant = "2026-10-08T18:30:00.000Z";
    expect(plain(formatHotelTime(instant, null))).toBe("1:30 PM");
    expect(plain(formatHotelTime(instant, "Mars/Olympus"))).toBe("1:30 PM");
    expect(resolveTimeZone("Mars/Olympus")).toBe(CHICAGO);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("America/Denver")).toBe(true);
  });

  it("returns null for missing or unparseable instants", () => {
    expect(formatHotelTime(null, CHICAGO)).toBeNull();
    expect(formatHotelTime("not a date", CHICAGO)).toBeNull();
  });
});

describe("hotel calendar day", () => {
  it("uses the hotel's date even when the device/UTC date has already rolled over", () => {
    const lateEvening = new Date("2026-10-09T02:00:00.000Z"); // 9 PM on Oct 8 in Chicago
    expect(hotelDateKey(lateEvening, CHICAGO)).toBe("2026-10-08");
    expect(currentShiftDate(CHICAGO, lateEvening)).toBe("2026-10-08");
    expect(hotelDateKey(lateEvening, "Pacific/Auckland")).toBe("2026-10-09");
  });

  it("formats a shift date as a calendar label without a timezone shift", () => {
    expect(formatShiftDate("2026-10-08", "en")).toBe("Thursday, October 8");
    expect(formatShiftDate("2026-10-08T00:00:00+00:00", "en")).toBe("Thursday, October 8");
    expect(formatShiftDate(null)).toBeNull();
    expect(formatShiftDate("garbage")).toBeNull();
  });
});

describe("zonedTimeToInstant", () => {
  it("maps a hotel wall-clock time to the right instant in summer and winter", () => {
    expect(zonedTimeToInstant("2026-10-08", 13, 30, CHICAGO)?.toISOString()).toBe("2026-10-08T18:30:00.000Z");
    expect(zonedTimeToInstant("2026-12-01", 13, 30, CHICAGO)?.toISOString()).toBe("2026-12-01T19:30:00.000Z");
  });

  it("handles the spring-forward gap (02:30 does not exist) by landing just after it", () => {
    const instant = zonedTimeToInstant("2026-03-08", 2, 30, CHICAGO)!;
    expect(instant).toBeInstanceOf(Date);
    expect(plain(formatHotelTime(instant, CHICAGO))).toBe("3:30 AM");
  });

  it("takes the first occurrence of an ambiguous fall-back time", () => {
    // 01:30 happens twice on 2026-11-01; the first is still daylight time (UTC-5).
    expect(zonedTimeToInstant("2026-11-01", 1, 30, CHICAGO)?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });

  it("rejects impossible input", () => {
    expect(zonedTimeToInstant("2026-10-08", 24, 0, CHICAGO)).toBeNull();
    expect(zonedTimeToInstant("2026-10-08", 10, 60, CHICAGO)).toBeNull();
    expect(zonedTimeToInstant("10/08/2026", 10, 0, CHICAGO)).toBeNull();
  });
});

describe("parseClockText", () => {
  it.each([
    ["1:30 PM", { hour: 13, minute: 30 }],
    ["1:30pm", { hour: 13, minute: 30 }],
    ["1 pm", { hour: 13, minute: 0 }],
    ["12:00 AM", { hour: 0, minute: 0 }],
    ["12:15 PM", { hour: 12, minute: 15 }],
    ["13:45", { hour: 13, minute: 45 }],
    ["9:05 a.m.", { hour: 9, minute: 5 }],
  ])("reads %s", (input, expected) => {
    expect(parseClockText(input)).toEqual(expected);
  });

  it.each(["", "soon", "25:00", "0 PM", "13 PM", "1:75 PM", "1:3 PM"])("rejects %j", (input) => {
    expect(parseClockText(input)).toBeNull();
  });
});

describe("resolveReturnTime", () => {
  const morning = new Date("2026-10-08T15:00:00.000Z"); // 10:00 AM in Chicago

  it("stores the hotel's 1:30 PM as an absolute instant", () => {
    expect(resolveReturnTime("1:30 PM", CHICAGO, morning)).toEqual({ ok: true, iso: "2026-10-08T18:30:00.000Z" });
  });

  it("rejects a time that has already passed instead of recording a past retry", () => {
    expect(resolveReturnTime("9:00 AM", CHICAGO, morning)).toEqual({ ok: false, reason: "past" });
    expect(resolveReturnTime("10:00 AM", CHICAGO, morning)).toEqual({ ok: false, reason: "past" });
  });

  it("rejects text that is not a time", () => {
    expect(resolveReturnTime("later", CHICAGO, morning)).toEqual({ ok: false, reason: "invalid" });
    expect(resolveReturnTime(undefined, CHICAGO, morning)).toEqual({ ok: false, reason: "invalid" });
  });

  it("resolves against the hotel's day, not the device's (11:30 PM when UTC has already rolled over)", () => {
    const nineThirtyPm = new Date("2026-10-09T02:30:00.000Z"); // Oct 8, 9:30 PM Chicago
    expect(resolveReturnTime("11:30 PM", CHICAGO, nineThirtyPm)).toEqual({ ok: true, iso: "2026-10-09T04:30:00.000Z" });
  });
});
