import fs from "fs";
import path from "path";
import {
  UNASSIGNED_CHECKLIST,
  adaptChecklistBinding,
  assetAdministrativeStatus,
  checklistNeedsAttention,
  deriveAssetFacets,
} from "@/lib/engineering/engineeringContracts";
import { completionFingerprint, resolveSubmission } from "@/lib/engineering/pmSubmission";
import { adaptPmSchedule } from "@/lib/engineering/pmSchedules";
import {
  ASSETS_LIST_ROUTE,
  PM_LIST_ROUTE,
  assetRoute,
  isSafeRouteId,
  pmInspectRoute,
  pmRecordRoute,
  pmScheduleRoute,
  roomRoute,
  workOrderRoute,
} from "@/lib/engineering/routes";
import { canManageAssets, canManagePmSchedules, canRequestPmDeferral, canReviewPmDeferral } from "@/lib/engineering/roles";

const UUID = "3f1f4c1e-0a3c-4c63-9f43-9a5e3a0a7c11";

describe("route builders", () => {
  it("builds the exact destination from a server id", () => {
    expect(assetRoute(UUID)).toEqual({ pathname: "/(app)/assets/[assetId]", params: { assetId: UUID } });
    expect(workOrderRoute(UUID)).toEqual({ pathname: "/(app)/work-orders/[woId]", params: { woId: UUID } });
    expect(roomRoute(UUID)).toEqual({ pathname: "/(app)/room-status/[roomId]", params: { roomId: UUID } });
    expect(pmScheduleRoute(UUID)).toBe(`/(app)/pm-schedules/${UUID}`);
    expect(pmInspectRoute(UUID)).toBe(`/(app)/pm-schedules/inspect/${UUID}`);
    expect(pmRecordRoute("c-1", UUID)).toBe(`/(app)/pm-schedules/record/c-1?scheduleId=${UUID}`);
  });

  it.each(["", "../admin", "a/b", "a?x=1", "a#b", "a b", "http://evil.test", "javascript:alert(1)", "a".repeat(65), "%2e%2e"])(
    "refuses an id that could change where the link goes: %p",
    (hostile) => {
      expect(isSafeRouteId(hostile)).toBe(false);
      for (const build of [assetRoute, workOrderRoute, roomRoute, pmScheduleRoute, pmInspectRoute]) expect(build(hostile)).toBeNull();
      expect(pmRecordRoute(hostile, UUID)).toBeNull();
      expect(pmRecordRoute(UUID, hostile)).toBeNull();
    },
  );

  it("yields nothing for a missing id so the caller can fall back to the list", () => {
    expect(assetRoute(null)).toBeNull();
    expect(assetRoute(undefined)).toBeNull();
    expect(ASSETS_LIST_ROUTE).toBe("/(app)/assets");
    expect(PM_LIST_ROUTE).toBe("/(app)/pm-schedules");
  });
});

describe("permission helpers", () => {
  it("only the chief engineer and GM manage schedules; a line engineer executes but does not move due dates", () => {
    expect(canManagePmSchedules("chief_engineer")).toBe(true);
    expect(canManagePmSchedules("gm")).toBe(true);
    expect(canManagePmSchedules("engineer")).toBe(false);
    expect(canManagePmSchedules("housekeeper")).toBe(false);
    expect(canManagePmSchedules(null)).toBe(false);
    expect(canRequestPmDeferral("chief_engineer")).toBe(true);
    expect(canRequestPmDeferral("engineer")).toBe(false);
  });

  it("a reviewer is never offered their own request", () => {
    expect(canReviewPmDeferral("gm", "chief-1", "gm-1")).toBe(true);
    expect(canReviewPmDeferral("chief_engineer", "chief-1", "chief-1")).toBe(false);
    expect(canReviewPmDeferral("engineer", "chief-1", "eng-1")).toBe(false);
    expect(canReviewPmDeferral("gm", null, "gm-1")).toBe(false);
    expect(canReviewPmDeferral("gm", "chief-1", null)).toBe(false);
  });

  it("equipment records can be managed by engineers, the chief engineer and GM", () => {
    for (const role of ["engineer", "chief_engineer", "gm"]) expect(canManageAssets(role)).toBe(true);
    for (const role of ["housekeeper", "front_desk", "housekeeping_supervisor", undefined]) expect(canManageAssets(role)).toBe(false);
  });
});

describe("mobile permission helpers match the API constants", () => {
  const roles = fs.readFileSync(path.resolve(__dirname, "../../../../api/core/roles.py"), "utf8");
  const constant = (name: string): string[] => {
    const match = new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, "m").exec(roles);
    expect(match).not.toBeNull();
    return match![1].split(",").map((r) => r.trim().replace(/"/g, "")).filter(Boolean).sort();
  };
  const accepted = (check: (role: string) => boolean) => ["gm", "chief_engineer", "engineer", "housekeeper", "front_desk", "housekeeping_supervisor"].filter(check).sort();

  it("schedule management, deferral request/review and asset management", () => {
    expect(accepted(canManagePmSchedules)).toEqual(constant("PM_SCHEDULE_MANAGER_ROLES"));
    expect(accepted(canRequestPmDeferral)).toEqual(constant("PM_DEFERRAL_REQUEST_ROLES"));
    expect(accepted((r) => canReviewPmDeferral(r, "someone-else", "me"))).toEqual(constant("PM_DEFERRAL_REVIEWER_ROLES"));
    expect(accepted(canManageAssets)).toEqual(constant("ASSET_MANAGER_ROLES"));
  });
});

describe("checklist binding", () => {
  it("reads an absent or unrecognised binding as unassigned, never ready", () => {
    expect(adaptChecklistBinding(undefined)).toEqual(UNASSIGNED_CHECKLIST);
    expect(adaptChecklistBinding(null)).toEqual(UNASSIGNED_CHECKLIST);
    expect(adaptChecklistBinding({ state: "mystery" })).toEqual(UNASSIGNED_CHECKLIST);
  });

  it("adapts a server binding and flags the states that block an inspection", () => {
    const ready = adaptChecklistBinding({ state: "ready", template_id: "t1", template_code: "chiller", template_name: "Chiller", template_version: 2 });
    expect(ready).toMatchObject({ state: "ready", templateId: "t1", templateCode: "chiller", templateVersion: 2, replacementTemplateId: null });
    expect(checklistNeedsAttention(ready)).toBe(false);
    expect(checklistNeedsAttention(UNASSIGNED_CHECKLIST)).toBe(false);
    for (const state of ["missing", "inactive", "incompatible"]) {
      expect(checklistNeedsAttention(adaptChecklistBinding({ state, template_code: "chiller" }))).toBe(true);
    }
    expect(adaptChecklistBinding({ state: "inactive", replacement_template_id: "t2" }).replacementTemplateId).toBe("t2");
  });

  it("travels from the schedule row to the view", () => {
    const now = new Date("2026-11-04T16:00:00Z");
    const row = { id: "s1", asset_id: "a1", name: "PM", interval_type: "monthly" as const, next_due_at: "2026-11-05T18:00:00Z" };
    expect(adaptPmSchedule(row, "America/Chicago", now)?.checklist).toEqual(UNASSIGNED_CHECKLIST);
    const bound = adaptPmSchedule({ ...row, checklist: { state: "ready", template_id: "t1" } }, "America/Chicago", now);
    expect(bound?.checklist).toMatchObject({ state: "ready", templateId: "t1" });
  });
});

describe("equipment status facets stay separate and honest about what is unknown", () => {
  it("administrative status comes from the record, not from how healthy it looks", () => {
    expect(assetAdministrativeStatus({ is_active: false })).toBe("inactive");
    expect(assetAdministrativeStatus({ is_active: true })).toBe("active");
    expect(assetAdministrativeStatus({ administrative_status: "inactive", is_active: true })).toBe("inactive");
    expect(assetAdministrativeStatus({})).toBeNull();
  });

  it("an asset with no meter data, no downtime field and no risk score is unknown, not fine", () => {
    expect(deriveAssetFacets({})).toEqual({ administrative: null, condition: null, inDowntimeNow: null, hadDowntime365d: null, predictiveRisk: null });
  });

  it("keeps confirmed downtime, meter condition and predicted risk apart", () => {
    const facets = deriveAssetFacets({ is_active: true, condition_status: "warning", active_downtime: null, had_downtime_365d: true, failure_risk_score: 82 });
    expect(facets).toEqual({ administrative: "active", condition: "warning", inDowntimeNow: false, hadDowntime365d: true, predictiveRisk: "high" });
    expect(deriveAssetFacets({ active_downtime: { id: "d1" } }).inDowntimeNow).toBe(true);
    expect(deriveAssetFacets({ condition_status: "nonsense" }).condition).toBeNull();
  });
});

describe("completion submission identity", () => {
  const base = { items: [{ label: "Belt", result: "passed" as const }], notes: "ok" };
  let n = 0;
  const fresh = () => `id-${++n}`;

  it("reuses the id while the content is unchanged, even if keys are ordered differently", () => {
    const first = resolveSubmission(null, base, fresh);
    const again = resolveSubmission(first, { notes: "ok", items: [{ result: "passed" as const, label: "Belt" }] }, fresh);
    expect(again).toBe(first);
  });

  it("starts a new attempt once the content changes, because the server refuses one id for two inspections", () => {
    const first = resolveSubmission(null, base, fresh);
    const edited = resolveSubmission(first, { ...base, notes: "belt frayed" }, fresh);
    expect(edited.id).not.toBe(first.id);
    expect(edited.fingerprint).not.toBe(first.fingerprint);
  });

  it("ignores undefined fields and the id itself", () => {
    expect(completionFingerprint({ ...base, labor_minutes: undefined })).toBe(completionFingerprint(base));
  });

  it("generates a real unique id by default", () => {
    const a = resolveSubmission(null, base);
    const b = resolveSubmission(null, base);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
  });
});
