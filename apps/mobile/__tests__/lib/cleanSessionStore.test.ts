import AsyncStorage from "@react-native-async-storage/async-storage";

class MockApiError extends Error {
  status: number;
  code?: string;
  detail?: unknown;
  constructor(message: string, status: number, code?: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("@/lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

const mockRefreshRooms = jest.fn().mockResolvedValue(undefined);
const mockDropQueued = jest.fn().mockResolvedValue(undefined);
const mockApp = {
  isOnline: true,
  user: { id: "user-1", tenant_id: "hotel-1" } as { id: string; tenant_id: string } | null,
  refreshRooms: mockRefreshRooms,
  dropQueuedRoomStatus: mockDropQueued,
};
jest.mock("@/stores/appStore", () => ({ useAppStore: { getState: () => mockApp } }));

import { selectSession, useCleanSessionStore } from "@/stores/cleanSessionStore";
import { isRoomManagedBySession } from "@/lib/housekeeping/sessionGuard";
import { getPhase, itemKey, type ChecklistItem } from "@/lib/housekeeping/cleanSession";

const ROOM = { id: "room-1", clean_type: "DEP" as string | null };

function item(id: string, label: string, required: boolean, checked = false, section = "General"): ChecklistItem {
  return { item_id: id, section, label, is_required: required, checked, checked_at: checked ? "2026-10-08T10:00:00Z" : null };
}

/** A tiny in-memory stand-in for the clean-session endpoints. */
class FakeServer {
  sessions = new Map<string, Record<string, unknown>>();
  template: ChecklistItem[] = [
    item("t1", "Strip beds", true, false, "Bedroom"),
    item("t2", "Clean bathroom", true, false, "Bathroom"),
    item("t3", "Vacuum", false, false, "General"),
  ];
  calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  failNext: Array<unknown> = [];
  online = true;
  /** The next completion is processed by the server, but the answer never reaches the app. */
  loseNextCompleteResponse = false;
  /** When set, linen PATCHes are refused with this error (everything else still works). */
  rejectLinen: unknown = null;

  private maybeFail(): void {
    if (!this.online) throw new Error("Network request failed");
    const next = this.failNext.shift();
    if (next) throw next;
  }

  handle(method: string, path: string, body?: Record<string, any>) {
    const result = this.process(method, path, body);
    if (this.loseNextCompleteResponse && method === "POST" && path.endsWith("/complete")) {
      this.loseNextCompleteResponse = false;
      throw new Error("Network request failed");
    }
    return result;
  }

  private process(method: string, path: string, body?: Record<string, any>) {
    this.calls.push({ method, path, body });
    this.maybeFail();
    if (method === "POST" && path === "/clean-sessions") {
      const existing = this.sessions.get(body!.id);
      if (existing) return { data: existing };
      const session = {
        id: body!.id,
        room_id: body!.room_id,
        housekeeper_id: "user-1",
        clean_type: "DEP",
        status: "active",
        base_clean_minutes: 30,
        started_at: body!.started_at,
        ended_at: null,
        duration_seconds: null,
        checklist: this.template.map((i) => ({ ...i })),
        checklist_done: 0,
        checklist_total: this.template.length,
      };
      this.sessions.set(body!.id, session);
      return { data: session };
    }
    if (method === "GET" && path === "/clean-sessions/active") {
      const active = [...this.sessions.values()].find((candidate) => candidate.status === "active");
      return { data: active ?? null };
    }
    const id = path.split("/")[2];
    const session = this.sessions.get(id) as any;
    if (!session) throw new MockApiError("Clean session not found", 404);
    if (method === "GET") return { data: session };
    if (method === "PATCH") {
      if (session.status !== "active") throw new MockApiError("Session is not active", 409, "SESSION_NOT_ACTIVE");
      for (const incoming of (body!.checklist ?? []) as ChecklistItem[]) {
        const target = session.checklist.find((c: ChecklistItem) => c.item_id === incoming.item_id);
        if (target) {
          target.checked = incoming.checked;
          target.checked_at = incoming.checked_at;
        }
      }
      if (body!.linen_counts) {
        if (this.rejectLinen) throw this.rejectLinen;
        session.linen_counts = body!.linen_counts;
      }
      return { data: session };
    }
    if (method === "POST" && path.endsWith("/complete")) {
      if (session.status === "completed") return { data: session };
      const missing = session.checklist.filter((c: ChecklistItem) => c.is_required && !c.checked);
      if (missing.length) {
        throw new MockApiError("incomplete", 422, "REQUIRED_ITEMS_INCOMPLETE", { missing: missing.map((m: ChecklistItem) => m.label) });
      }
      session.status = "completed";
      session.ended_at = body!.ended_at;
      session.duration_seconds = 1200;
      return { data: session };
    }
    throw new Error("unhandled " + method + " " + path);
  }

  count(method: string, path: string): number {
    return this.calls.filter((c) => c.method === method && c.path === path).length;
  }
}

let server: FakeServer;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  server = new FakeServer();
  mockApp.isOnline = true;
  mockApp.user = { id: "user-1", tenant_id: "hotel-1" };
  mockGet.mockImplementation(async (path: string) => server.handle("GET", path));
  mockPost.mockImplementation(async (path: string, body: Record<string, unknown>) => server.handle("POST", path, body));
  mockPatch.mockImplementation(async (path: string, body: Record<string, unknown>) => server.handle("PATCH", path, body));
  useCleanSessionStore.getState().reset();
});

const store = () => useCleanSessionStore.getState();
const record = () => store().sessions[ROOM.id];

/** Simulate an app restart: memory is gone, AsyncStorage is not. */
async function restart(): Promise<void> {
  store().reset();
  await store().hydrate();
}

describe("starting a session", () => {
  it("creates a persistent server session with a stable client id and the server's checklist snapshot", async () => {
    const result = await store().startSession(ROOM, { entryAcknowledged: false });

    expect(result.outcome).toBe("confirmed");
    const startCall = server.calls.find((c) => c.method === "POST" && c.path === "/clean-sessions")!;
    expect(startCall.body).toMatchObject({ room_id: "room-1", entry_acknowledged: false });
    expect(startCall.body!.id).toBe(record().sessionId);
    expect(record().checklist.map((i) => i.label)).toEqual(["Strip beds", "Clean bathroom", "Vacuum"]);
    expect(record().checklist.map((i) => i.is_required)).toEqual([true, true, false]);
    expect(getPhase(record())).toBe("active");
    expect(mockRefreshRooms).toHaveBeenCalled();
  });

  it("never mutates room status through the legacy endpoint", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    const checklist = record().checklist;
    for (const entry of checklist.filter((i) => i.is_required)) store().toggleItem(ROOM.id, itemKey(entry), true);
    await store().completeSession(ROOM.id);
    const legacy = [...mockPatch.mock.calls, ...mockPost.mock.calls].filter(([path]) => /\/rooms\/[^/]+\/status/.test(path));
    expect(legacy).toEqual([]);
    expect(mockDropQueued).toHaveBeenCalledWith(ROOM.id);
  });

  it("resumes the same session instead of creating a duplicate", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    const firstId = record().sessionId;
    await store().startSession(ROOM, { entryAcknowledged: false });
    expect(record().sessionId).toBe(firstId);
    expect(server.sessions.size).toBe(1);
  });

  it("sends the server's authoritative start time back after confirmation", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    const stored = server.sessions.get(record().sessionId) as { started_at: string };
    expect(record().startedAt).toBe(stored.started_at);
  });

  it("reports a rejected start (DND now active) and leaves no dead record behind", async () => {
    server.failNext.push(new MockApiError("Do Not Disturb", 409, "DND_ACTIVE"));
    const result = await store().startSession(ROOM, { entryAcknowledged: false });
    expect(result).toMatchObject({ outcome: "rejected", code: "DND_ACTIVE" });
    expect(record()).toBeUndefined();
    expect(isRoomManagedBySession(ROOM.id)).toBe(false);
  });
});

describe("restoring after restart", () => {
  it("restores the active session and its checklist progress from disk", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    store().toggleItem(ROOM.id, "id:t1", true);
    await restart();

    expect(record().checklist.find((i) => i.item_id === "t1")?.checked).toBe(true);
    expect(getPhase(record())).toBe("active");
  });

  it("does not start a second session when reopening a confirmed one", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    await restart();
    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });
    expect(server.count("POST", "/clean-sessions")).toBe(1);
  });

  it("attaches the server's active session when this device has no record", async () => {
    server.sessions.set("srv-1", {
      id: "srv-1", room_id: "room-1", housekeeper_id: "user-1", clean_type: "DEP", status: "active",
      started_at: "2026-10-08T09:00:00Z", ended_at: null, duration_seconds: null,
      checklist: [item("t1", "Strip beds", true, true)], checklist_done: 1, checklist_total: 1,
    });
    mockGet.mockImplementation(async (path: string) =>
      path === "/clean-sessions/active" ? { data: server.sessions.get("srv-1") } : server.handle("GET", path),
    );

    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });

    expect(record()).toMatchObject({ sessionId: "srv-1", startConfirmed: true });
    expect(record().checklist[0].checked).toBe(true);
    expect(server.count("POST", "/clean-sessions")).toBe(0);
  });

  it("attaches a legacy-started IN_PROGRESS room by starting a session for it", async () => {
    mockGet.mockImplementation(async (path: string) => (path === "/clean-sessions/active" ? { data: null } : server.handle("GET", path)));
    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });
    expect(server.count("POST", "/clean-sessions")).toBe(1);
    expect(record().startConfirmed).toBe(true);
  });

  it("leaves a room alone when the server's active session belongs to another room", async () => {
    mockGet.mockImplementation(async (path: string) =>
      path === "/clean-sessions/active"
        ? { data: { id: "other", room_id: "room-9", housekeeper_id: "user-1", status: "active", started_at: "x", checklist: [] } }
        : server.handle("GET", path),
    );
    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });
    expect(record()).toBeUndefined();
  });

  it("notices when the session was completed elsewhere", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    (server.sessions.get(record().sessionId) as any).status = "completed";
    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });
    expect(getPhase(record())).toBe("completed");
  });

  it("flags a session that no longer exists as a conflict and keeps local progress", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    store().toggleItem(ROOM.id, "id:t1", true);
    server.sessions.clear();
    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });
    expect(getPhase(record())).toBe("conflict");
    expect(record().checklist.find((i) => i.item_id === "t1")?.checked).toBe(true);
  });
});

describe("checklist persistence", () => {
  it("persists only the touched item through a session update", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    store().toggleItem(ROOM.id, "id:t2", true);
    await store().flush();

    const patch = server.calls.filter((c) => c.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect((patch[0].body!.checklist as ChecklistItem[]).map((i) => i.item_id)).toEqual(["t2"]);
    expect(record().pendingItems).toEqual({});
    expect((server.sessions.get(record().sessionId) as any).checklist[1].checked).toBe(true);
  });

  it("does not overwrite newer server state on untouched items", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    // Another device checked t1 meanwhile.
    (server.sessions.get(record().sessionId) as any).checklist[0].checked = true;
    store().toggleItem(ROOM.id, "id:t2", true);
    await store().flush();
    expect(record().checklist.find((i) => i.item_id === "t1")?.checked).toBe(true);
  });

  it("keeps edits made while a request is in flight pending", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    mockApp.isOnline = false;
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    expect(Object.keys(record().pendingItems).sort()).toEqual(["id:t1", "id:t2"]);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("completion", () => {
  async function startAndFinishRequired() {
    await store().startSession(ROOM, { entryAcknowledged: false });
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
  }

  it("refuses to submit while required items are unfinished, without touching the network", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    const result = await store().completeSession(ROOM.id);
    expect(result).toMatchObject({ outcome: "rejected", code: "REQUIRED_ITEMS_INCOMPLETE", missing: ["Strip beds", "Clean bathroom"] });
    expect(server.count("POST", "/clean-sessions/" + record().sessionId + "/complete")).toBe(0);
    expect(record().completeRequestedAt).toBeNull();
  });

  it("completes through the session API and is confirmed only after the server answers", async () => {
    await startAndFinishRequired();
    const result = await store().completeSession(ROOM.id);
    expect(result.outcome).toBe("confirmed");
    expect(getPhase(record())).toBe("completed");
    expect(record().durationSeconds).toBe(1200);
    expect(mockRefreshRooms).toHaveBeenCalled();
  });

  it("orders start -> checklist -> complete on the wire", async () => {
    await startAndFinishRequired();
    await store().completeSession(ROOM.id);
    const order = server.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path.replace(record().sessionId, ":id")}`);
    expect(order[0]).toBe("POST /clean-sessions");
    expect(order.indexOf("PATCH /clean-sessions/:id")).toBeGreaterThan(0);
    expect(order[order.length - 1]).toBe("POST /clean-sessions/:id/complete");
  });

  it("retrying a completed session does not complete twice", async () => {
    await startAndFinishRequired();
    await store().completeSession(ROOM.id);
    const again = await store().completeSession(ROOM.id);
    expect(again.outcome).toBe("confirmed");
    expect(server.calls.filter((c) => c.path.endsWith("/complete"))).toHaveLength(1);
  });

  it("surfaces a server-side required-item rejection and returns to active work", async () => {
    await startAndFinishRequired();
    // The server's snapshot has a required item this device never saw.
    (server.sessions.get(record().sessionId) as any).checklist.push(item("t9", "Late required item", true));

    const result = await store().completeSession(ROOM.id);

    expect(result).toMatchObject({ outcome: "rejected", code: "REQUIRED_ITEMS_INCOMPLETE" });
    expect(getPhase(record())).not.toBe("completed");
    expect(record().completeRequestedAt).toBeNull();
    expect(record().lastError?.missing).toEqual(["Late required item"]);
  });
});

describe("offline continuation", () => {
  beforeEach(async () => {
    // Templates cached from an earlier online moment.
    await AsyncStorage.setItem(
      "@patelrep/checklist_templates/v1/hotel-1",
      JSON.stringify([
        {
          id: "tpl-dep", clean_type: "DEP", name: "Departure",
          items: [
            { id: "t1", section: "Bedroom", label: "Strip beds", is_required: true, sort_order: 1 },
            { id: "t2", section: "Bathroom", label: "Clean bathroom", is_required: true, sort_order: 2 },
            { id: "t3", section: "General", label: "Vacuum", is_required: false, sort_order: 3 },
          ],
        },
      ]),
    );
    mockApp.isOnline = false;
  });

  it("starts from the cached hotel template, queued and clearly pending", async () => {
    const result = await store().startSession(ROOM, { entryAcknowledged: true });
    expect(result.outcome).toBe("queued");
    expect(record()).toMatchObject({ provisional: true, startConfirmed: false });
    expect(getPhase(record())).toBe("starting");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("cannot start offline without ever having downloaded the hotel checklist", async () => {
    await AsyncStorage.clear();
    const result = await store().startSession(ROOM, { entryAcknowledged: true });
    expect(result).toMatchObject({ outcome: "rejected", code: "NO_CHECKLIST_OFFLINE" });
    expect(record()).toBeUndefined();
  });

  it("a queued completion is never presented as confirmed", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    const result = await store().completeSession(ROOM.id);

    expect(result.outcome).toBe("queued");
    expect(record().completionConfirmed).toBe(false);
    expect(getPhase(record())).toBe("completing");
    expect(mockRefreshRooms).not.toHaveBeenCalled();
  });

  it("survives a restart while offline", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    store().toggleItem(ROOM.id, "id:t1", true);
    await restart();
    expect(getPhase(record())).toBe("starting");
    expect(record().checklist.find((i) => i.item_id === "t1")?.checked).toBe(true);
  });

  it("replays start, then checklist, then completion once, in order, when connectivity returns", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    await store().completeSession(ROOM.id);
    await restart();

    mockApp.isOnline = true;
    await Promise.all([store().flush(), store().flush()]); // overlapping reconnect events

    const writes = server.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path.replace(record().sessionId, ":id")}`);
    expect(writes).toEqual(["POST /clean-sessions", "PATCH /clean-sessions/:id", "POST /clean-sessions/:id/complete"]);
    expect(getPhase(record())).toBe("completed");
    expect(record().provisional).toBe(false);
    // The idempotency key stayed the same across the offline period and the replay.
    expect(server.sessions.has(record().sessionId)).toBe(true);
  });

  it("replaces the cached checklist with the server snapshot, carrying checked items over", async () => {
    server.template = [item("n1", "Strip beds", true, false, "Bedroom"), item("n2", "Deep clean tub", true, false, "Bathroom")];
    await store().startSession(ROOM, { entryAcknowledged: true });
    store().toggleItem(ROOM.id, "id:t1", true);
    mockApp.isOnline = true;
    await store().flush();

    expect(record().checklist.map((i) => i.label)).toEqual(["Strip beds", "Deep clean tub"]);
    expect(record().checklist[0]).toMatchObject({ item_id: "n1", checked: true });
    expect((server.sessions.get(record().sessionId) as any).checklist[0].checked).toBe(true);
  });

  it("turns a rejected replay into a visible conflict and keeps the local work recoverable", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    store().toggleItem(ROOM.id, "id:t1", true);
    mockApp.isOnline = true;
    server.failNext.push(new MockApiError("Do Not Disturb is active", 409, "DND_ACTIVE"));
    await store().flush();

    expect(getPhase(record())).toBe("conflict");
    expect(record().conflict).toMatchObject({ code: "DND_ACTIVE" });
    expect(record().checklist.find((i) => i.item_id === "t1")?.checked).toBe(true);
    // Nothing further is sent while the conflict stands.
    const before = server.calls.length;
    await store().flush();
    expect(server.calls.length).toBe(before);

    // After the housekeeper resolves it, the same queued work goes through.
    await store().retry(ROOM.id);
    expect(record().startConfirmed).toBe(true);
    expect(record().conflict).toBeNull();
  });

  it("keeps work queued across transient server failures", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    mockApp.isOnline = true;
    server.failNext.push(new MockApiError("Bad gateway", 502));
    await store().flush();
    expect(getPhase(record())).toBe("starting");
    expect(record().conflict).toBeNull();
    await store().flush();
    expect(getPhase(record())).toBe("active");
  });
});

describe("isolation", () => {
  it("does not show one user's session to another on the same device", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    expect(selectSession(ROOM.id)(store())).toBeDefined();

    mockApp.user = { id: "user-2", tenant_id: "hotel-1" };
    expect(selectSession(ROOM.id)(store())).toBeUndefined();
    await store().hydrate();
    expect(store().sessions[ROOM.id]).toBeUndefined();

    mockApp.user = { id: "user-1", tenant_id: "hotel-2" };
    await store().hydrate();
    expect(store().sessions[ROOM.id]).toBeUndefined();

    mockApp.user = { id: "user-1", tenant_id: "hotel-1" };
    await store().hydrate();
    expect(store().sessions[ROOM.id]).toBeDefined();
  });

  it("registers rooms with an unfinished session so the legacy queue skips them", async () => {
    await store().startSession(ROOM, { entryAcknowledged: false });
    expect(isRoomManagedBySession(ROOM.id)).toBe(true);
    store().discard(ROOM.id);
    expect(isRoomManagedBySession(ROOM.id)).toBe(false);
  });
});

describe("restoreActive (read-only dashboard restore)", () => {
  function seedServerSession(): Record<string, unknown> {
    const session = {
      id: "srv-1",
      room_id: "room-9",
      housekeeper_id: "user-1",
      clean_type: "DEP",
      status: "active",
      started_at: "2026-10-08T14:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
      checklist: server.template.map((i) => ({ ...i })),
      checklist_done: 0,
      checklist_total: 3,
    };
    server.sessions.set("srv-1", session);
    return session;
  }

  it("adopts the server's active session when the device has no record, keeping the real start time", async () => {
    seedServerSession();
    expect(await store().restoreActive()).toBe("restored");
    const restored = store().sessions["room-9"];
    expect(restored).toMatchObject({ sessionId: "srv-1", startConfirmed: true, startedAt: "2026-10-08T14:00:00.000Z" });
    expect(restored.checklist).toHaveLength(3);
    expect(isRoomManagedBySession("room-9")).toBe(true);
  });

  it("survives a restart after being adopted", async () => {
    seedServerSession();
    await store().restoreActive();
    await restart();
    expect(store().sessions["room-9"]?.sessionId).toBe("srv-1");
  });

  it("never starts a session: no active session means no POST and no record", async () => {
    expect(await store().restoreActive()).toBe("none");
    expect(mockPost).not.toHaveBeenCalled();
    expect(store().sessions).toEqual({});
  });

  it("keeps unsynced local work instead of overwriting it with the server copy", async () => {
    await store().startSession({ id: "room-9", clean_type: "DEP" }, { entryAcknowledged: true });
    const local = store().sessions["room-9"];
    const entry = local.checklist[0];
    store().toggleItem("room-9", itemKey(entry), true);
    expect(await store().restoreActive()).toBe("restored");
    const after = store().sessions["room-9"];
    expect(after.sessionId).toBe(local.sessionId);
    expect(after.checklist.find((c) => itemKey(c) === itemKey(entry))?.checked).toBe(true);
    expect(server.sessions.size).toBe(1);
  });

  it("reports offline and failed lookups without touching local state", async () => {
    mockApp.isOnline = false;
    expect(await store().restoreActive()).toBe("offline");
    mockApp.isOnline = true;
    server.failNext.push(new Error("boom"));
    expect(await store().restoreActive()).toBe("failed");
    expect(store().sessions).toEqual({});
  });
});

describe("standard clean time", () => {
  it("adopts the room type's base clean minutes from the server session", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    expect(record().baseCleanMinutes).toBe(30);
  });

  it("keeps it after a restart", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    await restart();
    expect(record().baseCleanMinutes).toBe(30);
  });

  it("restores it, with the real start time, when the device had no record", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    const startedAt = record().startedAt;
    store().reset();
    await AsyncStorage.clear();
    await store().restoreActive();
    expect(record().baseCleanMinutes).toBe(30);
    expect(record().startedAt).toBe(startedAt);
  });
});

describe("linen exchange", () => {
  async function started() {
    await store().startSession(ROOM, { entryAcknowledged: true });
  }
  const patches = () => server.calls.filter((c) => c.method === "PATCH");

  it("saves the counts on this session through the session update", async () => {
    await started();
    await store().saveLinen(ROOM.id, { dirtyOut: 4, cleanIn: 3 });

    expect(patches().pop()?.body).toEqual({ linen_counts: { dirty_out: 4, clean_in: 3 } });
    expect(record().linen).toEqual({ dirtyOut: 4, cleanIn: 3, pending: false, failed: false });
    expect((server.sessions.get(record().sessionId) as any).linen_counts).toEqual({ dirty_out: 4, clean_in: 3 });
  });

  it("keeps them keyed to the right session across a restart", async () => {
    await started();
    await store().saveLinen(ROOM.id, { dirtyOut: 2, cleanIn: 2 });
    const id = record().sessionId;
    await restart();
    expect(record().sessionId).toBe(id);
    expect(record().linen).toMatchObject({ dirtyOut: 2, cleanIn: 2 });
  });

  it("clamps to whole numbers between 0 and 99", async () => {
    await started();
    await store().saveLinen(ROOM.id, { dirtyOut: -3, cleanIn: 250 });
    expect(patches().pop()?.body).toEqual({ linen_counts: { dirty_out: 0, clean_in: 99 } });
    await store().saveLinen(ROOM.id, { dirtyOut: 2.7, cleanIn: Number.NaN });
    expect(patches().pop()?.body).toEqual({ linen_counts: { dirty_out: 2, clean_in: 0 } });
  });

  it("offline: stays pending on the device and counts as a pending change", async () => {
    await started();
    mockApp.isOnline = false;
    await store().saveLinen(ROOM.id, { dirtyOut: 1, cleanIn: 1 });

    expect(record().linen).toMatchObject({ pending: true, failed: false });
    expect(patches()).toHaveLength(0);
    expect(getPhase(record())).toBe("active");
    const { hasPendingSync, pendingChangeCount } = jest.requireActual("@/lib/housekeeping/cleanSession") as typeof import("@/lib/housekeeping/cleanSession");
    expect(hasPendingSync(record())).toBe(true);
    expect(pendingChangeCount(record())).toBe(1);
  });

  it("replays in order after reconnecting: checklist, then linen, then completion", async () => {
    await started();
    mockApp.isOnline = false;
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    await store().saveLinen(ROOM.id, { dirtyOut: 3, cleanIn: 3 });
    await store().completeSession(ROOM.id);
    server.calls.length = 0;

    mockApp.isOnline = true;
    await store().flush();

    const writes = server.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path.replace(record().sessionId, ":id")}`);
    expect(writes).toEqual(["PATCH /clean-sessions/:id", "PATCH /clean-sessions/:id", "POST /clean-sessions/:id/complete"]);
    expect(server.calls.filter((c) => c.method === "PATCH")[1].body).toEqual({ linen_counts: { dirty_out: 3, clean_in: 3 } });
    expect(getPhase(record())).toBe("completed");
  });

  it("an edit made while a save is in flight stays pending", async () => {
    await started();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = mockPatch.getMockImplementation()!;
    mockPatch.mockImplementationOnce(async (path: string, body: Record<string, unknown>) => {
      await gate;
      return original(path, body);
    });

    const first = store().saveLinen(ROOM.id, { dirtyOut: 1, cleanIn: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = store().saveLinen(ROOM.id, { dirtyOut: 5, cleanIn: 5 });
    release();
    await Promise.all([first, second]);

    expect(record().linen).toEqual({ dirtyOut: 5, cleanIn: 5, pending: false, failed: false });
    expect((server.sessions.get(record().sessionId) as any).linen_counts).toEqual({ dirty_out: 5, clean_in: 5 });
  });

  it("a refused save is flagged but never blocks submitting the room", async () => {
    await started();
    server.rejectLinen = new MockApiError("boom", 500);
    await store().saveLinen(ROOM.id, { dirtyOut: 1, cleanIn: 1 });
    expect(record().linen).toEqual({ dirtyOut: 1, cleanIn: 1, pending: false, failed: true });

    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    const result = await store().completeSession(ROOM.id);
    expect(result.outcome).toBe("confirmed");
    expect(record().linen?.failed).toBe(true); // still visible, still on the device
  });

  it("linen still pending when the room is submitted, then refused by the server, does not hold up the completion", async () => {
    await started();
    mockApp.isOnline = false;
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    await store().saveLinen(ROOM.id, { dirtyOut: 1, cleanIn: 1 });
    expect(record().linen?.pending).toBe(true);

    mockApp.isOnline = true;
    server.rejectLinen = new MockApiError("boom", 500);
    const result = await store().completeSession(ROOM.id);

    expect(result.outcome).toBe("confirmed");
    expect(record().linen).toMatchObject({ pending: false, failed: true });
    expect(server.calls.some((c) => c.method === "POST" && c.path.endsWith("/complete"))).toBe(true);
  });

  it("re-saving after a failure sends the counts again", async () => {
    await started();
    server.rejectLinen = new MockApiError("nope", 422);
    await store().saveLinen(ROOM.id, { dirtyOut: 1, cleanIn: 1 });
    server.rejectLinen = null;
    await store().saveLinen(ROOM.id, { dirtyOut: 1, cleanIn: 1 });
    expect(record().linen).toEqual({ dirtyOut: 1, cleanIn: 1, pending: false, failed: false });
  });

  it("cannot be changed once the finish was requested or confirmed", async () => {
    await started();
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    await store().completeSession(ROOM.id);
    const before = patches().length;
    await store().saveLinen(ROOM.id, { dirtyOut: 9, cleanIn: 9 });
    expect(patches()).toHaveLength(before);
    expect(record().linen).toBeUndefined();
  });

  it("adopts counts the server already holds when the device has none", async () => {
    await started();
    (server.sessions.get(record().sessionId) as any).linen_counts = { dirty_out: 6, clean_in: 6 };
    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });
    expect(record().linen).toEqual({ dirtyOut: 6, cleanIn: 6, pending: false, failed: false });
  });

  it("never overwrites unsaved device counts with the server copy", async () => {
    await started();
    mockApp.isOnline = false;
    await store().saveLinen(ROOM.id, { dirtyOut: 2, cleanIn: 2 });
    mockApp.isOnline = true;
    (server.sessions.get(record().sessionId) as any).linen_counts = { dirty_out: 9, clean_in: 9 };
    await store().restoreForRoom({ id: ROOM.id, status: "IN_PROGRESS" });
    expect(record().linen).toMatchObject({ dirtyOut: 2, cleanIn: 2, pending: true });
  });
});

describe("completion with an unknown outcome", () => {
  async function readyToFinish() {
    await store().startSession(ROOM, { entryAcknowledged: true });
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    // Let the syncs the ticks queued run to the end, so each scenario starts from a quiet queue.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await store().flush();
    expect(Object.keys(record().pendingItems)).toHaveLength(0);
    server.calls.length = 0;
  }
  const completeCalls = () => server.calls.filter((c) => c.method === "POST" && c.path.endsWith("/complete"));

  it("a lost answer is queued, never shown as confirmed, and marked as unsure", async () => {
    await readyToFinish();
    server.loseNextCompleteResponse = true;

    const result = await store().completeSession(ROOM.id);

    expect(result.outcome).toBe("queued");
    expect(record().completionConfirmed).toBe(false);
    expect(record().completionUnsure).toBe(true);
    expect(getPhase(record())).toBe("completing");
  });

  it("asks the server first and does not send the completion again when it already went through", async () => {
    await readyToFinish();
    server.loseNextCompleteResponse = true;
    await store().completeSession(ROOM.id);
    expect(completeCalls()).toHaveLength(1);

    await store().flush();

    expect(server.calls.some((c) => c.method === "GET" && c.path === "/clean-sessions/" + record().sessionId)).toBe(true);
    expect(completeCalls()).toHaveLength(1); // reconciled, not re-sent
    expect(record().completionConfirmed).toBe(true);
    expect(record().completionUnsure).toBe(false);
    expect(record().durationSeconds).toBe(1200);
  });

  it("sends it again, once, when the first request never reached the server", async () => {
    await readyToFinish();
    server.failNext.push(new Error("Network request failed")); // dropped before processing
    const first = await store().completeSession(ROOM.id);
    expect(first.outcome).toBe("queued");
    expect(record().completionUnsure).toBe(true);

    await store().flush();

    expect(record().completionConfirmed).toBe(true);
    expect(completeCalls()).toHaveLength(2); // the dropped attempt + the one that landed
    expect((server.sessions.get(record().sessionId) as any).status).toBe("completed");
  });

  it("a session the server closed in the meantime becomes a conflict, with the work kept", async () => {
    await readyToFinish();
    server.failNext.push(new Error("Network request failed"));
    await store().completeSession(ROOM.id);
    (server.sessions.get(record().sessionId) as any).status = "abandoned";

    await store().flush();

    expect(getPhase(record())).toBe("conflict");
    expect(record().conflict?.code).toBe("SESSION_ABANDONED");
    expect(record().checklist.find((i) => i.item_id === "t1")?.checked).toBe(true);
  });

  it("a definite refusal is not treated as unknown", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    (server.sessions.get(record().sessionId) as any).checklist.push(item("t9", "Late required item", true));
    store().toggleItem(ROOM.id, "id:t1", true);
    store().toggleItem(ROOM.id, "id:t2", true);
    await store().completeSession(ROOM.id);
    expect(record().completionUnsure).toBeFalsy();
  });

  it("duplicate completion requests share one request", async () => {
    await readyToFinish();
    const [a, b, c] = await Promise.all([
      store().completeSession(ROOM.id),
      store().completeSession(ROOM.id),
      store().completeSession(ROOM.id),
    ]);
    expect([a.outcome, b.outcome, c.outcome]).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(completeCalls()).toHaveLength(1);
  });
});

describe("rapid and repeated actions", () => {
  const startCalls = () => server.calls.filter((c) => c.method === "POST" && c.path === "/clean-sessions");
  const checklistCalls = () => server.calls.filter((c) => c.method === "PATCH");

  it("double-tapping Start creates one session and one server request", async () => {
    const [a, b] = await Promise.all([
      store().startSession(ROOM, { entryAcknowledged: true }),
      store().startSession(ROOM, { entryAcknowledged: true }),
    ]);
    expect([a.outcome, b.outcome]).toEqual(["confirmed", "confirmed"]);
    expect(server.sessions.size).toBe(1);
    expect(startCalls()).toHaveLength(1);
  });

  it("repeated taps on one item settle on the last value and the server agrees", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    for (const checked of [true, false, true, false, true]) store().toggleItem(ROOM.id, "id:t1", checked);
    await store().flush();
    const stored = server.sessions.get(record().sessionId) as { checklist: ChecklistItem[] };
    expect(stored.checklist.find((c) => c.item_id === "t1")?.checked).toBe(true);
    expect(record().checklist.find((c) => c.item_id === "t1")?.checked).toBe(true);
    expect(Object.keys(record().pendingItems)).toHaveLength(0);
  });

  it("two syncs triggered at once do not replay the same checklist change twice", async () => {
    await store().startSession(ROOM, { entryAcknowledged: true });
    mockApp.isOnline = false;
    store().toggleItem(ROOM.id, "id:t1", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    mockApp.isOnline = true;
    server.calls.length = 0;
    await Promise.all([store().flush(), store().flush()]);
    expect(checklistCalls()).toHaveLength(1);
    expect(Object.keys(record().pendingItems)).toHaveLength(0);
  });

  it("a room reassigned while the device was offline keeps the queued work as a conflict", async () => {
    await AsyncStorage.setItem(
      "@patelrep/checklist_templates/v1/hotel-1",
      JSON.stringify([
        {
          id: "tpl-dep", clean_type: "DEP", name: "Departure",
          items: [{ id: "t1", section: "Bedroom", label: "Strip beds", is_required: true, sort_order: 1 }],
        },
      ]),
    );
    mockApp.isOnline = false;
    const queued = await store().startSession(ROOM, { entryAcknowledged: true });
    expect(queued.outcome).toBe("queued");
    store().toggleItem(ROOM.id, "id:t1", true);
    mockApp.isOnline = true;
    server.failNext.push(new MockApiError("Room is assigned to someone else", 403, "NOT_ASSIGNED"));
    await store().flush();
    expect(record().conflict).toMatchObject({ code: "NOT_ASSIGNED" });
    expect(record().checklist.find((c) => c.item_id === "t1")?.checked).toBe(true);
    expect(server.sessions.size).toBe(0);
  });
});
