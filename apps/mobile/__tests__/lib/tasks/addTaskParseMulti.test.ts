const mockPost = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { post: (...args: unknown[]) => mockPost(...args), get: jest.fn() } }));

import { validateDraft } from "@/lib/tasks/addTask/draft";
import { MAX_SUGGESTED_TASKS, parseTaskRequest } from "@/lib/tasks/addTask/parseRequest";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-13T17:00:00Z");
const ONLINE = { isOnline: true, zone: ZONE, role: "housekeeper", now: NOW };

const reply = (tasks: unknown[]) => ({ data: { response_type: "task_preview", message: "", tasks } });
const TOWELS = {
  title: "Deliver two towels",
  task_type: "housekeeping",
  priority: "normal",
  room_id: "r405",
  room_number_display: "405",
  location_text: null,
  due_at: null,
  due_unresolved: false,
  confidence: 0.9,
};
const SHAMPOO = {
  title: "Restock shampoo",
  task_type: "housekeeping",
  priority: "normal",
  room_id: null,
  room_number_display: null,
  location_text: "Third-floor cart",
  due_at: null,
  due_unresolved: false,
  confidence: 0.9,
};

beforeEach(() => jest.clearAllMocks());

describe("parseTaskRequest — several tasks in one description", () => {
  it("returns every task separately, in the order written, and the first as the primary draft", async () => {
    mockPost.mockResolvedValue(reply([TOWELS, SHAMPOO]));

    const result = await parseTaskRequest("Room 405 needs two towels, and the third-floor cart needs more shampoo.", ONLINE);

    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.drafts.map((draft) => draft.title)).toEqual(["Deliver two towels", "Restock shampoo"]);
    expect(result.drafts[0].location).toEqual({ kind: "room", roomId: "r405", roomNumber: "405" });
    // A place that is not a room stays a plain place; the quantity "two" never became a room.
    expect(result.drafts[1].location).toEqual({ kind: "place", text: "Third-floor cart" });
    expect(result.draft.title).toBe("Deliver two towels");
    expect(result.draft.extraTasks).toBe(1);
    // It only asked for suggestions: nothing was created.
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/ai/copilot/chat", expect.objectContaining({ context: { source: "mobile_tasks", intent_hint: "task_creation" } }));
  });

  it("parses a Spanish description the same way", async () => {
    mockPost.mockResolvedValue(reply([{ ...TOWELS, title: "Entregar dos toallas" }, { ...SHAMPOO, title: "Reponer champú", location_text: "Carrito del tercer piso" }]));
    const result = await parseTaskRequest("La habitación 405 necesita dos toallas y el carrito del tercer piso necesita champú.", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[1].location).toEqual({ kind: "place", text: "Carrito del tercer piso" });
  });

  it("keeps a room the server could not verify visibly unverified (and unsendable) rather than attaching it", async () => {
    mockPost.mockResolvedValue(reply([{ ...TOWELS, room_id: null, room_number_display: "999" }, SHAMPOO]));
    const result = await parseTaskRequest("Room 999 needs towels and the cart needs shampoo", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.drafts[0].location).toEqual({ kind: "unverified", text: "999" });
    expect(validateDraft(result.drafts[0], ZONE, NOW).errors.location).toBe("unverified");
    expect(validateDraft(result.drafts[1], ZONE, NOW).valid).toBe(true);
  });

  it("prefers a room number over a place when both are written, and never invents an assignee, due time or urgency", async () => {
    mockPost.mockResolvedValue(
      reply([{ ...TOWELS, room_id: null, room_number_display: "405", location_text: "Hallway", assigned_to: "someone", due_at: null, priority: "urgent" }, SHAMPOO]),
    );
    const result = await parseTaskRequest("x towels y shampoo", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.drafts[0].location).toEqual({ kind: "unverified", text: "405" });
    expect(result.drafts[0].due).toEqual({ mode: "none" });
    // An urgent suggestion is not applied until the person confirms it.
    expect(result.drafts[0]).toMatchObject({ priority: "urgent", priorityConfirmed: false });
    expect(JSON.stringify(result.drafts)).not.toContain("someone");
  });

  it("drops a suggestion with no title but keeps the usable ones; if none are usable it is a failure, not 'no task'", async () => {
    mockPost.mockResolvedValueOnce(reply([{ ...TOWELS, title: "   " }, SHAMPOO]));
    const mixed = await parseTaskRequest("a", ONLINE);
    if (mixed.status !== "ok") throw new Error("expected ok");
    expect(mixed.drafts.map((draft) => draft.title)).toEqual(["Restock shampoo"]);

    mockPost.mockResolvedValueOnce(reply([{ title: "" }, null, 7, { description: "no title" }]));
    expect(await parseTaskRequest("b", ONLINE)).toEqual({ status: "failed", reason: "invalid" });
  });

  it("treats a malformed reply as a failure and an empty one as 'no task found'", async () => {
    mockPost.mockResolvedValueOnce({ data: { response_type: "task_preview", tasks: "not a list" } });
    expect(await parseTaskRequest("c", ONLINE)).toEqual({ status: "failed", reason: "invalid" });
    mockPost.mockResolvedValueOnce({ data: null });
    expect(await parseTaskRequest("d", ONLINE)).toEqual({ status: "failed", reason: "invalid" });
    mockPost.mockResolvedValueOnce({ data: { response_type: "answer", message: "Hi" } });
    expect(await parseTaskRequest("e", ONLINE)).toEqual({ status: "none", message: "Hi" });
    mockPost.mockResolvedValueOnce(reply([]));
    expect(await parseTaskRequest("f", ONLINE)).toEqual({ status: "none", message: "" });
  });

  it("caps the list at what a person can review on a phone", async () => {
    mockPost.mockResolvedValue(reply(Array.from({ length: 14 }, (_, index) => ({ ...SHAMPOO, title: `Task ${index + 1}` }))));
    const result = await parseTaskRequest("many", ONLINE);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.drafts).toHaveLength(MAX_SUGGESTED_TASKS);
  });

  it("makes ONE paid request when the same description is asked for twice at once", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockPost.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const first = parseTaskRequest("same words", ONLINE);
    const second = parseTaskRequest("same words", ONLINE);
    release(reply([SHAMPOO]));
    const [a, b] = await Promise.all([first, second]);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    // Once answered, asking again is a new request (the person chose to).
    mockPost.mockResolvedValue(reply([SHAMPOO]));
    await parseTaskRequest("same words", ONLINE);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it("sends nothing at all when offline", async () => {
    expect(await parseTaskRequest("x", { ...ONLINE, isOnline: false })).toEqual({ status: "failed", reason: "offline" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
