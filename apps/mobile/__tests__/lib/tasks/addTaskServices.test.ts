const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({
  api: { post: (...args: unknown[]) => mockPost(...args), get: (...args: unknown[]) => mockGet(...args) },
}));

import { act, renderHook } from "@testing-library/react-native";
import { createTask, fetchRoomDirectory, type RoomOption, type Task } from "@/lib/api/tasks";
import { clearDraft, loadDraft, ownerKey, saveDraft } from "@/lib/tasks/addTask/draftMemory";
import { emptyDraft, validateDraft, toCreateInput } from "@/lib/tasks/addTask/draft";
import { classifyParseError, parseTaskRequest } from "@/lib/tasks/addTask/parseRequest";
import { findRoomByNumber, normalizeRoomQuery, searchRooms } from "@/lib/tasks/addTask/rooms";
import { classifyCreateError, submitCreateTask, taskDestination, useCreateTask } from "@/lib/tasks/addTask/submit";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-13T17:00:00Z"); // noon in Chicago
const ONLINE = { isOnline: true, zone: ZONE, role: "housekeeper", now: NOW };
const failure = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });

function aiReply(tasks: unknown[], extra: Record<string, unknown> = {}) {
  return { data: { response_type: "task_preview", message: "", tasks, ...extra } };
}

const PILLOWS = {
  title: "Deliver two extra pillows",
  description: "Two extra pillows for the guest.",
  task_type: "housekeeping",
  priority: "normal",
  room_id: "r318",
  room_number_display: "318",
  due_at: "2026-10-13T19:00:00Z",
  due_unresolved: false,
  confidence: 0.92,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearDraft();
});

describe("parseTaskRequest — AI suggestions are drafts, never tasks", () => {
  it("turns the reply into an editable draft and creates nothing", async () => {
    mockPost.mockResolvedValue(aiReply([PILLOWS]));

    const result = await parseTaskRequest("Room 318 needs two extra pillows before 2 PM", ONLINE);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.draft).toMatchObject({
      title: "Deliver two extra pillows",
      type: "housekeeping",
      priority: "normal",
      priorityConfirmed: true,
      location: { kind: "room", roomId: "r318", roomNumber: "318" },
      due: { mode: "set", day: "today", time: "2:00 PM" },
      aiSuggested: true,
      lowConfidence: false,
      requestText: "Room 318 needs two extra pillows before 2 PM",
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/ai/copilot/chat", {
      message: "Room 318 needs two extra pillows before 2 PM",
      context: { source: "mobile_tasks", intent_hint: "task_creation" },
    });
    expect(mockPost).not.toHaveBeenCalledWith("/tasks", expect.anything());
    expect(mockPost).not.toHaveBeenCalledWith("/ai/tasks/confirm", expect.anything());
  });

  it("never carries an assignee from the AI into the draft", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, assigned_to: "someone-else" }]));

    const result = await parseTaskRequest("pillows", ONLINE);

    if (result.status !== "ok") throw new Error("expected ok");
    const input = toCreateInput(result.draft, validateDraft(result.draft, ZONE, NOW), "me");
    expect(input?.assigned_to).toBe("me");
    expect(JSON.stringify(result.draft)).not.toContain("someone-else");
  });

  it("keeps an unrecognised room visibly unverified instead of attaching an id", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, room_id: null, room_number_display: "999" }]));

    const result = await parseTaskRequest("room 999 pillows", ONLINE);

    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draft.location).toEqual({ kind: "unverified", text: "999" });
    expect(validateDraft(result.draft, ZONE, NOW).errors.location).toBe("unverified");
  });

  it("does not trust a room id without a room number, or a room number alone", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, room_id: "r1", room_number_display: null }]));
    const idOnly = await parseTaskRequest("x", ONLINE);
    if (idOnly.status !== "ok") throw new Error("expected ok");
    expect(idOnly.draft.location).toEqual({ kind: "none" });
  });

  it("presents an urgent suggestion for confirmation", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, priority: "urgent" }]));

    const result = await parseTaskRequest("leak in 318!", ONLINE);

    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draft).toMatchObject({ priority: "urgent", priorityConfirmed: false });
    expect(validateDraft(result.draft, ZONE, NOW).errors.priority).toBe("confirm");
  });

  it("maps 'high' to urgent (still unconfirmed) and unknown priorities to normal", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, priority: "HIGH" }]));
    const high = await parseTaskRequest("x", ONLINE);
    if (high.status !== "ok") throw new Error("expected ok");
    expect(high.draft).toMatchObject({ priority: "urgent", priorityConfirmed: false });

    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, priority: "whenever" }]));
    const odd = await parseTaskRequest("x", ONLINE);
    if (odd.status !== "ok") throw new Error("expected ok");
    expect(odd.draft.priority).toBe("normal");
  });

  it("leaves an unsupported category for the person to choose", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, task_type: "lost_found" }]));
    const result = await parseTaskRequest("found a phone", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draft.type).toBeNull();
    expect(validateDraft(result.draft, ZONE, NOW).errors.type).toBe("required");
  });

  it("flags an ambiguous due time as unresolved and an unconfident reply for checking", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, due_at: null, due_unresolved: true, confidence: 0.4 }]));
    const result = await parseTaskRequest("pillows sometime", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draft.due).toEqual({ mode: "unresolved" });
    expect(result.draft.lowConfidence).toBe(true);
    expect(validateDraft(result.draft, ZONE, NOW).errors.due).toBe("unresolved");
  });

  it("clips an over-long title instead of sending something the API rejects", async () => {
    mockPost.mockResolvedValue(aiReply([{ ...PILLOWS, title: "T".repeat(300) }]));
    const result = await parseTaskRequest("x", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draft.title).toHaveLength(120);
  });

  it("reviews the first task and says how many more were found", async () => {
    mockPost.mockResolvedValue(aiReply([PILLOWS, { ...PILLOWS, title: "Second" }, { ...PILLOWS, title: "Third" }]));
    const result = await parseTaskRequest("three things", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.draft.title).toBe("Deliver two extra pillows");
    expect(result.draft.extraTasks).toBe(2);
  });

  it("reports no task found, with the AI's message", async () => {
    mockPost.mockResolvedValue({ data: { response_type: "text", message: "Hello! How can I help?" } });
    expect(await parseTaskRequest("hi", ONLINE)).toEqual({ status: "none", message: "Hello! How can I help?" });

    mockPost.mockResolvedValue(aiReply([]));
    expect((await parseTaskRequest("hi", ONLINE)).status).toBe("none");
  });

  it("does not call the server when offline", async () => {
    expect(await parseTaskRequest("x", { ...ONLINE, isOnline: false })).toEqual({ status: "failed", reason: "offline" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([
    ["a timeout", new Error("Request timed out. Please try again."), "timeout"],
    ["rate limiting", failure(429), "rate_limited"],
    ["the AI provider being down", failure(503), "unavailable"],
    ["an internal error", failure(500), "unavailable"],
    ["no credits", failure(402), "unavailable"],
    ["a network failure", new TypeError("Network request failed"), "network"],
  ])("classifies %s", async (_label, error, reason) => {
    mockPost.mockRejectedValue(error);
    expect(await parseTaskRequest("x", ONLINE)).toEqual({ status: "failed", reason });
    expect(classifyParseError(error)).toBe(reason);
  });

  it.each([
    ["no data", {}],
    ["tasks that are not an array", { data: { response_type: "task_preview", tasks: "oops" } }],
    ["only unusable tasks (no title)", aiReply([{ priority: "urgent" }, null, "str"])],
  ])("treats %s as an invalid reply", async (_label, reply) => {
    mockPost.mockResolvedValue(reply);
    expect(await parseTaskRequest("x", ONLINE)).toEqual({ status: "failed", reason: "invalid" });
  });
});

describe("createTask / fetchRoomDirectory — the real API contract", () => {
  const stored = { id: "t1", title: "Pillows", task_type: "housekeeping", status: "open", priority: "normal", assigned_to: "me", rooms: { room_number: "318", floor: 3 }, room_id: "r318" };

  it("posts to /tasks and returns only what the server stored", async () => {
    mockPost.mockResolvedValue({ data: stored, meta: { replayed: false } });
    const body = { title: "Pillows", task_type: "housekeeping" as const, priority: "normal" as const, client_request_id: "key-1" };

    const result = await createTask(body);

    expect(mockPost).toHaveBeenCalledWith("/tasks", body);
    expect(result.task).toMatchObject({ id: "t1", room_number: "318", assigned_to: "me" });
    expect(result.replayed).toBe(false);
  });

  it("reports a replay, and rejects an empty reply instead of inventing a task", async () => {
    mockPost.mockResolvedValue({ data: stored, meta: { replayed: true } });
    expect((await createTask({ title: "x", task_type: "general", priority: "low", client_request_id: "k" })).replayed).toBe(true);

    mockPost.mockResolvedValue({ data: null });
    await expect(createTask({ title: "x", task_type: "general", priority: "low", client_request_id: "k" })).rejects.toThrow();
  });

  it("reads the room directory from the hotel-scoped endpoint", async () => {
    mockGet.mockResolvedValue({ data: [{ id: "r1", room_number: "318", floor: 3, building: "A" }, { id: "", room_number: "bad" }, { id: "r2", room_number: "" }] });

    expect(await fetchRoomDirectory()).toEqual([{ id: "r1", room_number: "318", floor: 3, building: "A" }]);
    expect(mockGet).toHaveBeenCalledWith("/rooms/directory");
  });
});

describe("submitCreateTask — what happened, and whether a retry is safe", () => {
  const input = emptyDraft("housekeeper");
  const body = { title: "Pillows", task_type: "housekeeping" as const, priority: "normal" as const, client_request_id: input.requestId };
  const stored = { id: "t1", title: "Pillows", task_type: "housekeeping", status: "open", priority: "normal", assigned_to: "me" };

  it("succeeds only from the server's stored row", async () => {
    mockPost.mockResolvedValue({ data: stored, meta: { replayed: false } });
    const outcome = await submitCreateTask(body, true);
    expect(outcome).toMatchObject({ kind: "created", replayed: false, task: { id: "t1" } });
  });

  it("does not send when offline", async () => {
    expect(await submitCreateTask(body, false)).toEqual({ kind: "offline" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a 4xx means nothing was created (fix and retry with a new key)", () => {
    expect(classifyCreateError(failure(422, "title is required"))).toEqual({ kind: "rejected", status: 422, message: "title is required" });
    expect(classifyCreateError(failure(404))).toMatchObject({ kind: "rejected" });
    expect(classifyCreateError(failure(409))).toMatchObject({ kind: "rejected" });
    expect(classifyCreateError(failure(403))).toEqual({ kind: "forbidden" });
  });

  it("no answer, a timeout or a 5xx means the task may exist (retry with the SAME key)", () => {
    expect(classifyCreateError(new Error("Request timed out. Please try again."))).toEqual({ kind: "unconfirmed" });
    expect(classifyCreateError(new TypeError("Network request failed"))).toEqual({ kind: "unconfirmed" });
    expect(classifyCreateError(failure(500))).toEqual({ kind: "unconfirmed" });
    expect(classifyCreateError(failure(503))).toEqual({ kind: "unconfirmed" });
  });

  it("retrying an unconfirmed attempt sends the same idempotency key", async () => {
    mockPost.mockRejectedValueOnce(new Error("Request timed out. Please try again."));
    mockPost.mockResolvedValueOnce({ data: stored, meta: { replayed: true } });

    const first = await submitCreateTask(body, true);
    const second = await submitCreateTask(body, true);

    expect(first.kind).toBe("unconfirmed");
    expect(second).toMatchObject({ kind: "created", replayed: true });
    expect(mockPost.mock.calls[0][1].client_request_id).toBe(mockPost.mock.calls[1][1].client_request_id);
  });

  it("ignores a second tap while the first request is running", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockPost.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const { result } = renderHook(() => useCreateTask());

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown = "pending";
    await act(async () => {
      first = result.current.submit(body, true);
      second = await result.current.submit(body, true);
    });
    expect(second).toBeNull();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      release({ data: stored, meta: {} });
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});

describe("taskDestination — where the new task really landed", () => {
  const task = (over: Partial<Task>) => ({ assigned_to: null, status: "open", task_type: "housekeeping", ...over }) as Task;
  const me = { id: "me", role: "housekeeper" };

  it("assigned to me -> My Work", () => expect(taskDestination(task({ assigned_to: "me" }), me)).toBe("mine"));
  it("open unassigned housekeeping -> Available", () => expect(taskDestination(task({}), me)).toBe("pool"));
  it("unassigned maintenance goes to the team, not to a list the housekeeper can see", () => {
    expect(taskDestination(task({ task_type: "engineering" }), me)).toBe("team");
  });
  it("assigned to someone else -> team", () => expect(taskDestination(task({ assigned_to: "other" }), me)).toBe("team"));
});

describe("room directory helpers", () => {
  const rooms: RoomOption[] = ["101", "318", "1318", "12A"].map((n, i) => ({ id: `r${i}`, room_number: n, floor: 1, building: null }));

  it("normalises the ways people write a room", () => {
    expect(normalizeRoomQuery(" Room 318 ")).toBe("318");
    expect(normalizeRoomQuery("rm #318")).toBe("318");
    expect(normalizeRoomQuery("Habitación 318")).toBe("318");
    expect(normalizeRoomQuery("12a")).toBe("12a");
  });

  it("verifies only an exact room of this hotel's list — never a near match", () => {
    expect(findRoomByNumber(rooms, "Room 318")?.id).toBe("r1");
    expect(findRoomByNumber(rooms, "12a")?.id).toBe("r3");
    expect(findRoomByNumber(rooms, "31")).toBeNull();
    expect(findRoomByNumber(rooms, "999")).toBeNull();
    expect(findRoomByNumber(rooms, "")).toBeNull();
  });

  it("searches prefix matches first", () => {
    expect(searchRooms(rooms, "31").map((r) => r.room_number)).toEqual(["318", "1318"]);
    expect(searchRooms(rooms, "zzz")).toEqual([]);
    expect(searchRooms(rooms, "").length).toBe(4);
  });
});

describe("draft memory — bound to one hotel and user, in memory only", () => {
  const snapshot = (title: string) => ({ draft: { ...emptyDraft("housekeeper"), title }, step: "review" as const, parsedText: null });

  it("returns the draft only to the same hotel+user", () => {
    const mine = ownerKey("hotel-1", "user-1");
    saveDraft(mine, snapshot("Pillows"));

    expect(loadDraft(mine)?.draft.title).toBe("Pillows");
    expect(loadDraft(ownerKey("hotel-2", "user-1"))).toBeNull();
    // once another account asked, the old draft is gone for good
    expect(loadDraft(mine)).toBeNull();
  });

  it("clears after a confirmed create and never stores without an owner", () => {
    const mine = ownerKey("hotel-1", "user-1");
    saveDraft(mine, snapshot("Pillows"));
    clearDraft();
    expect(loadDraft(mine)).toBeNull();

    saveDraft(null, snapshot("Anonymous"));
    expect(loadDraft(null)).toBeNull();
    expect(ownerKey(null, "u")).toBeNull();
  });
});
