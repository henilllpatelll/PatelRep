import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn(), patch: jest.fn(), post: jest.fn() },
}));
jest.mock("@/lib/offline/db", () => ({
  upsertRooms: jest.fn().mockResolvedValue(undefined),
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
}));

import { api } from "@/lib/api/client";
import { MAX_ACTION_ATTEMPTS, useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";
import { buildOverview, categoryOf, relevantCategories } from "@/lib/offline/syncOverview";
import { buildSyncRows, type SyncRow } from "@/lib/housekeeping/syncDetails";
import { hydrateLastSynced, recordConfirmedSync } from "@/lib/offline/lastSync";
import { summarizePendingWork } from "@/lib/auth/pendingWork";

const mockApi = api as unknown as { patch: jest.Mock; post: jest.Mock };
const profile = (id: string, tenant_id: string) => ({ id, tenant_id, role: "housekeeper" }) as unknown as UserProfile;
const row = (over: Partial<SyncRow>): SyncRow => ({ key: "k", roomId: null, kind: "room_status", state: "pending", ...over });
const base = { complete: true, loaded: true, online: true, syncing: false, lastSyncedAt: null, role: "housekeeper" };

describe("sync overview status", () => {
  it("is All Changes Saved only when every queue was read and none holds work", () => {
    expect(buildOverview({ ...base, rows: [] }).status).toBe("saved");
  });

  it("never claims saved when a queue could not be read, or before the first read", () => {
    expect(buildOverview({ ...base, rows: [], complete: false }).status).toBe("unavailable");
    expect(buildOverview({ ...base, rows: [], loaded: false }).status).toBe("unavailable");
  });

  it("is Offline (not an error) when offline with or without saved work", () => {
    expect(buildOverview({ ...base, rows: [], online: false }).status).toBe("offline");
    const o = buildOverview({ ...base, rows: [row({})], online: false });
    expect(o.status).toBe("offline");
    expect(o.pending).toBe(1);
    expect(o.attention).toBe(0);
  });

  it("is Waiting, then Syncing while a sync runs", () => {
    expect(buildOverview({ ...base, rows: [row({})] }).status).toBe("waiting");
    expect(buildOverview({ ...base, rows: [row({})], syncing: true }).status).toBe("syncing");
  });

  it("needs attention for failed or refused work, and that wins over offline and syncing", () => {
    for (const state of ["failed", "conflict"] as const) {
      const o = buildOverview({ ...base, rows: [row({ state }), row({ key: "b" })], online: false, syncing: true });
      expect(o.status).toBe("attention");
      expect(o.attention).toBe(1);
      expect(o.pending).toBe(1);
    }
  });

  it("treats a retrying item as waiting, not as needing the person", () => {
    const o = buildOverview({ ...base, rows: [row({ state: "retrying" })] });
    expect(o.status).toBe("waiting");
    expect(o.attention).toBe(0);
  });
});

describe("sync overview counts and categories", () => {
  it("counts each batched checklist edit and groups by category", () => {
    const o = buildOverview({
      ...base,
      rows: [
        row({ key: "a", kind: "checklist", count: 3 }),
        row({ key: "b", kind: "completion", state: "failed" }),
        row({ key: "c", kind: "work_order_update" }),
        row({ key: "d", kind: "logbook" }),
      ],
    });
    const by = Object.fromEntries(o.categories.map((c) => [c.key, c]));
    expect(by.sessions).toMatchObject({ pending: 3, attention: 1 });
    expect(by.tasks).toMatchObject({ pending: 1, attention: 0 });
    expect(by.other).toMatchObject({ pending: 1 });
    expect(by.rooms).toMatchObject({ pending: 0, attention: 0 });
    expect(o.total).toBe(6);
  });

  it("only lists categories that apply to the role, plus any that hold work", () => {
    expect(relevantCategories("engineer")).toEqual(["tasks"]);
    expect(relevantCategories("housekeeper")).toEqual(["rooms", "tasks", "sessions"]);
    const engineer = buildOverview({ ...base, role: "engineer", rows: [] });
    expect(engineer.categories.map((c) => c.key)).toEqual(["tasks"]);
    const withLog = buildOverview({ ...base, role: "engineer", rows: [row({ kind: "logbook" })] });
    expect(withLog.categories.map((c) => c.key)).toEqual(["tasks", "other"]);
  });

  it("maps every kind to a category", () => {
    expect(categoryOf("start")).toBe("sessions");
    expect(categoryOf("task")).toBe("tasks");
    expect(categoryOf("room_status")).toBe("rooms");
  });

  it("counts only queued writes, never cached read-only data", () => {
    // The row builder is fed queues only; a room list in the store is not an input at all.
    useAppStore.setState({ myRooms: [{ id: "r1", room_number: "101" } as never] });
    expect(buildSyncRows({ sessions: {}, actions: [], queue: [] })).toEqual([]);
  });
});

describe("action queue retry policy", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    useAppStore.setState({ pendingActions: [], isOnline: true, user: null, lastSyncedAt: null });
    useAppStore.getState().setUser(profile("user-a", "hotel-1"));
  });

  const queue = () => useAppStore.getState().enqueueAction({ type: "room_status", entityId: "room-1", payload: { status: "CLEAN" } });

  it("keeps a temporarily failing action, counting attempts, and stops retrying at the ceiling", async () => {
    await queue();
    mockApi.patch.mockRejectedValue(new Error("Network request failed"));
    for (let i = 0; i < MAX_ACTION_ATTEMPTS + 2; i++) await useAppStore.getState().flushQueue();

    expect(mockApi.patch).toHaveBeenCalledTimes(MAX_ACTION_ATTEMPTS);
    expect(useAppStore.getState().pendingActions).toHaveLength(1);
    expect(useAppStore.getState().pendingActions[0].attempts).toBe(MAX_ACTION_ATTEMPTS);
  });

  it("stops at once on a refusal retrying cannot fix, but keeps the saved work", async () => {
    await queue();
    mockApi.patch.mockRejectedValue(Object.assign(new Error("Forbidden"), { name: "ApiError", status: 403 }));
    await useAppStore.getState().flushQueue();
    await useAppStore.getState().flushQueue();

    expect(mockApi.patch).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().pendingActions[0].attempts).toBe(MAX_ACTION_ATTEMPTS);
    const rows = buildSyncRows({ sessions: {}, actions: useAppStore.getState().pendingActions, queue: [] });
    expect(rows[0].state).toBe("failed");
  });

  it("keeps retrying a timeout, rate limit or outage", async () => {
    await queue();
    mockApi.patch.mockRejectedValue(Object.assign(new Error("Too many"), { name: "ApiError", status: 429 }));
    await useAppStore.getState().flushQueue();
    mockApi.patch.mockRejectedValue(Object.assign(new Error("Down"), { name: "ApiError", status: 503 }));
    await useAppStore.getState().flushQueue();
    expect(mockApi.patch).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().pendingActions[0].attempts).toBe(2);
  });

  it("Sync now gives exhausted actions another go, and a success removes them", async () => {
    await queue();
    mockApi.patch.mockRejectedValue(Object.assign(new Error("Forbidden"), { name: "ApiError", status: 403 }));
    await useAppStore.getState().flushQueue();

    await useAppStore.getState().resetFailedActions();
    expect(useAppStore.getState().pendingActions[0].attempts).toBe(0);
    mockApi.patch.mockResolvedValue({});
    await useAppStore.getState().flushQueue();
    expect(useAppStore.getState().pendingActions).toEqual([]);
  });

  it("never sends one person's saved action while another is signed in", async () => {
    await queue();
    useAppStore.getState().setUser(profile("user-b", "hotel-1"));
    await useAppStore.getState().flushQueue();
    expect(mockApi.patch).not.toHaveBeenCalled();
    expect(summarizePendingWork({ userScope: "hotel-1:user-b", actions: useAppStore.getState().pendingActions, outboxScope: null, outbox: {}, sessionScope: null, sessions: {} })).toEqual([]);
  });
});

describe("last confirmed sync", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useAppStore.setState({ user: null, lastSyncedAt: null });
  });

  it("survives a restart for the same person and never moves backwards", async () => {
    useAppStore.getState().setUser(profile("user-a", "hotel-1"));
    await recordConfirmedSync("2026-10-15T15:00:00.000Z");
    await recordConfirmedSync("2026-10-15T14:00:00.000Z"); // an older, late result
    expect(useAppStore.getState().lastSyncedAt).toBe("2026-10-15T15:00:00.000Z");

    useAppStore.setState({ lastSyncedAt: null }); // app restart: memory is gone
    await hydrateLastSynced();
    expect(useAppStore.getState().lastSyncedAt).toBe("2026-10-15T15:00:00.000Z");
  });

  it("never shows another person's time on a shared phone", async () => {
    useAppStore.getState().setUser(profile("user-a", "hotel-1"));
    await recordConfirmedSync("2026-10-15T15:00:00.000Z");

    useAppStore.getState().setUser(profile("user-b", "hotel-1"));
    expect(useAppStore.getState().lastSyncedAt).toBeNull();
    await hydrateLastSynced();
    expect(useAppStore.getState().lastSyncedAt).toBeNull();

    useAppStore.getState().setUser(profile("user-a", "hotel-1"));
    await hydrateLastSynced();
    expect(useAppStore.getState().lastSyncedAt).toBe("2026-10-15T15:00:00.000Z");
  });

  it("records nothing when nobody is signed in", async () => {
    await recordConfirmedSync();
    expect(useAppStore.getState().lastSyncedAt).toBeNull();
  });
});

describe("sign-out summary includes the work-order queue", () => {
  it("counts SQLite queue rows by kind and flags exhausted ones", () => {
    const rows = summarizePendingWork({
      userScope: "hotel-1:user-a",
      actions: [],
      outboxScope: null,
      outbox: {},
      sessionScope: null,
      sessions: {},
      queue: [
        { id: 1, entity_type: "work_order", action: "update", entity_id: "w1", room_id: null, attempts: 0, created_at: "2026-10-15T10:00:00.000Z" },
        { id: 2, entity_type: "work_order", action: "create", entity_id: null, room_id: null, attempts: 5, created_at: "2026-10-15T11:00:00.000Z" },
      ],
    });
    expect(rows).toEqual([{ key: "workOrders", count: 2, oldestAt: "2026-10-15T10:00:00.000Z", needsAttention: 1 }]);
  });
});
