import { ALL_ROLE_TAB_ROUTES, HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";
import type { UserRole } from "@/lib/supabase";

const ENGINEER_KEYS = ["home", "work", "pm", "assets", "more"];
const ALL_ROLES: UserRole[] = [
  "housekeeper",
  "inspector",
  "engineer",
  "chief_engineer",
  "housekeeping_supervisor",
  "front_desk",
  "gm",
];

describe("getTabsForRole", () => {
  it("uses the handoff housekeeper tab order", () => {
    expect(getTabsForRole("housekeeper").map((tab) => tab.key)).toEqual([
      "home",
      "rooms",
      "tasks",
      "me",
    ]);
  });

  it("maps inspection roles to the supervisor tab set", () => {
    expect(getTabsForRole("housekeeping_supervisor").map((tab) => tab.key)).toEqual([
      "home",
      "board",
      "assignments",
      "inspect",
      "me",
    ]);
  });

  it("maps engineer to Home, Work, PM, Assets, and More", () => {
    expect(getTabsForRole("engineer").map((tab) => tab.key)).toEqual(ENGINEER_KEYS);
    expect(getTabsForRole("engineer").map((tab) => tab.titleKey)).toEqual([
      "tabs.home",
      "tabs.work",
      "tabs.pm",
      "tabs.assets",
      "tabs.more",
    ]);
    expect(getTabsForRole("engineer").map((tab) => tab.name)).toEqual([
      "home/index",
      "work-orders/index",
      "pm-schedules/index",
      "assets/index",
      "more/index",
    ]);
  });

  it("gives chief_engineer the engineering tabs, never the housekeeping ones", () => {
    expect(getTabsForRole("chief_engineer").map((tab) => tab.key)).toEqual(ENGINEER_KEYS);
    expect(getTabsForRole("chief_engineer")).toEqual(getTabsForRole("engineer"));
    expect(getTabsForRole("chief_engineer")).not.toEqual(getTabsForRole("housekeeper"));
  });

  it("keeps every other role's tabs unchanged", () => {
    expect(getTabsForRole("inspector").map((tab) => tab.key)).toEqual(["home", "inspect", "tasks", "me"]);
    expect(getTabsForRole("front_desk").map((tab) => tab.key)).toEqual(["home", "requests", "room-status", "logbook", "lost", "me"]);
    expect(getTabsForRole("gm").map((tab) => tab.key)).toEqual(["home", "alerts", "staff", "me"]);
  });

  it("only the housekeeping-floor roles get the housekeeper tabs", () => {
    const housekeeperTabs = getTabsForRole("housekeeper");
    const sharing = ALL_ROLES.filter((role) => getTabsForRole(role) === housekeeperTabs);
    expect(sharing).toEqual(["housekeeper"]);
  });

  it("every engineering tab route is a real tab or a registered hidden route", () => {
    const hidden = new Set(HIDDEN_APP_ROUTES);
    for (const tab of getTabsForRole("chief_engineer")) expect(hidden.has(tab.name)).toBe(false);
    // PM is a real tab now: declaring it hidden as well would register the same screen twice.
    expect(hidden.has("pm-schedules/index")).toBe(false);
    expect(hidden.has("work-orders/[woId]")).toBe(true);
  });

  it("keeps Rooms and Profile reachable for engineers even though they are no longer tabs", () => {
    const tabNames = new Set(getTabsForRole("engineer").map((tab) => tab.name));
    expect(tabNames.has("room-status/index")).toBe(false);
    expect(tabNames.has("profile/index")).toBe(false);
    // Still registered (hidden from the bar) because other roles list them as tabs, so router.push resolves.
    expect(ALL_ROLE_TAB_ROUTES).toEqual(expect.arrayContaining(["room-status/index", "profile/index", "more/index"]));
  });

  it("no route is both a visible tab for some role and a hidden app route", () => {
    const hidden = new Set(HIDDEN_APP_ROUTES);
    for (const name of ALL_ROLE_TAB_ROUTES) expect(hidden.has(name)).toBe(false);
  });
});
