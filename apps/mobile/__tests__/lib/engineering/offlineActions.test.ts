import { buildPendingActions, classifyReplayFailure, reconcileCompletion, summarizePending } from "@/lib/engineering/offlineActions";
import type { SyncQueueSummaryRow } from "@/lib/offline/db";

const err = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const row = (over: Partial<SyncQueueSummaryRow>): SyncQueueSummaryRow => ({ id: 1, entity_type: "work_order", action: "claim", entity_id: "wo-1", room_id: null, attempts: 0, created_at: "2026-10-31T10:00:00Z", ...over });

describe("replay failure classification", () => {
  it("retries only what could still succeed", () => {
    expect(classifyReplayFailure(new Error("Network request failed"))).toBe("retry");
    expect(classifyReplayFailure(err(500))).toBe("retry");
    expect(classifyReplayFailure(err(401))).toBe("retry");
  });
  it("treats business refusals as permanent", () => {
    expect(classifyReplayFailure(err(409))).toBe("conflict");
    expect(classifyReplayFailure(err(403))).toBe("forbidden");
    expect(classifyReplayFailure(err(404))).toBe("not_found");
    expect(classifyReplayFailure(err(422))).toBe("invalid");
  });
});

describe("completion reconciliation", () => {
  it("confirms only an order completed and still assigned to this person", () => {
    expect(reconcileCompletion({ status: "completed", assigned_to: "me" }, "me")).toBe("confirmed");
    expect(reconcileCompletion({ status: "completed", assigned_to: "other" }, "me")).toBe("conflict");
    expect(reconcileCompletion({ status: "on_hold", assigned_to: "me" }, "me")).toBe("conflict");
    expect(reconcileCompletion({ status: "cancelled", assigned_to: "me" }, "me")).toBe("conflict");
    expect(reconcileCompletion(null, "me")).toBe("conflict");
    expect(reconcileCompletion({ status: "completed", assigned_to: "me" }, null)).toBe("conflict");
  });
});

describe("pending actions", () => {
  it("derives state from the real queue row and never offers retry for a refused change", () => {
    const actions = buildPendingActions([
      row({ id: 1, attempts: 0 }),
      row({ id: 2, action: "complete", attempts: 2, label: "WO-1042" }),
      row({ id: 3, action: "complete", attempts: 5 }),
      row({ id: 4, action: "complete", attempts: 5, last_error: "conflict" }),
    ]);
    expect(actions.map((a) => a.state)).toEqual(["waiting", "retrying", "stuck", "refused"]);
    expect(actions.map((a) => a.canRetry)).toEqual([false, false, true, false]);
    expect(actions[3].reason).toBe("conflict");
    expect(actions.every((a) => a.canDiscard)).toBe(true);
    expect(actions[1].label).toBe("WO-1042");
  });
  it("lists only work-order rows and tells reports from claims", () => {
    const actions = buildPendingActions([
      row({ id: 1, entity_type: "task", action: "create" }),
      row({ id: 2, action: "create", entity_id: "eng-report:abc" }),
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("report");
    expect(actions[0].woId).toBeNull();
  });
  it("counts refused and stuck as needing attention", () => {
    const a = buildPendingActions([row({ id: 1 }), row({ id: 2, attempts: 5 }), row({ id: 3, attempts: 5, last_error: "forbidden" })]);
    expect(summarizePending(a)).toEqual({ waiting: 1, needsAttention: 2 });
  });
});
