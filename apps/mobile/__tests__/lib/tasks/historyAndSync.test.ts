import type { Task } from "@/lib/api/tasks";
import { groupHistory, mergeHistory, sortHistory } from "@/lib/tasks/offline/history";
import type { OutboxEntry } from "@/lib/tasks/offline/outboxPolicy";
import { attentionCount, buildSyncRows, deriveSyncKey, pendingCount } from "@/lib/tasks/offline/syncStatus";

function done(id: string, completedAt: string | null, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    task_type: "general",
    status: "completed",
    priority: "normal",
    assigned_to: "me",
    assigned_to_name: null,
    created_by: null,
    created_by_name: null,
    room_id: null,
    room_number: null,
    room_floor: null,
    location_text: null,
    due_at: null,
    created_at: null,
    started_at: null,
    completed_at: completedAt,
    is_ai_created: false,
    guest_request: null,
    blocker: null,
    ...extra,
  };
}

function entry(taskId: string, state: OutboxEntry["state"], queuedAt = "2026-10-13T16:00:00Z"): OutboxEntry {
  return {
    mutationId: `m-${taskId}`,
    op: "complete",
    taskId,
    userId: "me",
    tenantId: "h1",
    task: done(taskId, null, { status: "in_progress" }),
    note: null,
    observedStatus: "in_progress",
    observedAssignee: "me",
    queuedAt,
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    state,
    conflict: state === "conflict" ? { reason: "reassigned", at: queuedAt } : null,
  };
}

const CHICAGO = "America/Chicago";

describe("completed history ordering", () => {
  it("orders newest completion first and breaks ties by id, the same way the server pages", () => {
    const sorted = sortHistory([
      done("a", "2026-10-13T15:00:00Z"),
      done("c", "2026-10-13T16:00:00Z"),
      done("b", "2026-10-13T16:00:00Z"),
      done("d", "2026-10-12T16:00:00Z"),
    ]);

    expect(sorted.map((t) => t.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("merges pages without duplicates, newest copy wins, order stays deterministic", () => {
    const page1 = [done("a", "2026-10-13T16:00:00Z", { title: "old title" }), done("b", "2026-10-13T15:00:00Z")];
    const page2 = [done("b", "2026-10-13T15:00:00Z"), done("c", "2026-10-13T14:00:00Z"), done("a", "2026-10-13T16:00:00Z", { title: "new title" })];

    const merged = mergeHistory(page1, page2);

    expect(merged.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(merged[0].title).toBe("new title");
  });

  it("shows only server-completed rows that have a completion time (never an in-progress or pending one)", () => {
    const merged = mergeHistory([], [done("a", "2026-10-13T16:00:00Z"), done("legacy", null), done("open", "2026-10-13T16:00:00Z", { status: "in_progress" })]);

    expect(merged.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("hotel-local day grouping", () => {
  // 'now' is 5:30 AM Central on Oct 13 (= 10:30 UTC); the hotel day is not the UTC day or the phone's day.
  const now = new Date("2026-10-13T10:30:00Z");

  it("groups into Today / Yesterday / dated sections by the hotel's calendar day", () => {
    const sections = groupHistory(
      [
        done("t1", "2026-10-13T10:00:00Z"), // 5:00 AM Oct 13 Central -> today
        done("y1", "2026-10-13T04:30:00Z"), // 11:30 PM Oct 12 Central -> yesterday (still Oct 13 in UTC!)
        done("y2", "2026-10-12T20:00:00Z"), // 3:00 PM Oct 12 Central -> yesterday
        done("o1", "2026-10-09T18:00:00Z"), // Oct 9 Central
      ],
      now,
      CHICAGO,
    );

    expect(sections.map((s) => [s.key, s.data.map((t) => t.id)])).toEqual([
      ["today", ["t1"]],
      ["yesterday", ["y1", "y2"]],
      ["2026-10-09", ["o1"]],
    ]);
  });

  it("uses the hotel zone, not the viewer's, so a different zone moves the boundary", () => {
    const task = done("x", "2026-10-13T04:30:00Z"); // Oct 13 04:30 UTC
    expect(groupHistory([task], now, "UTC")[0].key).toBe("today");
    expect(groupHistory([task], now, CHICAGO)[0].key).toBe("yesterday");
  });

  it("returns nothing for an empty history", () => {
    expect(groupHistory([], now, CHICAGO)).toEqual([]);
  });
});

describe("sync status", () => {
  const none = {};

  it("is synced only when online, idle, fresh and nothing is waiting", () => {
    expect(deriveSyncKey({ isOnline: true, entries: none, sending: none, refreshing: false, stale: false })).toBe("synced");
  });

  it("is never 'synced' just because there is a connection", () => {
    expect(deriveSyncKey({ isOnline: true, entries: { t1: entry("t1", "pending") }, sending: none, refreshing: false, stale: false })).toBe("pending");
    expect(deriveSyncKey({ isOnline: true, entries: none, sending: none, refreshing: false, stale: true })).toBe("stale");
  });

  it("reports offline only when nothing is saved; saved changes win over plain offline", () => {
    expect(deriveSyncKey({ isOnline: false, entries: none, sending: none, refreshing: false, stale: false })).toBe("offline");
    expect(deriveSyncKey({ isOnline: false, entries: { t1: entry("t1", "pending") }, sending: none, refreshing: false, stale: false })).toBe("pending");
  });

  it("reports syncing while sending or refreshing", () => {
    expect(deriveSyncKey({ isOnline: true, entries: { t1: entry("t1", "pending") }, sending: { t1: true }, refreshing: false, stale: false })).toBe("syncing");
    expect(deriveSyncKey({ isOnline: true, entries: none, sending: none, refreshing: true, stale: false })).toBe("syncing");
  });

  it("needs attention beats everything: a refused or exhausted item is never hidden", () => {
    for (const state of ["conflict", "failed"] as const) {
      expect(deriveSyncKey({ isOnline: false, entries: { t1: entry("t1", state), t2: entry("t2", "pending") }, sending: { t2: true }, refreshing: true, stale: true })).toBe("attention");
    }
  });

  it("counts pending and attention separately", () => {
    const entries = { a: entry("a", "pending"), b: entry("b", "conflict"), c: entry("c", "failed") };
    expect(pendingCount(entries)).toBe(1);
    expect(attentionCount(entries)).toBe(2);
  });

  it("builds rows with refused items first, then sending, then waiting oldest-first", () => {
    const entries = {
      p2: entry("p2", "pending", "2026-10-13T17:00:00Z"),
      p1: entry("p1", "pending", "2026-10-13T16:00:00Z"),
      s: entry("s", "pending", "2026-10-13T18:00:00Z"),
      c: entry("c", "conflict"),
      f: entry("f", "failed"),
    };

    const rows = buildSyncRows(entries, { s: true });

    expect(rows.map((r) => [r.taskId, r.state])).toEqual([
      ["c", "conflict"],
      ["f", "failed"],
      ["s", "sending"],
      ["p1", "pending"],
      ["p2", "pending"],
    ]);
  });
});
