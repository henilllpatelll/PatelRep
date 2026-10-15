const mockGet = jest.fn();
const mockSet = jest.fn();

jest.mock("@/lib/api/notifications", () => ({
  getNotificationPreferences: (...a: unknown[]) => mockGet(...a),
  setNotificationPreference: (...a: unknown[]) => mockSet(...a),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useNotificationPreferences } from "@/lib/notifications/useNotificationPreferences";

const LIST = [
  { key: "room_assignments", enabled: true, has_critical: false },
  { key: "tasks", enabled: true, has_critical: true },
];

function setup(over: Partial<{ scope: string | null; role: string; online: boolean }> = {}) {
  return renderHook((props: { scope: string | null; role: string; online: boolean }) => useNotificationPreferences(props), {
    initialProps: { scope: "h1:u1", role: "housekeeper", online: true, ...over },
  });
}

const tasks = (hook: ReturnType<typeof setup>) => hook.result.current.items.find((i) => i.key === "tasks")!;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockGet.mockResolvedValue(LIST);
  mockSet.mockResolvedValue(undefined);
});

describe("loading", () => {
  it("shows the server's values and writes nothing on load (a default never overwrites a choice)", async () => {
    mockGet.mockResolvedValue([{ key: "tasks", enabled: false, has_critical: true }]);
    const hook = setup();
    expect(hook.result.current.status).toBe("loading");
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(tasks(hook).enabled).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("reloads when the evaluated role changes", async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(mockGet).toHaveBeenCalledTimes(1);
    mockGet.mockResolvedValue([{ key: "work_orders", enabled: true, has_critical: false }]);
    hook.rerender({ scope: "h1:u1", role: "engineer", online: true });
    await waitFor(() => expect(hook.result.current.items.map((i) => i.key)).toEqual(["work_orders"]));
  });

  it("falls back to the last confirmed list when the server cannot be reached, and says so", async () => {
    await AsyncStorage.setItem("@patelrep/notif_prefs/v1/h1:u1", JSON.stringify([{ key: "tasks", enabled: false, has_critical: true }]));
    mockGet.mockRejectedValue(new Error("offline"));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(hook.result.current.fromCache).toBe(true);
    expect(tasks(hook).enabled).toBe(false);
  });

  it("is an error (with a way to retry) when there is nothing cached either", async () => {
    mockGet.mockRejectedValueOnce(new Error("offline"));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    mockGet.mockResolvedValue(LIST);
    await act(async () => hook.result.current.reload());
    expect(hook.result.current.status).toBe("ready");
  });

  it("never reads another person's cache", async () => {
    await AsyncStorage.setItem("@patelrep/notif_prefs/v1/h1:other", JSON.stringify([{ key: "tasks", enabled: false, has_critical: true }]));
    mockGet.mockRejectedValue(new Error("offline"));
    const hook = setup({ scope: "h1:u1" });
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
  });
});

describe("saving", () => {
  it("responds immediately, saves through the API, then confirms", async () => {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    await act(async () => hook.result.current.setEnabled("tasks", false));
    expect(mockSet).toHaveBeenCalledWith("tasks", false);
    await waitFor(() => expect(tasks(hook).saving).toBe(false));
    expect(tasks(hook).enabled).toBe(false);
    expect(hook.result.current.justSaved).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem("@patelrep/notif_prefs/v1/h1:u1"))!)).toContainEqual({ key: "tasks", enabled: false, has_critical: true });
  });

  it("shows the switch moving before the server answers", async () => {
    let release: () => void = () => undefined;
    mockSet.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    act(() => hook.result.current.setEnabled("tasks", false));
    expect(tasks(hook)).toMatchObject({ enabled: false, saving: true });
    await act(async () => release());
    expect(tasks(hook)).toMatchObject({ enabled: false, saving: false, failed: false });
  });

  it("a failed save snaps back to the last saved value, flags the failure, and retry sends the same choice again", async () => {
    mockSet.mockRejectedValueOnce(new Error("500"));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    await act(async () => hook.result.current.setEnabled("tasks", false));
    await waitFor(() => expect(tasks(hook).failed).toBe(true));
    expect(tasks(hook)).toMatchObject({ enabled: true, saving: false });
    expect(hook.result.current.justSaved).toBe(false); // no false success
    await act(async () => hook.result.current.retry("tasks"));
    await waitFor(() => expect(tasks(hook).saving).toBe(false));
    expect(mockSet).toHaveBeenLastCalledWith("tasks", false);
    expect(tasks(hook)).toMatchObject({ enabled: false, failed: false });
  });

  it("rapid toggles are coalesced: one request in flight, and the last intent always wins", async () => {
    const resolvers: Array<() => void> = [];
    mockSet.mockImplementation(() => new Promise<void>((resolve) => { resolvers.push(resolve); }));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));

    act(() => hook.result.current.setEnabled("tasks", false)); // request 1 (off) in flight
    act(() => hook.result.current.setEnabled("tasks", true)); //  back on
    act(() => hook.result.current.setEnabled("tasks", false)); // and off again
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(tasks(hook).enabled).toBe(false);

    await act(async () => resolvers[0]()); // request 1 lands; the newest intent (off) equals it, so nothing more is sent
    await waitFor(() => expect(tasks(hook).saving).toBe(false));
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(tasks(hook).enabled).toBe(false);
  });

  it("an older request can never overwrite a newer choice", async () => {
    const resolvers: Array<() => void> = [];
    mockSet.mockImplementation(() => new Promise<void>((resolve) => { resolvers.push(resolve); }));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));

    act(() => hook.result.current.setEnabled("tasks", false));
    act(() => hook.result.current.setEnabled("tasks", true)); // changed mind while request 1 is out
    await act(async () => resolvers[0]());
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(2));
    expect(mockSet.mock.calls.map((c) => c[1])).toEqual([false, true]); // sent in order, last write is the latest intent
    await act(async () => resolvers[1]());
    await waitFor(() => expect(tasks(hook).saving).toBe(false));
    expect(tasks(hook).enabled).toBe(true);
  });

  it("does not save while offline and leaves the confirmed value showing", async () => {
    const hook = setup({ online: false });
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    act(() => hook.result.current.setEnabled("tasks", false));
    expect(mockSet).not.toHaveBeenCalled();
    expect(tasks(hook)).toMatchObject({ enabled: true, saving: false });
  });

  it("switches are independent: one failing does not undo another", async () => {
    mockSet.mockImplementation((key: string) => (key === "tasks" ? Promise.reject(new Error("x")) : Promise.resolve()));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    await act(async () => {
      hook.result.current.setEnabled("tasks", false);
      hook.result.current.setEnabled("room_assignments", false);
    });
    await waitFor(() => expect(tasks(hook).failed).toBe(true));
    const rooms = hook.result.current.items.find((i) => i.key === "room_assignments")!;
    expect(rooms).toMatchObject({ enabled: false, failed: false });
  });
});
