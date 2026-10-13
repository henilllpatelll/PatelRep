const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@/lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import {
  addTaskComment,
  claimTask,
  completeTask,
  createTasks,
  fetchCompletedPage,
  fetchMyWork,
  fetchTask,
  fetchTaskActivity,
  loadWorkQueue,
  normalizeTask,
  startTask,
  toConfirmPayload,
} from "@/lib/api/tasks";
import { parseTaskWithAI } from "@/lib/ai/tasks";

function row(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Task ${id}`, status: "open", task_type: "housekeeping", priority: "normal", ...extra };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("normalizeTask", () => {
  it("maps the backend row, joins and lifecycle fields", () => {
    const task = normalizeTask({
      id: "t1",
      title: "Restock cart",
      description: "Floor 2",
      task_type: "guest_request",
      status: "in_progress",
      priority: "urgent",
      assigned_to: "u1",
      created_by: "u2",
      room_id: "r1",
      rooms: { room_number: "214", floor: 2 },
      location_text: "Pool deck",
      due_at: "2026-10-12T18:00:00+00:00",
      started_at: "2026-10-12T17:00:00+00:00",
      is_ai_created: true,
      user_profiles: { full_name: "Ana Diaz", preferred_name: "Ana" },
      creator_profile: { full_name: "Sam Lee" },
      guest_request: { id: "g1", status: "open" },
    });

    expect(task).toMatchObject({
      id: "t1",
      description: "Floor 2",
      task_type: "guest_request",
      status: "in_progress",
      priority: "urgent",
      assigned_to: "u1",
      assigned_to_name: "Ana",
      created_by_name: "Sam Lee",
      room_id: "r1",
      room_number: "214",
      location_text: "Pool deck",
      started_at: "2026-10-12T17:00:00+00:00",
      completed_at: null,
      is_ai_created: true,
      guest_request: { id: "g1", status: "open" },
    });
  });

  it("never invents a room from free text and never flags AI unless the server did", () => {
    const task = normalizeTask({ id: "t1", title: "Check pool", location_text: "Pool deck", source: "guest", ai_suggested: true });

    expect(task.room_number).toBeNull();
    expect(task.room_id).toBeNull();
    expect(task.location_text).toBe("Pool deck");
    expect(task.is_ai_created).toBe(false);
    expect(task.guest_request).toBeNull();
  });

  it("falls back to safe enum values and orders comments oldest first", () => {
    const task = normalizeTask({
      id: "t1",
      title: "x",
      status: "weird",
      task_type: "weird",
      priority: "HIGH",
      task_comments: [
        { id: "c2", comment: "later", created_at: "2026-10-12T02:00:00Z", user_profiles: { full_name: "B" } },
        { id: "c1", comment: "first", created_at: "2026-10-12T01:00:00Z", is_system: true },
      ],
    });

    expect([task.status, task.task_type, task.priority]).toEqual(["open", "general", "urgent"]);
    expect(task.comments?.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(task.comments?.[1].author_name).toBe("B");
    expect(task.comments?.[0].is_system).toBe(true);
  });
});

describe("list retrieval", () => {
  it("follows cursors until the server says there is nothing more and de-duplicates", async () => {
    mockGet
      .mockResolvedValueOnce({ data: [row("a"), row("b")], meta: { has_more: true, next_cursor: "c 1/=", truncated: false } })
      .mockResolvedValueOnce({ data: [row("b"), row("c")], meta: { has_more: false, next_cursor: null, truncated: false } });

    const result = await fetchMyWork();

    expect(result.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(result.truncated).toBe(false);
    expect(mockGet).toHaveBeenNthCalledWith(1, "/tasks/mine?limit=200");
    expect(mockGet).toHaveBeenNthCalledWith(2, `/tasks/mine?limit=200&cursor=${encodeURIComponent("c 1/=")}`);
  });

  it("reports a server-side scan cap instead of hiding it", async () => {
    mockGet.mockResolvedValueOnce({ data: [row("a")], meta: { has_more: false, truncated: true } });

    expect((await fetchMyWork()).truncated).toBe(true);
  });

  it("propagates failures instead of returning an empty list", async () => {
    mockGet.mockRejectedValueOnce(new Error("HTTP 500"));

    await expect(fetchMyWork()).rejects.toThrow("HTTP 500");
  });

  it("keeps My Work and Available separate sources and never lists a task twice", async () => {
    mockGet.mockImplementation(async (path: string) =>
      path.startsWith("/tasks/mine")
        ? { data: [row("mine", { assigned_to: "me" }), row("both")], meta: { has_more: false } }
        : { data: [row("pool"), row("both")], meta: { has_more: false } },
    );

    const queue = await loadWorkQueue({ includeAvailable: true });
    expect(queue.tasks.map((t) => t.id)).toEqual(["mine", "both", "pool"]);

    mockGet.mockClear();
    await loadWorkQueue({ includeAvailable: false });
    expect(mockGet.mock.calls.map((c) => c[0])).toEqual(["/tasks/mine?limit=200"]);
  });

  it("pages the completion history and exposes the cursor", async () => {
    mockGet.mockResolvedValueOnce({
      data: [row("done", { status: "completed", completed_at: "2026-10-12T10:00:00+00:00" })],
      meta: { has_more: true, next_cursor: "next" },
    });

    const page = await fetchCompletedPage("prev", 10);

    expect(mockGet).toHaveBeenCalledWith("/tasks/mine/completed?limit=10&cursor=prev");
    expect(page).toMatchObject({ hasMore: true, nextCursor: "next" });
    expect(page.tasks[0].completed_at).toBe("2026-10-12T10:00:00+00:00");
  });

  it("reads a task detail with its comments", async () => {
    mockGet.mockResolvedValueOnce({ data: row("t1", { task_comments: [{ id: "c1", comment: "hi" }] }) });

    const task = await fetchTask("t1");

    expect(mockGet).toHaveBeenCalledWith("/tasks/t1");
    expect(task.comments).toHaveLength(1);
  });
});

describe("mutations", () => {
  it("completes through the dedicated endpoint and returns the server's task", async () => {
    mockPost.mockResolvedValueOnce({ data: row("t1", { status: "completed", completed_at: "2026-10-12T10:00:00+00:00" }), meta: { replayed: false } });

    const result = await completeTask("t1");

    expect(mockPost).toHaveBeenCalledWith("/tasks/t1/complete", {});
    expect(result.task.status).toBe("completed");
    expect(result.replayed).toBe(false);
  });

  it("sends a trimmed note only when there is one and surfaces replays", async () => {
    mockPost.mockResolvedValueOnce({ data: row("t1", { status: "completed" }), meta: { replayed: true } });

    const result = await completeTask("t1", "  left at door  ");

    expect(mockPost).toHaveBeenCalledWith("/tasks/t1/complete", { note: "left at door" });
    expect(result.replayed).toBe(true);
  });

  it.each([
    ["complete", () => completeTask("t1")],
    ["start", () => startTask("t1")],
    ["claim", () => claimTask("t1")],
  ])("%s rejects on a server failure and never reports success", async (_name, call) => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error("Task is no longer open for claiming"), { status: 409 }));

    await expect(call()).rejects.toMatchObject({ status: 409 });
  });

  it("treats an empty success body as a failure", async () => {
    mockPost.mockResolvedValueOnce({});

    await expect(completeTask("t1")).rejects.toThrow();
  });

  it("uses the start and claim endpoints", async () => {
    mockPost.mockResolvedValue({ data: row("t1", { status: "in_progress" }), meta: { replayed: false } });

    await startTask("t1");
    await claimTask("t2");

    expect(mockPost).toHaveBeenNthCalledWith(1, "/tasks/t1/start", {});
    expect(mockPost).toHaveBeenNthCalledWith(2, "/tasks/t2/claim", {});
  });

  it("posts a note in the JSON body (never in the URL) and returns the stored comment", async () => {
    mockPost.mockResolvedValueOnce({ data: { id: "c1", comment: "needs 2 & more", user_id: "u1", created_at: "2026-10-12T17:00:00Z" } });

    const stored = await addTaskComment("t1", "  needs 2 & more  ");

    expect(mockPost).toHaveBeenCalledWith("/tasks/t1/comments", { comment: "needs 2 & more" });
    expect(stored).toMatchObject({ id: "c1", comment: "needs 2 & more" });
  });

  it("reports whether the completion note was stored", async () => {
    mockPost.mockResolvedValueOnce({ data: { id: "t1", status: "completed" }, meta: { replayed: false, note_saved: false } });
    const result = await completeTask("t1", "  left at desk ");

    expect(mockPost).toHaveBeenCalledWith("/tasks/t1/complete", { note: "left at desk" });
    expect(result.noteSaved).toBe(false);

    mockPost.mockResolvedValueOnce({ data: { id: "t1", status: "completed" }, meta: { replayed: false } });
    expect((await completeTask("t1")).noteSaved).toBeNull();
  });
});

describe("task activity contract", () => {
  it("returns the authoritative task and only well-formed persisted events", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        task: { id: "t1", title: "Towels", status: "in_progress", rooms: { room_number: "214", floor: 2 } },
        events: [
          { id: "created", kind: "created", at: "2026-10-12T16:00:00Z", actor_id: "u2", actor_name: "Front Desk" },
          { id: "comment-1", kind: "comment", at: "2026-10-12T16:20:00Z", actor_id: "u2", actor_name: "Front Desk", text: "Leave outside" },
          { id: "bogus", kind: "teleported", at: "2026-10-12T16:30:00Z" },
          { id: "no-time", kind: "started" },
        ],
      },
      meta: { truncated: true },
    });

    const activity = await fetchTaskActivity("t1");

    expect(mockGet).toHaveBeenCalledWith("/tasks/t1/activity");
    expect(activity.task).toMatchObject({ id: "t1", room_number: "214", room_floor: 2 });
    expect(activity.events.map((e) => e.id)).toEqual(["created", "comment-1"]);
    expect(activity.events[1]).toMatchObject({ kind: "comment", text: "Leave outside", actor_name: "Front Desk" });
    expect(activity.truncated).toBe(true);
  });

  it("fails loudly when the server sends no task", async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    await expect(fetchTaskActivity("t1")).rejects.toThrow();
  });
});

describe("AI task creation contract", () => {
  const preview = {
    title: "Bring towels",
    task_type: "housekeeping" as const,
    priority: "normal" as const,
    room_number_display: "214",
  };

  it("posts an ARRAY of previews and forwards only fields the endpoint accepts", async () => {
    mockPost.mockResolvedValueOnce({ data: { created_count: 1, tasks: [row("n1", { is_ai_created: true })] }, meta: { deduplicated: 0 } });

    const result = await createTasks([{ ...preview, confidence: 0.9, use_ai: true } as never]);

    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe("/ai/tasks/confirm");
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([preview]);
    expect(result).toMatchObject({ createdCount: 1, deduplicated: 0 });
    expect(result.tasks[0].is_ai_created).toBe(true);
  });

  it("omits empty optional fields", () => {
    expect(toConfirmPayload({ ...preview, description: "", room_id: null, due_at: undefined })).toEqual(preview);
  });

  it("surfaces server-side dedupe and propagates validation failures", async () => {
    mockPost.mockResolvedValueOnce({ data: { created_count: 1, tasks: [row("n1")] }, meta: { deduplicated: 1 } });
    expect((await createTasks([preview])).deduplicated).toBe(1);

    mockPost.mockRejectedValueOnce(Object.assign(new Error("HTTP 422"), { status: 422 }));
    await expect(createTasks([preview])).rejects.toMatchObject({ status: 422 });
  });

  it("reads the copilot's real response shape: data.tasks, resolved room, normalised priority", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        response_type: "task_preview",
        message: "I found 2 tasks",
        tasks: [
          { title: "Crib to 412", task_type: "guest_request", priority: "high", room_id: "r412", room_number_display: "412", confidence: 0.9 },
          { title: "  ", task_type: "general", priority: "normal" },
          { title: "Check pool deck", task_type: "weird", priority: "low", room_id: null, room_number_display: "Pool deck" },
        ],
      },
    });

    const parsed = await parseTaskWithAI("crib to 412 and check the pool deck");

    expect(parsed.previews).toEqual([
      expect.objectContaining({ title: "Crib to 412", task_type: "guest_request", priority: "urgent", room_id: "r412", room_number_display: "412" }),
      expect.objectContaining({ title: "Check pool deck", task_type: "general", priority: "low", room_id: null, room_number_display: "Pool deck" }),
    ]);
    expect(mockPost).toHaveBeenCalledWith(
      "/ai/copilot/chat",
      expect.objectContaining({ context: expect.objectContaining({ intent_hint: "task_creation" }) }),
    );
  });

  it("returns no previews (and the AI's message) when the copilot detected no task", async () => {
    mockPost.mockResolvedValueOnce({ data: { response_type: "answer", message: "That is not a task." } });

    expect(await parseTaskWithAI("hello")).toEqual({ message: "That is not a task.", previews: [] });
  });
});
