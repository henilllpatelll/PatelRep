jest.mock("@/lib/offline/db", () => ({ getSyncQueueSummary: jest.fn() }));
jest.mock("@/stores/appStore", () => ({ useAppStore: { getState: jest.fn(() => ({ pendingActions: [] })) } }));
jest.mock("@/stores/cleanSessionStore", () => ({ useCleanSessionStore: { getState: jest.fn(() => ({ sessions: {} })) } }));

import { buildSyncRows, countPendingSync, MAX_SYNC_ATTEMPTS } from "@/lib/housekeeping/syncDetails";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import type { OfflineAction } from "@/stores/appStore";

function session(overrides: Partial<LocalCleanSession> = {}): LocalCleanSession {
  return {
    roomId: "room-218",
    sessionId: "s1",
    cleanType: "DEP",
    startedAt: "2026-10-08T09:00:00Z",
    entryAcknowledged: true,
    checklist: [],
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: "2026-10-08T09:00:00Z",
    ...overrides,
  };
}

const item = { item_id: "a", section: "Bed", label: "Linens", is_required: true, checked: true, checked_at: null };

describe("buildSyncRows", () => {
  it("lists nothing when nothing is waiting", () => {
    expect(buildSyncRows({ sessions: { "room-218": session() }, actions: [], queue: [] })).toEqual([]);
  });

  it("never lists a confirmed session", () => {
    expect(buildSyncRows({ sessions: { "room-218": session({ completionConfirmed: true, pendingItems: { a: item } }) }, actions: [], queue: [] })).toEqual([]);
  });

  it("batches checklist edits into one row with a count and adds the completion request", () => {
    const rows = buildSyncRows({
      sessions: { "room-218": session({ pendingItems: { a: item, b: { ...item, item_id: "b" } }, completeRequestedAt: "2026-10-08T10:00:00Z" }) },
      actions: [],
      queue: [],
    });
    expect(rows).toEqual([
      expect.objectContaining({ roomId: "room-218", kind: "checklist", state: "pending", count: 2 }),
      expect.objectContaining({ roomId: "room-218", kind: "completion", state: "pending" }),
    ]);
  });

  it("reports an unconfirmed start and pending linen separately", () => {
    const rows = buildSyncRows({
      sessions: { "room-218": session({ startConfirmed: false, linen: { dirtyOut: 2, cleanIn: 2, pending: true, failed: false } }) },
      actions: [],
      queue: [],
    });
    expect(rows.map((row) => row.kind)).toEqual(["start", "linen"]);
  });

  it("a completion whose answer never arrived is retrying, not pending", () => {
    const rows = buildSyncRows({ sessions: { "room-218": session({ completeRequestedAt: "x", completionUnsure: true }) }, actions: [], queue: [] });
    expect(rows).toEqual([expect.objectContaining({ kind: "completion", state: "retrying" })]);
  });

  it("a server conflict is its own state and is never silently dropped", () => {
    const rows = buildSyncRows({
      sessions: { "room-218": session({ conflict: { code: "ALREADY_COMPLETED", message: "x", at: "y" } as never, completeRequestedAt: "x" }) },
      actions: [],
      queue: [],
    });
    expect(rows).toEqual([expect.objectContaining({ kind: "completion", state: "conflict" })]);
  });

  it("separates pending, retrying and failed work orders by attempts", () => {
    const rows = buildSyncRows({
      sessions: {},
      actions: [],
      queue: [
        { id: 1, entity_type: "work_order", action: "create", entity_id: null, room_id: "room-224", attempts: 0 },
        { id: 2, entity_type: "work_order", action: "create", entity_id: null, room_id: "room-224", attempts: 2 },
        { id: 3, entity_type: "work_order", action: "create", entity_id: null, room_id: "room-224", attempts: MAX_SYNC_ATTEMPTS },
      ],
    });
    expect(rows.map((row) => row.state)).toEqual(["pending", "retrying", "failed"]);
    expect(rows.every((row) => row.kind === "work_order")).toBe(true);
  });

  it("lists the app action queue by kind only", () => {
    const actions: OfflineAction[] = [
      { id: "1", type: "logbook_create", entityId: "e1", payload: { text: "secret guest detail" }, createdAt: "x" },
      { id: "2", type: "room_status", entityId: "room-1", payload: {}, createdAt: "x" },
    ];
    const rows = buildSyncRows({ sessions: {}, actions, queue: [] });
    expect(rows.map((row) => row.kind)).toEqual(["logbook", "room_status"]);
    expect(JSON.stringify(rows)).not.toContain("secret guest detail");
  });

  it("carries no payload text for queued work orders", () => {
    const rows = buildSyncRows({
      sessions: {},
      actions: [],
      queue: [{ id: 1, entity_type: "work_order", action: "create", entity_id: null, room_id: "room-1", attempts: 0 }],
    });
    expect(Object.keys(rows[0]).sort()).toEqual(["key", "kind", "roomId", "state"]);
  });
});

describe("countPendingSync", () => {
  it("counts queued actions and unconfirmed session work for the hub badge", () => {
    const actions: OfflineAction[] = [{ id: "1", type: "logbook_create", entityId: "e", payload: {}, createdAt: "x" }];
    expect(countPendingSync({}, actions)).toBe(1);
    expect(countPendingSync({ r: session({ pendingItems: { a: item } }) }, [])).toBe(1);
    expect(countPendingSync({ r: session({ completionConfirmed: true, pendingItems: { a: item } }) }, [])).toBe(0);
  });
});
