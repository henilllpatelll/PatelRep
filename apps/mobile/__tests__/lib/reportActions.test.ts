import { getReportActions, type ReportActionContext } from "@/lib/housekeeping/reportActions";

const base: ReportActionContext = {
  role: "housekeeper",
  isOnline: true,
  room: { status: "DIRTY" },
  hasLiveSession: false,
  linenApplicable: false,
  linenLocked: false,
  pendingCount: 0,
};

const ids = (ctx: Partial<ReportActionContext>) => getReportActions({ ...base, ...ctx }).map((action) => action.id);
const reason = (ctx: Partial<ReportActionContext>, id: string) => getReportActions({ ...base, ...ctx }).find((action) => action.id === id)?.disabledReason;

describe("getReportActions", () => {
  it("gives a housekeeper the full set of reporting actions", () => {
    expect(ids({})).toEqual(["exception", "issue", "supplies", "found", "note", "info"]);
  });

  it("hides what the API would refuse for the role", () => {
    expect(ids({ role: "engineer" })).toEqual(["issue", "supplies", "note", "info"]);
    expect(ids({ role: "front_desk" })).toEqual(["issue", "supplies", "found", "note", "info"]);
    expect(ids({ role: null })).toEqual(["issue", "note", "info"]);
  });

  it("only Linen Exchange when linen applies, and says when it is locked", () => {
    expect(ids({})).not.toContain("linen");
    expect(reason({ linenApplicable: true }, "linen")).toBeNull();
    expect(reason({ linenApplicable: true, linenLocked: true }, "linen")).toBe("linenLocked");
  });

  it("offline: connection-bound rows say so; work orders keep their offline queue", () => {
    expect(reason({ isOnline: false }, "exception")).toBe("needsConnection");
    expect(reason({ isOnline: false }, "supplies")).toBe("needsConnection");
    expect(reason({ isOnline: false }, "found")).toBe("needsConnection");
    expect(reason({ isOnline: false }, "note")).toBe("needsConnection");
    expect(reason({ isOnline: false }, "issue")).toBeNull();
    expect(reason({ isOnline: false }, "info")).toBeNull();
  });

  it("a pre-entry exception is unavailable once the attendant is in the room", () => {
    expect(reason({ hasLiveSession: true }, "exception")).toBe("cleaningStarted");
  });

  it("there is nothing to report an access problem about on a finished or unavailable room", () => {
    for (const status of ["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"] as const) {
      expect(ids({ room: { status } })).not.toContain("exception");
    }
  });

  it("shows the sync row when changes are waiting or the device is offline", () => {
    expect(ids({})).not.toContain("sync");
    expect(ids({ pendingCount: 2 })).toContain("sync");
    expect(ids({ isOnline: false })).toContain("sync");
  });
});
