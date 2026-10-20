import { AppState } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/supabase", () => ({
  supabase: { channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnValue({}) }), removeChannel: jest.fn() },
}));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoardVerified: jest.fn(),
  fetchAssignableStaff: jest.fn(),
  fetchShiftRoster: jest.fn(),
  fetchInspectionHistory: jest.fn(),
  fetchLateCheckoutsVerified: jest.fn(),
}));
jest.mock("@/lib/api/tasks", () => ({ fetchBlockedTasks: jest.fn() }));

const mockSubscribe = jest.fn();
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({
  subscribeSupervisorRealtime: (...args: unknown[]) => mockSubscribe(...args),
  REALTIME_DEBOUNCE_MS: 1500,
}));

const mockState: {
  user: { id: string; tenant_id: string; role: string } | null;
  isOnline: boolean;
  hotelTimezone: string | null;
} = { user: { id: "sup-1", tenant_id: "hotel-1", role: "housekeeping_supervisor" }, isOnline: true, hotelTimezone: "America/Chicago" };
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockState) : mockState),
}));

import { useRoomBoard } from "@/lib/housekeeping/useRoomBoard";
import { STALE_AFTER_MS } from "@/lib/housekeeping/roomsFreshness";
import type { TodayFetchers } from "@/lib/housekeeping/supervisorToday";
import { acquireTodayStore } from "@/stores/supervisorTodayStore";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const T0 = Date.parse("2026-10-16T17:00:00Z"); // 12:00 in Chicago

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFetchers(overrides: Partial<TodayFetchers> = {}): jest.Mocked<TodayFetchers> {
  return {
    board: jest.fn(async () => hotelBoard()),
    staff: jest.fn(async () => STAFF),
    roster: jest.fn(async () => []),
    inspections: jest.fn(async () => []),
    blockedTasks: jest.fn(async () => []),
    ...overrides,
  } as jest.Mocked<TodayFetchers>;
}

let appStateHandlers: Array<(state: string) => void> = [];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(T0);
  mockSubscribe.mockReset();
  mockSubscribe.mockReturnValue(jest.fn());
  mockState.user = { id: "sup-1", tenant_id: "hotel-1", role: "housekeeping_supervisor" };
  mockState.isOnline = true;
  mockState.hotelTimezone = "America/Chicago";
  appStateHandlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, handler: (state: string) => void) => {
    appStateHandlers.push(handler);
    return { remove: jest.fn() };
  }) as never);
});

afterEach(() => {
  acquireTodayStore()(); // empty the shared snapshot between tests
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const lateOk = () => jest.fn(async () => []);

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useRoomBoard — loading and trust", () => {
  it("loads the board from the shared fetch path and reports it verified", async () => {
    const fetchers = makeFetchers();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    expect(result.current.model.availability.kind).toBe("loading");
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    expect(result.current.model.rooms).toHaveLength(10);
    expect(result.current.model.hotelDate).toBe("2026-10-16");
    expect(fetchers.board).toHaveBeenCalledWith("2026-10-16"); // hotel date, not the device's
    expect(result.current.gate).toEqual({ allowed: true, blockedBy: null });
  });

  it("a failed load is unavailable — never an empty board — and a retry recovers", async () => {
    const fetchers = makeFetchers({ board: jest.fn().mockRejectedValueOnce(Object.assign(new Error("down"), { status: 503 })).mockResolvedValue(hotelBoard()) });
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("unavailable"));
    expect(result.current.model.rooms).toBeNull();
    expect(result.current.gate.allowed).toBe(false);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.model.availability.kind).toBe("ready");
    expect(result.current.model.rooms).toHaveLength(10);
  });

  it("a rows-but-none-usable answer is a broken answer, not an empty hotel", async () => {
    const fetchers = makeFetchers({ board: jest.fn(async () => [{ room_id: "x", status: "DIRTY" }] as never) });
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("unavailable"));
  });

  it("verified empty is distinct from failed", async () => {
    const fetchers = makeFetchers({ board: jest.fn(async () => []) });
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("verified_empty"));
    expect(result.current.model.rooms).toEqual([]);
  });

  it("offline with nothing cached: unavailable (offline), nothing fetched, changes blocked", async () => {
    mockState.isOnline = false;
    const fetchers = makeFetchers();
    const late = lateOk();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: late }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("unavailable"));
    expect(result.current.model.availability).toMatchObject({ cause: "offline" });
    expect(fetchers.board).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
    expect(result.current.gate).toEqual({ allowed: false, blockedBy: "offline" });
  });

  it("going offline after a good load keeps the board as stale and pauses changes", async () => {
    const fetchers = makeFetchers();
    const { result, rerender } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    mockState.isOnline = false;
    rerender({});
    await waitFor(() => expect(result.current.model.availability.kind).toBe("stale"));
    expect(result.current.model.availability).toMatchObject({ reason: "offline", verifiedAt: T0 });
    expect(result.current.model.rooms).toHaveLength(10);
    expect(result.current.gate.allowed).toBe(false);
  });

  it("a failed refresh keeps the verified board (stale) without renewing its time", async () => {
    const board = jest.fn().mockResolvedValueOnce(hotelBoard()).mockRejectedValue(new Error("boom"));
    const fetchers = makeFetchers({ board });
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    jest.setSystemTime(T0 + 30_000);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.model.availability).toMatchObject({ kind: "stale", reason: "refresh_failed", verifiedAt: T0 });
    expect(result.current.model.rooms).toHaveLength(10);
    expect(result.current.gate.blockedBy).toBe("stale");
  });

  it("ages a quiet board into stale instead of leaving it looking live", async () => {
    const fetchers = makeFetchers();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    await act(async () => {
      jest.advanceTimersByTime(STALE_AFTER_MS + 61_000);
    });
    expect(result.current.model.availability).toMatchObject({ kind: "stale", reason: "age", verifiedAt: T0 });
  });

  it("a late-checkout failure never blanks the board; those rooms are just 'unknown'", async () => {
    const fetchers = makeFetchers();
    const late = jest.fn().mockRejectedValue(new Error("late down"));
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: late }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    await waitFor(() => expect(late).toHaveBeenCalled());
    expect(result.current.model.lateCheckoutsKnown).toBe(false);
    expect(result.current.model.rooms).toHaveLength(10);
  });

  it("joins verified late checkouts onto rooms", async () => {
    const fetchers = makeFetchers();
    const late = jest.fn(async () => [{ id: "l1", room_id: "room-102", status: "approved", requested_time: "2026-10-16T19:00:00Z" }]);
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: late }));
    await waitFor(() => expect(result.current.model.lateCheckoutsKnown).toBe(true));
    const room = result.current.model.rooms!.find((view) => view.room.roomNumber === "102")!;
    expect(room.room.lateCheckout).toMatchObject({ status: "approved" });
  });
});

describe("useRoomBoard — races, scopes and the clock", () => {
  it("out-of-order responses: the newest request's answer always wins", async () => {
    const first = deferred<ReturnType<typeof hotelBoard>>();
    const board = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => [rawRoom("501", "INSPECTED")]);
    const fetchers = makeFetchers({ board });
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await settle();
    // While the first (slow) request is in flight, a newer refresh is requested…
    let second!: Promise<void>;
    act(() => {
      second = result.current.refresh();
    });
    // …and the old one finally lands with different content.
    first.resolve(hotelBoard());
    await act(async () => {
      await second;
    });
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    expect(result.current.model.rooms!.map((view) => view.room.roomNumber)).toEqual(["501"]);
    expect(board).toHaveBeenCalledTimes(2); // in-flight + ONE coalesced follow-up
  });

  it("switching account/hotel: nothing from the previous scope is shown, and its late answer is discarded", async () => {
    const hotel1 = deferred<ReturnType<typeof hotelBoard>>();
    const fetchers = makeFetchers({
      board: jest.fn(async () => {
        if (mockState.user?.tenant_id === "hotel-1") return hotel1.promise;
        return [rawRoom("900", "DIRTY")];
      }),
    });
    const { result, rerender } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await settle();
    expect(result.current.model.availability.kind).toBe("loading");

    mockState.user = { id: "sup-9", tenant_id: "hotel-2", role: "housekeeping_supervisor" };
    rerender({});
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    expect(result.current.model.rooms!.map((view) => view.room.roomNumber)).toEqual(["900"]);

    // Hotel 1's slow answer arrives now. It must not replace hotel 2's board.
    hotel1.resolve(hotelBoard());
    await settle();
    expect(result.current.model.rooms!.map((view) => view.room.roomNumber)).toEqual(["900"]);
  });

  it("a scope change reads as 'nothing loaded' (never the old hotel's rooms) until its own answer arrives", async () => {
    const hotel2 = deferred<ReturnType<typeof hotelBoard>>();
    const fetchers = makeFetchers({
      board: jest.fn(async () => (mockState.user?.tenant_id === "hotel-1" ? hotelBoard() : hotel2.promise)),
    });
    const { result, rerender } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    mockState.user = { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" };
    rerender({});
    expect(result.current.model.availability.kind).toBe("loading");
    expect(result.current.model.rooms).toBeNull();
    hotel2.resolve([rawRoom("700", "DIRTY")]);
    await waitFor(() => expect(result.current.model.rooms?.map((v) => v.room.roomNumber)).toEqual(["700"]));
  });

  it("no signed-in hotel: nothing is fetched into a shared scope", async () => {
    mockState.user = null;
    const fetchers = makeFetchers();
    const late = lateOk();
    renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: late }));
    await settle();
    expect(late).not.toHaveBeenCalled();
    expect(fetchers.board).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("midnight in the HOTEL's zone: yesterday's board is hidden, then re-requested for the new date", async () => {
    jest.setSystemTime(Date.parse("2026-10-17T04:58:00Z")); // 23:58 on the 16th in Chicago (already the 17th in UTC)
    const fetchers = makeFetchers();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    expect(fetchers.board).toHaveBeenLastCalledWith("2026-10-16");

    // Hold the next answer so we can see the moment between midnight and the new board.
    const next = deferred<ReturnType<typeof hotelBoard>>();
    fetchers.board.mockImplementation(() => next.promise);
    await act(async () => {
      jest.setSystemTime(Date.parse("2026-10-17T05:02:00Z")); // 00:02 on the 17th
      jest.advanceTimersByTime(60_000); // the hook's clock tick
    });
    await waitFor(() => expect(fetchers.board).toHaveBeenLastCalledWith("2026-10-17"));
    expect(result.current.model.hotelDate).toBe("2026-10-17");
    expect(result.current.model.availability).toMatchObject({ kind: "previous_day", boardDate: "2026-10-16" });
    expect(result.current.model.rooms).toBeNull();
    expect(result.current.gate.allowed).toBe(false);

    await act(async () => {
      next.resolve([rawRoom("101", "DIRTY")]);
    });
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    expect(result.current.model.rooms).toHaveLength(1);
  });

  it("coming back from the background refreshes a stale board, and leaves a fresh one alone", async () => {
    const fetchers = makeFetchers();
    const late = lateOk();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: late }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    const loads = fetchers.board.mock.calls.length;

    await act(async () => appStateHandlers.forEach((handler) => handler("active")));
    await settle();
    expect(fetchers.board.mock.calls.length).toBe(loads); // still fresh → no refetch

    jest.setSystemTime(T0 + STALE_AFTER_MS + 5_000);
    await act(async () => appStateHandlers.forEach((handler) => handler("active")));
    await waitFor(() => expect(fetchers.board.mock.calls.length).toBe(loads + 1));
    expect(late.mock.calls.length).toBeGreaterThan(1);
  });

  it("ignores AppState changes that are not 'active'", async () => {
    const fetchers = makeFetchers();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    jest.setSystemTime(T0 + STALE_AFTER_MS + 5_000);
    const loads = fetchers.board.mock.calls.length;
    await act(async () => appStateHandlers.forEach((handler) => handler("background")));
    await settle();
    expect(fetchers.board.mock.calls.length).toBe(loads);
  });
});

describe("useRoomBoard — realtime", () => {
  it("registers ONE hotel-scoped subscription and releases it on unmount", async () => {
    const release = jest.fn();
    mockSubscribe.mockReturnValue(release);
    const fetchers = makeFetchers();
    const { unmount, rerender } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await settle();
    rerender({});
    rerender({});
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith("hotel-1", expect.any(Function));
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a realtime event refreshes the board AND late checkouts through the shared path", async () => {
    let onEvent: (() => void | Promise<void>) | null = null;
    mockSubscribe.mockImplementation((_tenant: string, cb: () => void) => {
      onEvent = cb;
      return jest.fn();
    });
    const fetchers = makeFetchers();
    const late = lateOk();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: late }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    const loads = fetchers.board.mock.calls.length;
    const lateLoads = late.mock.calls.length;
    await act(async () => {
      await onEvent?.();
    });
    expect(fetchers.board.mock.calls.length).toBe(loads + 1);
    expect(late.mock.calls.length).toBe(lateLoads + 1);
  });

  it("a dead channel cannot make old data look current: freshness is by age", async () => {
    mockSubscribe.mockReturnValue(jest.fn()); // channel registered but never delivers anything
    const fetchers = makeFetchers();
    const { result } = renderHook(() => useRoomBoard({ fetchers, fetchLateCheckouts: lateOk() }));
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    await act(async () => {
      jest.advanceTimersByTime(STALE_AFTER_MS + 61_000);
    });
    expect(result.current.model.availability.kind).toBe("stale");
  });
});
