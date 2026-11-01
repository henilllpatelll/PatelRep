import { getEngineeringMoreSections } from "@/lib/engineering/moreMenu";

const items = (role: string) => getEngineeringMoreSections(role).flatMap((s) => s.items);

describe("getEngineeringMoreSections", () => {
  it("keeps Rooms, Notifications, Profile, Settings and Sign out reachable", () => {
    const targets = items("engineer").map((i) => i.href ?? i.action);
    expect(targets).toEqual(
      expect.arrayContaining(["/(app)/room-status", "/(app)/notifications", "/(app)/profile/personal", "/(app)/profile", "signOut"]),
    );
  });

  it("offers nothing to non-engineering roles", () => {
    for (const role of ["housekeeper", "housekeeping_supervisor", "front_desk", "gm", null, undefined]) {
      expect(getEngineeringMoreSections(role)).toEqual([]);
    }
  });

  it("shows the Management section (Team Overview) to the chief engineer only", () => {
    expect(getEngineeringMoreSections("engineer").map((s) => s.key)).toEqual(["operations", "account"]);
    const chief = getEngineeringMoreSections("chief_engineer");
    expect(chief.map((s) => s.key)).toEqual(["operations", "account", "management"]);
    expect(chief[2].items.map((i) => i.href)).toEqual(["/(app)/team"]);
  });

  it("offers Sync Status to every engineering role", () => {
    for (const role of ["engineer", "chief_engineer"]) expect(items(role).some((i) => i.href === "/(app)/engineering-sync")).toBe(true);
  });

  it("every row is a real route or the sign-out action, never a placeholder", () => {
    for (const item of items("chief_engineer")) expect(Boolean(item.href) !== Boolean(item.action)).toBe(true);
  });
});
