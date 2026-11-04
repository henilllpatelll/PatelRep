import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/workOrders", () => ({ listActiveWorkOrders: jest.fn(), getWorkOrderSummary: jest.fn() }));
jest.mock("@/lib/api/assets", () => ({ listPmSchedules: jest.fn() }));
jest.mock("@/lib/engineering/workOrderCache", () => ({ loadQueueSnapshot: jest.fn(), saveQueueSnapshot: jest.fn().mockResolvedValue(undefined) }));

import { getWorkOrderSummary, listActiveWorkOrders } from "@/lib/api/workOrders";
import { listPmSchedules } from "@/lib/api/assets";
import { loadQueueSnapshot, saveQueueSnapshot } from "@/lib/engineering/workOrderCache";
import { homeSnapshotKey, useEngineeringHome } from "@/lib/engineering/useEngineeringHome";

const active = listActiveWorkOrders as jest.Mock;
const summary = getWorkOrderSummary as jest.Mock;
const pm = listPmSchedules as jest.Mock;
const loadSaved = loadQueueSnapshot as jest.Mock;
const save = saveQueueSnapshot as jest.Mock;

const order = (id: string, over: Record<string, unknown> = {}) => ({ id, title: id, status: "open", priority: "normal", assigned_to: null, created_at: "2026-10-31T10:00:00Z", ...over });
const offline = () => new Error("Network request failed");
const serverError = () => Object.assign(new Error("boom"), { status: 500 });

beforeEach(() => {
  jest.clearAllMocks();
  active.mockResolvedValue({ orders: [order("a")], truncated: false });
  summary.mockResolvedValue({ urgent: 0, in_progress: 0, waiting: 0, total: 1 });
  pm.mockResolvedValue([]);
  loadSaved.mockResolvedValue(null);
});

describe("useEngineeringHome", () => {
  it("loads each source once and reports them as ready", async () => {
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    expect(active).toHaveBeenCalledTimes(1);
    expect(pm).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledTimes(1);
    expect(result.current.fromSaved).toBe(false);
    expect(result.current.syncedAt).toBeInstanceOf(Date);
  });

  it("saves the freshly read queue (most urgent first) for offline use", async () => {
    active.mockResolvedValue({ orders: [order("calm"), order("emg", { priority: "emergency" })], truncated: false });
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toBe(homeSnapshotKey("engineer"));
    expect((save.mock.calls[0][1] as Array<{ id: string }>).map((o) => o.id)).toEqual(["emg", "calm"]);
  });

  it("drops the previous hotel's data immediately and rejects its late answer", async () => {
    let releaseOld!: (v: unknown) => void;
    active.mockReturnValueOnce(new Promise((r) => (releaseOld = r)));
    const { result, rerender } = renderHook(({ scope }: { scope: string | null }) => useEngineeringHome(scope, "engineer"), { initialProps: { scope: "h1:u1" as string | null } });
    active.mockResolvedValueOnce({ orders: [order("new-hotel")], truncated: false });
    rerender({ scope: "h2:u1" });
    await waitFor(() => expect(result.current.orders.map((o) => o.id)).toEqual(["new-hotel"]));
    await act(async () => releaseOld({ orders: [order("old-hotel")], truncated: false }));
    expect(result.current.orders.map((o) => o.id)).toEqual(["new-hotel"]);
  });

  it("starts clean for a different person and never shows the other person's rows while loading", async () => {
    const { result, rerender } = renderHook(({ scope }: { scope: string | null }) => useEngineeringHome(scope, "engineer"), { initialProps: { scope: "h1:u1" as string | null } });
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    active.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ scope: "h1:u2" });
    expect(result.current.orders).toEqual([]);
    expect(result.current.hasQueue).toBe(false);
    expect(result.current.summary).toBeNull();
  });

  it("clears everything when signed out", async () => {
    const { result, rerender } = renderHook(({ scope }: { scope: string | null }) => useEngineeringHome(scope, "engineer"), { initialProps: { scope: "h1:u1" as string | null } });
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    rerender({ scope: null });
    expect(result.current.orders).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("fails sections independently: PM down keeps the queue; the queue down keeps the last good copy", async () => {
    pm.mockRejectedValue(serverError());
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    expect(result.current.pmFailure).toBe("failed");
    expect(result.current.hasPm).toBe(false);
    expect(result.current.queueFailure).toBeNull();

    active.mockRejectedValue(serverError());
    await act(async () => {
      await result.current.request("manual");
    });
    expect(result.current.queueFailure).toBe("failed");
    expect(result.current.orders.map((o) => o.id)).toEqual(["a"]);
    expect(result.current.hasQueue).toBe(true);
  });

  it("drops the exact summary when its refresh fails, so it is never shown next to a newer queue", async () => {
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    summary.mockRejectedValue(serverError());
    await act(async () => {
      await result.current.request("manual");
    });
    expect(result.current.summary).toBeNull();
  });

  it("joins a read already running and runs one trailing read for realtime changes", async () => {
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    active.mockClear();
    let release!: (v: unknown) => void;
    active.mockReturnValueOnce(new Promise((r) => (release = r)));
    let done!: Promise<void>;
    act(() => {
      done = Promise.all([result.current.request("manual"), result.current.request("manual"), result.current.request("realtime"), result.current.request("realtime")]).then(() => undefined);
    });
    expect(active).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ orders: [order("a")], truncated: false });
      await done;
    });
    expect(active).toHaveBeenCalledTimes(2);
  });

  it("does not read again on a focus hint right after a read", async () => {
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    active.mockClear();
    await act(async () => {
      await result.current.request("focus");
    });
    expect(active).not.toHaveBeenCalled();
  });

  it("marks a truncated read so counts are lower bounds", async () => {
    active.mockResolvedValue({ orders: [order("a")], truncated: true });
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.truncated).toBe(true));
  });
});

describe("useEngineeringHome offline", () => {
  it("keeps the saved copy of one role apart from another's", async () => {
    active.mockRejectedValue(offline());
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "gm"));
    await waitFor(() => expect(loadSaved).toHaveBeenCalledWith(homeSnapshotKey("gm")));
    expect(homeSnapshotKey("gm")).not.toBe(homeSnapshotKey("engineer"));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("shows the saved queue as a stale lower bound when offline before anything was read", async () => {
    active.mockRejectedValue(offline());
    pm.mockRejectedValue(offline());
    summary.mockRejectedValue(offline());
    loadSaved.mockResolvedValue({ orders: [order("saved")], savedAt: "2026-10-31T09:00:00Z" });
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    expect(result.current.fromSaved).toBe(true);
    expect(result.current.truncated).toBe(true);
    expect(result.current.queueFailure).toBe("offline");
    expect(result.current.orders.map((o) => o.id)).toEqual(["saved"]);
    expect(result.current.syncedAt?.toISOString()).toBe("2026-10-31T09:00:00.000Z");
    expect(result.current.summary).toBeNull();
    expect(result.current.hasPm).toBe(false);
  });

  it("shows nothing (not an empty queue) when offline with no saved copy", async () => {
    active.mockRejectedValue(offline());
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasQueue).toBe(false);
    expect(result.current.queueFailure).toBe("offline");
  });

  it("never uses the saved copy for a server error, or instead of a live answer", async () => {
    active.mockRejectedValue(serverError());
    loadSaved.mockResolvedValue({ orders: [order("saved")], savedAt: "2026-10-31T09:00:00Z" });
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(loadSaved).not.toHaveBeenCalled();
    expect(result.current.hasQueue).toBe(false);
  });

  it("does not replace a live queue with the saved copy when a later refresh goes offline", async () => {
    const { result } = renderHook(() => useEngineeringHome("h1:u1", "engineer"));
    await waitFor(() => expect(result.current.hasQueue).toBe(true));
    active.mockRejectedValue(offline());
    loadSaved.mockResolvedValue({ orders: [order("saved")], savedAt: "2026-10-30T09:00:00Z" });
    await act(async () => {
      await result.current.request("manual");
    });
    expect(loadSaved).not.toHaveBeenCalled();
    expect(result.current.orders.map((o) => o.id)).toEqual(["a"]);
    expect(result.current.fromSaved).toBe(false);
  });

  it("drops a saved copy that arrives after the person or hotel changed", async () => {
    let releaseSaved!: (v: unknown) => void;
    active.mockRejectedValueOnce(offline());
    loadSaved.mockReturnValueOnce(new Promise((r) => (releaseSaved = r)));
    const { result, rerender } = renderHook(({ scope }: { scope: string | null }) => useEngineeringHome(scope, "engineer"), { initialProps: { scope: "h1:u1" as string | null } });
    await waitFor(() => expect(loadSaved).toHaveBeenCalled());
    active.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ scope: "h2:u9" });
    await act(async () => releaseSaved({ orders: [order("previous-person")], savedAt: "2026-10-31T09:00:00Z" }));
    expect(result.current.orders).toEqual([]);
    expect(result.current.fromSaved).toBe(false);
  });
});
