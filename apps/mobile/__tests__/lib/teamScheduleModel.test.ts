import {
  buildAttention,
  buildDayRoster,
  buildShiftGroups,
  buildWeekSummaries,
  countAttendance,
  periodOf,
  resolveDisplayStatus,
  shiftsForDay,
  toDayShift,
} from "@/lib/scheduling/teamScheduleModel";
import { CTX, NOW_MS, TODAY, person, schedule, shift } from "../helpers/teamScheduleFixtures";

const noNotes = { staleSince: null, attendanceUnavailable: false, incomplete: false, unreadableShifts: 0 };

describe("periods come from the real start time, never the template name", () => {
  it.each([
    [300, "morning"],
    [719, "morning"],
    [720, "afternoon"],
    [1019, "afternoon"],
    [1020, "evening"],
    [1259, "evening"],
    [1260, "overnight"],
    [0, "overnight"],
    [299, "overnight"],
  ] as const)("%i minutes → %s", (minutes, period) => {
    expect(periodOf(minutes)).toBe(period);
  });

  it("classifies a shift called 'Evening' that starts at 6 AM as morning", () => {
    const day = toDayShift(shift({ name: "Evening", startTime: "06:00:00", endTime: "14:00:00", startsAt: "2026-10-28T11:00:00Z", endsAt: "2026-10-28T19:00:00Z" }), CTX);
    expect(day.period).toBe("morning");
  });

  it("supports a custom hotel-defined window", () => {
    const day = toDayShift(shift({ name: "Laundry split", startTime: "10:30:00", endTime: "14:30:00", startsAt: "2026-10-28T15:30:00Z", endsAt: "2026-10-28T19:30:00Z" }), CTX);
    expect(day).toMatchObject({ period: "morning", startLabel: "10:30 AM", endLabel: "2:30 PM", name: "Laundry split" });
  });
});

describe("overnight and carried shifts", () => {
  const overnight = shift({ id: "n1", userId: "u9", name: "Night", startTime: "23:00:00", endTime: "07:00:00", startsAt: "2026-10-29T04:00:00Z", endsAt: "2026-10-29T12:00:00Z" });

  it("marks a shift that ends the next hotel day", () => {
    const day = toDayShift(overnight, CTX);
    expect(day.endsNextDay).toBe(true);
    expect(day.period).toBe("overnight");
    expect(day.startLabel).toBe("11:00 PM");
    expect(day.endLabel).toBe("7:00 AM");
  });

  it("does not mark an ordinary day shift", () => {
    expect(toDayShift(shift(), CTX).endsNextDay).toBe(false);
  });

  it("includes yesterday's overnight shift only while it is still running", () => {
    const carried = shift({ id: "c1", userId: "u9", workDate: "2026-10-27", carriedFromPreviousDay: true, startTime: "23:00:00", endTime: "11:00:00", startsAt: "2026-10-28T04:00:00Z", endsAt: "2026-10-28T16:00:00Z" });
    const s = schedule({ people: [person("u9", "Night Owl")], shifts: [carried] });
    expect(shiftsForDay(s, TODAY, CTX).map((x) => x.id)).toEqual(["c1"]); // 10:00 now, ends 11:00
    expect(shiftsForDay(s, TODAY, { ...CTX, nowMs: Date.parse("2026-10-28T17:00:00Z") })).toEqual([]); // 12:00 now, over
    expect(shiftsForDay(s, "2026-10-27", CTX)).toHaveLength(1); // still its own day's shift
  });

  it("never lets a carried shift of another day leak into a later day of the range", () => {
    const carried = shift({ id: "c1", workDate: "2026-10-25", carriedFromPreviousDay: true, endsAt: "2026-10-26T05:00:00Z" });
    const s = schedule({ dateFrom: "2026-10-26", dateTo: "2026-11-01", people: [person("u1", "A")], shifts: [carried] });
    expect(shiftsForDay(s, "2026-10-27", { ...CTX, nowMs: Date.parse("2026-10-20T00:00:00Z") })).toEqual([]);
  });
});

describe("several shifts for one person on one day", () => {
  const s = schedule({
    people: [person("u1", "Ana Torres", "working"), person("u2", "Ben Ruiz", "working")],
    shifts: [
      shift({ id: "am", userId: "u1" }),
      shift({ id: "pm", userId: "u1", name: "Evening", startTime: "17:00:00", endTime: "21:00:00", startsAt: "2026-10-28T22:00:00Z", endsAt: "2026-10-29T02:00:00Z" }),
      shift({ id: "am2", userId: "u2" }),
    ],
  });

  it("keeps both shifts on the person, in start order", () => {
    const roster = buildDayRoster(s, TODAY, "verified", CTX);
    const ana = roster.people.find((p) => p.userId === "u1");
    expect(ana?.shifts.map((x) => x.id)).toEqual(["am", "pm"]);
    expect(roster.shifts).toHaveLength(3);
  });

  it("appears once in each shift group and never overwrites a shift", () => {
    const groups = buildShiftGroups(buildDayRoster(s, TODAY, "verified", CTX).people);
    expect(groups.map((g) => g.name)).toEqual(["Morning", "Evening"]);
    expect(groups[0].members.map((m) => m.person.userId)).toEqual(["u1", "u2"]);
    expect(groups[1].members.map((m) => m.person.userId)).toEqual(["u1"]);
  });

  it("orders groups by real start time, not by name", () => {
    const reversed = schedule({
      people: [person("u1", "A")],
      shifts: [
        shift({ id: "z", name: "Aaa Late", startTime: "17:00:00", endTime: "21:00:00", startsAt: "2026-10-28T22:00:00Z", endsAt: "2026-10-29T02:00:00Z" }),
        shift({ id: "y", name: "Zzz Early", startTime: "06:00:00", endTime: "10:00:00", startsAt: "2026-10-28T11:00:00Z", endsAt: "2026-10-28T15:00:00Z" }),
      ],
    });
    expect(buildShiftGroups(buildDayRoster(reversed, TODAY, "not_applicable", CTX).people).map((g) => g.name)).toEqual(["Zzz Early", "Aaa Late"]);
  });
});

describe("attendance status — expected vs. actual", () => {
  const morning = toDayShift(shift(), CTX); // started 07:00, now 10:00
  const evening = toDayShift(shift({ id: "pm", startTime: "17:00:00", startsAt: "2026-10-28T22:00:00Z", endsAt: "2026-10-29T02:00:00Z" }), CTX);

  it("maps verified server statuses to labels", () => {
    expect(resolveDisplayStatus("working", [morning], "verified", NOW_MS)).toBe("on_shift");
    expect(resolveDisplayStatus("on_break", [morning], "verified", NOW_MS)).toBe("on_break");
    expect(resolveDisplayStatus("clocked_out", [morning], "verified", NOW_MS)).toBe("shift_ended");
    expect(resolveDisplayStatus("unknown", [morning], "verified", NOW_MS)).toBe("unknown");
    expect(resolveDisplayStatus(null, [morning], "verified", NOW_MS)).toBe("unknown");
  });

  it("calls a started shift without a clock-in 'not clocked in' — never absent", () => {
    expect(resolveDisplayStatus("not_clocked_in", [morning], "verified", NOW_MS)).toBe("not_clocked_in");
  });

  it("calls a shift that has not started yet 'scheduled', not 'not clocked in'", () => {
    expect(resolveDisplayStatus("not_clocked_in", [evening], "verified", NOW_MS)).toBe("scheduled");
  });

  it("reads a clock-out with a later shift still to come as 'scheduled'", () => {
    expect(resolveDisplayStatus("clocked_out", [morning, evening], "verified", NOW_MS)).toBe("scheduled");
  });

  it("makes no attendance claim on a past/future day", () => {
    expect(resolveDisplayStatus("working", [morning], "not_applicable", NOW_MS)).toBeNull();
  });

  it("is 'unknown' for everyone when attendance is unavailable", () => {
    expect(resolveDisplayStatus("working", [morning], "unavailable", NOW_MS)).toBe("unknown");
  });
});

describe("the day roster and counts", () => {
  const s = schedule({
    people: [person("u1", "Ana", "working"), person("u2", "Ben", "not_clocked_in"), person("u3", "Cy", "clocked_out"), person("u4", "Di", "working", { scheduled: false }), person("u5", "Ed", "scheduled", { scheduled: false })],
    shifts: [shift({ id: "1", userId: "u1" }), shift({ id: "2", userId: "u2" }), shift({ id: "3", userId: "u3" })],
    attendance: { requested: true, verified: true, asOf: "2026-10-28T15:00:00Z" },
  });

  it("lists scheduled people, plus someone verifiably working with no shift — and nobody else", () => {
    const roster = buildDayRoster(s, TODAY, "verified", CTX);
    expect(roster.people.map((p) => p.userId).sort()).toEqual(["u1", "u2", "u3", "u4"]);
    expect(roster.people.find((p) => p.userId === "u4")).toMatchObject({ scheduled: false, status: "on_shift" });
  });

  it("counts attendance only for a verified day, and never invents a shortage", () => {
    const counts = countAttendance(buildDayRoster(s, TODAY, "verified", CTX));
    expect(counts).toEqual({ scheduled: 3, onShift: 2, onBreak: 0, upcoming: 0, notClockedIn: 1, shiftEnded: 1, unknown: 0, unscheduledOnShift: 1 });
    expect(Object.keys(counts ?? {})).not.toContain("short");
    expect(countAttendance(buildDayRoster(s, TODAY, "unavailable", CTX))).toBeNull();
    expect(countAttendance(buildDayRoster(s, TODAY, "not_applicable", CTX))).toBeNull();
  });

  it("does not list an unscheduled person when attendance is unavailable", () => {
    expect(buildDayRoster(s, TODAY, "unavailable", CTX).people.map((p) => p.userId).sort()).toEqual(["u1", "u2", "u3"]);
  });
});

describe("attention items are real observations only", () => {
  const s = schedule({
    people: [person("u1", "Ana", "not_clocked_in"), person("u2", "Ben", "clocked_out"), person("u3", "Cy", "working", { scheduled: false }), person("u4", "Di", "working")],
    shifts: [shift({ id: "1", userId: "u1" }), shift({ id: "2", userId: "u2" }), shift({ id: "4", userId: "u4" })],
  });

  it("flags no clock-in, an early clock-out, and unscheduled work — with timestamps", () => {
    const items = buildAttention(buildDayRoster(s, TODAY, "verified", CTX), noNotes, CTX);
    expect(items.map((i) => i.kind).sort()).toEqual(["ended_early", "not_clocked_in", "unscheduled_on_shift"]);
    const late = items.find((i) => i.kind === "not_clocked_in");
    expect(late).toMatchObject({ userId: "u1", severity: "warning", atMs: Date.parse("2026-10-28T12:00:00Z") });
    expect(items.some((i) => (i.kind as string) === "absent" || (i.kind as string) === "no_show")).toBe(false);
  });

  it("fabricates nothing: a quiet verified day has no items", () => {
    const quiet = schedule({ people: [person("u4", "Di", "working")], shifts: [shift({ id: "4", userId: "u4" })] });
    expect(buildAttention(buildDayRoster(quiet, TODAY, "verified", CTX), noNotes, CTX)).toEqual([]);
  });

  it("reports source problems, and makes no per-person claim on a day without attendance", () => {
    const items = buildAttention(buildDayRoster(s, TODAY, "unavailable", CTX), { staleSince: NOW_MS - 600_000, attendanceUnavailable: true, incomplete: true, unreadableShifts: 2 }, CTX);
    expect(items.map((i) => i.kind).sort()).toEqual(["attendance_unavailable", "incomplete", "stale_data", "unreadable"]);
    expect(items.find((i) => i.kind === "unreadable")?.count).toBe(2);
  });

  it("puts warnings before notes", () => {
    const items = buildAttention(buildDayRoster(s, TODAY, "verified", CTX), noNotes, CTX);
    expect(items[0].severity).toBe("warning");
    expect(items[items.length - 1].severity).toBe("info");
  });
});

describe("week summaries", () => {
  const days = ["2026-10-26", "2026-10-27", "2026-10-28"];

  it("counts distinct people and shifts per day, keeping several shifts per person", () => {
    const s = schedule({
      dateFrom: "2026-10-26",
      people: [person("u1", "A"), person("u2", "B")],
      shifts: [shift({ id: "1", userId: "u1", workDate: "2026-10-26" }), shift({ id: "2", userId: "u1", workDate: "2026-10-26" }), shift({ id: "3", userId: "u2", workDate: "2026-10-28", publication: "draft" })],
    });
    expect(buildWeekSummaries(s, days)).toEqual([
      { date: "2026-10-26", people: 1, shifts: 2, drafts: 0 },
      { date: "2026-10-27", people: 0, shifts: 0, drafts: 0 },
      { date: "2026-10-28", people: 1, shifts: 1, drafts: 1 },
    ]);
  });

  it("offers no coverage percentage or staffing target", () => {
    const [first] = buildWeekSummaries(schedule({ people: [person("u1", "A")], shifts: [shift()] }), [TODAY]);
    expect(Object.keys(first).sort()).toEqual(["date", "drafts", "people", "shifts"]);
  });
});
