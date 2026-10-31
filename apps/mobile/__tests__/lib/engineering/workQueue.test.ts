import {
  EMPTY_FILTERS,
  activeFilterCount,
  availableViews,
  belongsToView,
  buildListParams,
  canViewTeamWork,
  classifyClaimError,
  compareWorkOrders,
  dedupeById,
  groupMineWork,
  isClaimable,
  isOverdue,
  isTerminalClaimFailure,
  queueKey,
  startOfHotelDay,
  urgentLandingView,
  viewStatuses,
  workOrderLabel,
} from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const ME = "eng-me";
const OTHER = "eng-other";
const NOW = new Date("2026-10-15T15:00:00Z"); // 10:00 in Chicago (CDT)

let counter = 0;
const wo = (over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: `wo-${++counter}`,
  title: "Fix it",
  status: "open",
  priority: "normal",
  assigned_to: null,
  created_at: "2026-10-15T10:00:00Z",
  ...over,
});

describe("views per role", () => {
  it("shows Team only to roles the API lets read everyone's work", () => {
    expect(availableViews("engineer")).toEqual(["mine", "available", "waiting", "done"]);
    expect(availableViews("chief_engineer")).toEqual(["mine", "available", "team", "waiting", "done"]);
    expect(availableViews("gm")).toContain("team");
    expect(canViewTeamWork("housekeeper")).toBe(false);
    expect(canViewTeamWork(undefined)).toBe(false);
  });
});

describe("belongsToView", () => {
  const viewer = { userId: ME, role: "engineer" };

  it("My Work is only the viewer's own active orders", () => {
    expect(belongsToView(wo({ assigned_to: ME, status: "in_progress" }), "mine", viewer)).toBe(true);
    expect(belongsToView(wo({ assigned_to: ME, status: "escalated" }), "mine", viewer)).toBe(true);
    expect(belongsToView(wo({ assigned_to: OTHER, status: "in_progress" }), "mine", viewer)).toBe(false);
    expect(belongsToView(wo({ assigned_to: null }), "mine", viewer)).toBe(false);
    expect(belongsToView(wo({ assigned_to: ME, status: "completed" }), "mine", viewer)).toBe(false);
    expect(belongsToView(wo({ assigned_to: ME, status: "cancelled" }), "mine", viewer)).toBe(false);
  });

  it("Available is unassigned open or escalated work only", () => {
    expect(belongsToView(wo(), "available", viewer)).toBe(true);
    expect(belongsToView(wo({ status: "escalated" }), "available", viewer)).toBe(true);
    expect(belongsToView(wo({ assigned_to: OTHER }), "available", viewer)).toBe(false);
    expect(belongsToView(wo({ status: "in_progress" }), "available", viewer)).toBe(false);
    expect(belongsToView(wo({ status: "completed" }), "available", viewer)).toBe(false);
  });

  it("Team is other people's active work and only for roles allowed to see it", () => {
    const row = wo({ assigned_to: OTHER, status: "in_progress" });
    expect(belongsToView(row, "team", { userId: ME, role: "engineer" })).toBe(false);
    expect(belongsToView(row, "team", { userId: ME, role: "chief_engineer" })).toBe(true);
    expect(belongsToView(wo({ assigned_to: ME, status: "in_progress" }), "team", { userId: ME, role: "chief_engineer" })).toBe(false);
    expect(belongsToView(wo({ assigned_to: null }), "team", { userId: ME, role: "chief_engineer" })).toBe(false);
  });

  it("Waiting is on-hold work; Done keeps completed and cancelled out of every active view", () => {
    expect(belongsToView(wo({ status: "on_hold" }), "waiting", viewer)).toBe(true);
    expect(belongsToView(wo({ status: "in_progress" }), "waiting", viewer)).toBe(false);
    expect(belongsToView(wo({ status: "completed" }), "done", viewer)).toBe(true);
    expect(belongsToView(wo({ status: "cancelled" }), "done", viewer)).toBe(true);
    expect(belongsToView(wo({ status: "open" }), "done", viewer)).toBe(false);
    for (const view of ["mine", "available", "team", "waiting"] as const) {
      expect(belongsToView(wo({ status: "completed", assigned_to: ME }), view, { userId: ME, role: "chief_engineer" })).toBe(false);
      expect(belongsToView(wo({ status: "cancelled", assigned_to: ME }), view, { userId: ME, role: "chief_engineer" })).toBe(false);
    }
  });
});

describe("claiming rules", () => {
  it("only an open, unclaimed order is claimable, and only by a role the API lets claim", () => {
    expect(isClaimable(wo(), "engineer")).toBe(true);
    expect(isClaimable(wo(), "gm")).toBe(true);
    expect(isClaimable(wo(), "chief_engineer")).toBe(false);
    expect(isClaimable(wo({ assigned_to: OTHER }), "engineer")).toBe(false);
    for (const status of ["escalated", "in_progress", "on_hold", "completed", "cancelled"] as const) {
      expect(isClaimable(wo({ status }), "engineer")).toBe(false);
    }
  });

  it("classifies claim failures from the API status", () => {
    expect(classifyClaimError({ status: 409 })).toBe("conflict");
    expect(classifyClaimError({ status: 403 })).toBe("forbidden");
    expect(classifyClaimError({ status: 401 })).toBe("forbidden");
    expect(classifyClaimError({ status: 404 })).toBe("not_found");
    expect(classifyClaimError({ status: 500 })).toBe("failed");
    expect(classifyClaimError(new Error("Network request failed"))).toBe("offline");
  });

  it("treats only refusals as terminal, so a flaky connection is retried", () => {
    expect(isTerminalClaimFailure({ status: 409 })).toBe(true);
    expect(isTerminalClaimFailure({ status: 403 })).toBe(true);
    expect(isTerminalClaimFailure({ status: 404 })).toBe(true);
    expect(isTerminalClaimFailure({ status: 500 })).toBe(false);
    expect(isTerminalClaimFailure(new Error("Network request failed"))).toBe(false);
  });
});

describe("priority ordering", () => {
  const rank = (orders: WorkOrder[], sort: Parameters<typeof compareWorkOrders>[0] = "priority") =>
    [...orders].sort(compareWorkOrders(sort)).map((o) => o.id);

  it("ranks emergency above urgent above normal above low", () => {
    const low = wo({ id: "low", priority: "low" });
    const normal = wo({ id: "normal" });
    const urgent = wo({ id: "urgent", priority: "urgent" });
    const emergency = wo({ id: "emergency", priority: "emergency" });
    expect(rank([low, normal, urgent, emergency])).toEqual(["emergency", "urgent", "normal", "low"]);
  });

  it("orders same-priority work by due time, with undated work last", () => {
    const later = wo({ id: "later", priority: "urgent", due_at: "2026-10-15T18:00:00Z" });
    const sooner = wo({ id: "sooner", priority: "urgent", due_at: "2026-10-15T12:00:00Z" });
    const undated = wo({ id: "undated", priority: "urgent" });
    expect(rank([undated, later, sooner])).toEqual(["sooner", "later", "undated"]);
  });

  it("never lets overdue erase priority: an overdue normal job stays under a fresh urgent one", () => {
    const overdueNormal = wo({ id: "overdue", due_at: "2026-10-15T09:00:00Z" });
    const freshUrgent = wo({ id: "urgent", priority: "urgent", due_at: "2026-10-16T09:00:00Z" });
    expect(rank([overdueNormal, freshUrgent])).toEqual(["urgent", "overdue"]);
    expect(isOverdue(overdueNormal, NOW)).toBe(true);
    expect(isOverdue(freshUrgent, NOW)).toBe(false);
  });

  it("is deterministic: identical rows keep a stable id order regardless of input order", () => {
    const a = wo({ id: "a" });
    const b = wo({ id: "b" });
    expect(rank([a, b])).toEqual(rank([b, a]));
  });

  it("supports the other sorts", () => {
    const old = wo({ id: "old", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", due_at: "2026-10-20T00:00:00Z" });
    const fresh = wo({ id: "fresh", created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-12T00:00:00Z", due_at: "2026-10-16T00:00:00Z" });
    expect(rank([old, fresh], "newest")).toEqual(["fresh", "old"]);
    expect(rank([fresh, old], "oldest")).toEqual(["old", "fresh"]);
    expect(rank([old, fresh], "due")).toEqual(["fresh", "old"]);
    expect(rank([old, fresh], "updated")).toEqual(["fresh", "old"]);
  });
});

describe("My Work grouping", () => {
  it("puts each order in exactly one group, escalated first, then in progress, ready, on hold", () => {
    const groups = groupMineWork([
      wo({ id: "hold", status: "on_hold", assigned_to: ME }),
      wo({ id: "ready", status: "open", assigned_to: ME }),
      wo({ id: "esc", status: "escalated", assigned_to: ME }),
      wo({ id: "prog", status: "in_progress", assigned_to: ME }),
      wo({ id: "prog", status: "in_progress", assigned_to: ME }), // a repeated row must not appear twice
    ]);
    expect(groups.map((g) => g.key)).toEqual(["escalated", "in_progress", "ready", "on_hold"]);
    expect(groups.flatMap((g) => g.orders.map((o) => o.id))).toEqual(["esc", "prog", "ready", "hold"]);
  });

  it("omits empty groups and sorts inside a group by urgency", () => {
    const groups = groupMineWork([wo({ id: "n", status: "in_progress" }), wo({ id: "e", status: "in_progress", priority: "emergency" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].orders.map((o) => o.id)).toEqual(["e", "n"]);
  });

  it("never invents a status: completed and cancelled are not grouped", () => {
    expect(groupMineWork([wo({ status: "completed" }), wo({ status: "cancelled" })])).toEqual([]);
  });
});

describe("buildListParams", () => {
  const ctx = { role: "engineer", now: NOW, timeZone: "America/Chicago" };

  it("asks the server for exactly what each view means", () => {
    expect(buildListParams("mine", EMPTY_FILTERS, "", ctx)).toMatchObject({ mine: true, sort_by: "priority", statuses: ["open", "escalated", "in_progress", "on_hold"] });
    expect(buildListParams("available", EMPTY_FILTERS, "", ctx)).toMatchObject({ unassigned: true, statuses: ["open", "escalated"] });
    expect(buildListParams("team", EMPTY_FILTERS, "", { ...ctx, role: "chief_engineer" })).toMatchObject({ assigned_to_others: true });
    expect(buildListParams("waiting", EMPTY_FILTERS, "", ctx)).toMatchObject({ statuses: ["on_hold"] });
    expect(buildListParams("done", EMPTY_FILTERS, "", ctx)).toMatchObject({ statuses: ["completed"], sort_by: "updated_at", mine: true });
  });

  it("does not scope a chief engineer's Done history to themselves", () => {
    expect(buildListParams("done", EMPTY_FILTERS, "", { ...ctx, role: "chief_engineer" }).mine).toBeUndefined();
  });

  it("keeps cancelled work apart from completed: Done shows one outcome at a time", () => {
    expect(viewStatuses("done", EMPTY_FILTERS)).toEqual(["completed"]);
    expect(viewStatuses("done", { ...EMPTY_FILTERS, statuses: ["cancelled"] })).toEqual(["cancelled"]);
    expect(viewStatuses("done", { ...EMPTY_FILTERS, statuses: ["completed", "cancelled"] })).toEqual(["completed"]);
  });

  it("narrows statuses to what the view allows", () => {
    expect(viewStatuses("mine", { ...EMPTY_FILTERS, statuses: ["in_progress", "completed"] })).toEqual(["in_progress"]);
    expect(viewStatuses("waiting", { ...EMPTY_FILTERS, statuses: ["open"] })).toEqual(["on_hold"]);
  });

  it("combines search, priority, category and location", () => {
    const params = buildListParams("mine", { ...EMPTY_FILTERS, priority: "urgent", category: "hvac", floor: 3, building: "A" }, "  312 ", ctx);
    expect(params).toMatchObject({ q: "312", priority: "urgent", category: "hvac", floor: 3, building: "A", mine: true });
  });

  it("maps sorts to the API", () => {
    const sort = (s: "priority" | "due" | "newest" | "oldest" | "updated") => {
      const { sort_by, sort_dir } = buildListParams("mine", { ...EMPTY_FILTERS, sort: s }, "", ctx);
      return `${sort_by}:${sort_dir}`;
    };
    expect(sort("priority")).toBe("priority:desc");
    expect(sort("due")).toBe("due_at:asc");
    expect(sort("newest")).toBe("created_at:desc");
    expect(sort("oldest")).toBe("created_at:asc");
    expect(sort("updated")).toBe("updated_at:desc");
  });

  it("computes due-today and due-this-week in the hotel's time zone, not the phone's", () => {
    const today = buildListParams("mine", { ...EMPTY_FILTERS, date: "today" }, "", ctx);
    expect(today.due_from).toBe("2026-10-15T05:00:00.000Z"); // midnight CDT
    expect(today.due_to).toBe("2026-10-16T05:00:00.000Z");
    const week = buildListParams("mine", { ...EMPTY_FILTERS, date: "week" }, "", ctx);
    expect(week.due_from).toBe("2026-10-15T05:00:00.000Z");
    expect(week.due_to).toBe("2026-10-22T05:00:00.000Z");
  });

  it("supports overdue, recently created and (for Done) recently updated", () => {
    expect(buildListParams("mine", { ...EMPTY_FILTERS, date: "overdue" }, "", ctx).overdue).toBe(true);
    expect(buildListParams("mine", { ...EMPTY_FILTERS, date: "recent" }, "", ctx).created_after).toBe("2026-10-14T15:00:00.000Z");
    expect(buildListParams("done", { ...EMPTY_FILTERS, date: "updated7" }, "", ctx).updated_after).toBe("2026-10-08T15:00:00.000Z");
    // A date filter that does not apply to the view is ignored rather than sent.
    expect(buildListParams("done", { ...EMPTY_FILTERS, date: "overdue" }, "", ctx).overdue).toBeUndefined();
  });

  it("narrows Waiting by assignment, but never exposes others' work to an engineer", () => {
    expect(buildListParams("waiting", { ...EMPTY_FILTERS, assignment: "mine" }, "", ctx).mine).toBe(true);
    expect(buildListParams("waiting", { ...EMPTY_FILTERS, assignment: "unassigned" }, "", ctx).unassigned).toBe(true);
    expect(buildListParams("waiting", { ...EMPTY_FILTERS, assignment: "others" }, "", ctx).assigned_to_others).toBeUndefined();
    expect(buildListParams("waiting", { ...EMPTY_FILTERS, assignment: "others" }, "", { ...ctx, role: "chief_engineer" }).assigned_to_others).toBe(true);
  });

  it("clearing every filter returns to the plain view request", () => {
    const filtered = buildListParams("mine", { ...EMPTY_FILTERS, priority: "urgent", category: "hvac" }, "x", ctx);
    const cleared = buildListParams("mine", EMPTY_FILTERS, "", ctx);
    expect(filtered).not.toEqual(cleared);
    expect(cleared.priority).toBeUndefined();
    expect(cleared.category).toBeUndefined();
    expect(cleared.q).toBeUndefined();
  });
});

describe("queueKey and filter counts", () => {
  it("is stable for the same request and different when anything changes", () => {
    const a = { statuses: ["open", "escalated"] as const, mine: true, q: "312" };
    const b = { q: "312", mine: true, statuses: ["escalated", "open"] as const };
    expect(queueKey("mine", a as never)).toBe(queueKey("mine", b as never));
    expect(queueKey("mine", a as never)).not.toBe(queueKey("available", a as never));
    expect(queueKey("mine", a as never)).not.toBe(queueKey("mine", { ...a, q: "313" } as never));
  });

  it("counts active filters, ignoring defaults", () => {
    expect(activeFilterCount("mine", EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount("done", { ...EMPTY_FILTERS, statuses: ["completed"] })).toBe(0);
    expect(activeFilterCount("done", { ...EMPTY_FILTERS, statuses: ["cancelled"] })).toBe(1);
    expect(activeFilterCount("mine", { ...EMPTY_FILTERS, priority: "urgent", floor: 2, sort: "due" })).toBe(3);
    expect(activeFilterCount("mine", { ...EMPTY_FILTERS, sort: "priority" })).toBe(0);
  });
});

describe("helpers", () => {
  it("dedupes by id keeping the first row", () => {
    expect(dedupeById([{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "a", v: 3 }])).toEqual([{ id: "a", v: 1 }, { id: "b", v: 2 }]);
  });

  it("finds the start of a hotel day across a DST change", () => {
    expect(startOfHotelDay("2026-10-15", "America/Chicago").toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(startOfHotelDay("2026-11-02", "America/Chicago").toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("formats the WO label only from a real number", () => {
    expect(workOrderLabel({ work_order_number: "1042" })).toBe("WO-1042");
    expect(workOrderLabel({ work_order_number: "WO-7" })).toBe("WO-7");
    expect(workOrderLabel({ work_order_number: null })).toBeNull();
  });

  it("sends Home's Urgent card to my urgent work first, else the unclaimed urgent queue", () => {
    const mine = wo({ priority: "emergency", assigned_to: ME, status: "in_progress" });
    const open = wo({ priority: "urgent" });
    expect(urgentLandingView([open, mine], ME)).toBe("mine");
    expect(urgentLandingView([open], ME)).toBe("available");
    expect(urgentLandingView([], ME)).toBe("mine");
  });
});
