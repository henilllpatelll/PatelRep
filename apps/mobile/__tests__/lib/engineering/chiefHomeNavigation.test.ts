import {
  TEAM_OVERVIEW_ROUTE,
  chiefQuickActionKeys,
  chiefQuickActionRoute,
  chiefSummaryRoute,
  quickActionKeys,
  usesChiefHome,
} from "@/lib/engineering/homeNavigation";
import { EMPTY_FILTERS, buildListParams } from "@/lib/engineering/workQueue";
import { managerSummarySelection } from "@/lib/engineering/managerSummary";
import { parsePmNavigation } from "@/lib/engineering/pmViews";
import { resolveWorkLink } from "@/lib/engineering/workNavigation";

/* A count opens a screen that holds exactly what was counted. The three Home cards must land on the same queues, with the
   same filters, as the Work screen's own manager tiles (which the server counts are defined to match). */

describe("who gets the management Home", () => {
  it("is the chief engineer only: engineers keep the technician Home and a GM has its own", () => {
    expect(usesChiefHome("chief_engineer")).toBe(true);
    for (const role of ["engineer", "gm", "housekeeper", null, undefined]) expect(usesChiefHome(role)).toBe(false);
  });
});

describe("chief summary routes", () => {
  const link = (key: Parameters<typeof chiefSummaryRoute>[0]) => {
    const route = chiefSummaryRoute(key, "t1");
    return resolveWorkLink(route.params.view, route.params.filter, "chief_engineer");
  };

  it("Needs owner opens Available Work and Waiting opens the on-hold queue, with no extra filtering", () => {
    expect(chiefSummaryRoute("needsOwner", "t1")).toEqual({ pathname: "/(app)/work-orders", params: { view: "available", nav: "t1" } });
    expect(chiefSummaryRoute("waiting", "t1")).toEqual({ pathname: "/(app)/work-orders", params: { view: "waiting", nav: "t1" } });
    expect(link("needsOwner")).toEqual({ view: "available", filters: null });
    expect(link("waiting")).toEqual({ view: "waiting", filters: null });
  });

  it("In progress opens Team narrowed to in-progress, the same selection the Work tile makes", () => {
    expect(chiefSummaryRoute("inProgress", "t1").params).toEqual({ view: "team", filter: "in_progress", nav: "t1" });
    const resolved = link("inProgress");
    expect(resolved?.view).toBe("team");
    expect(resolved?.filters).toEqual(managerSummarySelection("inProgress", EMPTY_FILTERS).filters);
    const params = buildListParams("team", resolved!.filters!, "", { role: "chief_engineer" });
    expect(params.statuses).toEqual(["in_progress"]);
    expect(params.assigned_to_others).toBe(true);
  });

  it("each card's list asks the server for the same orders its count describes", () => {
    const available = buildListParams("available", EMPTY_FILTERS, "", { role: "chief_engineer" });
    expect(available).toMatchObject({ unassigned: true, statuses: ["open", "escalated"] });
    const waiting = buildListParams("waiting", EMPTY_FILTERS, "", { role: "chief_engineer" });
    expect(waiting.statuses).toEqual(["on_hold"]);
  });

  it("omits the per-tap token when none is given, and a chief can reach every view a card opens", () => {
    expect(chiefSummaryRoute("waiting").params).toEqual({ view: "waiting" });
    for (const key of ["needsOwner", "inProgress", "waiting"] as const) expect(link(key)).not.toBeNull();
  });

  it("an engineer cannot be sent to Team by this link (the view is dropped, never rewritten)", () => {
    const route = chiefSummaryRoute("inProgress", "t1");
    expect(resolveWorkLink(route.params.view, route.params.filter, "engineer")).toBeNull();
  });

  it("an in-progress filter on any other view is ignored rather than applied to the wrong queue", () => {
    expect(resolveWorkLink("available", "in_progress", "chief_engineer")).toEqual({ view: "available", filters: null });
  });
});

describe("chief shortcuts", () => {
  it("are Assign Work, Team Overview, PM Planning and Assets, and none is a technician-only action", () => {
    expect(chiefQuickActionKeys()).toEqual(["assign", "team", "pm", "assets"]);
    expect(chiefQuickActionKeys()).not.toContain("available");
    expect(quickActionKeys("chief_engineer")).not.toContain("available");
  });

  it("open real destinations: unassigned work, the team, the PM Plan and the asset directory", () => {
    expect(chiefQuickActionRoute("assign", "t")).toEqual({ pathname: "/(app)/work-orders", params: { view: "available", nav: "t" } });
    expect(chiefQuickActionRoute("team")).toBe(TEAM_OVERVIEW_ROUTE);
    expect(chiefQuickActionRoute("assets")).toBe("/(app)/assets");
    const pm = chiefQuickActionRoute("pm") as { pathname: string; params: { view: string } };
    expect(pm.pathname).toBe("/(app)/pm-schedules");
    expect(parsePmNavigation(pm.params.view)).toEqual({ view: "plan", plan: "week" });
  });
});
