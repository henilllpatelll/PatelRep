import type { TeamSchedule, TeamShift } from "@/lib/api/schedulingTeam";
import { presenceFor } from "@/lib/engineering/technicianPresence";

const NOW = Date.parse("2026-11-03T15:00:00Z");
const H = 3_600_000;
const at = (hours: number) => new Date(NOW + hours * H).toISOString();

const shift = (userId: string, start: number, end: number, over: Partial<TeamShift> = {}): TeamShift => ({
  id: `${userId}:${start}:${end}`,
  userId,
  shiftId: null,
  workDate: "2026-11-03",
  name: null,
  departmentId: null,
  startTime: null,
  endTime: null,
  startsAt: at(start),
  endsAt: at(end),
  publication: "published",
  notes: null,
  carriedFromPreviousDay: false,
  status: null,
  version: 1,
  ...over,
});

const schedule = (shifts: TeamShift[], over: Partial<TeamSchedule> = {}): TeamSchedule => ({
  dateFrom: "2026-11-03",
  dateTo: "2026-11-03",
  hotelToday: "2026-11-03",
  generatedAt: null,
  people: ["a", "b"].map((userId) => ({ userId, name: userId, roles: ["engineer"], departmentId: null, departmentCode: null, scheduled: true, status: null })),
  shifts,
  attendance: { requested: false, verified: false, asOf: null },
  totalPeople: 2,
  complete: true,
  serverTruncated: false,
  unreadableShifts: 0,
  revision: null,
  ...over,
});

describe("presenceFor", () => {
  it("is on shift while a published shift covers now, until the shift's end", () => {
    expect(presenceFor(schedule([shift("a", -2, 4)]), "a", NOW)).toEqual({ kind: "on_shift", endsAt: at(4) });
  });

  it("uses the latest end when shifts overlap", () => {
    expect(presenceFor(schedule([shift("a", -2, 1), shift("a", -1, 5)]), "a", NOW)).toEqual({ kind: "on_shift", endsAt: at(5) });
  });

  it("is on shift at the start instant and no longer at the end instant", () => {
    expect(presenceFor(schedule([shift("a", 0, 2)]), "a", NOW)?.kind).toBe("on_shift");
    expect(presenceFor(schedule([shift("a", -2, 0)]), "a", NOW)?.kind).toBe("ended");
  });

  it("reports the next shift today as later", () => {
    expect(presenceFor(schedule([shift("a", 5, 9), shift("a", 2, 4)]), "a", NOW)).toEqual({ kind: "later", startsAt: at(2) });
  });

  it("reports a finished shift as ended", () => {
    expect(presenceFor(schedule([shift("a", -9, -1)]), "a", NOW)).toEqual({ kind: "ended" });
  });

  it("does not call a finished carried-over shift today's shift", () => {
    expect(presenceFor(schedule([shift("a", -20, -10, { carriedFromPreviousDay: true })]), "a", NOW)).toEqual({ kind: "none" });
  });

  it("says no shift only for a person the schedule covers who has none", () => {
    expect(presenceFor(schedule([shift("a", -2, 4)]), "b", NOW)).toEqual({ kind: "none" });
  });

  it("ignores draft shifts: a proposal is not the schedule", () => {
    expect(presenceFor(schedule([shift("a", -2, 4, { publication: "draft" })]), "a", NOW)).toEqual({ kind: "none" });
  });

  it("is unknown (null), not 'no shift', for someone the schedule does not cover", () => {
    expect(presenceFor(schedule([shift("a", -2, 4)]), "zzz", NOW)).toBeNull();
  });

  it.each([
    ["not read", null],
    ["partial", schedule([], { complete: false })],
    ["has unreadable shifts", schedule([shift("a", -2, 4)], { unreadableShifts: 1 })],
  ])("is unknown when the schedule was %s", (_label, value) => {
    expect(presenceFor(value as TeamSchedule | null, "a", NOW)).toBeNull();
  });
});
