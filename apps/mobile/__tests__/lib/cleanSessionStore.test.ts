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

  private maybeFail(): void {
    if (!this.online) throw new Error("Network request failed");
    const next = this.failNext.shift();
    if (next) throw next;
  }

  handle(method: string, path: string, body?: Record<string, any>) {
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
    const id = path.split("/")[2];
    const session = this.sessions.get(id) as any;
    if (!session) throw new MockApiError("Clean session not found", 404);
    if (method === "GET") return { data: session };
    if (method === "PATCH") {
      for (const incoming of body!.checklist as ChecklistItem[]) {
        const target = session.checklist.find((c: ChecklistItem) => c.item_id === incoming.item_id);
        if (target) {
          target.checked = incoming.checked;
          target.checked_at = incoming.checked_at;
        }
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
