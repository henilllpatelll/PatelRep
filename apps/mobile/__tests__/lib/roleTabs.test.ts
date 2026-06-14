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

  it("maps engineer to Orders, Rooms, Assets, and More", () => {
    expect(getTabsForRole("engineer").map((tab) => tab.key)).toEqual([
      "home",
      "orders",
      "rooms",
      "assets",
      "more",
    ]);
    expect(getTabsForRole("engineer").map((tab) => tab.titleKey)).toEqual([
      "tabs.home",
      "tabs.orders",
      "tabs.rooms",
      "tabs.assets",
      "tabs.more",
    ]);
  });

  it("keeps chief_engineer on the same tabs as engineer", () => {
    expect(getTabsForRole("chief_engineer").map((tab) => tab.key)).toEqual([
      "home",
      "orders",
      "rooms",
      "assets",
      "more",
    ]);
    expect(getTabsForRole("chief_engineer")).toEqual(getTabsForRole("engineer"));
  });
});
