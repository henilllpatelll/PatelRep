import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));
jest.mock("@/lib/offline/db", () => ({ upsertRooms: jest.fn().mockResolvedValue(undefined) }));

import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { registerSessionFlush, setManagedRooms } from "@/lib/housekeeping/sessionGuard";

const mockApi = api as unknown as { patch: jest.Mock; post: jest.Mock };

async function queue(type: "room_status" | "task_complete", entityId: string, payload: Record<string, unknown> = {}) {
  await useAppStore.getState().enqueueAction({ type, entityId, payload });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockApi.patch.mockResolvedValue({});
  useAppStore.setState({ pendingActions: [], isOnline: false });
  setManagedRooms([]);
  registerSessionFlush(null);
});

describe("offline queue vs. clean sessions", () => {
  it("does not replay a legacy room_status action for a room a clean session owns", async () => {
    await queue("room_status", "room-1", { status: "CLEAN" });
    await queue("room_status", "room-2", { status: "CLEAN" });
    setManagedRooms(["room-1"]);

    await useAppStore.getState().flushQueue();

    expect(mockApi.patch).toHaveBeenCalledTimes(1);
    expect(mockApi.patch).toHaveBeenCalledWith("/rooms/room-2/status", { status: "CLEAN" });
    expect(useAppStore.getState().pendingActions).toEqual([]);
  });

  it("drops queued room_status entries for one room only", async () => {
    await queue("room_status", "room-1", { status: "IN_PROGRESS" });
    await queue("room_status", "room-2", { status: "IN_PROGRESS" });
    await queue("task_complete", "room-1", {});

    await useAppStore.getState().dropQueuedRoomStatus("room-1");

    expect(useAppStore.getState().pendingActions.map((a) => `${a.type}:${a.entityId}`)).toEqual([
      "room_status:room-2",
      "task_complete:room-1",
    ]);
    expect(JSON.parse((await AsyncStorage.getItem("@patelrep/offline_queue")) ?? "[]")).toHaveLength(2);
  });

  it("flushes clean sessions before the generic queue when connectivity returns", async () => {
    const order: string[] = [];
    registerSessionFlush(async () => {
      order.push("sessions");
    });
    await queue("task_complete", "task-1", {});
    mockApi.patch.mockImplementation(async () => {
      order.push("queue");
      return {};
    });

    useAppStore.getState().setIsOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(order).toEqual(["sessions", "queue"]);
  });
});
