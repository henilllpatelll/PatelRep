import { build, room, session } from "../helpers/homeModelFixture";
import { buildSyncRows, type SyncRow } from "@/lib/housekeeping/syncDetails";
import { buildSyncStatusView } from "@/lib/housekeeping/syncStatus";

const row = (overrides: Partial<SyncRow>): SyncRow => ({ key: "r", roomId: null, kind: "checklist", state: "pending", ...overrides });
const view = (model: ReturnType<typeof build>, syncing = false, lastSyncedAt: string | null = "2026-10-14T14:00:00.000Z") =>
  buildSyncStatusView({ model, lastSyncedAt, syncing });

const rooms = () => [room("208", { status: "IN_PROGRESS" }), room("205")];

describe("buildSyncStatusView — status", () => {
  it("is synced only when nothing waits, nothing failed and the list is fresh", () => {
    expect(view(build(rooms())).status).toBe("synced");
  });

  it("is offline with cached data, or plain offline with none", () => {
    expect(view(build(rooms(), { online: false })).status).toBe("offline_cached");
    expect(view(build([], { online: false, board: { loading: false, freshness: "never", confirmedEmpty: false, serverShiftDate: null, answeredForDate: null } })).status).toBe("offline");
  });

  it("is pending while changes are saved on the phone, and syncing while a retry runs", () => {
    const model = build(rooms(), { syncRows: [row({ count: 2 })] });
    expect(view(model).status).toBe("pending");
    expect(view(model, true).status).toBe("syncing");
  });

  it("is stale when everything is sent but the room list is old", () => {
    expect(view(build(rooms(), { board: { freshness: "stale" } })).status).toBe("stale");
  });

  it("puts failures and conflicts ahead of everything, even offline or mid-retry", () => {
    expect(view(build(rooms(), { syncRows: [row({ state: "failed" })] }), true).status).toBe("failed");
    expect(view(build(rooms(), { online: false, syncRows: [row({ state: "conflict", roomId: "208" })] })).status).toBe("conflict");
  });

  it("is never 'synced' while a queue could not be read", () => {
    const model = build(rooms());
    const unreadable = { ...model, sync: { ...model.sync, complete: false, status: "pending" as const } };
    const result = view(unreadable);
    expect(result.status).toBe("pending");
    expect(result.unreadable).toBe(true);
  });
});

describe("buildSyncStatusView — rows", () => {
  it("names the room, the kind, when it was saved and where it stands", () => {
    const model = build(rooms(), {
      syncRows: [row({ key: "a", roomId: "208", kind: "checklist", count: 3, savedAt: "2026-10-14T14:50:00.000Z" })],
    });
    const [first] = view(model).rows;
    expect(first).toMatchObject({ roomNumber: "208", kind: "checklist", state: "pending", count: 3, savedAt: "2026-10-14T14:50:00.000Z", action: null });
  });

  it("shows waiting rows as sending during a retry, but never a refused one", () => {
    const model = build(rooms(), { syncRows: [row({ key: "a" }), row({ key: "b", state: "conflict", roomId: "208" })] });
    const states = Object.fromEntries(view(model, true).rows.map((r) => [r.key, r.state]));
    expect(states).toEqual({ a: "syncing", b: "conflict" });
  });

  it("sends a conflict back to its room and a task conflict to Tasks — it never replays one from here", () => {
    const model = build(rooms(), {
      syncRows: [row({ key: "c", state: "conflict", roomId: "208", kind: "completion" }), row({ key: "t", state: "failed", kind: "task" })],
    });
    const byKey = Object.fromEntries(view(model).rows.map((r) => [r.key, r.action]));
    expect(byKey.c).toEqual({ type: "room", roomId: "208" });
    expect(byKey.t).toEqual({ type: "tasks" });
  });

  it("carries no typed content: only kind, room, time and a reason code", () => {
    const model = build(rooms(), { syncRows: [row({ roomId: "208", savedAt: "2026-10-14T14:50:00.000Z", reason: "SESSION_GONE" })] });
    expect(Object.keys(view(model).rows[0]).sort()).toEqual(["action", "count", "key", "kind", "reason", "roomId", "roomNumber", "savedAt", "state"]);
  });
});

describe("buildSyncStatusView — retry", () => {
  it("allows a retry when there is something to send and a connection", () => {
    const result = view(build(rooms(), { syncRows: [row({})] }));
    expect(result).toMatchObject({ canRetry: true, retryBlock: null });
  });

  it("explains why it is unavailable: offline, nothing to send, or only conflicts", () => {
    expect(view(build(rooms(), { online: false, syncRows: [row({})] }))).toMatchObject({ canRetry: false, retryBlock: "offline" });
    expect(view(build(rooms()))).toMatchObject({ canRetry: false, retryBlock: "nothing" });
    expect(view(build(rooms(), { syncRows: [row({ state: "conflict", roomId: "208" })] }))).toMatchObject({ canRetry: false, retryBlock: "conflicts_only" });
  });

  it("does not allow a second retry while one is running", () => {
    expect(view(build(rooms(), { syncRows: [row({})] }), true).canRetry).toBe(false);
  });
});

describe("buildSyncRows — save time and reason", () => {
  it("records when a session change was saved, and why a refused one is stuck", () => {
    const rows = buildSyncRows({
      sessions: {
        "208": session("208", { startConfirmed: false, startedAt: "2026-10-14T14:00:00.000Z", pendingItems: { a: { item_id: "a", section: "x", label: "y", is_required: true, checked: true, checked_at: null } } }),
        "205": session("205", { conflict: { code: "SESSION_GONE", message: "gone", at: "2026-10-14T14:10:00.000Z" } }),
      },
      actions: [],
      queue: [],
    });
    const start = rows.find((r) => r.key === "session-208-start");
    const conflict = rows.find((r) => r.key === "session-205-conflict");
    expect(start?.savedAt).toBe("2026-10-14T14:00:00.000Z");
    expect(conflict).toMatchObject({ state: "conflict", reason: "SESSION_GONE" });
  });

  it("marks an unanswered completion as unsure, not as done", () => {
    const rows = buildSyncRows({
      sessions: { "208": session("208", { completeRequestedAt: "2026-10-14T14:58:00.000Z", completionUnsure: true }) },
      actions: [],
      queue: [],
    });
    expect(rows.find((r) => r.kind === "completion")).toMatchObject({ state: "retrying", reason: "COMPLETION_UNSURE", savedAt: "2026-10-14T14:58:00.000Z" });
  });

  it("reads the save time of work-order queue rows", () => {
    const rows = buildSyncRows({
      sessions: {},
      actions: [],
      queue: [{ id: 1, entity_type: "work_order", action: "create", entity_id: null, room_id: "208", attempts: 0, created_at: "2026-10-14T13:00:00.000Z" }],
    });
    expect(rows[0].savedAt).toBe("2026-10-14T13:00:00.000Z");
  });
});
