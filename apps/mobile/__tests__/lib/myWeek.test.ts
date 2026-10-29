import { addDays, groupByDate, mondayOf, resolveHighlight, validUuid, validYmd, weekOf } from "@/lib/scheduling/myWeek";
import { resolveScheduleTarget } from "@/lib/scheduling/scheduleLink";

const shift = (id: string, work_date: string, start = "07:00:00") => ({
  id, work_date, is_on_shift: false, clocked_in_at: null, clocked_out_at: null, shifts: { name: "S", start_time: start, end_time: "15:00:00" },
});
const ID = "c0000001-0000-4000-8000-000000000001";

describe("calendar arithmetic is independent of the phone's time zone and of DST", () => {
  it("accepts only real calendar days", () => {
    expect(validYmd("2030-06-12")).toBe("2030-06-12");
    expect(validYmd("2032-02-29")).toBe("2032-02-29");            // a leap day
    for (const bad of ["2030-02-31", "2031-02-29", "2030-13-01", "2030-6-1", "tomorrow", "", null, 20300612]) expect(validYmd(bad)).toBeNull();
  });

  it("starts the week on Monday, including from a Sunday and a Monday", () => {
    expect(mondayOf("2030-06-12")).toBe("2030-06-10");            // Wednesday
    expect(mondayOf("2030-06-16")).toBe("2030-06-10");            // Sunday belongs to the week that began the Monday before
    expect(mondayOf("2030-06-10")).toBe("2030-06-10");
  });

  it("gives seven consecutive days across a month, a year and both DST changes", () => {
    expect(weekOf("2030-07-31")).toEqual(["2030-07-29", "2030-07-30", "2030-07-31", "2030-08-01", "2030-08-02", "2030-08-03", "2030-08-04"]);
    expect(weekOf("2030-12-31")[6]).toBe("2031-01-05");
    expect(weekOf("2030-03-10")).toEqual(["2030-03-04", "2030-03-05", "2030-03-06", "2030-03-07", "2030-03-08", "2030-03-09", "2030-03-10"]);
    expect(weekOf("2030-11-03")).toEqual(["2030-10-28", "2030-10-29", "2030-10-30", "2030-10-31", "2030-11-01", "2030-11-02", "2030-11-03"]);
    expect(addDays("2030-03-09", 1)).toBe("2030-03-10");
    expect(addDays("2030-03-04", -7)).toBe("2030-02-25");
  });
});

describe("shifts and the highlight", () => {
  it("keeps every shift of a day in start order and an overnight shift on the day it starts", () => {
    const grouped = groupByDate([shift("b", "2030-06-12", "15:00:00"), shift("a", "2030-06-12", "07:00:00"), shift("night", "2030-06-13", "23:00:00")]);
    expect(grouped["2030-06-12"].map((s) => s.id)).toEqual(["a", "b"]);
    expect(grouped["2030-06-13"].map((s) => s.id)).toEqual(["night"]);
    expect(grouped["2030-06-14"]).toBeUndefined();
  });

  it("reports found, missing or nothing to find", () => {
    const grouped = groupByDate([shift(ID, "2030-06-12")]);
    expect(resolveHighlight({ date: null, assignmentId: null }, grouped)).toBe("none");
    expect(resolveHighlight({ date: "2030-06-12", assignmentId: null }, grouped)).toBe("found");
    expect(resolveHighlight({ date: "2030-06-13", assignmentId: null }, grouped)).toBe("missing");
    expect(resolveHighlight({ date: "2030-06-12", assignmentId: ID }, grouped)).toBe("found");
    expect(resolveHighlight({ date: "2030-06-12", assignmentId: "c0000009-0000-4000-8000-000000000009" }, grouped)).toBe("missing");
  });

  it("accepts only UUID ids", () => {
    expect(validUuid(ID.toUpperCase())).toBe(ID);
    expect(validUuid("../../admin")).toBeNull();
    expect(validUuid(undefined)).toBeNull();
  });
});

describe("the notification router passes the affected date and shift to My Schedule", () => {
  const data = (over: Record<string, unknown>) => ({ kind: "schedule", screen: "my_schedule", ...over });

  it("carries the published first date, an approved swap's new date and a named shift, and nothing malformed", () => {
    expect(resolveScheduleTarget(data({ params: { first_date: "2030-06-12" } }), "housekeeper")?.params).toEqual({ date: "2030-06-12" });
    expect(resolveScheduleTarget(data({ event: "schedule_swap_approved", params: { work_date: "2030-06-13" } }), "housekeeper")?.params).toEqual({ date: "2030-06-13" });
    expect(resolveScheduleTarget(data({ assignment_id: ID, params: { work_date: "2030-06-13" } }), "housekeeper")?.params).toEqual({ date: "2030-06-13", assignmentId: ID });
    expect(resolveScheduleTarget(data({ assignment_id: "not-a-uuid" }), "housekeeper")?.params).toEqual({});
    expect(resolveScheduleTarget({ kind: "schedule", screen: "offers", assignment_id: ID }, "housekeeper")?.params).toEqual({ tab: "offers" });
  });
});
