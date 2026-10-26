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
  fetchWorkloadSettings: jest.fn(),
  fetchScheduledShifts: jest.fn(),
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

import { SCHEDULE_STALE_AFTER_MS, SETTINGS_STALE_AFTER_MS } from "@/lib/housekeeping/assignmentModel";
import { estimateKey, useEstimateTable } from "@/lib/housekeeping/estimateTable";
import type { ScheduledShift } from "@/lib/housekeeping/assignmentSchedule";
import type { WorkloadSettings } from "@/lib/housekeeping/assignmentWorkload";
import type { TodayFetchers } from "@/lib/housekeeping/supervisorToday";
import { useAssignments } from "@/lib/housekeeping/useAssignments";
import { acquireTodayStore } from "@/stores/supervisorTodayStore";
import { SETTINGS, shift } from "../helpers/assignmentFixtures";
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
  acquireTodayStore()();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const lateOk = () => jest.fn(async () => []);
const settingsOk = () => jest.fn(async (_hotelId: string): Promise<WorkloadSettings> => SETTINGS);
const scheduleOk = () => jest.fn(async (_date: string): Promise<ScheduledShift[]> => [shift("hk-1")]);

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setup(over: Partial<Parameters<typeof useAssignments>[0]> = {}) {
  const fetchers = makeFetchers();
  const fetchSettings = settingsOk();
  const fetchSchedule = scheduleOk();
  const options = { fetchers, fetchLateCheckouts: lateOk(), fetchSettings, fetchSchedule, ...over };
  const hook = renderHook(() => useAssignments(options));
  return { ...hook, fetchers, fetchSettings, fetchSchedule };
}

describe("useAssignments — loading", () => {
  it("loads the board from the shared path plus settings and the schedule, for the hotel's date", async () => {
    const { result, fetchers, fetchSettings, fetchSchedule } = setup();
    expect(result.current.model.availability.kind).toBe("loading");
    await waitFor(() => expect(result.current.model.settings.trust).toBe("verified"));
    await waitFor(() => expect(result.current.model.schedule.trust).toBe("verified"));
    expect(result.current.model.rooms).toHaveLength(10);
    expect(result.current.scopeKey).toBe("hotel-1:sup-1");
    expect(fetchers.board).toHaveBeenCalledWith("2026-10-16");
    expect(fetchSettings).toHaveBeenCalledWith("hotel-1"); // the signed-in hotel
    expect(fetchSchedule).toHaveBeenCalledWith("2026-10-16"); // the hotel's date, not the device's
    expect(result.current.gate).toEqual({ allowed: true, blockedBy: null });
  });

  it("reuses the shared board: one board fetch and ONE realtime channel, no matter how many sources", async () => {
    const { result, fetchers } = setup();
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    await settle();
    expect(fetchers.board).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith("hotel-1", expect.any(Function));
  });

  it("an unreadable settings response leaves every room, owner and estimate intact", async () => {
    const fetchSettings = jest.fn().mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
    const { result } = setup({ fetchSettings });
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    await settle();
    expect(result.current.model.settings).toMatchObject({ trust: "unknown", value: null });
    expect(result.current.model.rooms).toHaveLength(10);
    expect(result.current.model.team?.find((member) => member.userId === "hk-1")?.load.credits.available).toBe(false);
    expect(result.current.gate.allowed).toBe(true); // the board itself is fine
  });

  it("a failed schedule is unknown, never 'nobody scheduled'", async () => {
    const fetchSchedule = jest.fn().mockRejectedValue(new Error("down"));
    const { result } = setup({ fetchSchedule });
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    await waitFor(() => expect(fetchSchedule).toHaveBeenCalled());
    await settle();
    expect(result.current.model.schedule).toMatchObject({ trust: "unknown", shifts: null });
    expect(result.current.model.team?.every((member) => member.scheduled === null)).toBe(true);
  });

  it("a refresh recovers a failed source", async () => {
    const fetchSettings = jest.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue(SETTINGS);
    const { result } = setup({ fetchSettings });
    await waitFor(() => expect(fetchSettings).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.model.settings.trust).toBe("unknown");
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.model.settings.trust).toBe("verified");
  });

  it("a failed refresh keeps the last verified settings, labelled stale", async () => {
    const fetchSettings = jest.fn().mockResolvedValueOnce(SETTINGS).mockRejectedValue(new Error("down"));
    const { result } = setup({ fetchSettings });
    await waitFor(() => expect(result.current.model.settings.trust).toBe("verified"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.model.settings).toMatchObject({ trust: "stale", value: SETTINGS });
  });

  it("nothing is fetched without a signed-in hotel and person", async () => {
    mockState.user = null;
    const { fetchers, fetchSettings, fetchSchedule } = setup();
    await settle();
    expect(fetchers.board).not.toHaveBeenCalled();
    expect(fetchSettings).not.toHaveBeenCalled();
    expect(fetchSchedule).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("offline: nothing is fetched and the gate is closed", async () => {
    mockState.isOnline = false;
    const { result, fetchSettings, fetchSchedule } = setup();
    await settle();
    expect(fetchSettings).not.toHaveBeenCalled();
    expect(fetchSchedule).not.toHaveBeenCalled();
    expect(result.current.gate).toEqual({ allowed: false, blockedBy: "offline" });
  });

  it("going offline keeps the settings as stale (offline), not gone", async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.model.settings.trust).toBe("verified"));
    mockState.isOnline = false;
    rerender({});
    await waitFor(() => expect(result.current.model.settings.trust).toBe("stale"));
    expect(result.current.model.settings.value).toEqual(SETTINGS);
    expect(result.current.gate.allowed).toBe(false);
  });
});

describe("useAssignments — scopes and the clock", () => {
  it("switching hotel drops the old hotel's settings and schedule, and discards their late answers", async () => {
    const hotel1 = deferred<WorkloadSettings>();
    const fetchSettings = jest.fn(async (hotelId: string) => (hotelId === "hotel-1" ? hotel1.promise : { ...SETTINGS, targetCredits: 30 }));
    const { result, rerender } = setup({ fetchSettings });
    await settle();
    expect(result.current.model.settings.trust).toBe("unknown");

    mockState.user = { id: "sup-9", tenant_id: "hotel-2", role: "housekeeping_supervisor" };
    rerender({});
    await waitFor(() => expect(result.current.model.settings.value?.targetCredits).toBe(30));

    // Hotel 1's slow answer lands now; it must not replace hotel 2's.
    hotel1.resolve({ ...SETTINGS, targetCredits: 99 });
    await settle();
    expect(result.current.model.settings.value?.targetCredits).toBe(30);
    expect(fetchSettings).toHaveBeenCalledWith("hotel-2");
  });

  it("a scope change reads as 'nothing loaded' until its own answers arrive", async () => {
    const hotel2 = deferred<WorkloadSettings>();
    const fetchSettings = jest.fn(async (hotelId: string) => (hotelId === "hotel-1" ? SETTINGS : hotel2.promise));
    const { result, rerender } = setup({ fetchSettings });
    await waitFor(() => expect(result.current.model.settings.trust).toBe("verified"));
    mockState.user = { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" };
    rerender({});
    expect(result.current.model.settings).toMatchObject({ trust: "unknown", value: null });
    expect(result.current.model.rooms).toBeNull();
    hotel2.resolve({ ...SETTINGS, targetCredits: 20 });
    await waitFor(() => expect(result.current.model.settings.value?.targetCredits).toBe(20));
  });

  it("the same hotel with a different supervisor is a different scope", async () => {
    const { result, rerender, fetchSettings } = setup();
    await waitFor(() => expect(result.current.scopeKey).toBe("hotel-1:sup-1"));
    mockState.user = { id: "sup-2", tenant_id: "hotel-1", role: "housekeeping_supervisor" };
    rerender({});
    expect(result.current.scopeKey).toBe("hotel-1:sup-2");
    await waitFor(() => expect(fetchSettings).toHaveBeenCalledTimes(2));
  });

  it("midnight in the HOTEL's zone: the schedule is re-requested for the new date", async () => {
    jest.setSystemTime(Date.parse("2026-10-17T04:58:00Z")); // 23:58 on the 16th in Chicago (already the 17th in UTC)
    const { result, fetchSchedule } = setup();
    await waitFor(() => expect(result.current.model.schedule.trust).toBe("verified"));
    expect(fetchSchedule).toHaveBeenLastCalledWith("2026-10-16");

    await act(async () => {
      jest.advanceTimersByTime(3 * 60_000); // past 00:00 Chicago
    });
    await waitFor(() => expect(fetchSchedule).toHaveBeenLastCalledWith("2026-10-17"));
    expect(result.current.model.hotelDate).toBe("2026-10-17");
  });

  it("returning to the foreground reloads the extra sources only when they are no longer fresh", async () => {
    const { result, fetchSettings, fetchSchedule } = setup();
    await waitFor(() => expect(result.current.model.settings.trust).toBe("verified"));
    await waitFor(() => expect(result.current.model.schedule.trust).toBe("verified"));
    const settingsCalls = fetchSettings.mock.calls.length;
    const scheduleCalls = fetchSchedule.mock.calls.length;

    await act(async () => {
      appStateHandlers.forEach((handler) => handler("active"));
    });
    await settle();
    expect(fetchSettings).toHaveBeenCalledTimes(settingsCalls); // fresh: left alone
    expect(fetchSchedule).toHaveBeenCalledTimes(scheduleCalls);

    await act(async () => {
      jest.setSystemTime(T0 + SCHEDULE_STALE_AFTER_MS + 1_000);
      appStateHandlers.forEach((handler) => handler("active"));
    });
    await waitFor(() => expect(fetchSchedule.mock.calls.length).toBeGreaterThan(scheduleCalls));
    expect(fetchSettings).toHaveBeenCalledTimes(settingsCalls); // still within its longer window
    expect(SETTINGS_STALE_AFTER_MS).toBeGreaterThan(SCHEDULE_STALE_AFTER_MS);
  });

  it("an unmounted screen never applies a late answer (no state update after unmount)", async () => {
    const late = deferred<WorkloadSettings>();
    const fetchSettings = jest.fn(async () => late.promise);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = setup({ fetchSettings });
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    unmount();
    late.resolve(SETTINGS);
    await settle();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("useAssignments — estimates match the Room Board's", () => {
  const seed = (minutes: number, version: number) =>
    useEstimateTable.setState({ entries: { [estimateKey("K", "DEP")]: { minutes, samples: 20 } }, fetchedAt: Date.now(), version });
  const minutesOf = (result: { current: { model: { team: { userId: string; load: { minutes: { remainingMinutes: number } } }[] | null } } }) =>
    result.current.model.team?.find((member) => member.userId === "hk-1")?.load.minutes.remainingMinutes;
  const board = () => [rawRoom("101", "DIRTY", { clean_type: "DEP", assigned_to: "hk-1", assignment_id: "as-1" })];

  // Reset BEFORE rendering (nothing is subscribed yet), so no state update lands outside act().
  beforeEach(() => useEstimateTable.setState({ entries: {}, fetchedAt: null, version: 0 }));

  it("uses the phone's learned figure (the same lookup the Room Board assignment flow uses), not just the room type's minutes", async () => {
    seed(45, 1);
    const { result } = setup({ fetchers: makeFetchers({ board: jest.fn(async () => board()) }) });
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    expect(minutesOf(result)).toBe(45);
  });

  it("recomputes when the learned table loads after the first render", async () => {
    const { result } = setup({ fetchers: makeFetchers({ board: jest.fn(async () => board()) }) });
    await waitFor(() => expect(result.current.model.availability.kind).toBe("ready"));
    expect(minutesOf(result)).toBe(30); // no table yet: the room type's configured minutes
    await act(async () => {
      seed(50, 1);
    });
    expect(minutesOf(result)).toBe(50);
  });
});

describe("useAssignments — the board stays the single source", () => {
  it("rooms in the model come from the shared snapshot (a board change shows without refetching extras)", async () => {
    const board = jest.fn().mockResolvedValueOnce(hotelBoard()).mockResolvedValue([rawRoom("501", "DIRTY")]);
    const { result, fetchSettings } = setup({ fetchers: makeFetchers({ board }) });
    await waitFor(() => expect(result.current.model.rooms).toHaveLength(10));
    await waitFor(() => expect(result.current.model.settings.trust).toBe("verified"));
    const settingsCalls = fetchSettings.mock.calls.length;
    const refresh = (mockSubscribe.mock.calls[0] as [string, () => Promise<void>])[1]; // what a Realtime event runs
    await act(async () => {
      await refresh();
    });
    await waitFor(() => expect(result.current.model.rooms?.map((entry) => entry.room.roomNumber)).toEqual(["501"]));
    // A realtime event refreshes the board only; the small extra sources are not re-requested by it.
    expect(fetchSettings.mock.calls.length).toBe(settingsCalls);
  });
});
