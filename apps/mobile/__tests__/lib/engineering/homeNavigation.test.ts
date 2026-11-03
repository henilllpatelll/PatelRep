import {
  ASSET_SCAN_ROUTE,
  FIND_ASSET_ROUTE,
  attentionOverflowLinks,
  continueLabelKey,
  myJobsRoute,
  quickActionKeys,
  quickActionRoute,
  showsMyJobs,
  urgentWorkRoute,
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
    expect(myJobsRoute("engineer")).toEqual(workViewRoute("mine"));
    expect(myJobsRoute("chief_engineer")).toEqual(workViewRoute("team"));
  });

  it("never labels a chief engineer's job action as continuing a repair", () => {
    expect(continueLabelKey("engineer")).toBe("continueRepair");
    expect(continueLabelKey("chief_engineer")).toBe("viewOrder");
    expect(continueLabelKey(undefined)).toBe("viewOrder");
  });
});

describe("quick actions", () => {
  it("opens the existing scanner, not the asset list, and keeps the list as the manual fallback", () => {
    expect(quickActionKeys()).toEqual(["report", "room", "scan", "pm"]);
    expect(quickActionRoute("scan")).toBe("/(app)/assets/scan");
    expect(ASSET_SCAN_ROUTE).toBe("/(app)/assets/scan");
    expect(FIND_ASSET_ROUTE).toBe("/(app)/assets");
    expect(quickActionRoute("report")).toBe("/(app)/work-orders/new");
    expect(quickActionRoute("room")).toBe("/(app)/room-status");
    expect(quickActionRoute("pm")).toBe("/(app)/pm-schedules");
  });
});

describe("attention overflow", () => {
  const items = (rows: { wo: WorkOrder[]; pm: PmScheduleRow[] }) =>
    buildHomeModel(rows.wo, adaptPmSchedules(rows.pm, "America/Chicago", NOW), ME, NOW).attention;

  it("reaches every kind of hidden item: work orders and PM each get their own link and count", () => {
    const attention = items({
      wo: [wo({ id: "e1", priority: "emergency" }), wo({ id: "e2", priority: "emergency" })],
      pm: [pm("p1"), pm("p2"), pm("p3")],
    });
    expect(attentionOverflowLinks(attention)).toEqual([
      { kind: "wo", count: 2, route: workViewRoute("all") },
      { kind: "pm", count: 3, route: "/(app)/pm-schedules" },
    ]);
  });

  it("offers a link only for a kind that was actually cut", () => {
    const onlyPm = items({ wo: [], pm: [pm("p1")] });
    expect(attentionOverflowLinks(onlyPm)).toEqual([{ kind: "pm", count: 1, route: "/(app)/pm-schedules" }]);
    expect(attentionOverflowLinks([])).toEqual([]);
  });
});
