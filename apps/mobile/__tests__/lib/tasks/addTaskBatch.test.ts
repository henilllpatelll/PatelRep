jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn(), get: jest.fn() } }));

import { renderHook, act } from "@testing-library/react-native";
import type { RoomOption, Task } from "@/lib/api/tasks";
import { emptyDraft, type TaskDraft } from "@/lib/tasks/addTask/draft";
import {
  batchFromDrafts,
  batchReadiness,
  createdTasks,
  pendingItems,
  reverifyRooms,
  submitBatch,
  summarizeBatch,
  useBatchCreate,
  withEditedDraft,
  withIncluded,
  type BatchContext,
  type BatchItem,
} from "@/lib/tasks/addTask/batch";
import type { SubmitOutcome } from "@/lib/tasks/addTask/submit";

const ZONE = "America/Chicago";
const VIEWER = { id: "me", role: "housekeeper" };

function draft(title: string, over: Partial<TaskDraft> = {}): TaskDraft {
  return {
    ...emptyDraft("housekeeper"),
    requestText: "Room 405 needs two towels, and the third-floor cart needs more shampoo.",
    title,
    type: "housekeeping",
    aiSuggested: true,
    ...over,
  };
}
const towels = () => draft("Deliver two towels", { location: { kind: "room", roomId: "r405", roomNumber: "405" } });
const shampoo = () => draft("Restock shampoo", { location: { kind: "place", text: "Third-floor cart" } });

function task(id: string, over: Partial<Task> = {}): Task {
  return { id, title: id, task_type: "housekeeping", status: "open", priority: "normal", assigned_to: "me", ...over } as Task;
}
const created = (id: string, replayed = false): SubmitOutcome => ({ kind: "created", task: task(id), replayed });

function context(submit: BatchContext["submit"], over: Partial<BatchContext> = {}): BatchContext {
  return { zone: ZONE, viewer: VIEWER, isOnline: true, submit, ...over };
}

describe("batchFromDrafts", () => {
  it("gives every suggestion its own idempotency key (the parser hands every draft the same one)", () => {
    const shared = emptyDraft("housekeeper").requestId;
    const items = batchFromDrafts([towels(), shampoo()].map((d) => ({ ...d, requestId: shared })));
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.draft.requestId)).size).toBe(2);
    expect(items.every((item) => item.draft.requestId !== shared)).toBe(true);
    expect(items.every((item) => item.include && item.status === "ready" && item.task === null)).toBe(true);
    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });
});

describe("editing and including", () => {
  it("replaces one draft and leaves the others alone", () => {
    const items = batchFromDrafts([towels(), shampoo()]);
    const next = withEditedDraft(items, items[0].key, { ...items[0].draft, title: "Deliver three towels" });
    expect(next[0].draft.title).toBe("Deliver three towels");
    expect(next[1]).toBe(items[1]);
  });

  it("leaves a task out and puts it back, but never takes a created task out of the batch", () => {
    let items = batchFromDrafts([towels(), shampoo()]);
    items = withIncluded(items, items[1].key, false);
    expect(items[1].include).toBe(false);
    expect(pendingItems(items)).toHaveLength(1);
    items = withIncluded(items, items[1].key, true);
    expect(pendingItems(items)).toHaveLength(2);

    const done = items.map((item, index) => (index === 0 ? { ...item, status: "created" as const, task: task("t1") } : item));
    expect(withIncluded(done, done[0].key, false)[0].include).toBe(true);
    // ...and a created task's details can no longer be edited here.
    expect(withEditedDraft(done, done[0].key, { ...done[0].draft, title: "Changed" })[0].draft.title).toBe("Deliver two towels");
  });

  it("a corrected, refused task gets a fresh key; an unconfirmed one keeps its key", () => {
    const [item] = batchFromDrafts([towels()]);
    const refused: BatchItem = { ...item, status: "failed", problem: "rejected", message: "no" };
    const fixed = withEditedDraft([refused], item.key, { ...item.draft, title: "Fixed" })[0];
    expect(fixed.draft.requestId).not.toBe(item.draft.requestId);
    expect(fixed.status).toBe("ready");
    expect(fixed.problem).toBeNull();

    const unsure: BatchItem = { ...item, status: "failed", problem: "unconfirmed" };
    const edited = withEditedDraft([unsure], item.key, { ...item.draft, title: "Fixed" })[0];
    expect(edited.draft.requestId).toBe(item.draft.requestId);
  });
});

describe("readiness", () => {
  it("is ready only when something is included and nothing included is incomplete", () => {
    const items = batchFromDrafts([towels(), shampoo()]);
    expect(batchReadiness(items, ZONE)).toMatchObject({ ready: true, count: 2, invalidKeys: [] });

    const broken = withEditedDraft(items, items[1].key, { ...items[1].draft, title: "  " });
    expect(batchReadiness(broken, ZONE)).toMatchObject({ ready: false, invalidKeys: [broken[1].key] });
    // Leaving the incomplete one out makes the rest ready.
    expect(batchReadiness(withIncluded(broken, broken[1].key, false), ZONE).ready).toBe(true);
    expect(batchReadiness(withIncluded(withIncluded(items, items[0].key, false), items[1].key, false), ZONE)).toMatchObject({ ready: false, count: 0 });
  });

  it("does not let an unverified room through", () => {
    const items = batchFromDrafts([draft("Deliver towels", { location: { kind: "unverified", text: "999" } })]);
    expect(batchReadiness(items, ZONE).ready).toBe(false);
  });
});

describe("reverifyRooms (against the hotel's own room directory)", () => {
  const directory: RoomOption[] = [{ id: "r405", room_number: "405", floor: 4, building: null }];

  it("keeps a room the directory confirms and demotes one it does not contain", () => {
    const items = batchFromDrafts([towels(), draft("Fix lamp", { location: { kind: "room", roomId: "r-foreign", roomNumber: "405" } })]);
    const next = reverifyRooms(items, directory);
    expect(next[0].draft.location).toEqual({ kind: "room", roomId: "r405", roomNumber: "405" });
    expect(next[1].draft.location).toEqual({ kind: "unverified", text: "405" });
    expect(batchReadiness(next, ZONE).invalidKeys).toEqual([next[1].key]);
  });

  it("demotes a room whose number no longer matches the id, returns the same array when nothing changed, and ignores an empty directory", () => {
    const mismatch = batchFromDrafts([draft("x", { location: { kind: "room", roomId: "r405", roomNumber: "406" } })]);
    expect(reverifyRooms(mismatch, directory)[0].draft.location.kind).toBe("unverified");
    const fine = batchFromDrafts([towels()]);
    expect(reverifyRooms(fine, directory)).toBe(fine);
    expect(reverifyRooms(mismatch, [])).toBe(mismatch);
  });
});

describe("submitBatch", () => {
  it("creates every included task once, in order, each with its own key, and reports what the server stored", async () => {
    const items = batchFromDrafts([towels(), shampoo()]);
    const submit = jest.fn(async (input: { title: string }) => created(`id-${input.title}`));

    const result = await submitBatch(items, context(submit));

    expect(submit).toHaveBeenCalledTimes(2);
    const keys = submit.mock.calls.map((call) => (call[0] as unknown as { client_request_id: string }).client_request_id);
    expect(new Set(keys).size).toBe(2);
    expect(submit.mock.calls[0][0]).toMatchObject({ title: "Deliver two towels", room_id: "r405", ai_suggested: true });
    expect(submit.mock.calls[1][0]).toMatchObject({ title: "Restock shampoo", location_text: "Third-floor cart" });
    expect(result.halted).toBeNull();
    expect(summarizeBatch(result.items)).toEqual({ included: 2, created: 2, failed: 0, unsent: 0 });
    expect(createdTasks(result.items).map((entry) => entry.task.id)).toEqual(["id-Deliver two towels", "id-Restock shampoo"]);
    expect(createdTasks(result.items)[0].destination).toBe("mine");
  });

  it("skips tasks the person left out", async () => {
    const left = batchFromDrafts([towels(), shampoo()]).map((item, index) => (index === 1 ? { ...item, include: false } : item));
    const submit = jest.fn(async () => created("only"));
    const result = await submitBatch(left, context(submit));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(summarizeBatch(result.items)).toMatchObject({ included: 1, created: 1 });
  });

  it("a refused task fails on its own: the others are still created, and the retry sends ONLY the failed one", async () => {
    const items = batchFromDrafts([towels(), shampoo(), draft("Third", { location: { kind: "place", text: "Lobby" } })]);
    let secondAttempts = 0;
    const submit = jest.fn(async (input: { title: string }): Promise<SubmitOutcome> => {
      if (input.title === "Restock shampoo") {
        secondAttempts += 1;
        return secondAttempts === 1 ? { kind: "rejected", status: 422, message: "nope" } : created("id-shampoo");
      }
      return created(`id-${input.title}`);
    });

    const first = await submitBatch(items, context(submit));
    expect(first.halted).toBeNull();
    expect(first.items.map((item) => item.status)).toEqual(["created", "failed", "created"]);
    expect(first.items[1]).toMatchObject({ problem: "rejected", message: "nope" });
    expect(summarizeBatch(first.items)).toEqual({ included: 3, created: 2, failed: 1, unsent: 0 });
    expect(createdTasks(first.items)).toHaveLength(2);

    submit.mockClear();
    const second = await submitBatch(first.items, context(submit));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toMatchObject({ title: "Restock shampoo" });
    expect(second.items.map((item) => item.status)).toEqual(["created", "created", "created"]);
    // The refusal means nothing existed under the old key, so the retry used a new one.
    const [oldKey, newKey] = [
      (first.items[1].draft.requestId),
      (submit.mock.calls[0][0] as unknown as { client_request_id: string }).client_request_id,
    ];
    expect(newKey).toBe(oldKey); // the key was already refreshed when the refusal was recorded
    expect(oldKey).not.toBe(items[1].draft.requestId);
  });

  it("stops when the server did not answer, keeps that task's key, and leaves the rest unsent (never claiming them)", async () => {
    const items = batchFromDrafts([towels(), shampoo(), draft("Third", { location: { kind: "place", text: "Lobby" } })]);
    const submit = jest.fn(async (input: { title: string }): Promise<SubmitOutcome> =>
      input.title === "Deliver two towels" ? created("id-1") : { kind: "unconfirmed" },
    );

    const result = await submitBatch(items, context(submit));

    expect(result.halted).toBe("unconfirmed");
    expect(submit).toHaveBeenCalledTimes(2); // the third was never sent
    expect(result.items.map((item) => item.status)).toEqual(["created", "failed", "ready"]);
    expect(result.items[1].draft.requestId).toBe(items[1].draft.requestId); // retry returns the task if it exists
    expect(summarizeBatch(result.items)).toEqual({ included: 3, created: 1, failed: 1, unsent: 1 });
    expect(createdTasks(result.items)).toHaveLength(1);
  });

  it.each([
    ["signedOut", { kind: "signedOut" }],
    ["offline", { kind: "offline" }],
  ] as const)("stops on %s without hammering the rest", async (halt, outcome) => {
    const items = batchFromDrafts([towels(), shampoo()]);
    const submit = jest.fn(async (): Promise<SubmitOutcome> => outcome as SubmitOutcome);
    const result = await submitBatch(items, context(submit));
    expect(result.halted).toBe(halt);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.items[0].status).toBe("failed");
    expect(result.items[1].status).toBe("ready");
    expect(createdTasks(result.items)).toHaveLength(0);
  });

  it("a forbidden task fails alone (fresh key) while the rest go on", async () => {
    const items = batchFromDrafts([towels(), shampoo()]);
    const submit = jest.fn(async (input: { title: string }): Promise<SubmitOutcome> =>
      input.title === "Deliver two towels" ? { kind: "forbidden" } : created("id-2"),
    );
    const result = await submitBatch(items, context(submit));
    expect(result.items.map((item) => item.status)).toEqual(["failed", "created"]);
    expect(result.items[0].problem).toBe("forbidden");
    expect(result.items[0].draft.requestId).not.toBe(items[0].draft.requestId);
  });

  it("validates again right before sending: an incomplete task is never sent", async () => {
    const items = batchFromDrafts([towels(), shampoo()]);
    const bad = items.map((item, index) => (index === 1 ? { ...item, draft: { ...item.draft, title: "" } } : item));
    const submit = jest.fn(async () => created("ok"));
    const result = await submitBatch(bad, context(submit));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.items[1]).toMatchObject({ status: "failed", problem: "invalid" });
  });

  it("a due time that passed while the list was open is caught before sending", async () => {
    const soon = new Date("2026-10-15T20:00:00.000Z").toISOString();
    const items = batchFromDrafts([draft("Late", { due: { mode: "set", day: "other", time: "3:00 PM", iso: soon } })]);
    const submit = jest.fn(async () => created("x"));
    const result = await submitBatch(items, context(submit, { now: () => new Date("2026-10-15T22:00:00.000Z") }));
    expect(submit).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({ status: "failed", problem: "invalid" });
  });

  it("reports progress as each task changes", async () => {
    const items = batchFromDrafts([towels(), shampoo()]);
    const seen: string[][] = [];
    await submitBatch(items, context(async () => created("x"), { onUpdate: (next) => seen.push(next.map((item) => item.status)) }));
    expect(seen[0]).toEqual(["creating", "ready"]);
    expect(seen[seen.length - 1]).toEqual(["created", "created"]);
  });

  it("never sends a task that is already created", async () => {
    const [first, second] = batchFromDrafts([towels(), shampoo()]);
    const submit = jest.fn(async () => created("new"));
    const result = await submitBatch([{ ...first, status: "created", task: task("done") }, second], context(submit));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.items[0].task?.id).toBe("done");
  });
});

describe("useBatchCreate", () => {
  it("runs one batch at a time: a second press while the first is running does nothing", async () => {
    const items = batchFromDrafts([towels()]);
    let release: (value: SubmitOutcome) => void = () => undefined;
    const submit = jest.fn(() => new Promise<SubmitOutcome>((resolve) => (release = resolve)));
    const { result } = renderHook(() => useBatchCreate());

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown = "unset";
    await act(async () => {
      first = result.current.run(items, context(submit));
      second = await result.current.run(items, context(submit));
    });
    expect(second).toBeNull();
    await act(async () => {
      release(created("one"));
      await first;
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });
});
