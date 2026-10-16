import type { Task } from "@/lib/api/tasks";
import { canAskAssistantAbout, explainSentences, explainTask, EXPLAIN_DETAILS_MAX, type ExplainContext } from "@/lib/tasks/explainTask";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

const NOW = new Date("2026-10-15T18:00:00Z"); // 1 PM in Chicago
const CTX: ExplainContext = { now: NOW, zone: "America/Chicago", language: "en", typeLabel: "Housekeeping", blockerReason: null };
const ME = { userId: "me", role: "housekeeper" };

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Deliver extra towels",
    description: "Deliver two clean bath towels.",
    task_type: "housekeeping",
    status: "open",
    priority: "normal",
    assigned_to: "me",
    assigned_to_name: "Maria",
    created_by: "boss",
    created_by_name: "Boss",
    room_id: "r405",
    room_number: "405",
    room_floor: 4,
    location_text: null,
    due_at: "2026-10-15T21:00:00Z",
    created_at: null,
    started_at: null,
    completed_at: null,
    is_ai_created: false,
    guest_request: null,
    blocker: null,
    ...over,
  } as Task;
}
const ids = (t: Task, viewer = ME, ctx = CTX) => explainTask(t, viewer, ctx).map((line) => line.id);

describe("explainTask — a plain reading of the task as stored", () => {
  it("covers what, where, when, priority, who and the instructions as written", () => {
    expect(ids(task())).toEqual(["what", "whereRoom", "whenSet", "priorityNormal", "statusMineOpen", "details"]);
    const lines = explainTask(task(), ME, CTX);
    expect(lines[0].params).toEqual({ title: "Deliver extra towels", type: "Housekeeping" });
    expect(lines[1].params).toEqual({ room: "405" });
    expect(lines[lines.length - 1].params.text).toBe("Deliver two clean bath towels.");
  });

  it("says so when the task has no instructions, no place and no due time, instead of filling the gap", () => {
    expect(ids(task({ description: null, room_number: null, room_id: null, due_at: null }))).toEqual([
      "what",
      "whereNone",
      "whenNone",
      "priorityNormal",
      "statusMineOpen",
      "detailsNone",
    ]);
    expect(ids(task({ description: "   " }))).toContain("detailsNone");
  });

  it("uses the free-text place only when there is no verified room", () => {
    expect(ids(task({ room_number: null, room_id: null, location_text: "Pool deck" }))).toContain("wherePlace");
    expect(explainTask(task({ room_number: null, room_id: null, location_text: "Pool deck" }), ME, CTX)[1].params).toEqual({ place: "Pool deck" });
  });

  it("flags an overdue task and an urgent or low priority", () => {
    expect(ids(task({ due_at: "2026-10-15T15:00:00Z", priority: "urgent" }))).toEqual(expect.arrayContaining(["whenOverdue", "priorityUrgent"]));
    expect(ids(task({ priority: "low" }))).toContain("priorityLow");
    // A completed task is not "overdue".
    expect(ids(task({ due_at: "2026-10-15T15:00:00Z", status: "completed" }))).toContain("whenSet");
  });

  it.each([
    [{ assigned_to: null }, "statusAvailable"],
    [{ status: "in_progress" as const }, "statusMineStarted"],
    [{ assigned_to: "other", assigned_to_name: "Ana" }, "statusOther"],
    [{ assigned_to: "other", assigned_to_name: null }, "statusTeammate"],
    [{ assigned_to: null, assigned_to_name: null, task_type: "engineering" as const }, "statusUnassigned"],
    [{ status: "completed" as const }, "statusCompleted"],
    [{ status: "cancelled" as const }, "statusCancelled"],
  ])("states who has it: %j -> %s", (over, expected) => {
    expect(ids(task(over))).toContain(expected);
  });

  it("mentions an active problem report, but not on a finished task", () => {
    const blocker = { reason: "supplies_missing", details: null } as unknown as Task["blocker"];
    expect(ids(task({ blocker }), ME, { ...CTX, blockerReason: "Supplies missing" })).toContain("blocked");
    expect(ids(task({ blocker, status: "completed" }), ME, { ...CTX, blockerReason: "Supplies missing" })).not.toContain("blocked");
  });

  it("quotes only the start of very long instructions", () => {
    const long = "x".repeat(EXPLAIN_DETAILS_MAX + 100);
    const text = explainTask(task({ description: long }), ME, CTX).find((line) => line.id === "details")?.params.text ?? "";
    expect(text.length).toBeLessThanOrEqual(EXPLAIN_DETAILS_MAX + 1);
    expect(text.endsWith("…")).toBe(true);
  });

  it("adds nothing that is not in the task (no steps, reasons or promises)", () => {
    const lines = explainTask(task({ description: null }), ME, CTX);
    const known = new Set(["what", "whereRoom", "wherePlace", "whereNone", "whenSet", "whenOverdue", "whenNone", "priorityUrgent", "priorityNormal", "priorityLow", "statusAvailable", "statusMineOpen", "statusMineStarted", "statusOther", "statusTeammate", "statusUnassigned", "statusCompleted", "statusCancelled", "blocked", "details", "detailsNone"]);
    expect(lines.every((line) => known.has(line.id))).toBe(true);
  });
});

describe("explainSentences", () => {
  const tr = (dictionary: unknown) => (key: string, options?: Record<string, unknown>) => {
    const found = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionary);
    const template = typeof found === "string" ? found : key;
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? `{{${name}}}`));
  };

  it("reads naturally in English and Spanish, with nothing left unfilled", () => {
    for (const dictionary of [en, es]) {
      const sentences = explainSentences(task(), ME, { now: NOW, zone: "America/Chicago", language: "en" }, tr(dictionary));
      expect(sentences.length).toBeGreaterThanOrEqual(5);
      expect(sentences.join(" ")).not.toMatch(/\{\{|tasks\.hk\.help/);
      expect(sentences.join(" ")).toContain("Deliver extra towels");
    }
    const spanish = explainSentences(task(), ME, { now: NOW, zone: "America/Chicago", language: "es" }, tr(es)).join(" ");
    expect(spanish).toContain("habitación 405");
    expect(spanish).not.toBe(explainSentences(task(), ME, { now: NOW, zone: "America/Chicago", language: "en" }, tr(en)).join(" "));
  });
});

describe("canAskAssistantAbout", () => {
  it("only for a task the server will accept as context: one assigned to me or created by me", () => {
    expect(canAskAssistantAbout(task({ assigned_to: "me" }), ME)).toBe(true);
    expect(canAskAssistantAbout(task({ assigned_to: null, created_by: "me" }), ME)).toBe(true);
    expect(canAskAssistantAbout(task({ assigned_to: null, created_by: "boss" }), ME)).toBe(false); // an unclaimed pool task
    expect(canAskAssistantAbout(task(), { userId: null, role: "housekeeper" })).toBe(false);
  });
});
