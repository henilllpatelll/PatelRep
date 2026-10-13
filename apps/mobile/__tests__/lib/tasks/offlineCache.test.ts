import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Task } from "@/lib/api/tasks";
import {
  CACHE_MAX_AGE_MS,
  HISTORY_CACHE_LIMIT,
  TASK_CACHE_PREFIX,
  TASK_CACHE_VERSION,
  clearAllTaskCaches,
  emptyCache,
  pruneForeignTaskCaches,
  readTaskCache,
  sanitizeCache,
  saveDoneToday,
  saveHistoryFirstPage,
  saveMyWork,
  slimTask,
  taskScope,
  updateTaskCache,
} from "@/lib/tasks/offline/taskCache";

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "Bring two towels",
    task_type: "guest_request",
    status: "in_progress",
    priority: "normal",
    assigned_to: "u1",
    assigned_to_name: "Maria",
    created_by: null,
    created_by_name: null,
    room_id: "r1",
    room_number: "214",
    room_floor: 2,
    location_text: null,
    due_at: null,
    created_at: "2026-10-13T10:00:00Z",
    started_at: null,
    completed_at: null,
    is_ai_created: false,
    guest_request: { id: "g1", status: "open" },
    blocker: null,
    ...extra,
  };
}

const A = "hotel-1:user-a";
const B = "hotel-1:user-b";
const OTHER_HOTEL = "hotel-2:user-a";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("task cache scope", () => {
  it("derives the scope from hotel AND user, and from nothing when either is missing", () => {
    expect(taskScope({ id: "u", tenant_id: "h" })).toBe("h:u");
    expect(taskScope({ id: "u", tenant_id: "" })).toBeNull();
    expect(taskScope({ id: "u" })).toBeNull();
    expect(taskScope(null)).toBeNull();
  });

  it("only ever returns a user's own saved tasks (User A cannot read User B's)", async () => {
    await saveMyWork(A, [task("a1")], false, "America/Chicago");
    await saveMyWork(B, [task("b1")], false, "America/Chicago");

    expect((await readTaskCache(A)).mine?.tasks.map((t) => t.id)).toEqual(["a1"]);
    expect((await readTaskCache(B)).mine?.tasks.map((t) => t.id)).toEqual(["b1"]);
  });

  it("never exposes one hotel's saved tasks to the same person's other hotel", async () => {
    await saveMyWork(A, [task("a1")], false, null);

    expect((await readTaskCache(OTHER_HOTEL)).mine).toBeNull();
  });

  it("refuses a record whose stored scope is not the requested one (a copied / mislabelled key)", async () => {
    await saveMyWork(A, [task("a1")], false, null);
    const raw = await AsyncStorage.getItem(TASK_CACHE_PREFIX + A);
    await AsyncStorage.setItem(TASK_CACHE_PREFIX + B, raw as string);

    expect((await readTaskCache(B)).mine).toBeNull();
  });
});

describe("task cache contents and policy", () => {
  it("keeps the operational task row but not comments, activity or the client sync flag", () => {
    const slim = slimTask({ ...task("a1"), comments: [{ id: "c", comment: "guest is in a wheelchair", user_id: null, author_name: null, is_system: false, created_at: null }], sync_state: "pending" });

    expect(slim).not.toHaveProperty("comments");
    expect(slim).not.toHaveProperty("sync_state");
    expect(slim.description).toBe("Bring two towels");
    expect(slim.guest_request).toEqual({ id: "g1", status: "open" });
  });

  it("stores no comment text on disk", async () => {
    await saveMyWork(A, [{ ...task("a1"), comments: [{ id: "c", comment: "SECRET GUEST DETAIL", user_id: null, author_name: null, is_system: false, created_at: null }] }], false, null);

    expect(await AsyncStorage.getItem(TASK_CACHE_PREFIX + A)).not.toContain("SECRET GUEST DETAIL");
  });

  it("round-trips My Work, details, the hotel zone and the sync time", async () => {
    await saveMyWork(A, [task("a1"), task("a2")], true, "America/Chicago");

    const cache = await readTaskCache(A);
    expect(cache.mine?.tasks).toHaveLength(2);
    expect(cache.mine?.truncated).toBe(true);
    expect(cache.hotelTimezone).toBe("America/Chicago");
    expect(Object.keys(cache.details).sort()).toEqual(["a1", "a2"]);
    expect(new Date(cache.mine?.syncedAt ?? "").getTime()).not.toBeNaN();
  });

  it("drops the details of tasks that left My Work and the history page", async () => {
    await saveMyWork(A, [task("a1"), task("a2")], false, null);
    await saveMyWork(A, [task("a2")], false, null);

    expect(Object.keys((await readTaskCache(A)).details)).toEqual(["a2"]);
  });

  it("caps the saved history page and says there is more behind it", async () => {
    const many = Array.from({ length: HISTORY_CACHE_LIMIT + 15 }, (_, i) => task(`h${i}`, { status: "completed", completed_at: "2026-10-13T10:00:00Z" }));
    await saveHistoryFirstPage(A, { tasks: many, nextCursor: "cur", hasMore: false });

    const history = (await readTaskCache(A)).history;
    expect(history?.tasks).toHaveLength(HISTORY_CACHE_LIMIT);
    expect(history?.hasMore).toBe(true);
    // the server cursor points past the dropped rows, so it is not kept
    expect(history?.nextCursor).toBeNull();
  });

  it("saves the Done Today count with the hotel day it belongs to", async () => {
    await saveDoneToday(A, { count: 8, atLeast: false }, "2026-10-13");

    expect((await readTaskCache(A)).doneToday).toMatchObject({ count: 8, day: "2026-10-13", atLeast: false });
  });

  it("expires sections older than the policy and ignores future-dated ones", () => {
    const now = Date.now();
    const old = new Date(now - CACHE_MAX_AGE_MS - 60_000).toISOString();
    const raw = {
      ...emptyCache(A),
      mine: { tasks: [task("a1")], truncated: false, syncedAt: old },
      history: { tasks: [task("h1")], nextCursor: null, hasMore: false, syncedAt: new Date(now + 3_600_000).toISOString() },
      doneToday: { count: 3, atLeast: false, day: "2026-10-13", syncedAt: old },
    };

    const cache = sanitizeCache(raw, A, now);
    expect(cache?.mine).toBeNull();
    expect(cache?.history).toBeNull();
    expect(cache?.doneToday).toBeNull();
  });

  it("keeps a section that is still inside the policy window", () => {
    const now = Date.now();
    const raw = { ...emptyCache(A), mine: { tasks: [task("a1")], truncated: false, syncedAt: new Date(now - CACHE_MAX_AGE_MS + 60_000).toISOString() } };

    expect(sanitizeCache(raw, A, now)?.mine?.tasks).toHaveLength(1);
  });

  it("treats a missing record as unknown (null), never as 'no tasks'", async () => {
    const cache = await readTaskCache(A);

    expect(cache.mine).toBeNull();
    expect(cache.history).toBeNull();
    expect(cache.doneToday).toBeNull();
  });
});

describe("task cache failure handling", () => {
  it("fails safe on corrupted JSON: comes back empty and removes the bad record", async () => {
    await AsyncStorage.setItem(TASK_CACHE_PREFIX + A, "{not json");

    const cache = await readTaskCache(A);

    expect(cache.mine).toBeNull();
    expect(await AsyncStorage.getItem(TASK_CACHE_PREFIX + A)).toBeNull();
  });

  it("discards a record written by another schema version", async () => {
    await AsyncStorage.setItem(
      TASK_CACHE_PREFIX + A,
      JSON.stringify({ ...emptyCache(A), version: TASK_CACHE_VERSION + 1, mine: { tasks: [task("a1")], truncated: false, syncedAt: new Date().toISOString() } }),
    );

    expect((await readTaskCache(A)).mine).toBeNull();
    expect(await AsyncStorage.getItem(TASK_CACHE_PREFIX + A)).toBeNull();
  });

  it("skips malformed task rows instead of trusting them", () => {
    const raw = { ...emptyCache(A), mine: { tasks: [task("ok"), { nope: true }, null], truncated: false, syncedAt: new Date().toISOString() } };

    expect(sanitizeCache(raw, A)?.mine?.tasks.map((t) => t.id)).toEqual(["ok"]);
  });

  it("does not let a storage failure break the app (the cache is optional)", async () => {
    // (mockRejectedValueOnce is consumed by this one write; restoring the shared storage mock would break later tests)
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(saveMyWork(A, [task("a1")], false, null)).resolves.toBeUndefined();

    warn.mockRestore();
  });

  it("serialises overlapping updates so none is lost", async () => {
    await Promise.all([
      saveDoneToday(A, { count: 1, atLeast: false }, "2026-10-13"),
      saveMyWork(A, [task("a1")], false, null),
      updateTaskCache(A, (cache) => ({ ...cache, hotelTimezone: "America/Chicago" })),
    ]);

    const cache = await readTaskCache(A);
    expect(cache.doneToday?.count).toBe(1);
    expect(cache.mine?.tasks).toHaveLength(1);
    expect(cache.hotelTimezone).toBe("America/Chicago");
  });
});

describe("task cache revocation", () => {
  it("clearAllTaskCaches removes every person's saved tasks but leaves unrelated storage alone", async () => {
    await saveMyWork(A, [task("a1")], false, null);
    await saveMyWork(B, [task("b1")], false, null);
    await AsyncStorage.setItem("@patelrep/other", "keep");

    await clearAllTaskCaches();

    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(TASK_CACHE_PREFIX))).toEqual([]);
    expect(await AsyncStorage.getItem("@patelrep/other")).toBe("keep");
  });

  it("pruneForeignTaskCaches keeps only the signed-in scope", async () => {
    await saveMyWork(A, [task("a1")], false, null);
    await saveMyWork(B, [task("b1")], false, null);

    await pruneForeignTaskCaches(A);

    expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(TASK_CACHE_PREFIX))).toEqual([TASK_CACHE_PREFIX + A]);
  });
});
