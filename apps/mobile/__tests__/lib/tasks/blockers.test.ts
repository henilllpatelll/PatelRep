const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@/lib/api/client", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import {
  BLOCKER_REASONS,
  fetchTaskActivity,
  normalizeBlocker,
  normalizeTask,
  reportBlocker,
  resumeTask,
  type Task,
} from "@/lib/api/tasks";
import { canReportBlocker, canResume, isBlocked, notificationKey, validateBlockerDraft } from "@/lib/tasks/blockers";
import { conflictReason, primaryAction, type Viewer } from "@/lib/tasks/taskActions";
import { statusLabel } from "@/lib/tasks/taskDisplay";
import { buildWorkBuckets, overdueMinutes, sortWork } from "@/lib/tasks/workQueue";

const ME: Viewer = { userId: "me", role: "housekeeper" };
const NOW = new Date("2026-10-13T17:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60000).toISOString();
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

const BLOCKER = {
  id: "b1",
  reason: "missing_supplies",
  details: "No clean bath towels on floor 2",
  reported_by: "me",
  reported_by_name: "Maria",
  reported_at: at(-20),
  status: "active",
  notification_status: "queued",
};

function task(extra: Record<string, unknown> = {}, id = "t1"): Task {
  return normalizeTask({
    id,
    title: `Task ${id}`,
    status: "open",
    task_type: "housekeeping",
    priority: "normal",
    assigned_to: "me",
    created_at: at(-600),
    due_at: at(240),
    ...extra,
  });
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe("blocker contract", () => {
  it("normalises the active blocker a task carries, and ignores anything malformed", () => {
    expect(task({ blocker: BLOCKER }).blocker).toEqual({
      id: "b1",
      reason: "missing_supplies",
      details: "No clean bath towels on floor 2",
      reported_by: "me",
      reported_by_name: "Maria",
      reported_at: at(-20),
      status: "active",
      notification_status: "queued",
    });
    expect(task().blocker).toBeNull();
    expect(task({ blocker: null }).blocker).toBeNull();
    expect(task({ blocker: { ...BLOCKER, reason: "because" } }).blocker).toBeNull();
    expect(task({ blocker: { ...BLOCKER, id: "" } }).blocker).toBeNull();
    expect(normalizeBlocker("nope")).toBeNull();
  });

  it("never treats a resolved blocker as a blocked task", () => {
    expect(task({ blocker: { ...BLOCKER, status: "resolved" } }).blocker).toBeNull();
  });

  it("falls back to a neutral notification status instead of inventing a confirmed one", () => {
    expect(normalizeBlocker({ ...BLOCKER, notification_status: "delivered-ish" })?.notification_status).toBe("pending");
    expect(normalizeBlocker({ ...BLOCKER, notification_status: undefined })?.notification_status).toBe("pending");
  });

  it("knows the seven canonical reasons", () => {
    expect([...BLOCKER_REASONS]).toEqual([
      "guest_unavailable",
      "do_not_disturb",
      "missing_supplies",
      "access_issue",
      "assistance_needed",
      "equipment_issue",
      "other",
    ]);
  });

  it("posts the reason, trimmed details and the idempotency key; omits blank details", async () => {
    mockPost.mockResolvedValue({ data: { task: { id: "t1", status: "open", blocker: BLOCKER }, blocker: BLOCKER }, meta: { replayed: false } });

    const result = await reportBlocker("t1", { reason: "missing_supplies", details: "  No towels  ", clientRequestId: "key-1" });
    await reportBlocker("t1", { reason: "do_not_disturb", details: "   ", clientRequestId: "key-2" });

    expect(mockPost).toHaveBeenNthCalledWith(1, "/tasks/t1/blockers", { reason: "missing_supplies", details: "No towels", client_request_id: "key-1" });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/tasks/t1/blockers", { reason: "do_not_disturb", client_request_id: "key-2" });
    expect(result.replayed).toBe(false);
    expect(result.task.blocker?.id).toBe("b1");
  });

  it("does not resolve with a task when the server sends nothing back", async () => {
    mockPost.mockResolvedValue({ data: {} });
    await expect(reportBlocker("t1", { reason: "other", details: "x", clientRequestId: "k" })).rejects.toThrow();
  });

  it("resumes with the report the employee was looking at", async () => {
    mockPost.mockResolvedValue({ data: { task: { id: "t1", status: "open", blocker: null }, blocker: { ...BLOCKER, status: "resolved" } }, meta: { replayed: true } });

    const result = await resumeTask("t1", "b1");

    expect(mockPost).toHaveBeenCalledWith("/tasks/t1/resume", { blocker_id: "b1" });
    expect(result.replayed).toBe(true);
    expect(result.task.blocker).toBeNull();
  });

  it("reads persisted blocker events from the activity feed and drops unknown reasons", async () => {
    mockGet.mockResolvedValue({
      data: {
        task: { id: "t1", status: "in_progress", assigned_to: "me" },
        events: [
          { id: "blocker-b1-reported", kind: "blocker_reported", at: at(-20), actor_id: "me", actor_name: "Maria", text: "No towels", reason: "missing_supplies" },
          { id: "blocker-b1-resolved", kind: "blocker_resolved", at: at(-5), actor_id: "sup", actor_name: "Sam", text: "Restocked", resolution: "resolved" },
          { id: "weird", kind: "blocker_reported", at: at(-1), actor_id: null, actor_name: null, text: null, reason: "bogus" },
          { id: "invented", kind: "supervisor_notified", at: at(-1) },
        ],
      },
      meta: { truncated: false },
    });

    const { events } = await fetchTaskActivity("t1");

    expect(events.map((e) => e.id)).toEqual(["blocker-b1-reported", "blocker-b1-resolved", "weird"]); // unknown kinds are not invented into the feed
    expect(events[0]).toMatchObject({ kind: "blocker_reported", reason: "missing_supplies", text: "No towels", actor_name: "Maria" });
    expect(events[1]).toMatchObject({ kind: "blocker_resolved", resolution: "resolved", text: "Restocked" });
    expect(events[2].reason).toBeNull();
  });
});

describe("who may report and resume", () => {
  it.each([
    ["assigned + open", { status: "open" }, true],
    ["assigned + in progress", { status: "in_progress" }, true],
    ["assigned + escalated", { status: "escalated" }, true],
    ["completed", { status: "completed" }, false],
    ["cancelled", { status: "cancelled" }, false],
    ["unassigned pool task", { assigned_to: null }, false],
    ["someone else's task", { assigned_to: "other" }, false],
    ["already blocked", { blocker: BLOCKER }, false],
  ])("%s -> %s", (_label, extra, expected) => {
    expect(canReportBlocker(task(extra), ME)).toBe(expected);
  });

  it("offers nothing to a signed-out viewer", () => {
    expect(canReportBlocker(task(), { userId: null, role: "housekeeper" })).toBe(false);
    expect(canResume(task({ blocker: BLOCKER }), { userId: null, role: "housekeeper" })).toBe(false);
  });

  it("lets only the assignee resume a live blocked task", () => {
    expect(canResume(task({ blocker: BLOCKER }), ME)).toBe(true);
    expect(canResume(task({ blocker: BLOCKER, assigned_to: "other" }), ME)).toBe(false);
    expect(canResume(task({ blocker: BLOCKER, status: "completed" }), ME)).toBe(false);
    expect(canResume(task(), ME)).toBe(false);
    expect(isBlocked(task({ blocker: BLOCKER }))).toBe(true);
  });

  it("makes Resume the primary action of a blocked task instead of Start or Complete", () => {
    expect(primaryAction(task({ blocker: BLOCKER, status: "open" }), ME)).toBe("resume");
    expect(primaryAction(task({ blocker: BLOCKER, status: "in_progress" }), ME)).toBe("resume");
    expect(primaryAction(task({ status: "in_progress" }), ME)).toBe("complete");
    expect(primaryAction(task({ blocker: BLOCKER, assigned_to: "other" }), ME)).toBeNull();
  });

  it("explains a refused start or complete as a blocked task, but not a refused resume", () => {
    const blocked = task({ blocker: BLOCKER });
    expect(conflictReason("start", blocked, ME)).toBe("blocked");
    expect(conflictReason("complete", blocked, ME)).toBe("blocked");
    expect(conflictReason("resume", blocked, ME)).toBe("changed");
    expect(conflictReason("complete", task({ status: "completed" }), ME)).toBe("completed");
  });

  it("shows one status for a blocked task, not a contradictory pair", () => {
    expect(statusLabel(task({ blocker: BLOCKER, status: "in_progress" }), ME, t)).toBe("tasks.hk.sheet.status.blocked");
    expect(statusLabel(task({ status: "in_progress" }), ME, t)).toBe("tasks.hk.sheet.status.in_progress");
    expect(statusLabel(task({ blocker: BLOCKER, status: "completed" }), ME, t)).toBe("tasks.hk.sheet.status.completed");
  });

  it("describes the alert only as the server reported it", () => {
    expect(["pending", "queued", "failed", "not_available"].map((s) => notificationKey(s as never))).toEqual([
      "tasks.hk.blocker.notify.pending",
      "tasks.hk.blocker.notify.queued",
      "tasks.hk.blocker.notify.failed",
      "tasks.hk.blocker.notify.not_available",
    ]);
  });
});

describe("form validation", () => {
  it("needs a reason", () => {
    expect(validateBlockerDraft(null, "")).toBe("reasonRequired");
  });

  it.each(BLOCKER_REASONS.filter((reason) => reason !== "other"))("%s may be sent without any description", (reason) => {
    expect(validateBlockerDraft(reason, "")).toBeNull();
    expect(validateBlockerDraft(reason, "  Some detail ")).toBeNull();
  });

  it("requires a real description for Other", () => {
    expect(validateBlockerDraft("other", "")).toBe("detailsRequired");
    expect(validateBlockerDraft("other", "   \n ")).toBe("detailsRequired");
    expect(validateBlockerDraft("other", "Cart wheel is stuck")).toBeNull();
  });

  it("limits the description to 1000 characters after trimming", () => {
    expect(validateBlockerDraft("missing_supplies", "x".repeat(1000))).toBeNull();
    expect(validateBlockerDraft("missing_supplies", `  ${"x".repeat(1000)}  `)).toBeNull();
    expect(validateBlockerDraft("missing_supplies", "x".repeat(1001))).toBe("detailsTooLong");
  });
});

describe("Needs attention in My Work", () => {
  it("lists a blocked task exactly once, in its own section, and never in the normal ones", () => {
    const tasks = [
      task({ blocker: BLOCKER, due_at: at(-30) }, "blocked-open"),
      task({ blocker: BLOCKER, status: "in_progress", started_at: at(-60) }, "blocked-running"),
      task({}, "plain"),
      task({ status: "in_progress", started_at: at(-10) }, "running"),
    ];

    const buckets = buildWorkBuckets(tasks, NOW);

    expect(buckets.needsAttention.map((x) => x.id).sort()).toEqual(["blocked-open", "blocked-running"]);
    const elsewhere = [buckets.nextUp, ...buckets.inProgress, ...buckets.upNext, ...buckets.later].filter(Boolean).map((x) => x!.id);
    expect(elsewhere.sort()).toEqual(["plain", "running"]);
  });

  it("keeps status-based counts: blocked work is unfinished, never completed", () => {
    const tasks = [
      task({ blocker: BLOCKER }, "blocked-open"),
      task({ blocker: BLOCKER, status: "in_progress", started_at: at(-60) }, "blocked-running"),
      task({}, "plain"),
      task({ status: "in_progress", started_at: at(-10) }, "running"),
      task({ status: "completed", completed_at: at(-5) }, "done"),
    ];

    const buckets = buildWorkBuckets(tasks, NOW);

    expect(buckets.remaining).toBe(2); // blocked-open + plain (not started)
    expect(buckets.started).toBe(2); // blocked-running + running
    expect(buckets.needsAttention.every((x) => x.status !== "completed")).toBe(true);
  });

  it("does not promote a blocked task to Next up, so it can not be started past its problem", () => {
    const buckets = buildWorkBuckets([task({ blocker: BLOCKER, priority: "urgent" }, "blocked"), task({}, "plain")], NOW);
    expect(buckets.nextUp?.id).toBe("plain");
  });

  it("orders blocked tasks deterministically and leaves overdue maths untouched", () => {
    const tasks = [
      task({ blocker: BLOCKER, due_at: at(60) }, "later"),
      task({ blocker: BLOCKER, due_at: at(-30) }, "late"),
      task({ blocker: BLOCKER, priority: "urgent", due_at: at(120) }, "urgent"),
    ];

    const first = buildWorkBuckets(tasks, NOW).needsAttention.map((x) => x.id);
    const second = buildWorkBuckets([...tasks].reverse(), NOW).needsAttention.map((x) => x.id);

    expect(first).toEqual(second);
    expect(first).toEqual(sortWork(tasks, NOW).map((x) => x.id));
    expect(overdueMinutes(tasks[1], NOW)).toBe(30); // a blocker does not pause the clock
    expect(tasks[1].due_at).toBe(at(-30)); // the original due time is preserved
  });

  it("reports an empty queue unchanged", () => {
    const buckets = buildWorkBuckets([], NOW);
    expect(buckets.needsAttention).toEqual([]);
    expect(buckets.remaining).toBe(0);
    expect(buckets.started).toBe(0);
  });
});

describe("English / Spanish parity for the blocker flow", () => {
  type Tree = { [key: string]: string | Tree };
  const leaves = (node: Tree, prefix = ""): string[] =>
    Object.entries(node).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`)));
  const hk = (dict: unknown) => (dict as { tasks: { hk: Tree } }).tasks.hk;

  it("has every blocker string in both languages", () => {
    const english = leaves((hk(en).blocker as Tree)).sort();
    const spanish = leaves((hk(es).blocker as Tree)).sort();
    expect(spanish).toEqual(english);
    for (const reason of BLOCKER_REASONS) expect(english).toContain(`reason.${reason}`);
  });

  it("has the new task sheet, card and message strings in both languages", () => {
    const keys = [
      "sections.needsAttention",
      "action.viewDetails",
      "action.viewDetailsA11y",
      "action.resumeA11y",
      "card.reportedAt",
      "sheet.status.blocked",
      "sheet.action.unableToComplete",
      "sheet.action.resume",
      "sheet.action.viewActivity",
      "sheet.reason.blocked",
      "sheet.event.blocker_reported",
      "sheet.event.blocker_resolved",
      "sheet.event.resolution.resumed",
      "sheet.event.resolution.resolved",
      "sheet.event.resolution.completed",
      "sheet.event.resolution.reassigned",
      "msg.resumeFailed",
      "msg.resumeConflict",
    ];
    const read = (dict: unknown, key: string) => key.split(".").reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], hk(dict));
    for (const key of keys) {
      expect(typeof read(en, key)).toBe("string");
      expect(typeof read(es, key)).toBe("string");
      expect(read(es, key)).not.toBe(read(en, key));
    }
  });

  it("keeps interpolation placeholders identical across languages", () => {
    const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
    const pairs = (e: Tree, s: Tree, prefix = ""): Array<[string, string, string]> =>
      Object.entries(e).flatMap(([key, value]) =>
        typeof value === "string" ? [[`${prefix}${key}`, value, s[key] as string] as [string, string, string]] : pairs(value, s[key] as Tree, `${prefix}${key}.`),
      );
    for (const [key, english, spanish] of pairs(hk(en).blocker as Tree, hk(es).blocker as Tree)) {
      expect({ key, placeholders: placeholders(spanish) }).toEqual({ key, placeholders: placeholders(english) });
    }
  });
});
