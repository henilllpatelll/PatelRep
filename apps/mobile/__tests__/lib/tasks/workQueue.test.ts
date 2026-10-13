const mockGet = jest.fn();

jest.mock("@/lib/api/client", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn() },
}));

import { normalizeTask, type Task } from "@/lib/api/tasks";
import { buildWorkBuckets, fetchDoneToday, minutesSince, overdueMinutes, sortWork } from "@/lib/tasks/workQueue";

const NOW = new Date("2026-10-12T17:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60000).toISOString();

function task(id: string, extra: Record<string, unknown> = {}): Task {
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

describe("sortWork", () => {
  it("orders overdue first, then in-progress, then open; urgent and earlier due first; id breaks ties", () => {
    const sorted = sortWork(
      [
        task("open-later", { due_at: at(300) }),
        task("open-soon", { due_at: at(30) }),
        task("open-urgent", { priority: "urgent", due_at: at(200) }),
        task("progress", { status: "in_progress", due_at: at(500) }),
        task("overdue-low", { priority: "low", due_at: at(-5) }),
        task("overdue-urgent", { priority: "urgent", due_at: at(-5) }),
        task("b-tie", { due_at: at(400) }),
        task("a-tie", { due_at: at(400) }),
      ],
      NOW,
    );

    expect(sorted.map((t) => t.id)).toEqual([
      "overdue-urgent",
      "overdue-low",
      "progress",
      "open-urgent",
      "open-soon",
      "open-later",
      "a-tie",
      "b-tie",
    ]);
  });

  it("is stable regardless of input order", () => {
    const tasks = [task("a", { due_at: at(60) }), task("b", { due_at: at(10) }), task("c", { due_at: at(-10) })];
    expect(sortWork([...tasks].reverse(), NOW).map((t) => t.id)).toEqual(sortWork(tasks, NOW).map((t) => t.id));
  });
});

describe("buildWorkBuckets", () => {
  it("picks Next Up by the priority policy and never repeats it in the lists", () => {
    const buckets = buildWorkBuckets(
      [
        task("late", { due_at: at(-12), title: "Deliver towels" }),
        task("urgent", { priority: "urgent", due_at: at(120) }),
        task("soon", { due_at: at(90) }),
        task("evening", { due_at: at(480) }),
        task("nodue", { due_at: null }),
        task("running", { status: "in_progress", started_at: at(-8), due_at: at(60) }),
        task("done", { status: "completed" }),
        task("cancelled", { status: "cancelled" }),
      ],
      NOW,
    );

    expect(buckets.nextUp?.id).toBe("late");
    expect(buckets.inProgress.map((t) => t.id)).toEqual(["running"]);
    expect(buckets.upNext.map((t) => t.id)).toEqual(["urgent", "soon"]);
    expect(buckets.later.map((t) => t.id)).toEqual(["evening", "nodue"]);
    expect(buckets.remaining).toBe(5);
    const everywhere = [buckets.nextUp!, ...buckets.inProgress, ...buckets.upNext, ...buckets.later].map((t) => t.id);
    expect(new Set(everywhere).size).toBe(everywhere.length);
  });

  it("treats escalated assignments as actionable and puts the longest-running task first", () => {
    const buckets = buildWorkBuckets(
      [
        task("esc", { status: "escalated", priority: "urgent" }),
        task("new", { status: "in_progress", started_at: at(-2) }),
        task("old", { status: "in_progress", started_at: at(-50) }),
      ],
      NOW,
    );

    expect(buckets.nextUp?.id).toBe("esc");
    expect(buckets.inProgress.map((t) => t.id)).toEqual(["old", "new"]);
  });

  it("has no Next Up and no sections for an empty list", () => {
    expect(buildWorkBuckets([], NOW)).toEqual({ needsAttention: [], nextUp: null, inProgress: [], upNext: [], later: [], remaining: 0, started: 0 });
  });
});

describe("time helpers", () => {
  it("computes overdue and elapsed minutes from absolute instants", () => {
    expect(overdueMinutes(task("a", { due_at: at(-12) }), NOW)).toBe(12);
    expect(overdueMinutes(task("a", { due_at: at(12) }), NOW)).toBeNull();
    expect(overdueMinutes(task("a", { due_at: null }), NOW)).toBeNull();
    expect(minutesSince(at(-8), NOW)).toBe(8);
    expect(minutesSince(null, NOW)).toBeNull();
  });
});

describe("fetchDoneToday", () => {
  const completed = (id: string, iso: string) => ({ id, title: id, status: "completed", completed_at: iso });

  beforeEach(() => mockGet.mockReset());

  it("counts completions on the hotel's calendar day, not the device's", async () => {
    // Chicago (CDT, UTC-5): 03:30Z on the 13th is still the 12th at 22:30; 05:30Z on the 13th is the 13th.
    mockGet.mockResolvedValueOnce({
      data: [
        completed("a", "2026-10-13T03:30:00+00:00"),
        completed("b", "2026-10-12T15:00:00+00:00"),
        completed("c", "2026-10-12T04:30:00+00:00"), // 23:30 on the 11th in Chicago
      ],
      meta: { has_more: true, next_cursor: "n" },
    });

    const result = await fetchDoneToday("America/Chicago", NOW);

    expect(result).toEqual({ count: 2, atLeast: false });
    expect(mockGet).toHaveBeenCalledTimes(1); // reached an earlier day, so no more pages needed
  });

  it("keeps paging while every row is still today and flags a capped read", async () => {
    mockGet.mockResolvedValue({
      data: [completed("x", "2026-10-12T15:00:00+00:00")],
      meta: { has_more: true, next_cursor: "n" },
    });

    const result = await fetchDoneToday("America/Chicago", NOW);

    expect(result.atLeast).toBe(true);
    expect(result.count).toBe(3);
  });

  it("propagates a failed request instead of reporting zero", async () => {
    mockGet.mockRejectedValue(new Error("HTTP 500"));

    await expect(fetchDoneToday("America/Chicago", NOW)).rejects.toThrow("HTTP 500");
  });
});
