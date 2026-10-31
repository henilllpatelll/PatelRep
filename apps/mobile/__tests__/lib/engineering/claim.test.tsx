import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));
jest.mock("@/lib/api/workOrders", () => ({ claimWorkOrder: jest.fn() }));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
  getSyncQueueSummary: jest.fn().mockResolvedValue([]),
  getPendingSyncQueue: jest.fn(),
  deleteSyncQueueItem: jest.fn().mockResolvedValue(undefined),
  incrementSyncQueueAttempts: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@react-native-community/netinfo", () => ({
  default: { fetch: jest.fn().mockResolvedValue({ isConnected: true }) },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api/client";
import { claimWorkOrder } from "@/lib/api/workOrders";
import { deleteSyncQueueItem, enqueueAction, getPendingSyncQueue, getSyncQueueSummary, incrementSyncQueueAttempts } from "@/lib/offline/db";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { flushSyncQueue } from "@/lib/offline/sync";
import { useClaimWorkOrder } from "@/lib/engineering/useClaimWorkOrder";
import { loadClaimConflicts, dismissClaimConflict, resetClaimConflictsForTests } from "@/lib/engineering/claimConflicts";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const claimApi = claimWorkOrder as jest.Mock;
const enqueue = enqueueAction as jest.Mock;
const summary = getSyncQueueSummary as jest.Mock;
const post = (api as unknown as { post: jest.Mock }).post;

const open: WorkOrder = { id: "wo-1", title: "Leaking sink", status: "open", priority: "urgent", assigned_to: null, work_order_number: "1045" };
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
  resetClaimConflictsForTests();
  summary.mockResolvedValue([]);
});

function mount(isOnline = true, role = "engineer") {
  return renderHook(() => useClaimWorkOrder({ isOnline, role }));
}

describe("claiming a work order", () => {
  it("is confirmed only when the server accepts it, and never touches the offline queue", async () => {
    claimApi.mockResolvedValue({ ...open, status: "in_progress" });
    const { result } = mount();
    let outcome: Awaited<ReturnType<typeof result.current.claim>> | undefined;
    await act(async () => {
      outcome = await result.current.claim(open);
    });
    expect(outcome).toEqual({ kind: "confirmed", wo: open });
    expect(claimApi).toHaveBeenCalledWith("wo-1");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("shows a pending state and ignores a second tap while the first is in flight", async () => {
    let finish: (v: unknown) => void = () => undefined;
    claimApi.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = mount();
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.claim(open);
      second = result.current.claim(open);
    });
    await waitFor(() => expect(result.current.claimingIds.has("wo-1")).toBe(true));
    expect(await second).toEqual({ kind: "ignored" });
    await act(async () => {
      finish({});
      await first;
    });
    expect(claimApi).toHaveBeenCalledTimes(1);
    expect(result.current.claimingIds.has("wo-1")).toBe(false);
  });

  it.each([
    [409, "conflict"],
    [403, "forbidden"],
    [404, "not_found"],
    [500, "failed"],
  ] as const)("reports a %s from the server as %s, with nothing queued", async (status, failure) => {
    claimApi.mockRejectedValue(apiError(status));
    const { result } = mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.claim(open);
    });
    expect(outcome).toEqual({ kind: "failed", wo: open, failure });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues the claim when offline and calls the API zero times", async () => {
    const { result } = mount(false);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.claim(open);
    });
    expect(outcome).toEqual({ kind: "queued", wo: open });
    expect(claimApi).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith("work_order", "claim", { label: "WO-1045 · Leaking sink" }, "wo-1");
    expect(result.current.queuedIds.has("wo-1")).toBe(true);
    // A queued claim cannot be queued twice.
    await act(async () => {
      expect(await result.current.claim(open)).toEqual({ kind: "ignored" });
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("queues instead of failing when the connection drops under an online tap", async () => {
    claimApi.mockRejectedValue(new Error("Network request failed"));
    const { result } = mount(true);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.claim(open);
    });
    expect(outcome).toMatchObject({ kind: "queued" });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("restores queued claims from the offline queue after a restart", async () => {
    summary.mockResolvedValue([
      { id: 1, entity_type: "work_order", action: "claim", entity_id: "wo-9", room_id: null, attempts: 0 },
      { id: 2, entity_type: "work_order", action: "complete", entity_id: "wo-8", room_id: null, attempts: 0 },
    ]);
    const { result } = mount(true);
    await waitFor(() => expect(result.current.queuedIds.has("wo-9")).toBe(true));
    expect(result.current.queuedIds.has("wo-8")).toBe(false);
  });

  it.each([
    ["not open", { ...open, status: "in_progress" as const }, "engineer"],
    ["already assigned", { ...open, assigned_to: "someone" }, "engineer"],
    ["completed", { ...open, status: "completed" as const }, "engineer"],
    ["cancelled", { ...open, status: "cancelled" as const }, "engineer"],
    ["a role that cannot claim", open, "chief_engineer"],
  ])("refuses to claim an ineligible order (%s) without calling anything", async (_label, wo, role) => {
    const { result } = mount(true, role);
    await act(async () => {
      expect(await result.current.claim(wo)).toEqual({ kind: "ignored" });
    });
    expect(claimApi).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("an offline claim that the server later refuses", () => {
  const queuedClaim = (id = 7) => ({
    id,
    entity_type: "work_order",
    action: "claim",
    entity_id: "wo-1",
    payload: JSON.stringify({ label: "WO-1045 · Leaking sink" }),
  });

  it("is dropped and recorded as a conflict the person can see, not retried forever", async () => {
    (getPendingSyncQueue as jest.Mock).mockResolvedValue([queuedClaim()]);
    post.mockRejectedValue(apiError(409));
    await flushSyncQueue();
    expect(deleteSyncQueueItem).toHaveBeenCalledWith(7);
    expect(incrementSyncQueueAttempts).not.toHaveBeenCalled();
    const conflicts = await loadClaimConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ woId: "wo-1", reason: "conflict", label: "WO-1045 · Leaking sink" });

    await dismissClaimConflict("wo-1");
    expect(await loadClaimConflicts()).toHaveLength(0);
  });

  it.each([403, 404])("treats a %s the same way", async (status) => {
    (getPendingSyncQueue as jest.Mock).mockResolvedValue([queuedClaim()]);
    post.mockRejectedValue(apiError(status));
    await flushSyncQueue();
    expect(deleteSyncQueueItem).toHaveBeenCalledWith(7);
    expect(await loadClaimConflicts()).toHaveLength(1);
  });

  it("keeps retrying on a transient failure: nothing is dropped or reported", async () => {
    (getPendingSyncQueue as jest.Mock).mockResolvedValue([queuedClaim()]);
    post.mockRejectedValue(apiError(500));
    await flushSyncQueue();
    expect(deleteSyncQueueItem).not.toHaveBeenCalled();
    expect(incrementSyncQueueAttempts).toHaveBeenCalledWith(7);
    expect(await loadClaimConflicts()).toHaveLength(0);
  });

  it("clears the item when the replay succeeds", async () => {
    (getPendingSyncQueue as jest.Mock).mockResolvedValue([queuedClaim()]);
    post.mockResolvedValue({});
    await flushSyncQueue();
    expect(post).toHaveBeenCalledWith("/work-orders/wo-1/claim", {});
    expect(deleteSyncQueueItem).toHaveBeenCalledWith(7);
    expect(await loadClaimConflicts()).toHaveLength(0);
  });

  it("does not show one person's conflicts to the next account on the phone", async () => {
    (getPendingSyncQueue as jest.Mock).mockResolvedValue([queuedClaim()]);
    post.mockRejectedValue(apiError(409));
    await flushSyncQueue();
    expect(await loadClaimConflicts()).toHaveLength(1);
    setQueueOwner("hotel-1:user-2");
    expect(await loadClaimConflicts()).toHaveLength(0);
  });
});
