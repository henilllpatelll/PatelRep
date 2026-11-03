jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));

import {
  classifyManagementFailure,
  coverageHealth,
  deferralInstant,
  earliestDeferralDate,
  failureLeftNothingChanged,
  formatRate,
  sortWorkload,
  validateDeferral,
} from "@/lib/engineering/pmManagement";
import { programParams } from "@/lib/api/pmManagement";
import type { PmWorkloadCard } from "@/lib/api/pmManagement";
import { canManagePmSchedules, canRequestPmDeferral, canReviewPmDeferral, canRetireAssets } from "@/lib/engineering/roles";

const err = (status: number, code?: string, message = "x") => Object.assign(new Error(message), { status, code });
const TZ = "America/Chicago";

describe("classifyManagementFailure", () => {
  it("names the refusals the server gives, by code", () => {
    expect(classifyManagementFailure(err(409, "version_conflict")).kind).toBe("version_conflict");
    expect(classifyManagementFailure(err(409, "asset_conflict")).kind).toBe("version_conflict");
    expect(classifyManagementFailure(err(409, "schedule_inactive")).kind).toBe("schedule_inactive");
    expect(classifyManagementFailure(err(422, "assignee_ineligible")).kind).toBe("assignee_ineligible");
    expect(classifyManagementFailure(err(403, "self_review")).kind).toBe("self_review");
    expect(classifyManagementFailure(err(409, "already_decided")).kind).toBe("already_decided");
    expect(classifyManagementFailure(err(409, "stale")).kind).toBe("stale");
    expect(classifyManagementFailure(err(409, "expired")).kind).toBe("expired");
    expect(classifyManagementFailure(err(503, "deferral_unavailable")).kind).toBe("unavailable");
  });

  it("a self-review 403 is NOT reported as a role problem", () => {
    expect(classifyManagementFailure(err(403, "self_review")).kind).toBe("self_review");
    expect(classifyManagementFailure(err(403)).kind).toBe("forbidden");
    expect(classifyManagementFailure(err(401)).kind).toBe("forbidden");
  });

  it("recognises a duplicate pending request and generic statuses", () => {
    expect(classifyManagementFailure(err(409, undefined, "This schedule already has a deferral request awaiting review")).kind).toBe("pending_exists");
    expect(classifyManagementFailure(err(404)).kind).toBe("not_found");
    expect(classifyManagementFailure(err(422, undefined, "bad")).kind).toBe("validation");
    expect(classifyManagementFailure(err(500)).kind).toBe("failed");
  });

  it("treats a missing answer as unconfirmed, never as a refusal", () => {
    const offline = classifyManagementFailure(new Error("Network request failed"));
    expect(offline.kind).toBe("unconfirmed");
    expect(failureLeftNothingChanged(offline)).toBe(false);
    expect(failureLeftNothingChanged(classifyManagementFailure(new Error("boom")))).toBe(false);
    expect(failureLeftNothingChanged(classifyManagementFailure(err(409, "version_conflict")))).toBe(true);
  });
});

describe("deferral request rules", () => {
  const now = new Date("2026-11-02T15:00:00Z"); // Monday 9am in Chicago
  const due = "2026-11-04T18:00:00Z";

  it("accepts a later date with a reason", () => {
    expect(validateDeferral({ reason: "Compressor part on order", requestedDate: "2026-11-10" }, due, TZ, now)).toEqual([]);
  });

  it("refuses short reasons, missing dates, today or earlier, and not-later-than-due", () => {
    expect(validateDeferral({ reason: "no", requestedDate: "2026-11-10" }, due, TZ, now)).toContain("reason_short");
    expect(validateDeferral({ reason: "valid reason", requestedDate: "" }, due, TZ, now)).toEqual(["date_missing"]);
    expect(validateDeferral({ reason: "valid reason", requestedDate: "2026-11-02" }, due, TZ, now)).toContain("date_past");
    expect(validateDeferral({ reason: "valid reason", requestedDate: "2026-11-04" }, due, TZ, now)).toContain("date_not_later");
    expect(validateDeferral({ reason: "x".repeat(501), requestedDate: "2026-11-10" }, due, TZ, now)).toContain("reason_long");
  });

  it("offers the day after the later of today and the due date as the earliest choice", () => {
    expect(earliestDeferralDate(due, TZ, now)).toBe("2026-11-05");
    expect(earliestDeferralDate("2026-10-01T00:00:00Z", TZ, now)).toBe("2026-11-03"); // overdue: tomorrow
    expect(earliestDeferralDate(null, TZ, now)).toBe("2026-11-03");
  });

  it("turns the chosen calendar date into noon in the hotel, across a DST change", () => {
    expect(deferralInstant("2026-11-10", TZ)).toBe("2026-11-10T18:00:00.000Z"); // CST, UTC-6
    expect(deferralInstant("2026-07-10", TZ)).toBe("2026-07-10T17:00:00.000Z"); // CDT, UTC-5
    expect(deferralInstant("nope", TZ)).toBeNull();
  });
});

describe("numbers shown to a manager", () => {
  it("never shows 0% for no data", () => {
    expect(formatRate(null)).toBeNull();
    expect(formatRate(undefined)).toBeNull();
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(2 / 3)).toBe("67%");
    expect(formatRate(1)).toBe("100%");
  });

  it("an unknown summary is not a healthy one", () => {
    expect(coverageHealth(null)).toBe("unknown");
    expect(coverageHealth({ overdue: 0, unassigned: 0, pending_approvals: 0 })).toBe("ok");
    expect(coverageHealth({ overdue: 0, unassigned: 0, pending_approvals: 1 })).toBe("attention");
  });

  it("orders workload by overdue, then assigned, then name, keeping ineligible assignees visible", () => {
    const card = (id: string, name: string, overdue: number, assigned: number, ineligible?: boolean): PmWorkloadCard => ({
      id, name, role: "engineer", overdue, assigned, due_today: 0, completed: 0, next_due_at: null, ineligible,
    });
    const sorted = sortWorkload([card("b", "Bo", 0, 2), card("a", "Ana", 0, 2), card("c", "Cy", 3, 1), card("g", "Gone", 0, 5, true)]);
    expect(sorted.map((c) => c.id)).toEqual(["c", "g", "a", "b"]);
  });
});

describe("program query", () => {
  it("sends only what was asked for, always with a page window", () => {
    expect(programParams({})).toBe("limit=25&offset=0");
    const q = new URLSearchParams(programParams({ q: " chiller ", overdueOnly: true, assigneeId: "u1", sort: "name", status: "all", offset: 25, limit: 10 }));
    expect(Object.fromEntries(q)).toEqual({ q: "chiller", overdue_only: "true", assignee_id: "u1", sort: "name", status: "all", limit: "10", offset: "25" });
  });
});

describe("management role gates mirror the server", () => {
  it("only the chief engineer and GM manage; an engineer never reviews", () => {
    expect(canManagePmSchedules("chief_engineer")).toBe(true);
    expect(canManagePmSchedules("gm")).toBe(true);
    expect(canManagePmSchedules("engineer")).toBe(false);
    expect(canRequestPmDeferral("engineer")).toBe(false);
    expect(canRetireAssets("engineer")).toBe(false);
  });

  it("a reviewer is never the requester", () => {
    expect(canReviewPmDeferral("chief_engineer", "u-chief", "u-chief")).toBe(false);
    expect(canReviewPmDeferral("gm", "u-chief", "u-gm")).toBe(true);
    expect(canReviewPmDeferral("engineer", "u-chief", "u-eng")).toBe(false);
    expect(canReviewPmDeferral("gm", null, "u-gm")).toBe(false);
  });
});
