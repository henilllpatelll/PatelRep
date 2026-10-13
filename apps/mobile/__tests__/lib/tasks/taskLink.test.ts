import { linkFailureOutcome, taskIdFromNotification } from "@/lib/tasks/taskLink";

const ID = "3f2b1c9e-5a7d-4e2f-9c1a-0b8d6e4f7a21";

describe("taskIdFromNotification", () => {
  it("reads the task id of every task notification type", () => {
    for (const type of ["task_assigned", "task_assigned_urgent", "task_reassigned", "task_cancelled", "task_blocker_resolved", "task_blocked"]) {
      expect(taskIdFromNotification({ type, task_id: ID })).toBe(ID);
    }
  });

  it("accepts a stored row's data (no type) and normalises the case", () => {
    expect(taskIdFromNotification({ task_id: ID.toUpperCase() })).toBe(ID);
  });

  it("refuses ids that are not UUIDs, so a payload can never carry a path or a query", () => {
    for (const bad of ["../admin", `${ID}/complete`, `${ID}?x=1`, "123", "", null, undefined, 7, {}]) {
      expect(taskIdFromNotification({ task_id: bad })).toBeNull();
    }
  });

  it("ignores other notification types even when they carry a task id", () => {
    expect(taskIdFromNotification({ type: "guest_request", task_id: ID })).toBeNull();
  });

  it("handles missing payloads", () => {
    expect(taskIdFromNotification(null)).toBeNull();
    expect(taskIdFromNotification(undefined)).toBeNull();
    expect(taskIdFromNotification("task_assigned")).toBeNull();
  });
});

describe("linkFailureOutcome", () => {
  it("treats refusals as unavailable and never says which kind", () => {
    for (const status of [400, 401, 403, 404, 409]) expect(linkFailureOutcome({ status })).toBe("unavailable");
  });

  it("treats no answer and temporary server problems as retryable", () => {
    for (const error of [new Error("Network request failed"), { status: 500 }, { status: 503 }, { status: 408 }, { status: 429 }]) {
      expect(linkFailureOutcome(error)).toBe("retry");
    }
  });
});
