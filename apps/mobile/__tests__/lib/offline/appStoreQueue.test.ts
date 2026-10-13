import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));
jest.mock("@/lib/offline/db", () => ({
  upsertRooms: jest.fn().mockResolvedValue(undefined),
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
}));

import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";
import { registerSessionFlush, setManagedRooms } from "@/lib/housekeeping/sessionGuard";

const mockApi = api as unknown as { patch: jest.Mock; post: jest.Mock };

const profile = (id: string, tenant_id: string) => ({ id, tenant_id, role: "housekeeper", email: `${id}@example.com` }) as unknown as UserProfile;
const userA = profile("user-a", "hotel-1");
const userB = profile("user-b", "hotel-1");
const userAOtherHotel = profile("user-a", "hotel-2");
const STORAGE = "@patelrep/offline_queue";

async function queue(type: "room_status" | "task_complete", entityId: string, payload: Record<string, unknown> = {}) {
  await useAppStore.getState().enqueueAction({ type, entityId, payload });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockApi.patch.mockResolvedValue({});
  mockApi.post.mockResolvedValue({});
  useAppStore.setState({ pendingActions: [], isOnline: false, user: null });
  useAppStore.getState().setUser(userA);
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
    await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-1", payload: { text: "x" } });
    mockApi.post.mockImplementation(async () => {
      order.push("queue");
      return {};
    });

    useAppStore.getState().setIsOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(order).toEqual(["sessions", "queue"]);
  });

  it("never replays an unowned legacy task_complete action (it could complete a task as another account)", async () => {
    await queue("task_complete", "task-1", { note: "all done" });
    await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-1", payload: { text: "kept" } });

    await useAppStore.getState().flushQueue();

    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith("/logbook/entries", { text: "kept" });
    expect(mockApi.post).not.toHaveBeenCalledWith(expect.stringContaining("/tasks/"), expect.anything());
    expect(useAppStore.getState().pendingActions).toEqual([]);
  });

  it("drops entries with no owner when loading (they can not be attributed to anyone)", async () => {
    await AsyncStorage.setItem(
      STORAGE,
      JSON.stringify([
        { id: "a-1", type: "task_complete", entityId: "task-1", payload: {}, createdAt: "2026-06-11", owner: "hotel-1:user-a" },
        { id: "a-2", type: "room_status", entityId: "room-1", payload: { status: "CLEAN" }, createdAt: "2026-06-11" },
        { id: "a-3", type: "room_status", entityId: "room-2", payload: { status: "CLEAN" }, createdAt: "2026-06-11", owner: "hotel-1:user-a" },
      ]),
    );

    await useAppStore.getState().loadPendingActions();

    expect(useAppStore.getState().pendingActions.map((a) => a.id)).toEqual(["a-3"]);
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE)) ?? "[]").map((a: { id: string }) => a.id)).toEqual(["a-3"]);
  });

  it("keeps a queued logbook entry when the server refuses it", async () => {
    mockApi.post.mockRejectedValueOnce(new Error("HTTP 500"));
    await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-1", payload: { text: "x" } });

    await useAppStore.getState().flushQueue();

    expect(useAppStore.getState().pendingActions.map((a) => a.entityId)).toEqual(["log-1"]);
  });

  describe("account isolation", () => {
    it("stamps the signed-in owner on every queued action", async () => {
      await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-1", payload: {} });
      expect(useAppStore.getState().pendingActions[0].owner).toBe("hotel-1:user-a");
    });

    it("refuses to queue with nobody signed in", async () => {
      useAppStore.getState().setUser(null);
      await expect(useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-1", payload: {} })).rejects.toThrow();
    });

    it("never shows, sends or deletes another account's queued changes, and gives them back to their owner", async () => {
      await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-a", payload: { text: "from A" } });

      useAppStore.getState().setUser(userB);
      expect(useAppStore.getState().pendingActions).toEqual([]);
      await useAppStore.getState().flushQueue();
      expect(mockApi.post).not.toHaveBeenCalled();

      await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-b", payload: { text: "from B" } });
      await useAppStore.getState().flushQueue();
      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledWith("/logbook/entries", { text: "from B" });
      // A's entry survived B's flush untouched.
      expect(JSON.parse((await AsyncStorage.getItem(STORAGE)) ?? "[]").map((a: { entityId: string }) => a.entityId)).toEqual(["log-a"]);

      mockApi.post.mockClear();
      useAppStore.getState().setUser(userA);
      await useAppStore.getState().loadPendingActions();
      expect(useAppStore.getState().pendingActions.map((a) => a.entityId)).toEqual(["log-a"]);
      await useAppStore.getState().flushQueue();
      expect(mockApi.post).toHaveBeenCalledWith("/logbook/entries", { text: "from A" });
    });

    it("treats the same person at a different hotel as a different owner", async () => {
      await useAppStore.getState().enqueueAction({ type: "work_order_update", entityId: "wo-1", payload: { status: "done" } });

      useAppStore.getState().setUser(userAOtherHotel);
      await useAppStore.getState().loadPendingActions();
      await useAppStore.getState().flushQueue();

      expect(useAppStore.getState().pendingActions).toEqual([]);
      expect(mockApi.patch).not.toHaveBeenCalled();
    });

    it("stops sending when another account signs in while a flush is running", async () => {
      await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-1", payload: {} });
      await useAppStore.getState().enqueueAction({ type: "logbook_create", entityId: "log-2", payload: {} });
      mockApi.post.mockImplementationOnce(async () => {
        useAppStore.getState().setUser(userB);
        return {};
      });

      await useAppStore.getState().flushQueue();

      expect(mockApi.post).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().pendingActions).toEqual([]);
    });
  });
});
