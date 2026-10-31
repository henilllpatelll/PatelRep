import { HIDDEN_APP_ROUTES, getTabsForRole } from "@/lib/navigation/roleTabs";
import type { UserRole } from "@/lib/supabase";

const ENGINEER_KEYS = ["home", "orders", "rooms", "assets", "me"];
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

  it("maps engineer to Orders, Rooms, Assets, and Profile", () => {
    expect(getTabsForRole("engineer").map((tab) => tab.key)).toEqual(ENGINEER_KEYS);
    expect(getTabsForRole("engineer").map((tab) => tab.titleKey)).toEqual([
      "tabs.home",
      "tabs.orders",
      "tabs.rooms",
      "tabs.assets",
      "tabs.profile",
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
    // The PM screen is reached from Home, not a tab.
    expect(hidden.has("pm-schedules/index")).toBe(true);
    expect(hidden.has("work-orders/[woId]")).toBe(true);
  });
});
