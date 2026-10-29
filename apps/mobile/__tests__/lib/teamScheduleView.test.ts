import { selectDayView, selectWeekView } from "@/lib/scheduling/teamScheduleView";
import { applyView, buildFilterOptions, DEFAULT_VIEW_STATE, filterCount, filterGroups, isDefaultView, pruneFilters, searchPeople, viewBadge } from "@/lib/scheduling/teamScheduleQuery";
import { buildDayRoster, buildShiftGroups } from "@/lib/scheduling/teamScheduleModel";
import type { SourceState } from "@/lib/housekeeping/supervisorSources";
import type { TeamSchedule } from "@/lib/api/schedulingTeam";
import { CTX, NOW_MS, TODAY, person, schedule, shift } from "../helpers/teamScheduleFixtures";

const available = (data: TeamSchedule): SourceState<TeamSchedule> => ({ status: "available", data, fetchedAt: NOW_MS });
const stale = (data: TeamSchedule): SourceState<TeamSchedule> => ({ status: "stale", data, fetchedAt: NOW_MS - 10 * 60_000, reason: "refresh_failed", failure: { kind: "error", status: 500 } });
const loading: SourceState<TeamSchedule> = { status: "loading" };
const failed = (kind: "offline" | "error" | "forbidden" = "error"): SourceState<TeamSchedule> => ({ status: "failed", failure: { kind, status: kind === "forbidden" ? 403 : null } });

const verifiedDay = schedule({
  people: [person("u1", "Ana", "working"), person("u2", "Ben", "not_clocked_in")],
  shifts: [shift({ id: "1", userId: "u1" }), shift({ id: "2", userId: "u2" })],
  attendance: { requested: true, verified: true, asOf: "2026-10-28T15:00:00Z" },
});
const plan = schedule({ dateFrom: "2026-10-26", dateTo: "2026-11-01", people: [person("u1", "Ana"), person("u2", "Ben")], shifts: [shift({ id: "1", userId: "u1" })] });

describe("selectDayView — errors are never empty schedules", () => {
  it("a failed read is a failure with a reason, not an empty day", () => {
    const view = selectDayView(TODAY, TODAY, failed("error"), failed("error"), CTX);
    expect(view.state).toBe("failed");
    expect(view.failure?.kind).toBe("error");
    expect(view.roster).toBeNull();
    expect(view.scheduledCount).toBeNull();
    expect(view.verifiedEmpty).toBe(false);
  });

  it("keeps offline and forbidden distinguishable", () => {
    expect(selectDayView("2026-10-30", TODAY, failed("offline"), loading, CTX).failure?.kind).toBe("offline");
    expect(selectDayView("2026-10-30", TODAY, failed("forbidden"), loading, CTX).failure?.kind).toBe("forbidden");
  });

  it("a verified empty read is a real empty state", () => {
    const view = selectDayView("2026-10-30", TODAY, { status: "empty", fetchedAt: NOW_MS }, loading, CTX);
    expect(view.state).toBe("ready");
    expect(view.verifiedEmpty).toBe(true);
    expect(view.staffInScope).toBe(0);
  });

  it("people in scope but nobody on this day is 'nothing scheduled', not an error", () => {
    const view = selectDayView("2026-10-30", TODAY, available(plan), loading, CTX);
    expect(view.state).toBe("ready");
    expect(view.roster?.people).toEqual([]);
    expect(view.staffInScope).toBe(2);
    expect(view.verifiedEmpty).toBe(false);
  });

  it("waits (skeleton) rather than flashing 'Unknown' while today's attendance read is still loading", () => {
    expect(selectDayView(TODAY, TODAY, available(plan), loading, CTX).state).toBe("loading");
  });
});

describe("selectDayView — attendance honesty", () => {
  it("today with a fresh verified read carries attendance and counts", () => {
    const view = selectDayView(TODAY, TODAY, available(plan), available(verifiedDay), CTX);
    expect(view.roster?.mode).toBe("verified");
    expect(view.counts).toMatchObject({ onShift: 1, notClockedIn: 1 });
    expect(view.stale).toBe(false);
    expect(view.attendanceAsOf).toBe(Date.parse("2026-10-28T15:00:00Z"));
  });

  it("a STALE read is never presented as live: statuses unknown, no counts, a stale notice", () => {
    const view = selectDayView(TODAY, TODAY, available(plan), stale(verifiedDay), CTX);
    expect(view.stale).toBe(true);
    expect(view.counts).toBeNull();
    expect(view.roster?.people.every((p) => p.status === "unknown")).toBe(true);
    expect(view.attention.map((i) => i.kind)).toContain("stale_data");
    expect(view.attendanceAsOf).toBeNull();
    expect(view.verifiedAt).toBe(NOW_MS - 10 * 60_000);
  });

  it("when the attendance read fails the plan still shows, with 'attendance unavailable'", () => {
    const view = selectDayView(TODAY, TODAY, available({ ...plan, dateFrom: TODAY, shifts: [shift({ id: "1", userId: "u1" })] }), failed("error"), CTX);
    expect(view.state).toBe("ready");
    expect(view.roster?.mode).toBe("unavailable");
    expect(view.counts).toBeNull();
    expect(view.attention.map((i) => i.kind)).toContain("attendance_unavailable");
    expect(view.roster?.people.map((p) => p.userId)).toEqual(["u1"]);
  });

  it("a server read that could not verify attendance is 'unavailable' even when fresh", () => {
    const unverified = schedule({ ...verifiedDay, attendance: { requested: true, verified: false, asOf: null }, people: [person("u1", "Ana", "unknown")] });
    const view = selectDayView(TODAY, TODAY, available(plan), available(unverified), CTX);
    expect(view.roster?.mode).toBe("unavailable");
    expect(view.counts).toBeNull();
  });

  it("any other day makes no attendance claim at all", () => {
    const future = schedule({ ...plan, shifts: [shift({ id: "9", userId: "u1", workDate: "2026-10-30", startsAt: "2026-10-30T12:00:00Z", endsAt: "2026-10-30T20:30:00Z" })] });
    const view = selectDayView("2026-10-30", TODAY, available(future), available(verifiedDay), CTX);
    expect(view.roster?.mode).toBe("not_applicable");
    expect(view.roster?.people.every((p) => p.status === null)).toBe(true);
    expect(view.counts).toBeNull();
  });

  it("flags an incomplete read and unreadable shifts", () => {
    const partial = schedule({ ...verifiedDay, complete: false, unreadableShifts: 3 });
    const kinds = selectDayView(TODAY, TODAY, available(plan), available(partial), CTX).attention.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["incomplete", "unreadable"]));
  });
});

describe("selectWeekView", () => {
  it("is unknown (null summaries), not zeros, while loading or failed", () => {
    expect(selectWeekView(TODAY, loading).summaries).toBeNull();
    expect(selectWeekView(TODAY, failed()).summaries).toBeNull();
  });

  it("gives all seven days, with a verified 0 for quiet days", () => {
    const view = selectWeekView(TODAY, available(plan));
    expect(view.days).toHaveLength(7);
    expect(view.summaries?.find((d) => d.date === TODAY)?.people).toBe(1);
    expect(view.summaries?.find((d) => d.date === "2026-10-27")?.people).toBe(0);
  });

  it("ignores a held answer for a different week", () => {
    expect(selectWeekView("2026-11-10", available(plan)).summaries).toBeNull();
  });
});

describe("search, filter and sort", () => {
  const s = schedule({
    people: [
      person("u1", "Ana Torres", "working", { roles: ["housekeeper"] }),
      person("u2", "Ben Ruiz", "not_clocked_in", { roles: ["inspector"] }),
      person("u3", "Cy Díaz", "clocked_out", { roles: ["housekeeper"] }),
      person("u4", null, "working", { roles: ["housekeeper"] }),
    ],
    shifts: [
      shift({ id: "1", userId: "u1" }),
      shift({ id: "2", userId: "u2", startTime: "06:00:00", startsAt: "2026-10-28T11:00:00Z" }),
      shift({ id: "3", userId: "u3" }),
      shift({ id: "4", userId: "u4", name: "Evening", startTime: "17:00:00", endTime: "21:00:00", startsAt: "2026-10-28T22:00:00Z", endsAt: "2026-10-29T02:00:00Z" }),
    ],
  });
  const roster = buildDayRoster(s, TODAY, "verified", CTX);

  it("searches names by every typed word, case- and spacing-insensitively", () => {
    expect(searchPeople(roster.people, "  ana   TOR ").map((p) => p.userId)).toEqual(["u1"]);
    expect(searchPeople(roster.people, "z").map((p) => p.userId).sort()).toEqual(["u2", "u3"]); // Ruiz, Díaz — never the nameless one
    expect(searchPeople(roster.people, "")).toHaveLength(4);
  });

  it("filters by status, role and shift", () => {
    expect(applyView(roster.people, { ...DEFAULT_VIEW_STATE, filters: { status: "on_shift", role: null, shiftKey: null } }).map((p) => p.userId).sort()).toEqual(["u1", "u4"]);
    expect(applyView(roster.people, { ...DEFAULT_VIEW_STATE, filters: { status: "all", role: "inspector", shiftKey: null } }).map((p) => p.userId)).toEqual(["u2"]);
    const eveningKey = buildShiftGroups(roster.people).find((g) => g.name === "Evening")?.key ?? null;
    expect(applyView(roster.people, { ...DEFAULT_VIEW_STATE, filters: { status: "all", role: null, shiftKey: eveningKey } }).map((p) => p.userId)).toEqual(["u4"]);
  });

  it("sorts by start time (default), name, and needs-a-look status", () => {
    expect(applyView(roster.people, DEFAULT_VIEW_STATE).map((p) => p.userId)).toEqual(["u2", "u1", "u3", "u4"]);
    expect(applyView(roster.people, { ...DEFAULT_VIEW_STATE, sort: "name" }).map((p) => p.userId)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(applyView(roster.people, { ...DEFAULT_VIEW_STATE, sort: "status" })[0].userId).toBe("u2");
  });

  it("never reorders its input", () => {
    const before = roster.people.map((p) => p.userId);
    applyView(roster.people, { ...DEFAULT_VIEW_STATE, sort: "name" });
    expect(roster.people.map((p) => p.userId)).toEqual(before);
  });

  it("offers only options somebody has, and drops a filter that no longer exists", () => {
    const options = buildFilterOptions(roster.people, buildShiftGroups(roster.people));
    expect(options.statuses).toEqual(["on_shift", "not_clocked_in", "shift_ended"]);
    expect(options.roles).toEqual(["housekeeper", "inspector"]);
    expect(pruneFilters({ status: "on_break", role: "nurse", shiftKey: "gone" }, options)).toEqual({ status: "all", role: null, shiftKey: null });
  });

  it("keeps group members consistent with the filtered people", () => {
    const groups = buildShiftGroups(roster.people);
    const visible = new Set(["u1"]);
    const out = filterGroups(groups, visible, DEFAULT_VIEW_STATE.filters);
    expect(out).toHaveLength(1);
    expect(out[0].members.map((m) => m.person.userId)).toEqual(["u1"]);
  });

  it("counts applied filters for the badge", () => {
    expect(filterCount({ status: "on_shift", role: "inspector", shiftKey: null })).toBe(2);
    expect(viewBadge({ ...DEFAULT_VIEW_STATE, sort: "name" })).toBe(1);
    expect(isDefaultView(DEFAULT_VIEW_STATE)).toBe(true);
    expect(isDefaultView({ ...DEFAULT_VIEW_STATE, query: "x" })).toBe(false);
  });

  it("handles a large team quickly", () => {
    const many = Array.from({ length: 1000 }, (_, i) => person(`p${i}`, `Person ${String(i).padStart(4, "0")}`, "working"));
    const big = schedule({ people: many, shifts: many.map((p, i) => shift({ id: `s${i}`, userId: p.userId })) });
    const started = Date.now();
    const bigRoster = buildDayRoster(big, TODAY, "verified", CTX);
    const result = applyView(bigRoster.people, { ...DEFAULT_VIEW_STATE, query: "person 09" });
    expect(bigRoster.people).toHaveLength(1000);
    expect(result).toHaveLength(many.filter((p) => p.name?.toLowerCase().includes("09")).length);
    expect(result.every((p) => p.name?.includes("09"))).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
