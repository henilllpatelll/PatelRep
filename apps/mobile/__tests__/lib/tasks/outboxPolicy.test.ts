import { ApiError } from "@/lib/api/client";
import type { Task } from "@/lib/api/tasks";
import {
  OFFLINE_MATRIX,
  backoffMs,
  canRetryConflict,
  checkQueueable,
  classifyCompletionError,
  isCompletedForMe,
  newMutationId,
  replayConflict,
  type OutboxEntry,
} from "@/lib/tasks/offline/outboxPolicy";

const viewer = { userId: "me", role: "housekeeper" };

function task(extra: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Deliver towels",
    description: null,
    task_type: "guest_request",
    status: "in_progress",
    priority: "normal",
    assigned_to: "me",
    assigned_to_name: null,
    created_by: null,
    created_by_name: null,
    room_id: null,
    room_number: "214",
    room_floor: null,
    location_text: null,
    due_at: null,
    created_at: null,
    started_at: null,
    completed_at: null,
    is_ai_created: false,
    guest_request: null,
    blocker: null,
    ...extra,
  };
}

describe("offline support matrix", () => {
  it("queues only completion; claim, start, create, AI, problem reports and notes need a connection", () => {
    expect(OFFLINE_MATRIX.complete).toBe("queued");
    for (const online of ["claim", "start", "create", "aiParse", "reportProblem", "postNote"] as const) {
      expect(OFFLINE_MATRIX[online]).toBe("online-only");
    }
    for (const cached of ["readMyWork", "readTaskDetail", "readCompletedHistory"] as const) {
      expect(OFFLINE_MATRIX[cached]).toBe("cached");
    }
  });
});

describe("checkQueueable", () => {
  it("allows my own started, unblocked task", () => {
    expect(checkQueueable(task(), viewer, {}, "", 2000)).toBeNull();
  });

  it.each([
    ["no session", task(), { userId: null, role: null }, "no_session"],
    ["someone else's task", task({ assigned_to: "other" }), viewer, "not_assigned"],
    ["an unassigned task", task({ assigned_to: null }), viewer, "not_assigned"],
    ["a task that was never started", task({ status: "open" }), viewer, "not_in_progress"],
    ["an already completed task", task({ status: "completed" }), viewer, "not_in_progress"],
    ["a cancelled task", task({ status: "cancelled" }), viewer, "not_in_progress"],
    [
      "a task with a reported problem",
      task({
        blocker: { id: "b", reason: "other", details: null, reported_by: "me", reported_by_name: null, reported_at: null, status: "active", notification_status: "queued" },
      }),
      viewer,
      "blocked",
    ],
  ] as const)("refuses %s", (_label, candidate, who, expected) => {
    expect(checkQueueable(candidate, who, {}, "", 2000)).toBe(expected);
  });

  it("refuses a second completion for the same task (no duplicate requests)", () => {
    const existing = { t1: {} as OutboxEntry };
    expect(checkQueueable(task(), viewer, existing, "", 2000)).toBe("duplicate");
  });

  it("refuses a note the server would reject", () => {
    expect(checkQueueable(task(), viewer, {}, "x".repeat(2001), 2000)).toBe("note_too_long");
    expect(checkQueueable(task(), viewer, {}, "  " + "x".repeat(2000) + "  ", 2000)).toBeNull();
  });

  it("has no task at all -> no session", () => {
    expect(checkQueueable(null, viewer, {}, "", 2000)).toBe("no_session");
  });
});

describe("classifyCompletionError", () => {
  const api = (status: number, code?: string) => new ApiError("x", status, code);

  it("treats a request with no HTTP answer as retryable (the outcome is unknown)", () => {
    expect(classifyCompletionError(new Error("Network request failed"))).toEqual({ kind: "retry", status: null });
    expect(classifyCompletionError(new Error("Request timed out. Please try again."))).toEqual({ kind: "retry", status: null });
  });

  it("waits for sign-in on an auth problem without counting it against the item", () => {
    expect(classifyCompletionError(new Error("Not authenticated"))).toEqual({ kind: "auth" });
    expect(classifyCompletionError(new Error("Session expired. Please log in again."))).toEqual({ kind: "auth" });
    expect(classifyCompletionError(api(401))).toEqual({ kind: "auth" });
  });

  it.each([408, 425, 429, 500, 502, 503])("retries a transient %i", (status) => {
    expect(classifyCompletionError(api(status))).toEqual({ kind: "retry", status });
  });

  it.each([403, 404, 409, 422])("stops on a definitive %i", (status) => {
    expect(classifyCompletionError(api(status))).toMatchObject({ kind: "conflict", status });
  });

  it("carries the server's machine-readable code", () => {
    expect(classifyCompletionError(api(409, "task_blocked"))).toEqual({ kind: "conflict", status: 409, errorCode: "task_blocked" });
  });
});

describe("backoffMs", () => {
  it("grows exponentially and is capped", () => {
    expect(backoffMs(1)).toBe(15_000);
    expect(backoffMs(2)).toBe(30_000);
    expect(backoffMs(3)).toBe(60_000);
    expect(backoffMs(40)).toBe(15 * 60_000);
  });

  it("never retries a rate limit sooner than a minute", () => {
    expect(backoffMs(1, 429)).toBe(60_000);
    expect(backoffMs(4, 429)).toBe(120_000);
  });
});

describe("replayConflict", () => {
  it("names the real reason from the task as the server now has it", () => {
    expect(replayConflict(403, null, task({ assigned_to: "someone" }), viewer)).toBe("reassigned");
    expect(replayConflict(409, null, task({ status: "cancelled" }), viewer)).toBe("cancelled");
    expect(replayConflict(409, "task_blocked", task(), viewer)).toBe("blocked");
    expect(replayConflict(404, null, null, viewer)).toBe("unavailable");
  });

  it("falls back to the status when the task could not be read", () => {
    expect(replayConflict(403, null, undefined, viewer)).toBe("forbidden");
    expect(replayConflict(409, null, undefined, viewer)).toBe("changed");
    expect(replayConflict(422, null, undefined, viewer)).toBe("rejected");
  });
});

describe("retry and reconciliation rules", () => {
  it("allows an explicit retry only for a lost race, never for a final refusal", () => {
    expect(canRetryConflict("changed")).toBe(true);
    for (const final of ["completed", "cancelled", "reassigned", "claimed", "unavailable", "blocked", "forbidden", "rejected", "expired"] as const) {
      expect(canRetryConflict(final)).toBe(false);
    }
  });

  it("recognises a task completed elsewhere as confirmed only when it is mine", () => {
    expect(isCompletedForMe(task({ status: "completed" }), viewer)).toBe(true);
    expect(isCompletedForMe(task({ status: "completed", assigned_to: "other" }), viewer)).toBe(false);
    expect(isCompletedForMe(task({ status: "cancelled" }), viewer)).toBe(false);
    expect(isCompletedForMe(null, viewer)).toBe(false);
  });

  it("makes distinct local mutation ids", () => {
    expect(newMutationId()).not.toBe(newMutationId());
  });
});
