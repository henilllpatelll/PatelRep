import fs from "fs";
import path from "path";
import { ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";
import {
  HOUSEKEEPER_ONLY_PATH_PREFIXES,
  SUPERVISOR_ROUTES,
  isSupervisorSafePath,
  supervisorHref,
  type SupervisorScreen,
} from "@/lib/navigation/supervisorRoutes";

const APP_DIR = path.resolve(__dirname, "../../app/(app)");
const screens = Object.keys(SUPERVISOR_ROUTES) as SupervisorScreen[];

describe("supervisor route contract", () => {
  it.each(screens)("%s resolves to a real screen file", (screen) => {
    expect(fs.existsSync(path.join(APP_DIR, SUPERVISOR_ROUTES[screen].screenFile))).toBe(true);
  });

  it.each(screens)("%s is a registered tab or hidden route in the (app) layout", (screen) => {
    const route = SUPERVISOR_ROUTES[screen];
    const name = route.screenFile.replace(/\.tsx$/, "");
    expect(route.pathname).toBe(`/(app)/${name.replace(/\/index$/, "")}`);
    expect([...ALL_ROLE_TAB_ROUTES, ...HIDDEN_APP_ROUTES]).toContain(name);
  });

  it("never targets a housekeeper-only screen", () => {
    for (const route of Object.values(SUPERVISOR_ROUTES)) {
      expect(HOUSEKEEPER_ONLY_PATH_PREFIXES.some((prefix) => route.pathname.startsWith(prefix))).toBe(false);
    }
  });

  it("rejects housekeeper-only and unregistered paths", () => {
    expect(isSupervisorSafePath("/(app)/my-rooms")).toBe(false);
    expect(isSupervisorSafePath("/(app)/my-rooms/r-1")).toBe(false);
    expect(isSupervisorSafePath("/(app)/attention")).toBe(false);
    expect(isSupervisorSafePath("/(app)/not-a-screen")).toBe(false);
    expect(isSupervisorSafePath("/(app)/room-board")).toBe(true);
  });

  it("only the Room Board and Assignments resolve a record from route params; every other target opens its parent screen", () => {
    for (const screen of screens) expect(SUPERVISOR_ROUTES[screen].recordDeepLink).toBe(screen === "rooms" || screen === "team");
    expect(supervisorHref({ screen: "rooms", record: { type: "room", id: "r-1" } })).toEqual({
      pathname: "/(app)/room-board",
      params: { roomId: "r-1" },
    });
    expect(supervisorHref({ screen: "rooms" })).toEqual({ pathname: "/(app)/room-board" });
    expect(supervisorHref({ screen: "rooms", record: { type: "room", id: "  " } })).toEqual({ pathname: "/(app)/room-board" });
    expect(supervisorHref({ screen: "tasks", record: { type: "task", id: "t-1" } })).toEqual({ pathname: "/(app)/tasks" });
    expect(supervisorHref({ screen: "team", record: { type: "staff", id: "s-1" } })).toEqual({ pathname: "/(app)/assignments", params: { staffId: "s-1" } });
    expect(supervisorHref({ screen: "team", record: { type: "staff", id: "bad id!" } })).toEqual({ pathname: "/(app)/assignments" });
  });

  it("the supervisor Attention Center is its own route, separate from the housekeeper one", () => {
    expect(SUPERVISOR_ROUTES.attention.pathname).toBe("/(app)/supervisor-attention");
    expect(isSupervisorSafePath("/(app)/supervisor-attention")).toBe(true);
    expect(isSupervisorSafePath("/(app)/attention")).toBe(false);
  });

  it("maps the Team workflow to the Assignments screen and Inspect to the inspection queue", () => {
    expect(supervisorHref({ screen: "team" }).pathname).toBe("/(app)/assignments");
    expect(supervisorHref({ screen: "inspect" }).pathname).toBe("/(app)/inspect");
  });
});

describe("existing navigation is unchanged", () => {
  it("keeps the supervisor bottom tabs exactly as they were", () => {
    expect(getTabsForRole("housekeeping_supervisor").map((tab) => tab.name)).toEqual([
      "home/index",
      "room-board/index",
      "assignments/index",
      "inspect/index",
      "profile/index",
    ]);
  });

  it("keeps every other role's tabs exactly as they were", () => {
    expect(getTabsForRole("housekeeper").map((tab) => tab.name)).toEqual(["home/index", "my-rooms/index", "tasks/index", "profile/index"]);
    expect(getTabsForRole("inspector").map((tab) => tab.name)).toEqual(["home/index", "inspect/index", "tasks/index", "profile/index"]);
    expect(getTabsForRole("engineer").map((tab) => tab.name)).toEqual([
      "home/index",
      "work-orders/index",
      "room-status/index",
      "assets/index",
      "profile/index",
    ]);
    expect(getTabsForRole("front_desk").map((tab) => tab.name)).toEqual([
      "home/index",
      "guest-requests/index",
      "room-status/index",
      "logbook/index",
      "lost-found/index",
      "profile/index",
    ]);
    expect(getTabsForRole("gm").map((tab) => tab.name)).toEqual(["home/index", "alerts/index", "staff/index", "profile/index"]);
  });
});
