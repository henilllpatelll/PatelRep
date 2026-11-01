import {
  EMPTY_REPORT_DRAFT,
  REPORT_CATEGORIES,
  REPORT_PRIORITIES,
  buildReportPayload,
  isDefinitiveRefusal,
  isQueueable,
  isReportDirty,
  isReportValid,
  pushRecentLocation,
  setPriority,
  validateReport,
  withAsset,
  type ReportAsset,
  type ReportDraft,
} from "@/lib/engineering/reportIssue";
import { EMPTY_AVAILABILITY_DRAFT, type AvailabilityReason } from "@/lib/engineering/roomAvailability";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const reasons: AvailabilityReason[] = [{ id: "1", code: "PLUMBING", label: "Plumbing" }];
const ctx = { requestId: REQUEST_ID, userId: "eng-1", reasons };
const room312 = { kind: "room", roomId: "r312", roomNumber: "312", floor: 3 } as const;
const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({ ...EMPTY_REPORT_DRAFT, location: room312, title: "Sink leaking", ...over });
const ptac: ReportAsset = { id: "a1", name: "PTAC Unit", categoryCode: "HVAC", roomId: "r312", roomNumber: "312", locationText: "Bedroom" };

describe("the values the form offers are the ones the API accepts", () => {
  it("lists exactly the API's work order categories and priorities", () => {
    expect([...REPORT_CATEGORIES].sort()).toEqual(["appliance", "doors_locks", "electrical", "furniture", "general", "hvac", "painting", "plumbing", "safety", "structural"]);
    expect([...REPORT_PRIORITIES]).toEqual(["emergency", "urgent", "normal", "low"]);
  });

  it("starts as a routine, normal-priority report with the safe 'general' category", () => {
    expect(EMPTY_REPORT_DRAFT).toMatchObject({ category: "general", priority: "normal", source: "self", roomDown: null, assignToMe: false });
  });
});

describe("validateReport", () => {
  it("accepts a quick room-based report with only a location and a title", () => {
    expect(validateReport(draft())).toEqual({ errors: [], roomDown: [] });
  });

  it("accepts a non-room location typed as text", () => {
    expect(isReportValid(validateReport(draft({ location: { kind: "other", text: "Pool deck" } })))).toBe(true);
  });

  it("requires a location and a title", () => {
    expect(validateReport(draft({ location: null, title: "  " })).errors).toEqual(["location_required", "title_required"]);
    expect(validateReport(draft({ location: { kind: "other", text: "   " } })).errors).toContain("location_required");
  });

  it("enforces the API's length limits", () => {
    expect(validateReport(draft({ title: "x".repeat(121) })).errors).toContain("title_too_long");
    expect(validateReport(draft({ description: "x".repeat(2001) })).errors).toContain("description_too_long");
    expect(validateReport(draft({ location: { kind: "other", text: "x".repeat(256) } })).errors).toContain("location_too_long");
  });

  it("makes emergency a deliberate, confirmed choice", () => {
    expect(validateReport(draft({ priority: "emergency" })).errors).toEqual(["emergency_unconfirmed"]);
    expect(validateReport(draft({ priority: "emergency", emergencyConfirmed: true })).errors).toEqual([]);
    expect(setPriority(draft({ priority: "emergency", emergencyConfirmed: true }), "urgent").emergencyConfirmed).toBe(false);
  });

  it("refuses an equipment/room combination that no longer matches rather than silently filing it wrong", () => {
    expect(validateReport(draft({ asset: ptac, location: { kind: "room", roomId: "r999", roomNumber: "999" } })).errors).toEqual(["asset_room_mismatch"]);
    expect(validateReport(draft({ asset: ptac, location: { kind: "other", text: "Lobby" } })).errors).toEqual(["asset_room_mismatch"]);
    expect(validateReport(draft({ asset: ptac })).errors).toEqual([]);
  });

  it("does not require a guest room for equipment that has none", () => {
    const rooftop: ReportAsset = { id: "a2", name: "Rooftop unit", locationText: "Roof" };
    expect(validateReport(draft({ asset: rooftop, location: { kind: "other", text: "Roof" } })).errors).toEqual([]);
  });

  it("needs equipment before an equipment impact, and a guest room before a room-down request", () => {
    expect(validateReport(draft({ assetImpact: "degraded" })).errors).toEqual(["impact_needs_asset"]);
    expect(validateReport(draft({ location: { kind: "other", text: "Lobby" }, roomDown: { ...EMPTY_AVAILABILITY_DRAFT } })).errors).toContain("room_down_needs_room");
  });

  it("validates the room-down fields only when the person chose to take the room down", () => {
    expect(validateReport(draft()).roomDown).toEqual([]);
    expect(validateReport(draft({ roomDown: { ...EMPTY_AVAILABILITY_DRAFT } })).roomDown).toEqual(["type_required", "reason_required", "return_required"]);
  });
});

describe("withAsset", () => {
  it("fills the room and the matching trade from the equipment without overwriting a chosen category", () => {
    const next = withAsset(EMPTY_REPORT_DRAFT, ptac);
    expect(next).toMatchObject({ category: "hvac", location: { kind: "room", roomId: "r312", roomNumber: "312" }, asset: { id: "a1" } });
    expect(withAsset({ ...EMPTY_REPORT_DRAFT, category: "electrical" }, ptac).category).toBe("electrical");
  });

  it("keeps category 'general' when the equipment's trade is not one of the API's categories", () => {
    expect(withAsset(EMPTY_REPORT_DRAFT, { ...ptac, categoryCode: "ELEV", roomId: null, roomNumber: null }).category).toBe("general");
  });

  it("uses the equipment's location text only when nothing was chosen, and resets its impact when removed", () => {
    const rooftop: ReportAsset = { id: "a2", name: "Rooftop unit", locationText: "Roof" };
    expect(withAsset(EMPTY_REPORT_DRAFT, rooftop).location).toEqual({ kind: "other", text: "Roof" });
    expect(withAsset({ ...EMPTY_REPORT_DRAFT, location: { kind: "other", text: "Pool" } }, rooftop).location).toEqual({ kind: "other", text: "Pool" });
    expect(withAsset({ ...EMPTY_REPORT_DRAFT, asset: ptac, assetImpact: "degraded" }, null)).toMatchObject({ asset: null, assetImpact: "operating" });
  });
});

describe("buildReportPayload", () => {
  it("builds the canonical room-based request with the request key and nothing the person did not choose", () => {
    expect(buildReportPayload(draft({ description: " Dripping ", category: "plumbing", priority: "urgent" }), ctx)).toEqual({
      client_request_id: REQUEST_ID,
      title: "Sink leaking",
      description: "Dripping",
      category: "plumbing",
      priority: "urgent",
      source: "self",
      room_id: "r312",
    });
  });

  it("sends free-text location for a non-room place and no room id", () => {
    const payload = buildReportPayload(draft({ location: { kind: "other", text: " Pool deck " } }), ctx);
    expect(payload).toMatchObject({ location_text: "Pool deck" });
    expect(payload).not.toHaveProperty("room_id");
  });

  it("links the equipment by its canonical id and carries its impact only when it is not 'operating'", () => {
    expect(buildReportPayload(draft({ asset: ptac, category: "hvac" }), ctx)).toMatchObject({ asset_id: "a1", room_id: "r312", category: "hvac" });
    expect(buildReportPayload(draft({ asset: ptac }), ctx)).not.toHaveProperty("asset_impact");
    expect(buildReportPayload(draft({ asset: ptac, assetImpact: "out_of_service" }), ctx)).toMatchObject({ asset_impact: "out_of_service" });
  });

  it("assigns only to the signed-in person, and only when they asked", () => {
    expect(buildReportPayload(draft({ assignToMe: true }), ctx)).toMatchObject({ assigned_to: "eng-1" });
    expect(buildReportPayload(draft(), ctx)).not.toHaveProperty("assigned_to");
    expect(buildReportPayload(draft({ assignToMe: true }), { ...ctx, userId: null })).not.toHaveProperty("assigned_to");
  });

  it("links a repeat failure by the earlier work order's id", () => {
    expect(buildReportPayload(draft({ repeatOf: { id: "wo-5", label: "WO-5 · Leak" } }), ctx)).toMatchObject({ repeat_of_work_order_id: "wo-5" });
  });

  it("an emergency report does NOT take the room down by itself", () => {
    const payload = buildReportPayload(draft({ priority: "emergency", emergencyConfirmed: true }), ctx);
    expect(payload).toMatchObject({ priority: "emergency" });
    expect(payload).not.toHaveProperty("room_unavailability");
    expect(payload).not.toHaveProperty("mark_room_out_of_order");
  });

  it("includes a room-down request only when chosen, with the hotel's reason label and the mobile source", () => {
    const returnAt = new Date(Date.now() + 5 * 3_600_000);
    const payload = buildReportPayload(draft({ roomDown: { type: "OUT_OF_SERVICE", reasonCode: "PLUMBING", details: "", returnAt, workOrderId: null } }), ctx);
    expect(payload?.room_unavailability).toEqual({
      room_id: "r312",
      type: "OUT_OF_SERVICE",
      reason_code: "PLUMBING",
      reason_label: "Plumbing",
      expected_return_at: returnAt.toISOString(),
      source: "MOBILE",
    });
  });

  it("builds nothing for an invalid draft or a room-down reason the hotel does not have", () => {
    expect(buildReportPayload(draft({ title: "" }), ctx)).toBeNull();
    const returnAt = new Date(Date.now() + 5 * 3_600_000);
    expect(buildReportPayload(draft({ roomDown: { type: "OUT_OF_ORDER", reasonCode: "NOPE", details: "", returnAt, workOrderId: null } }), ctx)).toBeNull();
  });
});

describe("queueing and refusals", () => {
  it("never saves a room-down request for later", () => {
    expect(isQueueable(draft())).toBe(true);
    expect(isQueueable(draft({ roomDown: { ...EMPTY_AVAILABILITY_DRAFT } }))).toBe(false);
  });

  it("treats a 4xx as a final answer for the request id but a timeout, 5xx, 408 and 429 as 'try again with the same id'", () => {
    for (const status of [400, 403, 404, 409, 422]) expect(isDefinitiveRefusal(status)).toBe(true);
    for (const status of [408, 429, 500, 502, 503, null, undefined]) expect(isDefinitiveRefusal(status as number | null)).toBe(false);
  });
});

describe("drafts and recent places", () => {
  it("does not count an entry point's own prefill as unsaved work", () => {
    const prefill = withAsset({ ...EMPTY_REPORT_DRAFT }, ptac);
    expect(isReportDirty(prefill, [], prefill)).toBe(false);
    expect(isReportDirty({ ...prefill, title: "No cooling" }, [], prefill)).toBe(true);
    expect(isReportDirty(prefill, [{ id: "p", uri: "file:///a.jpg", caption: "" }], prefill)).toBe(true);
    expect(isReportDirty(EMPTY_REPORT_DRAFT, [], EMPTY_REPORT_DRAFT)).toBe(false);
  });

  it("keeps the five most recent distinct places, newest first", () => {
    let recent = pushRecentLocation([], { kind: "room", roomId: "a", roomNumber: "101" });
    recent = pushRecentLocation(recent, { kind: "other", text: "Lobby" });
    recent = pushRecentLocation(recent, { kind: "room", roomId: "a", roomNumber: "101" });
    expect(recent).toHaveLength(2);
    expect(recent[0]).toMatchObject({ roomId: "a" });
    for (let i = 0; i < 8; i += 1) recent = pushRecentLocation(recent, { kind: "other", text: `Place ${i}` });
    expect(recent).toHaveLength(5);
    expect(pushRecentLocation(recent, { kind: "other", text: "place 7" })).toHaveLength(5);
  });
});
