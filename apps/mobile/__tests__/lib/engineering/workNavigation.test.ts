import {
  SECONDARY_VIEWS,
  defaultView,
  isReachableView,
  isSecondaryView,
  primaryViews,
  resolveView,
  secondaryViews,
  showsSummary,
} from "@/lib/engineering/workNavigation";

describe("primary and secondary views", () => {
  it("gives an engineer My Work and Available as tabs, with On hold and History as shortcuts", () => {
    expect(primaryViews("engineer")).toEqual(["mine", "available"]);
    expect(secondaryViews("engineer")).toEqual(["waiting", "done"]);
    expect(defaultView("engineer")).toBe("mine");
  });

  it("gives a chief engineer Team first, then Available, and no My Work", () => {
    expect(primaryViews("chief_engineer")).toEqual(["team", "available"]);
    expect(secondaryViews("chief_engineer")).toEqual(["waiting", "done"]);
    expect(defaultView("chief_engineer")).toBe("team");
  });

  it("gives a GM all three tabs, My Work first", () => {
    expect(primaryViews("gm")).toEqual(["mine", "available", "team"]);
    expect(defaultView("gm")).toBe("mine");
  });

  it("never offers Team to a role the API will not let read everyone's work", () => {
    for (const role of ["engineer", "housekeeper", "front_desk", undefined, null]) {
      expect(primaryViews(role)).not.toContain("team");
    }
  });

  it("falls back to Available for a role that can neither hold work nor manage a team", () => {
    expect(primaryViews("front_desk")).toEqual(["available"]);
    expect(defaultView("front_desk")).toBe("available");
    expect(defaultView(undefined)).toBe("available");
  });

  it("keeps On hold and History out of the tabs for every role", () => {
    for (const role of ["engineer", "chief_engineer", "gm", "front_desk"]) {
      expect(primaryViews(role).some(isSecondaryView)).toBe(false);
      expect(secondaryViews(role)).toEqual([...SECONDARY_VIEWS]);
    }
  });
});

describe("resolveView (deep links)", () => {
  it("honours every view the role can reach, including the secondary ones", () => {
    expect(resolveView("waiting", "engineer")).toBe("waiting");
    expect(resolveView("done", "chief_engineer")).toBe("done");
    expect(resolveView("team", "gm")).toBe("team");
    expect(resolveView("available", "engineer")).toBe("available");
  });

  it("sends a view the role cannot reach to that role's default", () => {
    expect(resolveView("team", "engineer")).toBe("mine");
    expect(resolveView("mine", "chief_engineer")).toBe("team");
  });

  it("treats junk as no request", () => {
    for (const junk of [undefined, null, "", "bogus", 3, ["mine"]]) {
      expect(resolveView(junk, "engineer")).toBe("mine");
      expect(isReachableView(junk, "engineer")).toBe(false);
    }
  });
});

describe("showsSummary", () => {
  it("shows the tiles only on My Work, and only where My Work exists", () => {
    expect(showsSummary("mine", "engineer")).toBe(true);
    expect(showsSummary("mine", "gm")).toBe(true);
    expect(showsSummary("mine", "chief_engineer")).toBe(false);
    expect(showsSummary("available", "engineer")).toBe(false);
    expect(showsSummary("waiting", "engineer")).toBe(false);
  });
});
