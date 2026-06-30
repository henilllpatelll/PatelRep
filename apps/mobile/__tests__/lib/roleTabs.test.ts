import { getTabsForRole } from "@/lib/navigation/roleTabs";

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
    expect(getTabsForRole("engineer").map((tab) => tab.key)).toEqual([
      "home",
      "orders",
      "rooms",
      "assets",
      "me",
    ]);
    expect(getTabsForRole("engineer").map((tab) => tab.titleKey)).toEqual([
      "tabs.home",
      "tabs.orders",
      "tabs.rooms",
      "tabs.assets",
      "tabs.profile",
    ]);
  });

  it("keeps engineer on the same tabs as engineer", () => {
    expect(getTabsForRole("engineer").map((tab) => tab.key)).toEqual([
      "home",
      "orders",
      "rooms",
      "assets",
      "me",
    ]);
    expect(getTabsForRole("engineer")).toEqual(getTabsForRole("engineer"));
  });
});
