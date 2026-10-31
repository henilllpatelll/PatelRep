import AsyncStorage from "@react-native-async-storage/async-storage";
import { flushSyncQueue } from "@/lib/offline/sync";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));
jest.mock("@/lib/offline/db", () => ({
  getPendingSyncQueue: jest.fn(),
  deleteSyncQueueItem: jest.fn(),
  incrementSyncQueueAttempts: jest.fn(),
  upsertRooms: jest.fn(),
  clearRoomsCache: jest.fn(),
}));
jest.mock("@react-native-community/netinfo", () => ({
  default: { fetch: jest.fn().mockResolvedValue({ isConnected: true }) },
}));

import { api } from "@/lib/api/client";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { deleteSyncQueueItem, getPendingSyncQueue, incrementSyncQueueAttempts } from "@/lib/offline/db";
import { REPORT_QUEUE_MARK, listQueuedReports, loadReportRecords, recordReport, dismissReportRecord } from "@/lib/engineering/pendingReports";

const post = (api as unknown as { post: jest.Mock }).post;
const pending = getPendingSyncQueue as jest.Mock;
const deleted = deleteSyncQueueItem as jest.Mock;
const attempts = incrementSyncQueueAttempts as jest.Mock;

const REQUEST = "22222222-2222-4222-8222-222222222222";
const report = (over: Record<string, unknown> = {}) => ({
  id: 7,
  entity_type: "work_order",
  action: "create",
  entity_id: `${REPORT_QUEUE_MARK}${REQUEST}`,
  payload: JSON.stringify({ client_request_id: REQUEST, title: "AC not cooling", category: "hvac", priority: "normal", room_id: "r312" }),
  ...over,
});
const refusal = (status: number, message: string) => Object.assign(new Error(message), { status });

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => undefined); // the sync engine warns on every failed attempt
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
  deleted.mockResolvedValue(undefined);
  attempts.mockResolvedValue(undefined);
  await loadReportRecords();
  for (const record of await loadReportRecords()) await dismissReportRecord(record.requestId);
});

describe("an engineering report saved offline", () => {
  it("is replayed with its original client_request_id, and the work order number the server returns is kept", async () => {
    pending.mockResolvedValue([report()]);
    post.mockResolvedValue({ data: { id: "wo-1042", work_order_number: 1042 } });

    await flushSyncQueue();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/work-orders", expect.objectContaining({ client_request_id: REQUEST, room_id: "r312" }));
    expect(deleted).toHaveBeenCalledWith(7);
    expect(await loadReportRecords()).toEqual([
      expect.objectContaining({ requestId: REQUEST, kind: "synced", workOrderId: "wo-1042", workOrderNumber: "1042", title: "AC not cooling" }),
    ]);
  });

  it("stays in the queue after a lost answer or a server error, so the next attempt (same key) can't duplicate", async () => {
    pending.mockResolvedValue([report()]);
    for (const failure of [new Error("Network request failed"), refusal(503, "Service unavailable"), refusal(429, "Slow down"), refusal(408, "Timeout")]) {
      post.mockRejectedValueOnce(failure);
      await flushSyncQueue();
    }
    expect(deleted).not.toHaveBeenCalled();
    expect(attempts).toHaveBeenCalledTimes(4);
    expect(await loadReportRecords()).toEqual([]);
    const keys = post.mock.calls.map(([, payload]) => (payload as { client_request_id: string }).client_request_id);
    expect(new Set(keys)).toEqual(new Set([REQUEST]));
  });

  it("is dropped, and recorded as refused with the server's reason, when the server says it can never be accepted", async () => {
    pending.mockResolvedValue([report()]);
    post.mockRejectedValue(refusal(422, "Room not found"));

    await flushSyncQueue();

    expect(deleted).toHaveBeenCalledWith(7);
    expect(attempts).not.toHaveBeenCalled();
    expect(await loadReportRecords()).toEqual([expect.objectContaining({ requestId: REQUEST, kind: "refused", message: "Room not found", title: "AC not cooling" })]);
  });

  it("does not change how other queued work-order creates behave: a housekeeping report refused with 422 is kept, not dropped", async () => {
    pending.mockResolvedValue([report({ entity_id: null })]);
    post.mockRejectedValue(refusal(422, "Invalid"));

    await flushSyncQueue();

    expect(deleted).not.toHaveBeenCalled();
    expect(attempts).toHaveBeenCalledWith(7);
    expect(await loadReportRecords()).toEqual([]);
  });

  it("keeps its records per person: another account on the phone does not see them", async () => {
    await recordReport({ requestId: "a", kind: "synced", title: "Mine", workOrderNumber: "1" });
    setQueueOwner("hotel-1:user-2");
    expect(await loadReportRecords()).toEqual([]);
    setQueueOwner("hotel-1:user-1");
    expect((await loadReportRecords()).map((r) => r.title)).toEqual(["Mine"]);
  });
});

describe("listQueuedReports", () => {
  it("lists only engineering reports still waiting, by title", async () => {
    pending.mockResolvedValue([
      report(),
      report({ id: 8, entity_id: null }),
      report({ id: 9, entity_type: "work_order", action: "claim", entity_id: "wo-1", payload: "{}" }),
      report({ id: 10, entity_id: `${REPORT_QUEUE_MARK}other`, payload: JSON.stringify({ title: "Door sticks" }) }),
    ]);
    expect(await listQueuedReports()).toEqual([
      { requestId: REQUEST, title: "AC not cooling" },
      { requestId: "other", title: "Door sticks" },
    ]);
  });
});
