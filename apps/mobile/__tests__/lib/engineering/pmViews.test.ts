import { parsePmNavigation } from "@/lib/engineering/pmViews";

describe("parsePmNavigation", () => {
  it("defaults to Today", () => {
    expect(parsePmNavigation(undefined)).toEqual({ view: "today", plan: "week" });
    expect(parsePmNavigation("nonsense")).toEqual({ view: "today", plan: "week" });
  });

  it("keeps older Week and Calendar links working inside Plan", () => {
    expect(parsePmNavigation("week")).toEqual({ view: "plan", plan: "week" });
    expect(parsePmNavigation("calendar")).toEqual({ view: "plan", plan: "calendar" });
    expect(parsePmNavigation(["calendar", "x"])).toEqual({ view: "plan", plan: "calendar" });
  });

  it("opens Plan and History directly", () => {
    expect(parsePmNavigation("plan").view).toBe("plan");
    expect(parsePmNavigation("history").view).toBe("history");
  });
});
