import { flushSyncQueue, refreshRooms } from "@/lib/offline/sync";

// Mock dependencies
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));
jest.mock("@/lib/offline/db", () => ({
  getPendingSyncQueue: jest.fn(),
  deleteSyncQueueItem: jest.fn(),
  incrementSyncQueueAttempts: jest.fn(),
  upsertRooms: jest.fn(),
}));
jest.mock("@react-native-community/netinfo", () => ({
  default: { fetch: jest.fn().mockResolvedValue({ isConnected: true }) },
}));

import { api } from "@/lib/api/client";
import { getPendingSyncQueue, deleteSyncQueueItem, incrementSyncQueueAttempts, upsertRooms } from "@/lib/offline/db";

const mockApi = api as unknown as {
  get: jest.Mock;
  patch: jest.Mock;
  post: jest.Mock;
};
const mockGetPendingSyncQueue = getPendingSyncQueue as jest.Mock;
const mockDeleteSyncQueueItem = deleteSyncQueueItem as jest.Mock;
const mockIncrementSyncQueueAttempts = incrementSyncQueueAttempts as jest.Mock;
const mockUpsertRooms = upsertRooms as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteSyncQueueItem.mockResolvedValue(undefined);
  mockIncrementSyncQueueAttempts.mockResolvedValue(undefined);
  mockUpsertRooms.mockResolvedValue(undefined);
});

describe("flushSyncQueue", () => {
  it("processes room_status/update items and calls PATCH /rooms/{id}/status", async () => {
    mockGetPendingSyncQueue.mockResolvedValue([
      {
        id: 1,
        entity_type: "room_status",
        action: "update",
        entity_id: "room-abc",
        payload: JSON.stringify({ status: "CLEAN" }),
      },
    ]);
    mockApi.patch.mockResolvedValue({});

    await flushSyncQueue();

    expect(mockApi.patch).toHaveBeenCalledWith("/rooms/room-abc/status", { status: "CLEAN" });
    expect(mockDeleteSyncQueueItem).toHaveBeenCalledWith(1);
  });

  it("leaves a failed item in the queue (does not delete on error) and increments attempts", async () => {
    mockGetPendingSyncQueue.mockResolvedValue([
      {
        id: 2,
        entity_type: "room_status",
        action: "update",
        entity_id: "room-xyz",
        payload: JSON.stringify({ status: "IN_PROGRESS" }),
      },
    ]);
    mockApi.patch.mockRejectedValue(new Error("Network error"));

    await flushSyncQueue();

    expect(mockDeleteSyncQueueItem).not.toHaveBeenCalled();
    expect(mockIncrementSyncQueueAttempts).toHaveBeenCalledWith(2);
  });

  it("processes work_order/create items and calls POST /work-orders", async () => {
    mockGetPendingSyncQueue.mockResolvedValue([
      {
        id: 3,
        entity_type: "work_order",
        action: "create",
        entity_id: undefined,
        payload: JSON.stringify({ title: "Broken AC", room_id: "room-1" }),
      },
    ]);
    mockApi.post.mockResolvedValue({ data: { id: "wo-1" } });

    await flushSyncQueue();

    expect(mockApi.post).toHaveBeenCalledWith("/work-orders", {
      title: "Broken AC",
      room_id: "room-1",
    });
    expect(mockDeleteSyncQueueItem).toHaveBeenCalledWith(3);
  });

  it("processes work_order/claim items and calls POST /work-orders/{id}/claim", async () => {
    mockGetPendingSyncQueue.mockResolvedValue([{
      id: 4, entity_type: "work_order", action: "claim",
      entity_id: "wo-99", payload: JSON.stringify({}),
    }]);
    mockApi.post.mockResolvedValue({});
    await flushSyncQueue();
    expect(mockApi.post).toHaveBeenCalledWith("/work-orders/wo-99/claim", {});
    expect(mockDeleteSyncQueueItem).toHaveBeenCalledWith(4);
  });

  it("processes work_order/complete items and calls POST /work-orders/{id}/complete", async () => {
    mockGetPendingSyncQueue.mockResolvedValue([{
      id: 5, entity_type: "work_order", action: "complete",
      entity_id: "wo-77", payload: JSON.stringify({ completion_notes: "Fixed the pipe" }),
    }]);
    mockApi.post.mockResolvedValue({});
    await flushSyncQueue();
    expect(mockApi.post).toHaveBeenCalledWith("/work-orders/wo-77/complete", { completion_notes: "Fixed the pipe" });
    expect(mockDeleteSyncQueueItem).toHaveBeenCalledWith(5);
  });
});

describe("refreshRooms", () => {
  it("calls GET /housekeeping/my-rooms with a local date param (not /rooms?my_rooms=true)", async () => {
    mockApi.get.mockResolvedValue({ data: [] });

    await refreshRooms();

    expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining("/housekeeping/my-rooms?date="));
    // Ensure the old endpoint is NOT used
    expect(mockApi.get).not.toHaveBeenCalledWith(expect.stringContaining("/rooms?my_rooms=true"));
  });

  it("unwraps response.data before passing to upsertRooms", async () => {
    const rooms = [{ id: "r1", room_number: "101" }];
    mockApi.get.mockResolvedValue({ data: rooms });

    await refreshRooms();

    expect(mockUpsertRooms).toHaveBeenCalledWith(rooms);
    // Ensure it was NOT called with the wrapper object
    expect(mockUpsertRooms).not.toHaveBeenCalledWith({ data: rooms });
  });
});
