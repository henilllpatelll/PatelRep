import {
  availabilityFor,
  composeRoomBoard,
  evaluateMutationGate,
  initialRoomBoardSources,
  isLive,
  resolveBoardAvailability,
  rosterTrustOf,
  verifiedAgeMs,
  type RoomBoardSources,
} from "@/lib/housekeeping/roomBoardState";
import { normalizeBoardRecords } from "@/lib/housekeeping/roomBoardModel";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import {
  availableSource,
  failedSource,
  loadingSource,
  offlineSource,
  type SourceState,
} from "@/lib/housekeeping/supervisorSources";
import { normalizeRoster } from "@/lib/housekeeping/supervisorTeam";
import { composeSupervisorToday, initialTodaySources, loadTodaySources } from "@/lib/housekeeping/supervisorToday";
import { HOTEL_DATE, NOW, STAFF, ZONE, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const snapshot = (raw = hotelBoard(), date = HOTEL_DATE) => normalizeBoardRecords(raw, date);
const board = (raw = hotelBoard(), date = HOTEL_DATE, at = NOW) =>
  availableSource(snapshot(raw, date), at, (value) => value.rooms.length === 0);

function sources(overrides: Partial<RoomBoardSources> = {}): RoomBoardSources {
  return { ...initialRoomBoardSources(), ...overrides };
}
const compose = (s: RoomBoardSources, now = NOW) => composeRoomBoard(s, { now, timeZone: ZONE });

const rosterOf = (rows: Parameters<typeof normalizeRoster>[0], at = NOW) => availableSource(normalizeRoster(rows, at), at);

describe("board source states — what the board may claim", () => {
  it("initial loading", () => {
    const model = compose(sources());
    expect(model.availability).toEqual({ kind: "loading" });
    expect(model.rooms).toBeNull();
    expect(model.readiness).toBeNull();
  });

  it("successfully loaded → ready, live, with a verification time", () => {
    const model = compose(sources({ board: board() }));
    expect(model.availability).toEqual({ kind: "ready", verifiedAt: NOW });
    expect(isLive(model.availability)).toBe(true);
    expect(model.rooms).toHaveLength(10);
    expect(model.lastVerifiedAt).toBe(NOW);
  });

  it("verified empty: the server answered and there are no rooms — a TRUE zero, distinct from failure", () => {
    const model = compose(sources({ board: board([]) }));
    expect(model.availability).toEqual({ kind: "verified_empty", verifiedAt: NOW });
    expect(model.rooms).toEqual([]);
    expect(model.readiness).toMatchObject({ inventoryTotal: 0, progress: null });
  });

  it("failed load is NOT an empty board: rooms and readiness are unknown, never zero", () => {
    const failed = failedSource<ReturnType<typeof snapshot>>(Object.assign(new Error("boom"), { status: 500 }), loadingSource());
    const model = compose(sources({ board: failed }));
    expect(model.availability).toMatchObject({ kind: "unavailable", cause: "error" });
    expect(model.rooms).toBeNull();
    expect(model.readiness).toBeNull();
    expect(isLive(model.availability)).toBe(false);
  });

  it("forbidden and offline failures are told apart", () => {
    const forbidden = failedSource<ReturnType<typeof snapshot>>(Object.assign(new Error("no"), { status: 403 }), loadingSource());
    expect(compose(sources({ board: forbidden })).availability).toMatchObject({ kind: "unavailable", cause: "forbidden" });
    // Offline with nothing verified yet (loading → failed/offline).
    expect(compose(sources({ board: offlineSource(loadingSource()) })).availability).toMatchObject({ kind: "unavailable", cause: "offline" });
  });

  it("offline WITH verified data keeps it, relabelled stale (never live)", () => {
    const model = compose(sources({ board: offlineSource(board()) }));
    expect(model.availability).toEqual({ kind: "stale", reason: "offline", verifiedAt: NOW, failure: null });
    expect(model.rooms).toHaveLength(10);
    expect(isLive(model.availability)).toBe(false);
  });

  it("a failed refresh keeps the previous verified board as stale and does NOT renew its time", () => {
    const refreshed = failedSource(Object.assign(new Error("x"), { status: 502 }), board());
    const model = compose(sources({ board: refreshed }), NOW + 60_000);
    expect(model.availability).toMatchObject({ kind: "stale", reason: "refresh_failed", verifiedAt: NOW });
    expect(model.lastVerifiedAt).toBe(NOW);
    expect(model.rooms).toHaveLength(10);
  });

  it("a previously verified EMPTY board that goes stale is still known-empty, not unknown", () => {
    const model = compose(sources({ board: offlineSource(board([])) }));
    expect(model.availability).toMatchObject({ kind: "stale", reason: "offline" });
    expect(model.rooms).toEqual([]);
  });

  it("an answer older than the freshness window is demoted to stale by age", () => {
    const fresh = compose(sources({ board: board() }), NOW + STALE_AFTER_MS);
    expect(fresh.availability.kind).toBe("ready");
    const old = compose(sources({ board: board() }), NOW + STALE_AFTER_MS + 1);
    expect(old.availability).toMatchObject({ kind: "stale", reason: "age", verifiedAt: NOW });
    expect(isLive(old.availability)).toBe(false);
  });

  it("reports how long ago the board was last verified", () => {
    const model = compose(sources({ board: board() }), NOW + 90_000);
    expect(verifiedAgeMs(model.availability, NOW + 90_000)).toBe(90_000);
    expect(verifiedAgeMs({ kind: "loading" }, NOW)).toBeNull();
    expect(verifiedAgeMs({ kind: "unavailable", cause: "error", failure: null }, NOW)).toBeNull();
  });
});

describe("hotel date — previous-day data never appears as today's board", () => {
  it("a board requested for yesterday is previous_day and hides its rooms, however fresh", () => {
    const model = compose(sources({ board: board(hotelBoard(), "2026-10-15") }));
    expect(model.availability).toEqual({ kind: "previous_day", boardDate: "2026-10-15", hotelDate: HOTEL_DATE, verifiedAt: NOW });
    expect(model.rooms).toBeNull();
    expect(model.readiness).toBeNull();
    expect(isLive(model.availability)).toBe(false);
  });

  it("uses the HOTEL's calendar day, not the device's: 11 PM Chicago is already tomorrow in UTC", () => {
    const lateEvening = Date.parse("2026-10-17T04:30:00Z"); // 23:30 on 2026-10-16 in Chicago
    const model = compose(sources({ board: board(hotelBoard(), "2026-10-16", lateEvening) }), lateEvening);
    expect(model.hotelDate).toBe("2026-10-16");
    expect(model.availability.kind).toBe("ready");
  });

  it("crossing midnight in the hotel zone turns the held board into previous_day", () => {
    const before = Date.parse("2026-10-17T04:59:00Z"); // 23:59 CDT, still the 16th
    const after = Date.parse("2026-10-17T05:01:00Z"); // 00:01 CDT, the 17th
    const held = board(hotelBoard(), "2026-10-16", before);
    expect(compose(sources({ board: held }), before).availability.kind).toBe("ready");
    expect(compose(sources({ board: held }), after).availability).toMatchObject({ kind: "previous_day", boardDate: "2026-10-16", hotelDate: "2026-10-17" });
  });

  it("follows the daylight-saving change (CST after the fall-back)", () => {
    const november = Date.parse("2026-11-02T05:30:00Z"); // 23:30 CST on 2026-11-01 (after fall-back)
    expect(compose(sources(), november).hotelDate).toBe("2026-11-01");
  });

  it("an unstamped snapshot cannot be disproved, so it is not called previous-day", () => {
    const model = compose(sources({ board: availableSource(normalizeBoardRecords(hotelBoard()), NOW) }));
    expect(model.availability.kind).toBe("ready");
  });

  it("a stale board from yesterday is previous_day too (not 'stale today')", () => {
    const held = offlineSource(board(hotelBoard(), "2026-10-15"));
    expect(compose(sources({ board: held })).availability.kind).toBe("previous_day");
  });

  it("falls back to the default hotel zone — not the device — when no zone is known", () => {
    const model = composeRoomBoard(sources(), { now: Date.parse("2026-10-17T04:30:00Z"), timeZone: null });
    expect(model.timeZone).toBe("America/Chicago");
    expect(model.hotelDate).toBe("2026-10-16");
  });
});

describe("mutation gate — never act on data that cannot be trusted", () => {
  it("allows only a fresh verified board on a reachable server", () => {
    expect(evaluateMutationGate({ kind: "ready", verifiedAt: NOW }, true)).toEqual({ allowed: true, blockedBy: null });
    expect(evaluateMutationGate({ kind: "verified_empty", verifiedAt: NOW }, true).allowed).toBe(true);
  });

  it.each([
    [{ kind: "loading" } as const, true, "loading"],
    [{ kind: "stale", reason: "age", verifiedAt: NOW, failure: null } as const, true, "stale"],
    [{ kind: "unavailable", cause: "error", failure: null } as const, true, "unavailable"],
    [{ kind: "previous_day", boardDate: "2026-10-15", hotelDate: HOTEL_DATE, verifiedAt: NOW } as const, true, "previous_day"],
    [{ kind: "ready", verifiedAt: NOW } as const, false, "offline"],
  ])("blocks %j (online=%s) → %s", (availability, online, blockedBy) => {
    expect(evaluateMutationGate(availability, online)).toEqual({ allowed: false, blockedBy });
  });
});

describe("assignment — assigned ≠ named ≠ on shift", () => {
  const withBoard = (extra: Partial<RoomBoardSources> = {}) =>
    sources({
      board: board(),
      staff: availableSource(STAFF, NOW),
      roster: rosterOf([{ user_id: "hk-1", status: "active", started_at: "2026-10-16T12:00:00Z" }]),
      ...extra,
    });
  const view = (model: ReturnType<typeof compose>, number: string) => (model.rooms ?? []).find((v) => v.room.roomNumber === number)!;

  it("resolves the name and the verified attendance separately", () => {
    const model = compose(withBoard());
    expect(view(model, "102").assignee).toEqual({ userId: "hk-1", name: "Ana Torres", availability: "on_shift" });
    // hk-2 is on the staff list but absent from a VERIFIED roster → not clocked in (a fact), not unknown.
    expect(view(model, "104").assignee).toEqual({ userId: "hk-2", name: "Ben Ortiz", availability: "not_clocked_in" });
    expect(view(model, "101").assignee).toBeNull();
  });

  it("a missing display name never means unassigned", () => {
    const model = compose(withBoard({ staff: availableSource([STAFF[1]], NOW) }));
    const assigned = view(model, "102");
    expect(assigned.room.assignment.userId).toBe("hk-1");
    expect(assigned.assignee).toEqual({ userId: "hk-1", name: null, availability: "on_shift" });
  });

  it("a failed staff list leaves names unknown but rooms stay assigned", () => {
    const failedStaff = failedSource<typeof STAFF>(new Error("down"), loadingSource());
    const model = compose(withBoard({ staff: failedStaff }));
    expect(model.staffNamesKnown).toBe(false);
    expect(view(model, "102").assignee).toMatchObject({ userId: "hk-1", name: null });
    expect(model.readiness?.unassignedActionable).toBe(2); // 101 and 201, exactly as before
  });

  it("an active account is NOT on shift: availability is unknown whenever the roster is unverified", () => {
    for (const roster of [
      loadingSource<ReturnType<typeof normalizeRoster>>(),
      failedSource<ReturnType<typeof normalizeRoster>>(Object.assign(new Error("403"), { status: 403 }), loadingSource()),
      offlineSource(rosterOf([{ user_id: "hk-1", status: "active", started_at: "2026-10-16T12:00:00Z" }])),
    ]) {
      const model = compose(withBoard({ roster }));
      expect(model.rosterTrust === "verified").toBe(false);
      expect(view(model, "102").assignee?.availability).toBe("unknown");
      expect(model.staff.every((member) => member.availability === "unknown")).toBe(true);
    }
  });

  it("a verified empty roster says everyone is not clocked in", () => {
    const model = compose(withBoard({ roster: availableSource([], NOW, () => true) }));
    expect(model.rosterTrust).toBe("verified");
    expect(view(model, "102").assignee?.availability).toBe("not_clocked_in");
  });

  it("supports mirror-only assignments (no dated row) as assigned rooms", () => {
    const mirror = board([rawRoom("301", "DIRTY", { assigned_to: "hk-3", assignment_id: null })]);
    const model = compose(withBoard({ board: mirror }));
    const room = view(model, "301");
    expect(room.room.assignment.source).toBe("status_mirror");
    expect(room.assignee).toMatchObject({ userId: "hk-3", name: "Cara Reyes" });
    expect(model.readiness?.unassignedActionable).toBe(0);
  });

  it("availabilityFor / rosterTrustOf read the roster honestly", () => {
    const verified = rosterOf([{ user_id: "hk-1", status: "ended", started_at: "2026-10-16T12:00:00Z" }]);
    expect(rosterTrustOf(verified)).toBe("verified");
    expect(availabilityFor("hk-1", verified)).toBe("ended");
    expect(availabilityFor("hk-9", verified)).toBe("not_clocked_in");
    expect(availabilityFor("hk-1", loadingSource())).toBe("unknown");
  });

  it("counts each person's assigned and open rooms from the board", () => {
    const model = compose(withBoard());
    expect(model.staff.find((member) => member.userId === "hk-1")).toMatchObject({ assignedRooms: 2, openRooms: 2 });
    // hk-2 has 104 in progress (open) and 105 submitted (not open).
    expect(model.staff.find((member) => member.userId === "hk-2")).toMatchObject({ assignedRooms: 2, openRooms: 1 });
    expect(model.staff.find((member) => member.userId === "hk-3")).toMatchObject({ assignedRooms: 0, openRooms: 0 });
  });
});

describe("late checkouts are an independent source", () => {
  it("joins them when verified and reports them unknown (not none) when the request failed", () => {
    const late = availableSource([{ id: "l1", room_id: "room-102", status: "approved", requested_time: "2026-10-16T19:00:00Z" }], NOW);
    const ok = compose(sources({ board: board(), lateCheckouts: late }));
    expect(ok.lateCheckoutsKnown).toBe(true);
    expect(ok.rooms!.find((v) => v.room.roomNumber === "102")!.room.lateCheckout).toMatchObject({ status: "approved" });

    const failed = compose(sources({ board: board(), lateCheckouts: failedSource(new Error("x"), loadingSource()) }));
    expect(failed.lateCheckoutsKnown).toBe(false);
    expect(failed.availability.kind).toBe("ready"); // the board itself is unaffected
    expect(failed.rooms).toHaveLength(10);
  });
});

describe("readiness — correct denominator, identical to Supervisor Today", () => {
  it("excludes out-of-order rooms from the in-service denominator and never counts CLEAN as ready", () => {
    const { readiness } = compose(sources({ board: board() }));
    expect(readiness).toMatchObject({
      inventoryTotal: 10,
      outOfOrder: 3,
      inService: 7,
      ready: 1, // 106 only
      awaitingInspection: 1, // 105 (CLEAN)
      inProgress: 1,
      toClean: 4, // 101, 102, 103, 201
      unclassified: 0,
    });
    expect(readiness!.progress).toBeCloseTo(1 / 7);
  });

  it("counts an unrecognised status as unclassified, not as cleaned or dirty", () => {
    const { readiness } = compose(sources({ board: board([rawRoom("101", "INSPECTED"), rawRoom("102", "MYSTERY")]) }));
    expect(readiness).toMatchObject({ inService: 2, ready: 1, unclassified: 1 });
  });

  it("matches Supervisor Today's readiness exactly for the same shared sources", async () => {
    const fetchers = {
      board: async () => hotelBoard(),
      staff: async () => STAFF,
      roster: async () => [],
      inspections: async () => [],
      blockedTasks: async () => [],
    };
    const loaded = await loadTodaySources(initialTodaySources(), fetchers, { now: NOW, timeZone: ZONE, online: true });
    const today = composeSupervisorToday(loaded, { now: NOW, timeZone: ZONE });
    const model = composeRoomBoard(
      { board: loaded.board, staff: loaded.staff, roster: loaded.roster, lateCheckouts: loadingSource() },
      { now: NOW, timeZone: ZONE },
    );
    expect(model.readiness).toEqual(today.readiness.value);
    expect(model.hotelDate).toBe(today.hotelDate);
    // The loader stamped the snapshot with the hotel date it asked for.
    expect(loaded.board.status === "available" && loaded.board.data.forDate).toBe(HOTEL_DATE);
  });

  it("the 'behind schedule' cut-off follows the hotel clock, not the device's", () => {
    // 17:30 UTC = 12:30 in Chicago: before the hotel's 1 PM. A device clock that disagrees must not matter.
    const now = Date.parse("2026-10-16T17:30:00Z");
    const hours = jest.spyOn(Date.prototype, "getHours").mockReturnValue(15); // the phone thinks it is 3 PM
    try {
      const model = composeRoomBoard(sources({ board: board([rawRoom("101", "DIRTY")], HOTEL_DATE, now) }), { now, timeZone: ZONE });
      expect(model.readiness?.behindSchedule).toBe(0);
    } finally {
      hours.mockRestore();
    }
    // 18:30 UTC = 13:30 in Chicago: past 1 PM at the hotel, even if the phone says it is 9 AM.
    const later = Date.parse("2026-10-16T18:30:00Z");
    const early = jest.spyOn(Date.prototype, "getHours").mockReturnValue(9);
    try {
      const model = composeRoomBoard(sources({ board: board([rawRoom("101", "DIRTY")], HOTEL_DATE, later) }), { now: later, timeZone: ZONE });
      expect(model.readiness?.behindSchedule).toBe(1);
    } finally {
      early.mockRestore();
    }
  });

  it("surfaces unusable and duplicate rows so a short board is explainable", () => {
    const model = compose(sources({ board: board([rawRoom("101", "DIRTY"), rawRoom("101", "DIRTY"), { room_id: "x", status: "DIRTY" } as never]) }));
    expect(model.warnings).toEqual({ invalidRows: 1, duplicateRows: 1 });
  });
});

describe("resolveBoardAvailability", () => {
  it("is a pure read of the source against the hotel date", () => {
    const empty = availableSource(snapshot([]), NOW, () => true) as SourceState<ReturnType<typeof snapshot>>;
    expect(resolveBoardAvailability(empty, HOTEL_DATE).kind).toBe("verified_empty");
    expect(resolveBoardAvailability(loadingSource(), HOTEL_DATE).kind).toBe("loading");
  });
});
