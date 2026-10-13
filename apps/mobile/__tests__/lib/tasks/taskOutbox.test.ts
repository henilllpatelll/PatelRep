import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: jest.fn().mockResolvedValue(undefined),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
  getSyncQueueSummary: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/api/tasks", () => ({
  ...jest.requireActual("@/lib/api/tasks"),
  completeTask: jest.fn(),
  fetchTask: jest.fn(),
}));

import { completeTask, fetchTask, type Task } from "@/lib/api/tasks";
import { useAppStore } from "@/stores/appStore";
import { loadSyncRows } from "@/lib/housekeeping/syncDetails";
import { MAX_TRANSIENT_ATTEMPTS, OUTBOX_EXPIRY_MS, OUTBOX_MAX_ENTRIES, type OutboxEntry } from "@/lib/tasks/offline/outboxPolicy";
import { OUTBOX_PREFIX, OUTBOX_VERSION, entriesForCurrentUser, flushTaskOutbox, useTaskOutbox } from "@/lib/tasks/offline/taskOutbox";
import { TASK_CACHE_PREFIX, readTaskCache, saveMyWork } from "@/lib/tasks/offline/taskCache";

const mockComplete = completeTask as jest.Mock;
const mockFetch = fetchTask as jest.Mock;

function makeTask(id: string, extra: Partial<Task> = {}): Task {
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
    room_id: "r214",
    room_number: "214",
    room_floor: 2,
    location_text: null,
    due_at: null,
    created_at: "2026-10-13T10:00:00Z",
    started_at: "2026-10-13T10:05:00Z",
    completed_at: null,
    is_ai_created: false,
    guest_request: null,
    blocker: null,
    ...extra,
  };
}

const httpError = (status: number, code?: string) => Object.assign(new Error(`HTTP ${status}`), { status, code });
const user = (id: string, tenant = "h1") => ({ id, tenant_id: tenant, role: "housekeeper", full_name: id, language_pref: "en" }) as never;
const keyFor = (id: string, tenant = "h1") => `${OUTBOX_PREFIX}${tenant}:${id}`;

function signIn(id: string, tenant = "h1") {
  useAppStore.setState({ user: user(id, tenant), isAuthenticated: true });
}
function resetMemory() {
  useTaskOutbox.setState({ scope: null, entries: {}, hydrated: false, sending: {}, settledTick: 0, lastConfirmedAt: null });
}
const entryOf = (taskId: string) => useTaskOutbox.getState().entries[taskId] as OutboxEntry | undefined;
const stored = async (id = "u1", tenant = "h1") => JSON.parse((await AsyncStorage.getItem(keyFor(id, tenant))) ?? "null");

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockComplete.mockReset();
  mockFetch.mockReset();
  resetMemory();
  useAppStore.setState({ user: null, isAuthenticated: false, isOnline: true });
  signIn("u1");
});

describe("saving a completion on the device", () => {
  it("persists the entry BEFORE reporting it saved", async () => {
    const result = await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "Left at the door");

    expect(result.ok).toBe(true);
    const blob = await stored();
    expect(blob.version).toBe(OUTBOX_VERSION);
    expect(blob.entries.t1).toMatchObject({ taskId: "t1", op: "complete", userId: "u1", tenantId: "h1", note: "Left at the door", state: "pending", attempts: 0 });
    expect(entryOf("t1")?.mutationId).toMatch(/^m-/);
  });

  it("does not claim it saved a completion it could not write", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));

    const result = await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    expect(result).toEqual({ ok: false, reason: "storage" });
    expect(entryOf("t1")).toBeUndefined();
    expect(await AsyncStorage.getItem(keyFor("u1"))).toBeNull();
  });

  it("never writes a credential, token or the viewer's profile into the queue", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "note");

    const raw = (await AsyncStorage.getItem(keyFor("u1"))) as string;
    expect(raw).not.toMatch(/bearer|access_token|refresh_token|password|authorization|apikey/i);
    expect(Object.keys(JSON.parse(raw).entries.t1).sort()).toEqual(
      ["attempts", "conflict", "lastAttemptAt", "mutationId", "nextAttemptAt", "note", "observedAssignee", "observedStatus", "op", "queuedAt", "state", "task", "taskId", "tenantId", "userId"].sort(),
    );
  });

  it("survives an app restart", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "keep me");
    resetMemory(); // process killed: memory gone, disk stays

    expect(await useTaskOutbox.getState().hydrate()).toBe(true);

    expect(entryOf("t1")).toMatchObject({ taskId: "t1", note: "keep me", state: "pending" });
  });

  it("refuses a second completion for the same task", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    expect(await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "")).toEqual({ ok: false, reason: "duplicate" });
  });

  it.each([
    ["someone else's task", makeTask("t1", { assigned_to: "u2" }), "not_assigned"],
    ["a task not started yet", makeTask("t1", { status: "open" }), "not_in_progress"],
    ["a task with a reported problem", makeTask("t1", { blocker: { id: "b", reason: "other", details: null, reported_by: "u1", reported_by_name: null, reported_at: null, status: "active", notification_status: "queued" } }), "blocked"],
  ] as const)("refuses %s", async (_label, candidate, reason) => {
    expect(await useTaskOutbox.getState().enqueueComplete(candidate, "")).toEqual({ ok: false, reason });
    expect(await AsyncStorage.getItem(keyFor("u1"))).toBeNull();
  });

  it("refuses when nobody is signed in", async () => {
    useAppStore.setState({ user: null, isAuthenticated: false });

    expect(await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "")).toEqual({ ok: false, reason: "no_session" });
  });

  it("bounds the queue size", async () => {
    for (let i = 0; i < OUTBOX_MAX_ENTRIES; i += 1) {
      expect((await useTaskOutbox.getState().enqueueComplete(makeTask(`t${i}`), "")).ok).toBe(true);
    }

    expect(await useTaskOutbox.getState().enqueueComplete(makeTask("one-too-many"), "")).toEqual({ ok: false, reason: "storage" });
  });
});

describe("sending saved completions", () => {
  it("replays through POST /tasks/{id}/complete (the authorised verb) with the note, then removes it only after the server answers", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockComplete.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "all done");

    const flushing = flushTaskOutbox();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // In flight: still saved, still pending, shown as sending — NOT done.
    expect(mockComplete).toHaveBeenCalledWith("t1", "all done");
    expect(entryOf("t1")?.state).toBe("pending");
    expect(useTaskOutbox.getState().sending.t1).toBe(true);

    release({ task: makeTask("t1", { status: "completed" }), replayed: false, noteSaved: true });
    await flushing;

    expect(entryOf("t1")).toBeUndefined();
    expect(await AsyncStorage.getItem(keyFor("u1"))).toBeNull();
    expect(useTaskOutbox.getState().settledTick).toBe(1);
    expect(useTaskOutbox.getState().lastConfirmedAt).not.toBeNull();
  });

  it("sends nothing while offline and keeps the entry", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");
    useAppStore.setState({ isOnline: false });

    await flushTaskOutbox();

    expect(mockComplete).not.toHaveBeenCalled();
    expect(entryOf("t1")?.state).toBe("pending");
  });

  it("sends the note together with the completion, never as a separate mutation", async () => {
    mockComplete.mockResolvedValue({ task: makeTask("t1", { status: "completed" }), replayed: false, noteSaved: true });
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "  trimmed note  ");

    await flushTaskOutbox();

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledWith("t1", "trimmed note");
  });

  it("is single-flight: overlapping flushes never double-send", async () => {
    mockComplete.mockResolvedValue({ task: makeTask("t1", { status: "completed" }), replayed: false, noteSaved: null });
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    await Promise.all([flushTaskOutbox(), flushTaskOutbox(), flushTaskOutbox()]);

    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps a lost reply pending with a backoff, and does not retry before it is due", async () => {
    mockComplete.mockRejectedValue(new Error("Request timed out. Please try again."));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "keep this note");

    await flushTaskOutbox();
    const first = entryOf("t1") as OutboxEntry;
    expect(first).toMatchObject({ state: "pending", attempts: 1, note: "keep this note" });
    expect(new Date(first.nextAttemptAt as string).getTime()).toBeGreaterThan(Date.now());

    await flushTaskOutbox(); // not due: no storm
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("reconciles a request that the server accepted but never answered: the retry is a replay and confirms once", async () => {
    mockComplete.mockRejectedValueOnce(new Error("Network request failed"));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "n");
    await flushTaskOutbox();
    useTaskOutbox.setState((s) => ({ entries: { ...s.entries, t1: { ...s.entries.t1, nextAttemptAt: new Date(Date.now() - 1000).toISOString() } } }));
    mockComplete.mockResolvedValueOnce({ task: makeTask("t1", { status: "completed" }), replayed: true, noteSaved: null });

    await flushTaskOutbox();

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(mockComplete.mock.calls[1]).toEqual(mockComplete.mock.calls[0]); // same request both times
    expect(entryOf("t1")).toBeUndefined();
    expect(useTaskOutbox.getState().settledTick).toBe(1); // confirmed exactly once
  });

  it("stops retrying on its own after the attempt ceiling and surfaces it for review", async () => {
    mockComplete.mockRejectedValue(httpError(503));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    for (let i = 0; i < MAX_TRANSIENT_ATTEMPTS + 2; i += 1) {
      useTaskOutbox.setState((s) => (s.entries.t1 ? { entries: { ...s.entries, t1: { ...s.entries.t1, nextAttemptAt: null } } } : s));
      await flushTaskOutbox();
    }

    expect(mockComplete).toHaveBeenCalledTimes(MAX_TRANSIENT_ATTEMPTS);
    expect(entryOf("t1")).toMatchObject({ state: "failed", attempts: MAX_TRANSIENT_ATTEMPTS, nextAttemptAt: null });
  });

  it("waits for sign-in on an auth problem without using up an attempt", async () => {
    mockComplete.mockRejectedValue(httpError(401));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    await flushTaskOutbox();

    expect(entryOf("t1")).toMatchObject({ state: "pending", attempts: 0 });
  });

  it("drops the finished task from the saved My Work so a restart does not show it as unfinished", async () => {
    await saveMyWork("h1:u1", [makeTask("t1"), makeTask("t2")], false, null);
    mockComplete.mockResolvedValue({ task: makeTask("t1", { status: "completed" }), replayed: false, noteSaved: null });
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    await flushTaskOutbox();
    const cache = await readTaskCache("h1:u1");

    expect(cache.mine?.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(cache.details.t1).toBeUndefined();
  });
});

describe("conflicts", () => {
  async function refused(status: number, current: Task | Error, code?: string) {
    mockComplete.mockRejectedValue(httpError(status, code));
    if (current instanceof Error) mockFetch.mockRejectedValue(current);
    else mockFetch.mockResolvedValue(current);
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "my note");
    await flushTaskOutbox();
    return entryOf("t1") as OutboxEntry;
  }

  it("a reassigned task becomes a conflict, keeps the note, and is never forced through or retried", async () => {
    const entry = await refused(403, makeTask("t1", { assigned_to: "u2", assigned_to_name: "Ana" }));

    expect(entry).toMatchObject({ state: "conflict", conflict: { reason: "reassigned" }, note: "my note", nextAttemptAt: null });
    expect(entry.task.assigned_to).toBe("u2"); // the server's latest word, for "view updated task"
    await flushTaskOutbox();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("a cancelled task is a conflict", async () => {
    expect((await refused(409, makeTask("t1", { status: "cancelled" }))).conflict?.reason).toBe("cancelled");
  });

  it("a task that was blocked while offline is a conflict, not a completion", async () => {
    const entry = await refused(409, makeTask("t1"), "task_blocked");
    expect(entry).toMatchObject({ state: "conflict", conflict: { reason: "blocked" } });
  });

  it("a task that no longer exists for me is 'unavailable'", async () => {
    expect((await refused(404, httpError(404))).conflict?.reason).toBe("unavailable");
  });

  it("a task completed elsewhere reconciles as confirmed instead of a conflict", async () => {
    mockComplete.mockRejectedValue(httpError(409));
    mockFetch.mockResolvedValue(makeTask("t1", { status: "completed", completed_at: "2026-10-13T11:00:00Z" }));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    await flushTaskOutbox();

    expect(entryOf("t1")).toBeUndefined();
  });

  it("a server rejection never marks the task complete locally", async () => {
    const entry = await refused(403, makeTask("t1", { assigned_to: "u2" }));

    expect(entry.state).not.toBe("pending");
    expect(entry.task.status).not.toBe("completed");
    expect(useTaskOutbox.getState().lastConfirmedAt).toBeNull();
  });

  it("only a lost race can be retried by hand; a final refusal can only be dismissed", async () => {
    await refused(403, makeTask("t1", { assigned_to: "u2" }));
    expect(await useTaskOutbox.getState().retry("t1")).toBe(false);
    expect(entryOf("t1")?.state).toBe("conflict");

    expect(await useTaskOutbox.getState().dismiss("t1")).toBe(true);
    expect(entryOf("t1")).toBeUndefined();
    expect(await AsyncStorage.getItem(keyFor("u1"))).toBeNull();
  });

  it("a 'changed' conflict can be retried explicitly, which re-sends with the same note", async () => {
    await refused(409, new Error("offline-read"));
    expect(entryOf("t1")?.conflict?.reason).toBe("changed");
    mockComplete.mockResolvedValue({ task: makeTask("t1", { status: "completed" }), replayed: false, noteSaved: true });

    expect(await useTaskOutbox.getState().retry("t1")).toBe(true);
    await flushTaskOutbox();

    expect(mockComplete).toHaveBeenLastCalledWith("t1", "my note");
    expect(entryOf("t1")).toBeUndefined();
  });

  it("will not dismiss a pending completion (nothing is lost by accident)", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    expect(await useTaskOutbox.getState().dismiss("t1")).toBe(false);
    expect(entryOf("t1")).toBeDefined();
  });
});

describe("identity, hotel and session isolation", () => {
  it("User B never sees or replays User A's saved completion", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "A's note");

    useAppStore.getState().setUser(user("u2"));
    await flushTaskOutbox();

    expect(mockComplete).not.toHaveBeenCalled();
    expect(entriesForCurrentUser(useTaskOutbox.getState())).toEqual({});
    expect(await stored("u1")).not.toBeNull(); // still A's, isolated on disk
    expect(await stored("u2")).toBeNull();
  });

  it("B's own queue is separate, and A gets theirs back after signing in again", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");
    useAppStore.getState().setUser(user("u2"));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t9", { assigned_to: "u2" }), "");
    expect(Object.keys(entriesForCurrentUser(useTaskOutbox.getState()))).toEqual(["t9"]);

    useAppStore.getState().setUser(user("u1"));
    await useTaskOutbox.getState().hydrate();

    expect(Object.keys(entriesForCurrentUser(useTaskOutbox.getState()))).toEqual(["t1"]);
  });

  it("Hotel A's saved completion is not replayed under Hotel B, even for the same person", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    useAppStore.getState().setUser(user("u1", "h2"));
    await flushTaskOutbox();

    expect(mockComplete).not.toHaveBeenCalled();
    expect(entriesForCurrentUser(useTaskOutbox.getState())).toEqual({});
  });

  it("sign-out hides the queue and sends nothing", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    useAppStore.getState().setUser(null);
    await flushTaskOutbox();

    expect(mockComplete).not.toHaveBeenCalled();
    expect(entriesForCurrentUser(useTaskOutbox.getState())).toEqual({});
  });

  it("an account switch during a request does not apply the answer to the new account", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockComplete.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");

    const flushing = flushTaskOutbox();
    await new Promise((resolve) => setTimeout(resolve, 0));
    useAppStore.getState().setUser(user("u2"));
    release({ task: makeTask("t1", { status: "completed" }), replayed: false, noteSaved: null });
    await flushing;

    expect(entriesForCurrentUser(useTaskOutbox.getState())).toEqual({});
    expect(useTaskOutbox.getState().settledTick).toBe(0);
    expect((await stored("u1")).entries.t1).toBeDefined(); // A's record untouched; a later replay is idempotent
  });

  it("rejects entries inside a record that name a different person or hotel", async () => {
    const good = (await (async () => {
      await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");
      return stored("u1");
    })()) as { entries: Record<string, OutboxEntry> };
    const forged = { ...good, entries: { t1: good.entries.t1, t2: { ...good.entries.t1, taskId: "t2", task: makeTask("t2"), userId: "u2" }, t3: { ...good.entries.t1, taskId: "t3", task: makeTask("t3"), tenantId: "h2" } } };
    await AsyncStorage.setItem(keyFor("u1"), JSON.stringify(forged));
    resetMemory();

    await useTaskOutbox.getState().hydrate();

    expect(Object.keys(useTaskOutbox.getState().entries)).toEqual(["t1"]);
  });

  it("hydrating a record saved for another scope under this key yields nothing", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");
    const raw = (await AsyncStorage.getItem(keyFor("u1"))) as string;
    await AsyncStorage.setItem(keyFor("u3"), raw);
    resetMemory();
    signIn("u3");

    await useTaskOutbox.getState().hydrate();

    expect(useTaskOutbox.getState().entries).toEqual({});
  });
});

describe("recovery from bad or old data", () => {
  it("starts empty on corrupted storage instead of crashing", async () => {
    await AsyncStorage.setItem(keyFor("u1"), "{broken");

    expect(await useTaskOutbox.getState().hydrate()).toBe(true);
    expect(useTaskOutbox.getState().entries).toEqual({});
  });

  it("ignores a record from another schema version", async () => {
    await AsyncStorage.setItem(keyFor("u1"), JSON.stringify({ version: OUTBOX_VERSION + 1, scope: "h1:u1", entries: {} }));

    await useTaskOutbox.getState().hydrate();

    expect(useTaskOutbox.getState().entries).toEqual({});
  });

  it("surfaces a completion that waited too long for review instead of silently dropping or sending it", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "stale");
    const blob = await stored();
    blob.entries.t1.queuedAt = new Date(Date.now() - OUTBOX_EXPIRY_MS - 60_000).toISOString();
    await AsyncStorage.setItem(keyFor("u1"), JSON.stringify(blob));
    resetMemory();

    await useTaskOutbox.getState().hydrate();
    await flushTaskOutbox();

    expect(entryOf("t1")).toMatchObject({ state: "failed", conflict: { reason: "expired" }, note: "stale" });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("clears the previous person's cached tasks on an account switch", async () => {
    await saveMyWork("h1:u1", [makeTask("t1")], false, null);
    expect(await AsyncStorage.getItem(`${TASK_CACHE_PREFIX}h1:u1`)).not.toBeNull();

    useAppStore.getState().setUser(user("u2"));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await AsyncStorage.getItem(`${TASK_CACHE_PREFIX}h1:u1`)).toBeNull();
  });
});

describe("Sync Status data", () => {
  it("lists a saved completion by kind and room only — never the note — and as a pending change", async () => {
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "PRIVATE NOTE");

    const { rows } = await loadSyncRows();

    expect(rows).toEqual([expect.objectContaining({ kind: "task", roomId: "r214", state: "pending" })]);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE NOTE");
  });

  it("shows a refused completion as a conflict row", async () => {
    mockComplete.mockRejectedValue(httpError(403));
    mockFetch.mockResolvedValue(makeTask("t1", { assigned_to: "u2" }));
    await useTaskOutbox.getState().enqueueComplete(makeTask("t1"), "");
    await flushTaskOutbox();

    const { rows } = await loadSyncRows();

    expect(rows).toEqual([expect.objectContaining({ kind: "task", state: "conflict" })]);
  });
});
