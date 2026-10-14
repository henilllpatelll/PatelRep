import type { Room } from "@/stores/appStore";
import {
  STALE_AFTER_MS,
  boardIsWrongDay,
  isWrongDay,
  resolveBoardDate,
  resolveBoardState,
  resolveFreshness,
  roomsForShiftDate,
} from "@/lib/housekeeping/roomsFreshness";
import { buildSyncSummary } from "@/lib/housekeeping/homeSync";

function room(id: string, assignment_date: string | null): Room {
  return {
    id,
    room_number: id,
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    assignment_date,
  };
}

describe("shift-date scoping", () => {
  it("drops rooms assigned for another date and keeps undated ones", () => {
    const rooms = [room("1", "2026-10-14"), room("2", "2026-10-13"), room("3", null), room("4", "2026-10-14T00:00:00Z")];
    expect(roomsForShiftDate(rooms, "2026-10-14").map((r) => r.id)).toEqual(["1", "3", "4"]);
  });

  it("recognises a list that is entirely another day's", () => {
    expect(isWrongDay([room("1", "2026-10-13"), room("2", "2026-10-13")], "2026-10-14")).toBe(true);
    expect(isWrongDay([room("1", "2026-10-13"), room("2", "2026-10-14")], "2026-10-14")).toBe(false);
    expect(isWrongDay([room("1", null)], "2026-10-14")).toBe(false);
    expect(isWrongDay([], "2026-10-14")).toBe(false);
  });

  it("trusts the server's own date only while its answer is for today's calendar date", () => {
    expect(resolveBoardDate("2026-10-14", "2026-10-13", "2026-10-14")).toBe("2026-10-13");
    expect(resolveBoardDate("2026-10-14", "2026-10-13", "2026-10-13")).toBe("2026-10-14");
    expect(resolveBoardDate("2026-10-14", null, null)).toBe("2026-10-14");
  });

  it("calls the list wrong once the calendar rolled past the day it was fetched for", () => {
    const rooms = [room("1", "2026-10-13")];
    expect(boardIsWrongDay(rooms, "2026-10-14", "2026-10-13", "2026-10-13")).toBe(true);
    // Server fell back to its own date for today's request: fine.
    expect(boardIsWrongDay(rooms, "2026-10-14", "2026-10-13", "2026-10-14")).toBe(false);
    // Even a list dated "today" is stale if it was fetched for yesterday's calendar day.
    expect(boardIsWrongDay([room("1", "2026-10-14")], "2026-10-14", "2026-10-14", "2026-10-13")).toBe(true);
  });
});

describe("resolveBoardState", () => {
  const base = { loading: false, roomCount: 0, wrongDay: false, confirmedEmpty: false };

  it("a failed or unverified empty list is unavailable, not empty", () => {
    expect(resolveBoardState(base)).toBe("unavailable");
  });
  it("empty needs a server answer that said so", () => {
    expect(resolveBoardState({ ...base, confirmedEmpty: true })).toBe("empty");
  });
  it("shows rooms whenever there are any", () => {
    expect(resolveBoardState({ ...base, roomCount: 3 })).toBe("ready");
    expect(resolveBoardState({ ...base, roomCount: 3, confirmedEmpty: true })).toBe("ready");
  });
  it("loading beats empty/unavailable but not rooms", () => {
    expect(resolveBoardState({ ...base, loading: true })).toBe("loading");
    expect(resolveBoardState({ ...base, loading: true, roomCount: 2 })).toBe("loading");
  });
  it("a wrong-day list outranks everything", () => {
    expect(resolveBoardState({ ...base, wrongDay: true, roomCount: 4, loading: true })).toBe("stale_date");
  });
});

describe("resolveFreshness", () => {
  const now = 1_000_000_000;
  it("is fresh right after a successful refresh", () => {
    expect(resolveFreshness({ lastRefreshAt: now - 5_000, fetchFailed: false, hasRooms: true, now })).toBe("fresh");
  });
  it("is stale when old, or when the latest refresh failed", () => {
    expect(resolveFreshness({ lastRefreshAt: now - STALE_AFTER_MS - 1, fetchFailed: false, hasRooms: true, now })).toBe("stale");
    expect(resolveFreshness({ lastRefreshAt: now - 1_000, fetchFailed: true, hasRooms: true, now })).toBe("stale");
  });
  it("is cached with rooms but no refresh yet, and never with nothing", () => {
    expect(resolveFreshness({ lastRefreshAt: null, fetchFailed: false, hasRooms: true, now })).toBe("cached");
    expect(resolveFreshness({ lastRefreshAt: null, fetchFailed: false, hasRooms: false, now })).toBe("never");
  });
});

describe("buildSyncSummary", () => {
  const base = { isOnline: true, freshness: "fresh" as const, lastRefreshAt: 0, fetchFailed: false, rows: [], rowsComplete: true };

  it("is synced only when online, fresh, and nothing waits", () => {
    expect(buildSyncSummary(base).status).toBe("synced");
  });
  it("offline outranks pending, and attention outranks offline", () => {
    const rows = [{ key: "a", roomId: "1", kind: "checklist" as const, state: "pending" as const, count: 2 }];
    expect(buildSyncSummary({ ...base, isOnline: false, rows }).status).toBe("offline");
    const failed = [...rows, { key: "b", roomId: "1", kind: "linen" as const, state: "failed" as const }];
    expect(buildSyncSummary({ ...base, isOnline: false, rows: failed }).status).toBe("attention");
  });
  it("reports old or cached room data when everything else is sent", () => {
    expect(buildSyncSummary({ ...base, freshness: "stale" }).status).toBe("stale");
    expect(buildSyncSummary({ ...base, freshness: "cached", lastRefreshAt: null }).status).toBe("stale");
    expect(buildSyncSummary({ ...base, freshness: "never", lastRefreshAt: null }).status).toBe("unknown");
  });
  it("counts each checklist edit and distinguishes retrying from failed", () => {
    const rows = [
      { key: "a", roomId: "1", kind: "checklist" as const, state: "pending" as const, count: 3 },
      { key: "b", roomId: "2", kind: "completion" as const, state: "retrying" as const },
    ];
    const summary = buildSyncSummary({ ...base, rows });
    expect(summary.pending).toBe(4);
    expect(summary.failed).toBe(0);
    expect(summary.completionsAwaitingConfirmation).toBe(1);
  });
});
