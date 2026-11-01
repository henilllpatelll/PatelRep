jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/workOrders", () => ({ getWorkOrder: jest.fn() }));
jest.mock("@/lib/offline/db", () => ({
  getPendingSyncQueue: jest.fn(),
  getSyncQueueSummary: jest.fn().mockResolvedValue([]),
  deleteSyncQueueItem: jest.fn().mockResolvedValue(undefined),
  incrementSyncQueueAttempts: jest.fn().mockResolvedValue(undefined),
  markSyncQueueItemRefused: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@react-native-community/netinfo", () => ({ default: { fetch: jest.fn().mockResolvedValue({ isConnected: true }) } }));

import { api } from "@/lib/api/client";
import { getWorkOrder } from "@/lib/api/workOrders";
import { deleteSyncQueueItem, getPendingSyncQueue, incrementSyncQueueAttempts, markSyncQueueItemRefused } from "@/lib/offline/db";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { flushSyncQueue } from "@/lib/offline/sync";
import { useAppStore } from "@/stores/appStore";

const post = (api as unknown as { post: jest.Mock }).post;
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const queued = [{ id: 7, entity_type: "work_order", action: "complete", payload: JSON.stringify({ notes: "Replaced capacitor" }), entity_id: "wo-1" }];

beforeEach(() => {
  jest.clearAllMocks();
  setQueueOwner("h1:me");
  (getPendingSyncQueue as jest.Mock).mockResolvedValue(queued);
  useAppStore.setState({ user: { id: "me" } as never });
});

describe("offline completion replay", () => {
  it("removes the row only after the server confirms", async () => {
    post.mockResolvedValueOnce({});
    await flushSyncQueue();
    expect(deleteSyncQueueItem).toHaveBeenCalledWith(7);
  });

  it("keeps the row and retries (bounded) on a network or server failure", async () => {
    post.mockRejectedValueOnce(new Error("Network request failed"));
    await flushSyncQueue();
    expect(incrementSyncQueueAttempts).toHaveBeenCalledWith(7);
    expect(deleteSyncQueueItem).not.toHaveBeenCalled();
    expect(markSyncQueueItemRefused).not.toHaveBeenCalled();
  });

  it("keeps the saved notes and marks a permanent refusal instead of deleting it", async () => {
    post.mockRejectedValueOnce(apiError(403));
    await flushSyncQueue();
    expect(markSyncQueueItemRefused).toHaveBeenCalledWith(7, "forbidden");
    expect(deleteSyncQueueItem).not.toHaveBeenCalled();
  });

  it("treats a 409 on an order already completed by this person as confirmed", async () => {
    post.mockRejectedValueOnce(apiError(409));
    (getWorkOrder as jest.Mock).mockResolvedValueOnce({ status: "completed", assigned_to: "me" });
    await flushSyncQueue();
    expect(deleteSyncQueueItem).toHaveBeenCalledWith(7);
    expect(markSyncQueueItemRefused).not.toHaveBeenCalled();
  });

  it("records a real conflict when the order changed under the person", async () => {
    post.mockRejectedValueOnce(apiError(409));
    (getWorkOrder as jest.Mock).mockResolvedValueOnce({ status: "cancelled", assigned_to: "me" });
    await flushSyncQueue();
    expect(markSyncQueueItemRefused).toHaveBeenCalledWith(7, "conflict");
    expect(deleteSyncQueueItem).not.toHaveBeenCalled();
  });

  it("leaves it queued when a 409 cannot be verified", async () => {
    post.mockRejectedValueOnce(apiError(409));
    (getWorkOrder as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));
    await flushSyncQueue();
    expect(incrementSyncQueueAttempts).toHaveBeenCalledWith(7);
    expect(markSyncQueueItemRefused).not.toHaveBeenCalled();
  });

  it("never replays when nobody is signed in", async () => {
    setQueueOwner(null);
    await flushSyncQueue();
    expect(post).not.toHaveBeenCalled();
  });
});
