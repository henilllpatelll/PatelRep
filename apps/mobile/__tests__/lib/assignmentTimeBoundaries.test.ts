import { shiftTimeFor } from "@/lib/housekeeping/assignmentSchedule";
import { addDaysToYmd, hotelDateKey } from "@/lib/housekeeping/hotelTime";

/* Assignments runs on the HOTEL's day and clock, never the phone's and never UTC. These pin the places where those
   differ: the evening UTC has already rolled over, overnight shifts, and the two daylight-saving nights a year. */

const CHICAGO = "America/Chicago";
const shift = (startTime: string, endTime: string) => ({ userId: "hk-1", name: "Shift", startTime, endTime });
const at = (iso: string) => Date.parse(iso);

describe("the hotel's operational date", () => {
  it("11:30 pm in Chicago is still that evening's date even though UTC is already tomorrow", () => {
    expect(hotelDateKey("2026-10-17T04:30:00Z", CHICAGO)).toBe("2026-10-16");
    expect(hotelDateKey(new Date("2026-10-17T04:30:00Z"), "UTC")).toBe("2026-10-17");
  });
  it("12:30 am the next morning belongs to the next hotel day", () => {
    expect(hotelDateKey("2026-10-17T05:30:00Z", CHICAGO)).toBe("2026-10-17");
  });
  it("a hotel on the other side of the date line is on a different day than Chicago at the same instant", () => {
    expect(hotelDateKey("2026-10-17T03:00:00Z", "Pacific/Auckland")).toBe("2026-10-17");
    expect(hotelDateKey("2026-10-17T03:00:00Z", CHICAGO)).toBe("2026-10-16");
  });
  it("date arithmetic is calendar arithmetic across month and year ends", () => {
    expect(addDaysToYmd("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToYmd("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("shift windows", () => {
  it("an overnight shift ends the next calendar day in the hotel's zone", () => {
    // 10 pm to 6 am, assigned to the 16th: 22:00 CDT (03:00Z on the 17th) to 06:00 CDT on the 17th.
    const during = shiftTimeFor([shift("22:00:00", "06:00:00")], { hotelDate: "2026-10-16", now: at("2026-10-17T07:00:00Z"), timeZone: CHICAGO });
    expect(during?.phase).toBe("during");
    expect(during?.minutesLeft).toBe(240); // 02:00 CDT -> 06:00 CDT
    expect(new Date(during!.endsAt).toISOString()).toBe("2026-10-17T11:00:00.000Z");
  });

  it("is not 'after' at 1 am when the shift started the evening before", () => {
    const result = shiftTimeFor([shift("22:00:00", "06:00:00")], { hotelDate: "2026-10-16", now: at("2026-10-17T06:00:00Z"), timeZone: CHICAGO });
    expect(result?.phase).toBe("during");
  });

  it("does not depend on the phone's zone: the same instant gives the same answer for any hotel zone label", () => {
    const options = { hotelDate: "2026-10-16", now: at("2026-10-16T18:00:00Z") };
    const chicago = shiftTimeFor([shift("07:00:00", "15:00:00")], { ...options, timeZone: CHICAGO });
    const newYork = shiftTimeFor([shift("07:00:00", "15:00:00")], { ...options, timeZone: "America/New_York" });
    expect(chicago?.phase).toBe("during");
    expect(chicago?.minutesLeft).toBe(120); // 13:00 CDT -> 15:00 CDT
    expect(newYork?.minutesLeft).toBe(60); // the same instant is 14:00 EDT, an hour from 15:00 EDT
  });

  it("fall-back night (Nov 1) has an extra hour: 10 pm -> 6 am is nine real hours", () => {
    const options = { hotelDate: "2026-10-31", now: at("2026-11-01T03:00:00Z"), timeZone: CHICAGO };
    const result = shiftTimeFor([shift("22:00:00", "06:00:00")], options);
    expect(result?.phase).toBe("during");
    expect(Math.round((result!.endsAt - result!.startsAt) / 60_000)).toBe(9 * 60);
  });

  it("spring-forward night (Mar 8) has one fewer hour: 10 pm -> 6 am is seven real hours", () => {
    const result = shiftTimeFor([shift("22:00:00", "06:00:00")], { hotelDate: "2026-03-07", now: at("2026-03-08T04:00:00Z"), timeZone: CHICAGO });
    expect(Math.round((result!.endsAt - result!.startsAt) / 60_000)).toBe(7 * 60);
  });

  it("a shift with no readable times is unknown, never 'no time left'", () => {
    expect(shiftTimeFor([shift("soon", "later")], { hotelDate: "2026-10-16", now: at("2026-10-16T18:00:00Z"), timeZone: CHICAGO })).toBeNull();
  });
});
