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
import AS from "@react-native-async-storage/async-storage";
import { saveCompletionDraft, loadCompletionDraft } from "@/lib/engineering/workOrderDrafts";
import { loadRecentlySynced } from "@/lib/engineering/syncedHistory";
import { emptyCompletionDraft } from "@/lib/engineering/repairWorkspace";

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

describe("saved draft and recently synced follow the server, not the queue", () => {

  beforeEach(async () => {
    await AS.clear();
    await saveCompletionDraft("wo-1", { ...emptyCompletionDraft(), notes: "Replaced capacitor" }, "in_progress", "WO-1");
  });

  it("clears the draft and lists the completion as synced only after the server accepts it", async () => {
    post.mockResolvedValueOnce({});
    await flushSyncQueue();
    expect(await loadCompletionDraft("wo-1")).toBeNull();
    expect((await loadRecentlySynced()).map((e) => `${e.kind}:${e.woId}`)).toEqual(["complete:wo-1"]);
  });

  it("keeps the draft and records nothing when the replay fails or is refused", async () => {
    post.mockRejectedValueOnce(new Error("Network request failed"));
    await flushSyncQueue();
    post.mockRejectedValueOnce(apiError(422));
    await flushSyncQueue();
    expect(await loadCompletionDraft("wo-1")).not.toBeNull();
    expect(await loadRecentlySynced()).toEqual([]);
  });

  it("counts a proven earlier landing (409, then re-read) as synced", async () => {
    post.mockRejectedValueOnce(apiError(409));
    (getWorkOrder as jest.Mock).mockResolvedValueOnce({ status: "completed", assigned_to: "me" });
    await flushSyncQueue();
    expect(await loadCompletionDraft("wo-1")).toBeNull();
    expect((await loadRecentlySynced())[0]).toMatchObject({ kind: "complete", woId: "wo-1" });
  });

  it("records a confirmed claim but not a refused one", async () => {
    (getPendingSyncQueue as jest.Mock).mockResolvedValue([{ id: 8, entity_type: "work_order", action: "claim", payload: JSON.stringify({ label: "WO-1" }), entity_id: "wo-1" }]);
    post.mockRejectedValueOnce(apiError(409));
    await flushSyncQueue();
    expect(await loadRecentlySynced()).toEqual([]);
    post.mockResolvedValueOnce({});
    await flushSyncQueue();
    expect((await loadRecentlySynced())[0]).toMatchObject({ kind: "claim", woId: "wo-1", label: "WO-1" });
  });
});
