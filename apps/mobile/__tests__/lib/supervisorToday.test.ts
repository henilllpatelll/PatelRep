import { api } from "@/lib/api/client";
import {
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchShiftRoster,
  type InspectionRecordRaw,
  type ShiftRosterRowRaw,
} from "@/lib/api/housekeepingSupervisor";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { availableSource, loadingSource } from "@/lib/housekeeping/supervisorSources";
import { buildTeamPulse, normalizeRoster, type RosterEntry } from "@/lib/housekeeping/supervisorTeam";
import {
  buildInspectionMetrics,
  buildReadinessSummary,
  composeSupervisorToday,
  hotelTodayKey,
  hotelTzOffsetMinutes,
  initialTodaySources,
  loadTodaySources,
  normalizeBoard,
  type TodayFetchers,
  type TodaySources,
} from "@/lib/housekeeping/supervisorToday";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));
const mockGet = api.get as jest.Mock;

// 12:00 in Chicago (CDT) on 2026-10-16 — past noon, before the 1 PM "behind" cut-off on any device zone near UTC-5.
const NOW = Date.parse("2026-10-16T17:00:00Z");
const ZONE = "America/Chicago";

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterAll(() => jest.useRealTimers());

function raw(roomId: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  return { room_id: roomId, status, rooms: { id: roomId, room_number: roomId.replace("r-", ""), floor: 1 }, ...extra };
}

function fetchers(overrides: Partial<TodayFetchers> = {}): TodayFetchers {
  return {
    board: async () => [raw("r-101", "DIRTY")],
    staff: async () => [{ userId: "hk-1", name: "Ana", role: "housekeeper" }],
    roster: async () => [],
    inspections: async () => [],
    blockedTasks: async () => [],
    ...overrides,
  };
}

const ONLINE = { now: NOW, timeZone: ZONE, online: true };

describe("room status classification and readiness denominators", () => {
  const rooms = normalizeBoard([
    raw("r-101", "INSPECTED"),
    raw("r-102", "INSPECTED"),
    raw("r-103", "CLEAN"),
    raw("r-104", "IN_PROGRESS", { assigned_to: "hk-1" }),
    raw("r-105", "DIRTY"),
    raw("r-106", "PICKUP", { assigned_to: "hk-1" }),
    raw("r-107", "OCCUPIED"),
    raw("r-108", "OOO"),
    raw("r-109", "OOO"),
    raw("r-110", "SOMETHING_NEW"),
  ]).rooms;
  const summary = buildReadinessSummary(rooms);

  it("keeps INSPECTED as ready and CLEAN as awaiting inspection — CLEAN is never guest-ready", () => {
    expect(summary.ready).toBe(2);
    expect(summary.awaitingInspection).toBe(1);
  });

  it("separates hotel inventory from in-service rooms", () => {
    expect(summary.inventoryTotal).toBe(10);
    expect(summary.outOfOrder).toBe(2);
    expect(summary.inService).toBe(8);
  });

  it("accounts for every in-service room exactly once, counting unknown statuses as unclassified", () => {
    expect(summary.toClean).toBe(3);
    expect(summary.inProgress).toBe(1);
    expect(summary.unclassified).toBe(1);
    expect(summary.ready + summary.awaitingInspection + summary.inProgress + summary.toClean + summary.unclassified).toBe(
      summary.inService,
    );
  });

  it("uses in-service rooms as the readiness denominator and ready-only workload remaining", () => {
    expect(summary.progress).toBeCloseTo(2 / 8);
    expect(summary.workRemaining).toBe(summary.toClean + summary.inProgress + summary.awaitingInspection);
  });

  it("counts unassigned actionable rooms (to clean or in progress, no housekeeper)", () => {
    // 104 + 106 are assigned; 105 and 107 are not.
    expect(summary.unassignedActionable).toBe(2);
  });

  it("never exceeds 100% and reaches exactly 100% when every in-service room is ready", () => {
    const all = buildReadinessSummary(normalizeBoard([raw("r-1", "INSPECTED"), raw("r-2", "INSPECTED"), raw("r-3", "OOO")]).rooms);
    expect(all.progress).toBe(1);
  });

  it("has no progress (null, not 0%) when no room is in service", () => {
    expect(buildReadinessSummary([]).progress).toBeNull();
    expect(buildReadinessSummary(normalizeBoard([raw("r-1", "OOO")]).rooms).progress).toBeNull();
  });
});

describe("board normalisation", () => {
  it("drops rows without a room reference and de-duplicates by room id, reporting both", () => {
    const snapshot = normalizeBoard([
      raw("r-101", "DIRTY"),
      raw("r-101", "INSPECTED"),
      { room_id: "r-300", status: "DIRTY", rooms: null },
      { room_id: "", status: "DIRTY", rooms: { room_number: "9" } },
    ]);
    expect(snapshot.rooms.map((room) => room.roomId)).toEqual(["r-101"]);
    expect(snapshot.rooms[0].status).toBe("DIRTY");
    expect(snapshot.invalidRows).toBe(2);
    expect(snapshot.duplicateRows).toBe(1);
  });

  it("treats a board whose rows are all unusable as a failure, not an empty hotel", async () => {
    const sources = await loadTodaySources(
      initialTodaySources(),
      fetchers({ board: async () => [{ room_id: "r-1", status: "DIRTY", rooms: null }] }),
      ONLINE,
    );
    expect(sources.board.status).toBe("failed");
  });
});

describe("empty hotel and verified zeros", () => {
  it("shows a verified-empty board as true zeros with no progress, not as unknown", async () => {
    const sources = await loadTodaySources(initialTodaySources(), fetchers({ board: async () => [] }), ONLINE);
    expect(sources.board.status).toBe("empty");
    const today = composeSupervisorToday(sources, { now: NOW, timeZone: ZONE });
    expect(today.readiness.status).toBe("empty");
    expect(today.readiness.value).toMatchObject({ inventoryTotal: 0, inService: 0, ready: 0, progress: null });
    expect(today.attention.items).toEqual([]);
  });

  it("reports zero completed inspections as a real zero when the history is verified empty", async () => {
    const sources = await loadTodaySources(initialTodaySources(), fetchers(), ONLINE);
    const today = composeSupervisorToday(sources, { now: NOW, timeZone: ZONE });
    expect(today.inspections.status).toBe("empty");
    expect(today.inspections.value).toEqual({ total: 0, passed: 0, failed: 0, conditional: 0, other: 0 });
  });
});

describe("partial failure never produces false zeros", () => {
  it("keeps the board when inspection history fails, and marks inspections unavailable", async () => {
    const sources = await loadTodaySources(
      initialTodaySources(),
      fetchers({
        board: async () => [raw("r-101", "INSPECTED"), raw("r-102", "CLEAN")],
        inspections: async () => {
          throw Object.assign(new Error("boom"), { status: 500 });
        },
      }),
      ONLINE,
    );
    const today = composeSupervisorToday(sources, { now: NOW, timeZone: ZONE });
    expect(today.readiness.status).toBe("available");
    expect(today.readiness.value?.ready).toBe(1);
    expect(today.inspections.status).toBe("failed");
    expect(today.inspections.value).toBeNull();
    expect(today.inspections.failure).toEqual({ kind: "error", status: 500 });
  });

  it("keeps the last verified board as stale (original fetch time) when a refresh fails", async () => {
    const first = await loadTodaySources(initialTodaySources(), fetchers({ board: async () => [raw("r-101", "INSPECTED")] }), ONLINE);
    const later = NOW + 60_000;
    const second = await loadTodaySources(
      first,
      fetchers({
        board: async () => {
          throw new Error("network");
        },
      }),
      { ...ONLINE, now: later },
    );
    expect(second.board).toMatchObject({ status: "stale", reason: "refresh_failed", fetchedAt: NOW });
    const today = composeSupervisorToday(second, { now: later, timeZone: ZONE });
    expect(today.readiness.status).toBe("stale");
    expect(today.readiness.value?.ready).toBe(1);
    expect(today.readiness.fetchedAt).toBe(NOW);
  });

  it("marks everything stale when offline without refetching", async () => {
    const first = await loadTodaySources(initialTodaySources(), fetchers(), ONLINE);
    const get = jest.fn();
    const offline = await loadTodaySources(first, fetchers({ board: get }), { ...ONLINE, online: false });
    expect(get).not.toHaveBeenCalled();
    expect(offline.board).toMatchObject({ status: "stale", reason: "offline" });
    expect(offline.inspections).toMatchObject({ status: "stale", reason: "offline" });
  });

  it("is failed (unknown), not empty, when offline before anything ever loaded", async () => {
    const offline = await loadTodaySources(initialTodaySources(), fetchers(), { ...ONLINE, online: false });
    expect(offline.board).toEqual({ status: "failed", failure: { kind: "offline", status: null } });
  });

  it("demotes an answer older than the freshness window to stale", () => {
    const sources: TodaySources = {
      ...initialTodaySources(),
      board: availableSource(normalizeBoard([raw("r-101", "INSPECTED")]), NOW - 10 * 60_000, (b) => b.rooms.length === 0),
    };
    const today = composeSupervisorToday(sources, { now: NOW, timeZone: ZONE });
    expect(today.readiness.status).toBe("stale");
    expect(today.sources.board).toMatchObject({ status: "stale", reason: "age" });
  });

  it("reports a still-loading source as loading with no value", () => {
    const today = composeSupervisorToday({ ...initialTodaySources(), board: loadingSource() }, { now: NOW, timeZone: ZONE });
    expect(today.readiness).toMatchObject({ status: "loading", value: null, fetchedAt: null });
  });

  it("reports a forbidden roster as a distinct failure", async () => {
    const sources = await loadTodaySources(
      initialTodaySources(),
      fetchers({
        roster: async () => {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
      }),
      ONLINE,
    );
    expect(sources.roster).toEqual({ status: "failed", failure: { kind: "forbidden", status: 403 } });
  });
});

describe("staff availability: unknown vs verified zero", () => {
  const rooms = normalizeBoard([raw("r-101", "DIRTY", { assigned_to: "hk-1" })]).rooms;
  const staff = [
    { userId: "hk-1", name: "Ana", role: "housekeeper" },
    { userId: "hk-2", name: "Ben", role: "housekeeper" },
  ];

  it("is unknown (null counts, unknown members) when the roster could not be read — never zero", () => {
    const pulse = buildTeamPulse(rooms, staff, { status: "failed", failure: { kind: "error", status: 500 } });
    expect(pulse.roster.status).toBe("unknown");
    expect(pulse.onShift).toBeNull();
    expect(pulse.onBreak).toBeNull();
    expect(pulse.members.every((member) => member.availability === "unknown")).toBe(true);
  });

  it("is a true zero when the roster is verified and nobody has clocked in", () => {
    const pulse = buildTeamPulse(rooms, staff, availableSource<RosterEntry[]>([], NOW));
    expect(pulse.roster.status).toBe("verified");
    expect(pulse.onShift).toBe(0);
    expect(pulse.members.map((member) => member.availability)).toEqual(["not_clocked_in", "not_clocked_in"]);
  });

  it("does not treat an assigned room as being on shift", () => {
    const pulse = buildTeamPulse(rooms, staff, availableSource<RosterEntry[]>([], NOW));
    const ana = pulse.members.find((member) => member.userId === "hk-1");
    expect(ana?.load?.total).toBe(1);
    expect(ana?.availability).not.toBe("on_shift");
    expect(pulse.onShift).toBe(0);
  });

  it("counts recorded shifts: on shift, on break and ended are distinct", () => {
    const entries = normalizeRoster(
      [
        { user_id: "hk-1", status: "active", started_at: "2026-10-16T12:00:00Z" },
        { user_id: "hk-2", status: "on_break", started_at: "2026-10-16T12:00:00Z", on_break_since: "2026-10-16T16:30:00Z" },
        { user_id: "hk-3", status: "ended", started_at: "2026-10-16T11:00:00Z" },
      ],
      NOW,
    );
    const pulse = buildTeamPulse(rooms, staff, availableSource(entries, NOW));
    expect(pulse.onShift).toBe(1);
    expect(pulse.onBreak).toBe(1);
  });

  it("does not trust an open shift that has run implausibly long, or a status it does not know", () => {
    const entries = normalizeRoster(
      [
        { user_id: "hk-1", status: "active", started_at: "2026-10-15T01:00:00Z" },
        { user_id: "hk-2", status: "paused", started_at: "2026-10-16T12:00:00Z" },
        { user_id: "hk-3", status: "active", started_at: null },
      ],
      NOW,
    );
    expect(entries.map((entry) => entry.availability)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("keeps the latest row per person and ignores rows without a user id", () => {
    const rows: ShiftRosterRowRaw[] = [
      { user_id: "hk-1", status: "active", started_at: "2026-10-16T13:00:00Z" },
      { user_id: "hk-1", status: "ended", started_at: "2026-10-16T08:00:00Z" },
      { user_id: null, status: "active", started_at: "2026-10-16T13:00:00Z" },
    ];
    const entries = normalizeRoster(rows, NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0].availability).toBe("on_shift");
  });
});

describe("inspection metrics come only from inspection records", () => {
  it("counts recorded results, de-duplicates by id and keeps unrecognised results out of pass/fail", () => {
    const records: InspectionRecordRaw[] = [
      { id: "i1", overall_result: "passed" },
      { id: "i1", overall_result: "passed" },
      { id: "i2", overall_result: "failed" },
      { id: "i3", overall_result: "conditional" },
      { id: "i4", overall_result: "weird" },
      { id: "i5", overall_result: null },
    ];
    expect(buildInspectionMetrics(records)).toEqual({ total: 5, passed: 1, failed: 1, conditional: 1, other: 2 });
  });

  it("does not infer failures from room statuses", async () => {
    const sources = await loadTodaySources(
      initialTodaySources(),
      fetchers({ board: async () => [raw("r-1", "CLEAN"), raw("r-2", "DIRTY"), raw("r-3", "CLEAN")] }),
      ONLINE,
    );
    const today = composeSupervisorToday(sources, { now: NOW, timeZone: ZONE });
    expect(today.readiness.value?.awaitingInspection).toBe(2);
    expect(today.inspections.value?.failed).toBe(0);
    expect(today.inspections.value?.total).toBe(0);
  });
});

describe("hotel-local date", () => {
  it("uses the hotel zone, not UTC, for 'today'", () => {
    expect(hotelTodayKey(Date.parse("2026-10-17T02:00:00Z"), ZONE)).toBe("2026-10-16");
    expect(hotelTodayKey(Date.parse("2026-10-17T06:00:00Z"), ZONE)).toBe("2026-10-17");
  });

  it("derives the getTimezoneOffset minutes for the hotel's day (DST-aware)", () => {
    expect(hotelTzOffsetMinutes("2026-10-16", ZONE)).toBe(300);
    expect(hotelTzOffsetMinutes("2026-12-01", ZONE)).toBe(360);
  });

  it("requests board, roster and inspections for the hotel's date", async () => {
    const board = jest.fn(async () => [raw("r-1", "DIRTY")]);
    const roster = jest.fn(async () => []);
    const inspections = jest.fn(async () => []);
    await loadTodaySources(initialTodaySources(), fetchers({ board, roster, inspections }), {
      now: Date.parse("2026-10-17T02:00:00Z"),
      timeZone: ZONE,
      online: true,
    });
    expect(board).toHaveBeenCalledWith("2026-10-16");
    expect(roster).toHaveBeenCalledWith("2026-10-16");
    expect(inspections).toHaveBeenCalledWith("2026-10-16", 300);
  });
});

describe("strict API wrappers", () => {
  beforeEach(() => mockGet.mockReset());

  it("throws on a malformed payload instead of returning an empty list", async () => {
    mockGet.mockResolvedValue({ data: null });
    await expect(fetchBoardVerified("2026-10-16")).rejects.toThrow(/Malformed board/);
    mockGet.mockResolvedValue({});
    await expect(fetchShiftRoster("2026-10-16")).rejects.toThrow(/Malformed roster/);
    mockGet.mockResolvedValue(undefined);
    await expect(fetchInspectionHistory("2026-10-16", 300)).rejects.toThrow(/Malformed inspections/);
  });

  it("returns an honestly empty array when the server says so", async () => {
    mockGet.mockResolvedValue({ data: [] });
    await expect(fetchShiftRoster("2026-10-16")).resolves.toEqual([]);
  });

  it("calls the documented endpoints", async () => {
    mockGet.mockResolvedValue({ data: [] });
    await fetchBoardVerified("2026-10-16");
    await fetchShiftRoster("2026-10-16");
    await fetchInspectionHistory("2026-10-16", 300);
    expect(mockGet.mock.calls.map((call) => call[0])).toEqual([
      "/housekeeping/board?date=2026-10-16",
      "/shifts/roster?date=2026-10-16",
      "/housekeeping/inspections?date_from=2026-10-16&date_to=2026-10-16&tz_offset=300",
    ]);
  });
});
