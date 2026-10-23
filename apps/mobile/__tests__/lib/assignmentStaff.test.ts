import {
  normalizeScheduledShifts,
  scheduledUserIds,
  shiftTimeFor,
} from "@/lib/housekeeping/assignmentSchedule";
import { ATTENDANCE_RANK, resolveAttendance } from "@/lib/housekeeping/assignmentStaff";
import { selectStaffNeedingAttention, selectStaffWithoutRooms } from "@/lib/housekeeping/assignmentSelectors";
import { availableSource, failedSource, loadingSource, offlineSource } from "@/lib/housekeeping/supervisorSources";
import type { ScheduledShift } from "@/lib/housekeeping/assignmentSchedule";
import type { RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import { assignmentsOf, rosterOf, rosterRow, shift } from "../helpers/assignmentFixtures";
import { NOW, ZONE, rawRoom } from "../helpers/roomBoardFixtures";

const roster = (...rows: ReturnType<typeof rosterRow>[]) => rosterOf(rows);
const schedule = (...users: string[]) => availableSource(users.map((user) => shift(user)), NOW);

describe("attendance is its own fact", () => {
  it("a verified roster row says on shift, on break or shift ended", () => {
    const source = roster(rosterRow("a", "active"), rosterRow("b", "on_break"), rosterRow("c", "ended"));
    expect(resolveAttendance("a", source, schedule()).attendance).toBe("on_shift");
    expect(resolveAttendance("b", source, schedule()).attendance).toBe("on_break");
    expect(resolveAttendance("c", source, schedule()).attendance).toBe("shift_ended");
  });

  it("scheduled but not clocked in differs from not clocked in", () => {
    const source = roster(rosterRow("a", "active"));
    expect(resolveAttendance("x", source, schedule("x"))).toMatchObject({ attendance: "scheduled_not_clocked_in", scheduled: true });
    expect(resolveAttendance("y", source, schedule("x"))).toMatchObject({ attendance: "not_clocked_in", scheduled: false });
  });

  it("being scheduled does not make a clocked-out person 'on shift'", () => {
    expect(resolveAttendance("a", roster(rosterRow("a", "ended")), schedule("a")).attendance).toBe("shift_ended");
  });

  it("an unverified schedule makes no claim about being scheduled", () => {
    const stale = offlineSource(availableSource([shift("x")], NOW));
    expect(resolveAttendance("x", roster(rosterRow("a", "active")), stale)).toMatchObject({ attendance: "not_clocked_in", scheduled: null });
    expect(resolveAttendance("x", roster(rosterRow("a", "active")), loadingSource())).toMatchObject({ scheduled: null });
  });

  it("an implausibly old open shift is unknown, not 'on shift'", () => {
    const source = rosterOf([rosterRow("a", "active", 20 * 60 * 60_000)]);
    expect(resolveAttendance("a", source, schedule()).attendance).toBe("unknown");
  });
});

describe("a missing or failed roster is unknown — never zero staff working", () => {
  const failures = {
    loading: loadingSource<RosterEntry[]>(),
    failed: failedSource<RosterEntry[]>(Object.assign(new Error("forbidden"), { status: 403 }), loadingSource()),
    stale: offlineSource(rosterOf([rosterRow("a", "active")])),
  };

  it.each(Object.entries(failures))("%s roster → everybody unknown, even the scheduled and even the person in the old answer", (_name, source) => {
    expect(resolveAttendance("a", source, schedule("a"))).toMatchObject({ attendance: "unknown", rosterVerified: false });
  });

  it("in the composed model nobody is 'not clocked in' when the roster failed", () => {
    const model = assignmentsOf({ roster: failures.failed });
    expect(model.rosterTrust).toBe("unknown");
    expect(model.team?.every((member) => member.attendance === "unknown")).toBe(true);
    expect(model.team?.flatMap((member) => member.concerns)).not.toContain("not_clocked_in_with_open_rooms");
  });

  it("a verified EMPTY roster is a real answer: listed staff are not clocked in", () => {
    const model = assignmentsOf({ roster: rosterOf([]) });
    expect(model.rosterTrust).toBe("verified");
    expect(model.team?.every((member) => member.attendance === "not_clocked_in")).toBe(true);
  });

  it("attendance ranks working people ahead of definitely-absent ones, unknown in between", () => {
    const order = Object.entries(ATTENDANCE_RANK).sort(([, a], [, b]) => a - b).map(([key]) => key);
    expect(order).toEqual(["on_shift", "scheduled_not_clocked_in", "on_break", "unknown", "not_clocked_in", "shift_ended"]);
  });
});

describe("assignment ownership is not attendance", () => {
  it("a person with rooms who is not clocked in is flagged — rooms never made them 'on shift'", () => {
    const model = assignmentsOf({
      raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-1" })],
      roster: roster(rosterRow("hk-1", "active")),
    });
    const ben = model.team?.find((member) => member.userId === "hk-2");
    expect(ben).toMatchObject({ attendance: "not_clocked_in" });
    expect(ben?.concerns).toContain("not_clocked_in_with_open_rooms");
  });

  it("a person whose shift ended with rooms still open is flagged", () => {
    const model = assignmentsOf({
      raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-1" })],
      roster: roster(rosterRow("hk-1", "ended")),
    });
    expect(model.team?.find((member) => member.userId === "hk-1")?.concerns).toContain("shift_ended_with_open_rooms");
  });

  it("a scheduled person who has not clocked in yet is only a concern once their shift has started", () => {
    const before = assignmentsOf({
      raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-1" })],
      roster: roster(rosterRow("hk-1", "active")),
      schedule: availableSource([shift("hk-2", "13:00", "21:00")], NOW), // NOW = 12:00 Chicago
    });
    expect(before.team?.find((m) => m.userId === "hk-2")?.concerns).toEqual([]);
    const during = assignmentsOf({
      raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-1" })],
      roster: roster(rosterRow("hk-1", "active")),
      schedule: availableSource([shift("hk-2", "07:00", "15:00")], NOW),
    });
    expect(during.team?.find((m) => m.userId === "hk-2")?.concerns).toContain("not_clocked_in_with_open_rooms");
  });
});

describe("the team model", () => {
  it("includes staff with ZERO assignments, so their capacity is visible", () => {
    const model = assignmentsOf({ raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-1" })] });
    expect(model.team?.map((member) => member.userId).sort()).toEqual(["hk-1", "hk-2", "hk-3"]);
    expect(selectStaffWithoutRooms(model.team ?? []).map((member) => member.userId).sort()).toEqual(["hk-2", "hk-3"]);
    expect(model.team?.find((member) => member.userId === "hk-3")).toMatchObject({ rooms: [], listed: true, name: "Cara Reyes" });
  });

  it("is stable: ordered by name, unnamed owners last", () => {
    const model = assignmentsOf({ raw: [rawRoom("101", "DIRTY", { assigned_to: "zzz", assignment_id: "as-1" })] });
    expect(model.team?.map((member) => member.name)).toEqual(["Ana Torres", "Ben Ortiz", "Cara Reyes", null]);
  });

  it("is unknown (null), not empty, while the board is unavailable", () => {
    const model = assignmentsOf({ boardDate: "2026-10-15" }); // a board requested for the previous hotel day
    expect(model.rooms).toBeNull();
    expect(model.team).toBeNull();
  });

  it("selects staff needing attention", () => {
    const model = assignmentsOf({
      raw: [rawRoom("101", "DIRTY", { assigned_to: "hk-2", assignment_id: "as-1" })],
      roster: roster(rosterRow("hk-1", "active")),
    });
    expect(selectStaffNeedingAttention(model.team ?? []).map((member) => member.userId)).toEqual(["hk-2"]);
  });
});

describe("scheduled shifts", () => {
  const response = (rows: unknown[]) => ({ data: rows });
  const row = (user: string, start = "07:00:00", end = "15:00:00", date = "2026-10-16") => ({
    user_id: user,
    work_date: date,
    shifts: { name: "Day", start_time: start, end_time: end },
  });

  it("normalises rows, drops those without a user or for another date", () => {
    const shifts = normalizeScheduledShifts(response([row("a"), row("b", "07:00", "15:00", "2026-10-15"), { work_date: "2026-10-16" }]), "2026-10-16");
    expect(shifts).toEqual([{ userId: "a", name: "Day", startTime: "07:00:00", endTime: "15:00:00" }]);
    expect([...scheduledUserIds(shifts)]).toEqual(["a"]);
  });

  it("a malformed body throws — it is never an empty schedule", () => {
    expect(() => normalizeScheduledShifts(null, "2026-10-16")).toThrow(/Malformed/);
    expect(() => normalizeScheduledShifts({ data: "nope" }, "2026-10-16")).toThrow(/Malformed/);
    expect(() => normalizeScheduledShifts({}, "2026-10-16")).toThrow(/Malformed/);
  });

  const at = (hhmm: string) => Date.parse(`2026-10-16T${hhmm}:00-05:00`); // Chicago is CDT in October
  const timeAt = (shifts: ScheduledShift[], when: number) => shiftTimeFor(shifts, { hotelDate: "2026-10-16", now: when, timeZone: ZONE });

  it("minutes left in a shift in progress, before it, and after it", () => {
    const day = [shift("a", "07:00", "15:00")];
    expect(timeAt(day, at("12:00"))).toMatchObject({ phase: "during", minutesLeft: 180 });
    expect(timeAt(day, at("06:00"))).toMatchObject({ phase: "before", minutesLeft: 480 });
    expect(timeAt(day, at("16:00"))).toMatchObject({ phase: "after", minutesLeft: 0 });
  });

  it("an overnight shift ends the next calendar day", () => {
    const night = [shift("a", "22:00", "06:00")];
    expect(timeAt(night, at("23:00"))).toMatchObject({ phase: "during", minutesLeft: 420 });
  });

  it("unreadable or absent times are unknown, not 'no time left'", () => {
    expect(timeAt([], at("12:00"))).toBeNull();
    expect(timeAt([shift("a", null, "15:00")], at("12:00"))).toBeNull();
    expect(timeAt([shift("a", "7am", "3pm")], at("12:00"))).toBeNull();
  });

  it("with several shifts: the one running, else the next, else the last", () => {
    const split = [shift("a", "06:00", "10:00"), shift("a", "14:00", "18:00")];
    expect(timeAt(split, at("08:00"))).toMatchObject({ phase: "during", minutesLeft: 120 });
    expect(timeAt(split, at("12:00"))).toMatchObject({ phase: "before", minutesLeft: 240 });
    expect(timeAt(split, at("20:00"))).toMatchObject({ phase: "after" });
  });

  it("flows into the team model as minutes left", () => {
    const model = assignmentsOf({ schedule: availableSource([shift("hk-1", "07:00", "15:00")], NOW) });
    expect(model.team?.find((member) => member.userId === "hk-1")?.shift).toMatchObject({ phase: "during", minutesLeft: 180 });
    expect(model.team?.find((member) => member.userId === "hk-2")?.shift).toBeNull();
  });
});
