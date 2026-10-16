import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { Room } from "@/stores/appStore";

const mockSetMyRooms = jest.fn((rooms: Room[]) => {
  mockStore.myRooms = rooms;
});
const mockSetHotelTimezone = jest.fn();
const mockStore: {
  isOnline: boolean;
  myRooms: Room[];
  setMyRooms: jest.Mock;
  user: { id: string; tenant_id: string } | null;
  hotelTimezone: string | null;
  setHotelTimezone: jest.Mock;
} = {
  isOnline: true,
  myRooms: [],
  setMyRooms: mockSetMyRooms,
  user: { id: "user-1", tenant_id: "hotel-1" },
  hotelTimezone: "America/Chicago",
  setHotelTimezone: mockSetHotelTimezone,
};

const mockApiGet = jest.fn();
const mockGetRoomsByDate = jest.fn();
const mockUpsertRooms = jest.fn();
const mockClearRoomsCache = jest.fn();

jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockApiGet(...args) } }));
jest.mock("@/lib/offline/db", () => ({
  getRoomsByDate: (...args: unknown[]) => mockGetRoomsByDate(...args),
  upsertRooms: (...args: unknown[]) => mockUpsertRooms(...args),
  clearRoomsCache: (...args: unknown[]) => mockClearRoomsCache(...args),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: Object.assign(
    (selector?: (state: typeof mockStore) => unknown) => (selector ? selector(mockStore) : mockStore),
    { getState: () => mockStore },
  ),
}));
jest.mock("@/stores/cleanSessionStore", () => ({ useCleanSessionStore: { getState: () => ({}) } }));

import { acceptRoomsResult, fetchMyRooms, resetRoomsRequestState } from "@/lib/housekeeping/roomsRequest";
import { readRoomsCache, writeRoomsCache } from "@/lib/housekeeping/roomsCache";
import { useMyRoomsData } from "@/lib/housekeeping/useMyRoomsData";
import { resetRoomsStatus, useRoomsStatus } from "@/stores/roomsStatusStore";

const STAMP_KEY = "@patelrep/rooms_cache_scope";
const SCOPE = "hotel-1:user-1";

function room(id: string, assignment_date = "2026-10-14", overrides: Partial<Room> = {}): Room {
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
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  // The fixtures are dated 2026-10-14 and the hook drops a server answer for a day that is already over, so
  // pin ONLY the wall clock (timers stay real) to that day instead of whatever day the suite happens to run.
  jest.useFakeTimers({
    now: new Date("2026-10-14T18:00:00Z"),
    doNotFake: [
      "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
      "nextTick", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
      "requestIdleCallback", "cancelIdleCallback", "performance", "hrtime",
    ],
  });
  resetRoomsStatus();
  resetRoomsRequestState();
  await AsyncStorage.clear();
  mockStore.isOnline = true;
  mockStore.myRooms = [];
  mockStore.user = { id: "user-1", tenant_id: "hotel-1" };
  mockStore.hotelTimezone = "America/Chicago";
  mockGetRoomsByDate.mockResolvedValue([]);
  mockUpsertRooms.mockResolvedValue(undefined);
  mockClearRoomsCache.mockResolvedValue(undefined);
});

describe("shared my-rooms request", () => {
  it("makes one request for overlapping callers", async () => {
    const d = deferred<{ data: Room[] }>();
    mockApiGet.mockReturnValue(d.promise);
    const a = fetchMyRooms(SCOPE, "2026-10-14");
    const b = fetchMyRooms(SCOPE, "2026-10-14");
    expect(a).toBe(b);
    d.resolve({ data: [room("101")] });
    await a;
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    // Once settled, the next call is a fresh request.
    mockApiGet.mockResolvedValue({ data: [] });
    await fetchMyRooms(SCOPE, "2026-10-14");
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it("does not share a request between people or dates", async () => {
    mockApiGet.mockResolvedValue({ data: [] });
    await Promise.all([
      fetchMyRooms("hotel-1:user-1", "2026-10-14"),
      fetchMyRooms("hotel-1:user-2", "2026-10-14"),
      fetchMyRooms("hotel-1:user-1", "2026-10-15"),
    ]);
    expect(mockApiGet).toHaveBeenCalledTimes(3);
  });

  it("rejects an older response after a newer one was applied", async () => {
    const slow = deferred<{ data: Room[] }>();
    mockApiGet.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ data: [room("fresh")] });
    const older = fetchMyRooms(SCOPE, "2026-10-14");
    const newer = fetchMyRooms(SCOPE, "2026-10-15");
    const newerResult = await newer;
    expect(acceptRoomsResult(newerResult.seq)).toBe(true);

    slow.resolve({ data: [room("stale")] });
    const olderResult = await older;
    expect(olderResult.seq).toBeLessThan(newerResult.seq);
    expect(acceptRoomsResult(olderResult.seq)).toBe(false);
  });

  it("carries the server's resolved date and zone", async () => {
    mockApiGet.mockResolvedValue({ data: [], meta: { timezone: "America/New_York", shift_date: "2026-10-13" } });
    const result = await fetchMyRooms(SCOPE, "2026-10-14");
    expect(result).toMatchObject({ timezone: "America/New_York", shiftDate: "2026-10-13", requestedDate: "2026-10-14", scope: SCOPE });
  });
});

describe("scoped room cache", () => {
  it("returns nothing for a cache it did not write for this person", async () => {
    mockGetRoomsByDate.mockResolvedValue([room("101")]);
    expect(await readRoomsCache(SCOPE, "2026-10-14")).toEqual([]); // no stamp: unknown owner
    await AsyncStorage.setItem(STAMP_KEY, "hotel-2:user-9");
    expect(await readRoomsCache(SCOPE, "2026-10-14")).toEqual([]); // someone else's
    await AsyncStorage.setItem(STAMP_KEY, SCOPE);
    expect(await readRoomsCache(SCOPE, "2026-10-14")).toHaveLength(1);
  });

  it("replaces another person's cache instead of mixing with it", async () => {
    await AsyncStorage.setItem(STAMP_KEY, "hotel-2:user-9");
    await writeRoomsCache(SCOPE, [room("101")], "2026-10-14");
    expect(mockClearRoomsCache).toHaveBeenCalledTimes(1);
    expect(mockUpsertRooms).toHaveBeenCalledWith([expect.objectContaining({ id: "101" })], { replaceDate: "2026-10-14" });
    expect(await AsyncStorage.getItem(STAMP_KEY)).toBe(SCOPE);
  });

  it("keeps the cache when the same person writes again", async () => {
    await AsyncStorage.setItem(STAMP_KEY, SCOPE);
    await writeRoomsCache(SCOPE, [room("101")], "2026-10-14");
    expect(mockClearRoomsCache).not.toHaveBeenCalled();
  });

  it("never reads or writes without a signed-in person", async () => {
    expect(await readRoomsCache(null, "2026-10-14")).toEqual([]);
    await writeRoomsCache(null, [room("101")], "2026-10-14");
    expect(mockUpsertRooms).not.toHaveBeenCalled();
  });
});

describe("useMyRoomsData", () => {
  it("loads rooms for the hotel's date and stamps the cache", async () => {
    mockApiGet.mockResolvedValue({ data: [room("101")], meta: { timezone: "America/Chicago", shift_date: "2026-10-14" } });
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockStore.myRooms.map((r) => r.id)).toEqual(["101"]);
    expect(result.current.fetchError).toBeNull();
    expect(result.current.hasConfirmedFetch).toBe(true);
    expect(result.current.freshness).toBe("fresh");
    await waitFor(() => expect(mockUpsertRooms).toHaveBeenCalled());
    expect(await AsyncStorage.getItem(STAMP_KEY)).toBe(SCOPE);
  });

  it("says empty only after the server answered with no rooms", async () => {
    mockApiGet.mockResolvedValue({ data: [], meta: { shift_date: "2026-10-14" } });
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(result.current.boardState).toBe("empty"));
    expect(result.current.confirmedEmpty).toBe(true);
  });

  it("does not turn a failed request into an empty board", async () => {
    mockApiGet.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.fetchError).toBe("network down");
    expect(result.current.confirmedEmpty).toBe(false);
    expect(result.current.boardState).toBe("unavailable");
    expect(result.current.hasConfirmedFetch).toBe(false);
  });

  it("keeps the rooms on screen, marked stale, when a refresh fails", async () => {
    mockStore.myRooms = [room("101", "2026-10-14")];
    mockApiGet.mockResolvedValueOnce({ data: [room("101")], meta: { shift_date: "2026-10-14" } });
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(result.current.freshness).toBe("fresh"));

    mockApiGet.mockRejectedValue(new Error("timeout"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(mockStore.myRooms.map((r) => r.id)).toEqual(["101"]);
    expect(result.current.fetchError).toBe("timeout");
    expect(result.current.usingCache).toBe(true);
    expect(result.current.freshness).toBe("stale");
    expect(result.current.boardState).toBe("ready");
  });

  it("falls back to this person's cache when the request fails", async () => {
    await AsyncStorage.setItem(STAMP_KEY, SCOPE);
    mockGetRoomsByDate.mockResolvedValue([room("cached")]);
    mockApiGet.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(mockStore.myRooms.map((r) => r.id)).toEqual(["cached"]));
    expect(result.current.freshness).toBe("cached");
  });

  it("reads the device cache without calling the server when offline", async () => {
    mockStore.isOnline = false;
    await AsyncStorage.setItem(STAMP_KEY, SCOPE);
    mockGetRoomsByDate.mockResolvedValue([room("cached")]);
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(mockStore.myRooms.map((r) => r.id)).toEqual(["cached"]));
    expect(mockApiGet).not.toHaveBeenCalled();
    expect(result.current.usingCache).toBe(true);
    expect(result.current.fetchError).toBeNull();
    expect(result.current.hasConfirmedFetch).toBe(false);
  });

  it("does not show another hotel's or person's cached rooms", async () => {
    mockStore.isOnline = false;
    await AsyncStorage.setItem(STAMP_KEY, "hotel-2:user-9");
    mockGetRoomsByDate.mockResolvedValue([room("someone-elses")]);
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockStore.myRooms).toEqual([]);
    // And offline with nothing trustworthy is "unavailable", not "all done".
    expect(result.current.boardState).toBe("unavailable");
  });

  it("starts from a clean status when a different person signs in", async () => {
    mockApiGet.mockResolvedValue({ data: [room("101")], meta: { shift_date: "2026-10-14" } });
    const { result, rerender } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(result.current.hasConfirmedFetch).toBe(true));

    const second = deferred<{ data: Room[]; meta?: { shift_date: string } }>();
    mockApiGet.mockReturnValue(second.promise);
    mockStore.user = { id: "user-2", tenant_id: "hotel-2" };
    mockStore.myRooms = [];
    rerender({});
    await waitFor(() => expect(useRoomsStatus.getState().scope).toBe("hotel-2:user-2"));
    expect(useRoomsStatus.getState().lastRefreshAt).toBeNull();
    expect(result.current.hasConfirmedFetch).toBe(false);
    second.resolve({ data: [], meta: { shift_date: "2026-10-14" } });
    await waitFor(() => expect(result.current.hasConfirmedFetch).toBe(true));
  });

  it("drops a response that lands after the person changed", async () => {
    const slow = deferred<{ data: Room[]; meta: { shift_date: string } }>();
    mockApiGet.mockReturnValueOnce(slow.promise);
    const { rerender } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));

    mockApiGet.mockResolvedValue({ data: [], meta: { shift_date: "2026-10-14" } });
    mockStore.user = { id: "user-2", tenant_id: "hotel-2" };
    rerender({});
    await waitFor(() => expect(useRoomsStatus.getState().scope).toBe("hotel-2:user-2"));

    await act(async () => {
      slow.resolve({ data: [room("previous-users-room")], meta: { shift_date: "2026-10-14" } });
    });
    expect(mockStore.myRooms.map((r) => r.id)).not.toContain("previous-users-room");
  });

  it("does not request anything when disabled (non-housekeeper roles)", async () => {
    renderHook(() => useMyRoomsData({ enabled: false }));
    await act(async () => undefined);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it("applies a reassignment on the next refresh: rooms added and removed", async () => {
    mockApiGet.mockResolvedValueOnce({ data: [room("101"), room("102")], meta: { shift_date: "2026-10-14" } });
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(mockStore.myRooms.map((r) => r.id)).toEqual(["101", "102"]));

    mockApiGet.mockResolvedValueOnce({ data: [room("102"), room("103")], meta: { shift_date: "2026-10-14" } });
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockStore.myRooms.map((r) => r.id)).toEqual(["102", "103"]);
  });

  it("re-ranks only on a deliberate refresh or when the set of rooms changes, not on every poll", async () => {
    jest.useFakeTimers();
    mockApiGet.mockResolvedValue({ data: [room("101")], meta: { shift_date: "2026-10-14" } });
    const { result } = renderHook(() => useMyRoomsData());
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.hasConfirmedFetch).toBe(true));
    const firstRank = result.current.rankedAt.getTime();

    // A later poll with the same rooms must not move the ranking clock.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.rankedAt.getTime()).toBe(firstRank);

    // A pull-to-refresh does.
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await result.current.refresh();
    });
    expect(result.current.rankedAt.getTime()).toBeGreaterThan(firstRank);
  });

  it("ignores an answer for a day that ended while the request was out, then asks again for the new day", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-15T04:59:30.000Z")); // 11:59:30 PM CDT on the 14th
    const first = deferred<{ data: Room[]; meta: { shift_date: string } }>();
    mockApiGet.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-10-14"));

    jest.setSystemTime(new Date("2026-10-15T05:00:30.000Z")); // past midnight in Chicago
    mockApiGet.mockResolvedValueOnce({ data: [room("201", "2026-10-15")], meta: { shift_date: "2026-10-15" } });
    await act(async () => {
      first.resolve({ data: [room("101", "2026-10-14")], meta: { shift_date: "2026-10-14" } });
    });

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-10-15"));
    await waitFor(() => expect(mockStore.myRooms.map((r) => r.id)).toEqual(["201"]));
    expect(result.current.expectedShiftDate).toBe("2026-10-15");
    expect(result.current.boardState).toBe("ready");
  });

  it("reports yesterday's list as the wrong day once the hotel's date rolls over", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-14T20:00:00.000Z"));
    mockApiGet.mockResolvedValue({ data: [room("101", "2026-10-14")], meta: { shift_date: "2026-10-14" } });
    const { result } = renderHook(() => useMyRoomsData());
    await waitFor(() => expect(result.current.boardState).toBe("ready"));

    // Midnight passes while offline: nothing new can be fetched.
    mockStore.isOnline = false;
    jest.setSystemTime(new Date("2026-10-15T06:00:00.000Z"));
    mockApiGet.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.expectedShiftDate).toBe("2026-10-15");
    // The day-old list is replaced by whatever the device cached for today (nothing), never kept as today's work.
    expect(mockStore.myRooms).toEqual([]);
    expect(result.current.boardState).toBe("unavailable");
  });
});
