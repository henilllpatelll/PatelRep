import { getTabsForRole } from "@/lib/navigation/roleTabs";

describe("getTabsForRole", () => {
  it("uses the handoff housekeeper tab order with Copilot centered", () => {
    expect(getTabsForRole("housekeeper").map((tab) => tab.key)).toEqual([
      "home",
      "rooms",
      "copilot",
      "tasks",
      "me",
    ]);
    expect(getTabsForRole("housekeeper")[2]).toMatchObject({
      key: "copilot",
      special: true,
    });
  });

  it("maps inspection roles to the supervisor tab set", () => {
    expect(getTabsForRole("housekeeping_supervisor").map((tab) => tab.key)).toEqual([
      "home",
      "board",
      "assignments",
      "inspect",
      "copilot",
      "me",
    ]);
  });

  it("maps engineer roles to the engineering tab set", () => {
    expect(getTabsForRole("chief_engineer").map((tab) => tab.key)).toEqual([
      "home",
      "orders",
      "copilot",
      "assets",
      "pm",
      "me",
    ]);
  });
});
