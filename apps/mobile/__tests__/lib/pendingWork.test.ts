import { summarizePendingWork, totalPending } from "@/lib/auth/pendingWork";
import type { OfflineAction } from "@/stores/appStore";

const SCOPE_A = "hotel-1:alice";
const SCOPE_B = "hotel-1:bob";

const action = (type: OfflineAction["type"], owner: string | undefined, createdAt = "2026-10-01T10:00:00Z"): OfflineAction => ({
  id: `${type}-${owner}-${createdAt}`,
  type,
  entityId: "e1",
  payload: {},
  createdAt,
  owner,
});

const outboxEntry = (state: "pending" | "conflict" | "failed", queuedAt = "2026-10-01T09:00:00Z") =>
  ({ taskId: "t", state, queuedAt }) as never;

const session = (over: Record<string, unknown> = {}) =>
  ({
    roomId: "r1",
    sessionId: "s1",
    startedAt: "2026-10-01T08:00:00Z",
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    conflict: null,
    lastError: null,
    ...over,
  }) as never;

const base = { userScope: SCOPE_A, actions: [], outboxScope: SCOPE_A, outbox: {}, sessionScope: SCOPE_A, sessions: {} };

describe("summarizePendingWork", () => {
  it("returns nothing when nothing is queued", () => {
    expect(summarizePendingWork(base)).toEqual([]);
  });

  it("groups real queued work by kind with counts and the oldest time", () => {
    const rows = summarizePendingWork({
      ...base,
      actions: [
        action("room_status", SCOPE_A, "2026-10-01T10:00:00Z"),
        action("room_status", SCOPE_A, "2026-10-01T07:00:00Z"),
        action("work_order_update", SCOPE_A),
        action("logbook_create", SCOPE_A),
      ],
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.roomUpdates).toMatchObject({ count: 2, oldestAt: "2026-10-01T07:00:00Z", needsAttention: 0 });
    expect(byKey.workOrders.count).toBe(1);
    expect(byKey.logbook.count).toBe(1);
    expect(totalPending(rows)).toBe(4);
  });

  it("combines legacy and outbox task completions and flags refused ones as needing attention", () => {
    const rows = summarizePendingWork({
      ...base,
      actions: [action("task_complete", SCOPE_A)],
      outbox: { t1: outboxEntry("pending"), t2: outboxEntry("conflict"), t3: outboxEntry("failed") },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "taskCompletions", count: 4, needsAttention: 2 });
  });

  it("counts only clean sessions the server has not confirmed", () => {
    const rows = summarizePendingWork({
      ...base,
      sessions: {
        done: session({ roomId: "done", completionConfirmed: true, completeRequestedAt: "x" }),
        starting: session({ roomId: "starting", startConfirmed: false }),
        completing: session({ roomId: "completing", completeRequestedAt: "2026-10-01T11:00:00Z" }),
        edits: session({ roomId: "edits", pendingItems: { a: {} } }),
        conflict: session({ roomId: "conflict", startConfirmed: false, conflict: { code: "X" } }),
        synced: session({ roomId: "synced" }),
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "cleaningSessions", count: 4, needsAttention: 1 });
  });

  it("never shows another employee's saved work (shared phone)", () => {
    const rows = summarizePendingWork({
      ...base,
      userScope: SCOPE_B,
      actions: [action("room_status", SCOPE_A), action("task_complete", SCOPE_A), action("logbook_create", SCOPE_B)],
      // These stores still hold Alice's scope in memory until Bob's own hydrate swaps them.
      outboxScope: SCOPE_A,
      outbox: { t1: outboxEntry("pending") },
      sessionScope: SCOPE_A,
      sessions: { r1: session({ startConfirmed: false }) },
    });
    expect(rows.map((r) => r.key)).toEqual(["logbook"]);
    expect(totalPending(rows)).toBe(1);
  });

  it("ignores scoped stores (outbox, clean sessions) when nobody is signed in", () => {
    expect(
      summarizePendingWork({
        ...base,
        userScope: null,
        actions: [action("room_status", undefined)],
        outbox: { t1: outboxEntry("pending") },
        sessions: { r1: session({ startConfirmed: false }) },
      }).map((r) => r.key),
    ).toEqual(["roomUpdates"]);
  });
});
