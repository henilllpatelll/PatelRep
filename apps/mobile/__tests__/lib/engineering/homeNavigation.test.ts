import {
  ASSET_SCAN_ROUTE,
  attentionRoute,
  focusRoute,
  continueLabelKey,
  myJobsRoute,
  quickActionKeys,
  quickActionRoute,
  showsMyJobs,
  urgentWorkRoute,
  workOrderPath,
  workViewRoute,
} from "@/lib/engineering/homeNavigation";
import { buildHomeModel } from "@/lib/engineering/homeModel";
import { adaptPmSchedules } from "@/lib/engineering/pmSchedules";
import { EMPTY_FILTERS, availableViews, belongsToView, buildListParams } from "@/lib/engineering/workQueue";
import {
  isReachableView,
  isSecondaryView,
  primaryViews,
  resolveView,
  resolveWorkLink,
  secondaryViews,
  showsSummary,
} from "@/lib/engineering/workNavigation";
import type { PmScheduleRow } from "@/lib/api/assets";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const NOW = new Date("2026-10-31T15:00:00Z");
const ME = "me";
const wo = (over: Partial<WorkOrder> & { id: string }): WorkOrder =>
  ({ title: over.id, status: "open", priority: "normal", assigned_to: null, created_at: "2026-10-31T10:00:00Z", ...over }) as WorkOrder;
const pm = (id: string): PmScheduleRow =>
  ({ id, asset_id: "a", name: id, interval_type: "monthly", is_active: true, next_due_at: "2026-10-20T15:00:00Z" }) as PmScheduleRow;

describe("Urgent count and destination agree", () => {
  const orders = [
    wo({ id: "mine-e", priority: "emergency", assigned_to: ME, status: "in_progress" }),
    wo({ id: "free-u", priority: "urgent" }),
    wo({ id: "held-u", priority: "urgent", status: "on_hold", assigned_to: ME }),
    wo({ id: "esc-u", priority: "urgent", status: "escalated" }),
    wo({ id: "other-e", priority: "emergency", assigned_to: "other", status: "in_progress" }),
    wo({ id: "normal", priority: "normal", assigned_to: ME }),
    wo({ id: "done-u", priority: "urgent", status: "completed" }),
  ];

  it("links to the all view narrowed to urgent, whoever owns the work", () => {
    expect(urgentWorkRoute()).toEqual({ pathname: "/(app)/work-orders", params: { view: "all", filter: "urgent" } });
  });

  it("carries a per-tap token so a repeat tap is not swallowed by the mounted Work tab", () => {
    expect(urgentWorkRoute("t1").params).toEqual({ view: "all", filter: "urgent", nav: "t1" });
    expect(workViewRoute("mine", "t2").params).toEqual({ view: "mine", nav: "t2" });
    expect(myJobsRoute("chief_engineer", "t3").params).toEqual({ view: "team", nav: "t3" });
  });

  it("the destination holds exactly the orders the Home card counted (engineer and chief)", () => {
    for (const role of ["engineer", "chief_engineer"]) {
      const counted = buildHomeModel(orders, [], ME, NOW).urgent;
      const link = resolveWorkLink("all", "urgent", role);
      expect(link).not.toBeNull();
      const request = buildListParams(link!.view, link!.filters!, "", { role, now: NOW });
      expect(request.priorities).toEqual(["emergency", "urgent"]);
      const shown = orders.filter(
        (o) =>
          request.statuses!.includes(o.status) &&
          request.priorities!.includes(o.priority as "emergency" | "urgent") &&
          belongsToView(o, link!.view, { userId: ME, role }),
      );
      expect(shown).toHaveLength(counted);
      expect(counted).toBe(5);
    }
  });

  it("never narrows to one owner", () => {
    const params = buildListParams("all", { ...EMPTY_FILTERS, urgentOnly: true }, "", { role: "chief_engineer", now: NOW });
    expect(params.mine).toBeUndefined();
    expect(params.unassigned).toBeUndefined();
    expect(params.assigned_to_others).toBeUndefined();
  });
});

describe("the All active view", () => {
  it("is a link-only secondary view: never a tab, never a shortcut, left with Back", () => {
    expect(isSecondaryView("all")).toBe(true);
    for (const role of ["engineer", "chief_engineer", "gm"]) {
      expect(primaryViews(role)).not.toContain("all");
      expect(secondaryViews(role)).not.toContain("all");
      expect(availableViews(role)).toContain("all");
      expect(isReachableView("all", role)).toBe(true);
      expect(resolveView("all", role)).toBe("all");
    }
    expect(showsSummary("all", "engineer")).toBe(false);
  });
});

describe("resolveWorkLink", () => {
  it("opens all narrowed to urgent for the Home Urgent link, for both engineering roles", () => {
    for (const role of ["engineer", "chief_engineer"]) {
      const link = resolveWorkLink("all", "urgent", role);
      expect(link?.view).toBe("all");
      expect(link?.filters?.urgentOnly).toBe(true);
    }
  });

  it("opens a plain view without touching the person's filters", () => {
    expect(resolveWorkLink("mine", undefined, "engineer")).toEqual({ view: "mine", filters: null });
    expect(resolveWorkLink(["waiting"], undefined, "chief_engineer")).toEqual({ view: "waiting", filters: null });
  });

  it("ignores a view this role cannot reach instead of redirecting to a different queue", () => {
    expect(resolveWorkLink("mine", undefined, "chief_engineer")).toBeNull();
    expect(resolveWorkLink("team", undefined, "engineer")).toBeNull();
    expect(resolveWorkLink("nonsense", "urgent", "engineer")).toBeNull();
    expect(resolveWorkLink(undefined, "urgent", "engineer")).toBeNull();
    expect(resolveWorkLink("../../admin", undefined, "engineer")).toBeNull();
  });

  it("drops an unknown filter but still opens the view", () => {
    expect(resolveWorkLink("all", "drop table", "engineer")).toEqual({ view: "all", filters: null });
    expect(resolveWorkLink("all", ["urgent", "x"], "engineer")?.filters?.urgentOnly).toBe(true);
  });
});

describe("role-specific destinations", () => {
  it("offers My Jobs only to a role that can hold an assignment", () => {
    expect(showsMyJobs("engineer")).toBe(true);
    expect(showsMyJobs("gm")).toBe(true);
    expect(showsMyJobs("chief_engineer")).toBe(false);
    expect(showsMyJobs(undefined)).toBe(false);
  });

  it("sends My Jobs to My Work for an engineer and to the role's own default view otherwise", () => {
    expect(myJobsRoute("engineer")).toEqual({ pathname: "/(app)/work-orders", params: { view: "mine", filter: "actionable" } });
    expect(myJobsRoute("chief_engineer")).toEqual(workViewRoute("team"));
  });

  it("never labels a chief engineer's job action as continuing a repair", () => {
    expect(continueLabelKey("engineer")).toBe("continueRepair");
    expect(continueLabelKey("chief_engineer")).toBe("viewOrder");
    expect(continueLabelKey(undefined)).toBe("viewOrder");
  });
});

describe("quick actions", () => {
  it("offers a technician Report, Scan, Room Status and Available Work, in that order", () => {
    expect(quickActionKeys("engineer")).toEqual(["report", "scan", "room", "available"]);
  });

  it("gives a chief engineer PM instead of the technician's Available Work queue", () => {
    expect(quickActionKeys("chief_engineer")).toEqual(["report", "scan", "room", "pm"]);
    expect(quickActionKeys(undefined)).toEqual(["report", "scan", "room", "pm"]);
  });

  it("opens the existing scanner (it owns manual entry and asset search), not the asset list", () => {
    expect(quickActionRoute("scan")).toBe("/(app)/assets/scan");
    expect(ASSET_SCAN_ROUTE).toBe("/(app)/assets/scan");
    expect(quickActionRoute("report")).toBe("/(app)/work-orders/new");
    expect(quickActionRoute("room")).toBe("/(app)/room-status");
    expect(quickActionRoute("pm")).toBe("/(app)/pm-schedules");
  });

  it("opens the existing unassigned queue for Available Work, with a per-tap token", () => {
    expect(quickActionRoute("available")).toEqual({ pathname: "/(app)/work-orders", params: { view: "available" } });
    expect(quickActionRoute("available", "t1")).toEqual({ pathname: "/(app)/work-orders", params: { view: "available", nav: "t1" } });
  });
});

describe("primary card and attention destinations", () => {
  const model = (orders: WorkOrder[], pmRows: PmScheduleRow[] = [], blockedSync = 0) =>
    buildHomeModel(orders, adaptPmSchedules(pmRows, "America/Chicago", NOW), ME, NOW, { canAct: true, blockedSync });

  it("continue and start-next both open that exact work order; neither mutates", () => {
    const cont = model([wo({ id: "w1", assigned_to: ME, status: "in_progress" })]);
    expect(focusRoute(cont.focus)).toBe("/(app)/work-orders/w1");
    const next = model([wo({ id: "w2", assigned_to: ME })]);
    expect(focusRoute(next.focus)).toBe("/(app)/work-orders/w2");
  });

  it("resume opens the existing inspection screen for that schedule", () => {
    const focus = { kind: "resume_pm", pm: { draft: { scheduleId: "pm1", label: null, answered: 1, total: 3, updatedAt: NOW.toISOString() }, schedule: null } } as const;
    expect(focusRoute(focus)).toBe("/(app)/pm-schedules/inspect/pm1");
  });

  it("available work and the all-clear states open the available queue; none opens nothing", () => {
    expect(focusRoute({ kind: "available_work", count: 2 }, "t")).toEqual({ pathname: "/(app)/work-orders", params: { view: "available", nav: "t" } });
    expect(focusRoute({ kind: "none" })).toBeNull();
  });

  it("routes each attention kind to its own exact destination", () => {
    const m = model([wo({ id: "e1", priority: "emergency" })], [pm("p1")], 2);
    const byKind = Object.fromEntries(m.attention.map((item) => [item.kind, attentionRoute(item)]));
    expect(byKind).toEqual({ wo: "/(app)/work-orders/e1", pm: "/(app)/pm-schedules/p1", sync: "/(app)/engineering-sync" });
  });

  it("ranks a blocked save right after emergencies, ahead of urgent unassigned, overdue and PM", () => {
    const m = model(
      [wo({ id: "u1", priority: "urgent" }), wo({ id: "e1", priority: "emergency" }), wo({ id: "late", due_at: "2026-10-30T10:00:00Z" })],
      [pm("p1")],
      1,
    );
    expect(m.attention.map((item) => item.key)).toEqual(["wo:e1", "sync:pm", "wo:u1", "wo:late", "pm:p1"]);
  });
});

describe("work-order links never leave the work-order route", () => {
  it("builds the exact detail path for a plain id", () => {
    expect(workOrderPath("wo-1_A")).toBe("/(app)/work-orders/wo-1_A");
  });

  it.each(["../team", "a/b", "x?y=1", "http://evil", "", " ", "a.b"])("falls back to the Work list for %p", (id) => {
    expect(workOrderPath(id)).toBe("/(app)/work-orders");
  });

  it("falls back for a missing id", () => {
    expect(workOrderPath(null)).toBe("/(app)/work-orders");
    expect(workOrderPath(undefined)).toBe("/(app)/work-orders");
  });

  it("the primary card and attention rows use the same guard", () => {
    const hostile = { kind: "continue_repair", wo: { id: "../x" }, moreActive: 0 } as never;
    expect(focusRoute(hostile)).toBe("/(app)/work-orders");
    expect(attentionRoute({ kind: "wo", key: "wo:../x", reason: "emergency", wo: { id: "../x" } } as never)).toBe("/(app)/work-orders");
  });
});
