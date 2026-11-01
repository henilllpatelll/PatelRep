import fs from "fs";
import path from "path";
import { transitionWorkOrder } from "@/lib/api/workOrders";
import { api } from "@/lib/api/client";
import {
  HOLD_REASON_CODES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_TRANSITIONS,
  canTransitionWorkOrder,
  countQueueSignals,
  isActiveWorkOrder,
  isHighPriority,
  priorityRank,
  sortQueue,
  splitWorkbench,
  type WorkOrder,
} from "@/lib/engineering/workOrders";

jest.mock("@/lib/api/client", () => ({
  API_BASE: "http://api.test/v1",
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));

const base: WorkOrder = { id: "wo", title: "Fix", status: "open", priority: "normal" };
const NOW = new Date("2026-11-04T16:00:00Z");

describe("priorities", () => {
  it("orders emergency above urgent above normal above low", () => {
    expect([...WORK_ORDER_PRIORITIES]).toEqual(["emergency", "urgent", "normal", "low"]);
    expect(priorityRank("emergency")).toBeLessThan(priorityRank("urgent"));
    expect(priorityRank("urgent")).toBeLessThan(priorityRank("normal"));
    expect(priorityRank("normal")).toBeLessThan(priorityRank("low"));
    expect(priorityRank(undefined)).toBeGreaterThan(priorityRank("low"));
  });

  it("treats both emergency and urgent as high priority", () => {
    expect(isHighPriority("emergency")).toBe(true);
    expect(isHighPriority("urgent")).toBe(true);
    expect(isHighPriority("normal")).toBe(false);
    expect(isHighPriority("low")).toBe(false);
    expect(isHighPriority(null)).toBe(false);
  });
});

describe("queue signals", () => {
  const orders: WorkOrder[] = [
    { ...base, id: "e", priority: "emergency" },
    { ...base, id: "u1", priority: "urgent" },
    { ...base, id: "u2", priority: "urgent", status: "in_progress" },
    { ...base, id: "n", priority: "normal" },
    { ...base, id: "done", priority: "emergency", status: "completed" },
  ];

  it("counts emergency and urgent separately and together", () => {
    expect(countQueueSignals(orders, NOW)).toMatchObject({ emergency: 1, urgent: 2, highPriority: 3 });
  });

  it("never lets an emergency vanish from the urgent chip", () => {
    const only = countQueueSignals([{ ...base, priority: "emergency" }], NOW);
    expect(only.highPriority).toBe(1);
    expect(only.urgent).toBe(0);
  });
});

describe("queue ordering", () => {
  it("puts emergency before urgent before overdue before the rest, newest first within a rank", () => {
    const list: WorkOrder[] = [
      { ...base, id: "normal-old", created_at: "2026-11-01T00:00:00Z" },
      { ...base, id: "normal-new", created_at: "2026-11-03T00:00:00Z" },
      { ...base, id: "overdue", due_at: "2026-11-04T10:00:00Z", created_at: "2026-11-02T00:00:00Z" },
      { ...base, id: "urgent", priority: "urgent" },
      { ...base, id: "emergency", priority: "emergency" },
    ];
    expect(sortQueue(list, NOW).map((w) => w.id)).toEqual(["emergency", "urgent", "overdue", "normal-new", "normal-old"]);
  });

  it("a workbench puts my in-progress work on the bench and the unclaimed queue separately", () => {
    const open = [{ ...base, id: "q", priority: "urgent" as const }];
    const active = [
      { ...base, id: "mine", status: "in_progress" as const, assigned_to: "me" },
      { ...base, id: "theirs", status: "in_progress" as const, assigned_to: "you" },
    ];
    const wb = splitWorkbench(open, active, "me", NOW);
    expect(wb.bench.map((w) => w.id)).toEqual(["mine"]);
    expect(wb.team.map((w) => w.id)).toEqual(["theirs"]);
    expect(wb.queue.map((w) => w.id)).toEqual(["q"]);
  });
});

describe("statuses", () => {
  it("knows which statuses are active", () => {
    for (const status of ["open", "escalated", "in_progress", "on_hold"] as const) expect(isActiveWorkOrder({ status })).toBe(true);
    for (const status of ["completed", "cancelled"] as const) expect(isActiveWorkOrder({ status })).toBe(false);
  });

  it("allows hold and resume but not completing straight from open", () => {
    expect(canTransitionWorkOrder("in_progress", "on_hold")).toBe(true);
    expect(canTransitionWorkOrder("on_hold", "in_progress")).toBe(true);
    expect(canTransitionWorkOrder("open", "completed")).toBe(false);
    expect(canTransitionWorkOrder("completed", "open")).toBe(true);
    expect(canTransitionWorkOrder("completed", "in_progress")).toBe(false);
  });
});

describe("transitionWorkOrder", () => {
  beforeEach(() => {
    (api.post as jest.Mock).mockReset().mockResolvedValue({ data: {} });
    (api.patch as jest.Mock).mockReset();
  });

  it("changes status through the transition endpoint, never PATCH", async () => {
    await transitionWorkOrder("wo-1", { status: "on_hold", reason_code: "awaiting_parts" });
    expect(api.post).toHaveBeenCalledWith("/work-orders/wo-1/transition", {
      status: "on_hold",
      reason_code: "awaiting_parts",
      source: "mobile",
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("resume needs no reason", async () => {
    await transitionWorkOrder("wo-1", { status: "in_progress" });
    expect(api.post).toHaveBeenCalledWith("/work-orders/wo-1/transition", expect.objectContaining({ status: "in_progress", source: "mobile" }));
  });
});

/* Drift guards against the API's own transition rules. */
describe("matches apps/api/services/work_orders/transitions.py", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../../api/services/work_orders/transitions.py"), "utf8");

  function pyDict(name: string): Record<string, string[]> {
    const body = new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source)![1];
    const result: Record<string, string[]> = {};
    for (const entry of body.matchAll(/"(\w+)":\s*frozenset\(\{([^}]*)\}\)/g)) {
      result[entry[1]] = [...entry[2].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    }
    return result;
  }

  it("has the same allowed transitions", () => {
    const api = pyDict("_ALLOWED_TRANSITIONS");
    expect(Object.keys(api).sort()).toEqual(Object.keys(WORK_ORDER_TRANSITIONS).sort());
    for (const [from, targets] of Object.entries(api)) {
      expect([...WORK_ORDER_TRANSITIONS[from as keyof typeof WORK_ORDER_TRANSITIONS]].sort()).toEqual([...targets].sort());
    }
  });

  it("has the same hold reasons", () => {
    expect([...HOLD_REASON_CODES].sort()).toEqual(pyDict("_REASONS_BY_TARGET").on_hold.sort());
  });

  it("has the same priority values", () => {
    const match = /WORK_ORDER_PRIORITIES[^=]*=\s*\(([^)]*)\)/.exec(source)!;
    expect([...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual([...WORK_ORDER_PRIORITIES]);
  });
});
