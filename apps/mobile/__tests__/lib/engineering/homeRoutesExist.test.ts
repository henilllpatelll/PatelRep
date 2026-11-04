import fs from "fs";
import path from "path";
import {
  ENGINEERING_SYNC_ROUTE,
  REPORT_ISSUE_ROUTE,
  ROOM_STATUS_ROUTE,
  SCAN_ASSET_ROUTE,
  TEAM_OVERVIEW_ROUTE,
  WORK_ROUTE,
  chiefQuickActionKeys,
  chiefQuickActionRoute,
  chiefSummaryRoute,
  quickActionKeys,
  quickActionRoute,
  workOrderPath,
} from "@/lib/engineering/homeNavigation";
import { technicianRoute } from "@/lib/engineering/chiefHomeModel";
import { ASSETS_LIST_ROUTE, PM_LIST_ROUTE, assetRoute, pmInspectRoute, pmScheduleRoute, roomRoute, workOrderRoute } from "@/lib/engineering/routes";

/* Every destination an Engineering Home control can produce must be a real screen. A link to a route file that does not
   exist would silently bounce the person (expo-router) instead of failing a build, so this walks the app directory. */

const APP_DIR = path.resolve(__dirname, "../../../app");

function pathnameOf(route: unknown): string {
  const raw = typeof route === "string" ? route : (route as { pathname: string }).pathname;
  return raw.split("?")[0];
}

function screenExists(pathname: string): boolean {
  const segments = pathname.replace(/^\//, "").split("/");
  let dir = APP_DIR;
  for (let i = 0; i < segments.length; i++) {
    const last = i === segments.length - 1;
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
    const seg = segments[i];
    const isParam = /^\[.+\]$/.test(seg);
    // A concrete id (e.g. /work-orders/abc) matches a dynamic [param] entry; a literal segment must match by name.
    const dirEntry = entries.find((e) => e.isDirectory() && (e.name === seg || (!isParam && /^\[.+\]$/.test(e.name) && !entries.some((x) => x.name === seg && x.isDirectory()))));
    if (last) {
      const file = entries.find((e) => e.isFile() && (e.name === `${seg}.tsx` || (/^\[.+\]\.tsx$/.test(e.name) && !entries.some((x) => x.isFile() && x.name === `${seg}.tsx`) && !entries.some((x) => x.isDirectory() && x.name === seg))));
      if (file) return true;
      if (dirEntry) return fs.existsSync(path.join(dir, dirEntry.name, "index.tsx"));
      return false;
    }
    if (!dirEntry) return false;
    dir = path.join(dir, dirEntry.name);
  }
  return false;
}

describe("Engineering Home destinations are real screens", () => {
  const destinations: Record<string, unknown> = {
    work: WORK_ROUTE,
    report: REPORT_ISSUE_ROUTE,
    rooms: ROOM_STATUS_ROUTE,
    scan: SCAN_ASSET_ROUTE,
    sync: ENGINEERING_SYNC_ROUTE,
    team: TEAM_OVERVIEW_ROUTE,
    pm: PM_LIST_ROUTE,
    assets: ASSETS_LIST_ROUTE,
    notifications: "/(app)/notifications",
    profile: "/(app)/profile",
    workOrderPath: workOrderPath("wo1"),
    workOrderRoute: workOrderRoute("wo1"),
    pmSchedule: pmScheduleRoute("pm1"),
    pmInspect: pmInspectRoute("pm1"),
    asset: assetRoute("a1"),
    room: roomRoute("r1"),
    technician: technicianRoute("u1"),
    ...Object.fromEntries(quickActionKeys("engineer").map((k) => [`tech-${k}`, quickActionRoute(k, "t")])),
    ...Object.fromEntries(quickActionKeys("chief_engineer").map((k) => [`chiefTech-${k}`, quickActionRoute(k, "t")])),
    ...Object.fromEntries(chiefQuickActionKeys().map((k) => [`chief-${k}`, chiefQuickActionRoute(k, "t")])),
    ...Object.fromEntries((["needsOwner", "inProgress", "waiting"] as const).map((k) => [`summary-${k}`, chiefSummaryRoute(k, "t")])),
  };

  it.each(Object.entries(destinations))("%s resolves to a screen file", (_name, route) => {
    expect(route).toBeTruthy();
    expect(screenExists(pathnameOf(route))).toBe(true);
  });

  it("the checker rejects a route that has no screen", () => {
    expect(screenExists("/(app)/work-orders/nope/missing")).toBe(false);
    expect(screenExists("/(app)/not-a-screen")).toBe(false);
  });
});
