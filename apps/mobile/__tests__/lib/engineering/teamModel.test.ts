import { canManageTeam, classifyAssignError, filterTechnicians, isAssignable, isRetryable, needsRefreshAfter, summaryTiles, teamScope } from "@/lib/engineering/teamModel";
import type { Technician } from "@/lib/api/engineeringTeam";

const err = (status: number, message = "x") => Object.assign(new Error(message), { status });
const tech = (id: string, name: string | null): Technician => ({ user_id: id, name, active: 0, urgent: 0, on_hold: 0, overdue: 0 });

describe("team model", () => {
  it("only chief engineers and GMs are offered management", () => {
    expect(canManageTeam("chief_engineer")).toBe(true);
    expect(canManageTeam("gm")).toBe(true);
    for (const role of ["engineer", "housekeeper", "housekeeping_supervisor", "front_desk", null, undefined]) expect(canManageTeam(role)).toBe(false);
  });

  it("closed orders are not assignable", () => {
    expect(isAssignable({ status: "open" })).toBe(true);
    expect(isAssignable({ status: "on_hold" })).toBe(true);
    expect(isAssignable({ status: "completed" })).toBe(false);
    expect(isAssignable({ status: "cancelled" })).toBe(false);
  });

  it("maps the API answers to actionable failures", () => {
    expect(classifyAssignError(err(409, "This work order was assigned by someone else."))).toBe("conflict");
    expect(classifyAssignError(err(409, "This work order is closed and can no longer be assigned"))).toBe("closed");
    expect(classifyAssignError(err(403))).toBe("not_allowed");
    expect(classifyAssignError(err(404))).toBe("not_found");
    expect(classifyAssignError(err(422))).toBe("invalid");
    expect(classifyAssignError(new Error("Network request failed"))).toBe("offline");
    expect(classifyAssignError(err(500))).toBe("failed");
    expect(needsRefreshAfter("conflict")).toBe(true);
    expect(needsRefreshAfter("failed")).toBe(false);
    expect(isRetryable("failed")).toBe(true);
    expect(isRetryable("conflict")).toBe(true);
    expect(isRetryable("not_allowed")).toBe(false);
    expect(isRetryable("closed")).toBe(false);
  });

  it("shows optional tiles only when non-zero or unknown, and never turns unknown into zero", () => {
    const { primary, secondary } = summaryTiles({ open: 4, overdue: 1, on_hold: 0, emergency: 0, unassigned: 2, pm_overdue: null });
    expect(primary.map((t) => t.key)).toEqual(["open", "overdue", "on_hold"]);
    expect(primary[1].alert).toBe(true);
    expect(secondary.map((t) => [t.key, t.value])).toEqual([["unassigned", 2], ["pm_overdue", null]]);
  });

  it("filters technicians by name and keeps server order otherwise", () => {
    const list = [tech("a", "Alex M."), tech("b", "Bea Chen"), tech("c", null)];
    expect(filterTechnicians(list, "").map((t) => t.user_id)).toEqual(["a", "b", "c"]);
    expect(filterTechnicians(list, " bea ").map((t) => t.user_id)).toEqual(["b"]);
  });

  it("scopes team reads to hotel + person", () => {
    expect(teamScope({ id: "u1", tenant_id: "h1" })).toBe("h1:u1:team");
    expect(teamScope({ id: "u1" })).toBeNull();
    expect(teamScope(null)).toBeNull();
  });
});
