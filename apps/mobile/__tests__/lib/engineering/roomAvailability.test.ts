import {
  EMPTY_AVAILABILITY_DRAFT,
  MAX_RETURN_DAYS,
  buildCreateBody,
  buildReleaseBody,
  canConfirmRelease,
  composeReturn,
  etaNeedsNote,
  interpretCreate,
  interpretRelease,
  needsOpenRepairAcknowledgement,
  releaseBlock,
  returnPresets,
  validateAvailability,
  validateEtaChange,
  type AvailabilityDraft,
  type AvailabilityReason,
  type ReleaseFacts,
} from "@/lib/engineering/roomAvailability";

const NOW = new Date("2026-10-31T15:00:00.000Z");
const reasons: AvailabilityReason[] = [
  { id: "1", code: "PLUMBING", label: "Plumbing" },
  { id: "2", code: "HVAC", label: "HVAC" },
];
const valid = (over: Partial<AvailabilityDraft> = {}): AvailabilityDraft => ({
  ...EMPTY_AVAILABILITY_DRAFT,
  type: "OUT_OF_ORDER",
  reasonCode: "PLUMBING",
  returnAt: new Date(NOW.getTime() + 4 * 3_600_000),
  ...over,
});

describe("validateAvailability", () => {
  it("accepts a complete out-of-order and out-of-service request", () => {
    expect(validateAvailability(valid(), NOW)).toEqual([]);
    expect(validateAvailability(valid({ type: "OUT_OF_SERVICE" }), NOW)).toEqual([]);
  });

  it("requires a type, a reason and a return time", () => {
    expect(validateAvailability(EMPTY_AVAILABILITY_DRAFT, NOW)).toEqual(["type_required", "reason_required", "return_required"]);
  });

  it("rejects a return time that is in the past, invalid, or absurdly far away", () => {
    expect(validateAvailability(valid({ returnAt: new Date(NOW.getTime() - 1000) }), NOW)).toEqual(["return_past"]);
    expect(validateAvailability(valid({ returnAt: new Date("nope") }), NOW)).toEqual(["return_required"]);
    expect(validateAvailability(valid({ returnAt: new Date(NOW.getTime() + (MAX_RETURN_DAYS + 1) * 86_400_000) }), NOW)).toEqual(["return_too_far"]);
  });

  it("limits the details length to what the API accepts", () => {
    expect(validateAvailability(valid({ details: "x".repeat(2001) }), NOW)).toEqual(["details_too_long"]);
  });
});

describe("buildCreateBody", () => {
  it("takes the reason label from the hotel's own list and records the mobile source", () => {
    const body = buildCreateBody("room-1", valid({ details: "  Leak under sink ", workOrderId: "wo-9" }), reasons);
    expect(body).toMatchObject({
      room_id: "room-1",
      type: "OUT_OF_ORDER",
      reason_code: "PLUMBING",
      reason_label: "Plumbing",
      details: "Leak under sink",
      primary_work_order_id: "wo-9",
      source: "MOBILE",
    });
    expect(body?.expected_return_at).toBe(valid().returnAt?.toISOString());
  });

  it("builds nothing for an unknown reason or an incomplete draft", () => {
    expect(buildCreateBody("room-1", valid({ reasonCode: "MADE_UP" }), reasons)).toBeNull();
    expect(buildCreateBody("room-1", EMPTY_AVAILABILITY_DRAFT, reasons)).toBeNull();
  });

  it("omits optional fields that were not filled", () => {
    const body = buildCreateBody("room-1", valid(), reasons);
    expect(body).not.toHaveProperty("details");
    expect(body).not.toHaveProperty("primary_work_order_id");
  });
});

describe("interpretCreate", () => {
  const body = { type: "OUT_OF_SERVICE" as const, reason_code: "HVAC", expected_return_at: "2026-10-31T19:00:00.000Z" };

  it("is confirmed only when the server's period is the one that was asked for", () => {
    const result = interpretCreate(body, { period: { id: "p1", type: "OUT_OF_SERVICE", reason_code: "HVAC", expected_return_at: "2026-10-31T19:00:00+00:00" }, room_status: { status: "OOO" } });
    expect(result).toMatchObject({ kind: "confirmed", roomStatus: "OOO" });
  });

  it("reports 'already active' when the room was already down with a different record: the request was not applied", () => {
    const result = interpretCreate(body, { period: { id: "p0", type: "OUT_OF_ORDER", reason_code: "PLUMBING", expected_return_at: "2026-11-02T09:00:00Z" }, room_status: { status: "OOO" } });
    expect(result?.kind).toBe("already_active");
  });

  it("treats a differing return time as a conflict even if type and reason match", () => {
    const result = interpretCreate(body, { period: { id: "p0", type: "OUT_OF_SERVICE", reason_code: "HVAC", expected_return_at: "2026-10-31T22:00:00Z" } });
    expect(result?.kind).toBe("already_active");
  });

  it("is not a success at all without a period in the answer", () => {
    expect(interpretCreate(body, null)).toBeNull();
    expect(interpretCreate(body, {})).toBeNull();
    expect(interpretCreate(body, { period: {} })).toBeNull();
  });
});

describe("expected return changes", () => {
  const current = new Date(NOW.getTime() + 2 * 3_600_000);

  it("needs a reason only when the return moves later", () => {
    expect(etaNeedsNote(current, new Date(current.getTime() + 60_000 * 90))).toBe(true);
    expect(etaNeedsNote(current, new Date(current.getTime() - 60_000 * 30))).toBe(false);
    expect(validateEtaChange(current, new Date(current.getTime() + 3_600_000), "", NOW)).toEqual(["note_required"]);
    expect(validateEtaChange(current, new Date(current.getTime() + 3_600_000), "Parts delayed", NOW)).toEqual([]);
    expect(validateEtaChange(current, new Date(current.getTime() - 30 * 60_000), "", NOW)).toEqual([]);
  });

  it("rejects no-ops, past times and a missing time", () => {
    expect(validateEtaChange(current, current, "", NOW)).toEqual(["unchanged"]);
    expect(validateEtaChange(current, new Date(NOW.getTime() - 1), "", NOW)).toContain("return_past");
    expect(validateEtaChange(current, null, "", NOW)).toEqual(["return_required"]);
  });
});

describe("return time choices", () => {
  it("only offers 'tonight' while 6 PM is still more than an hour away", () => {
    const morning = new Date(2026, 9, 31, 9, 0);
    const evening = new Date(2026, 9, 31, 17, 30);
    expect(returnPresets(morning).map((p) => p.key)).toContain("tonight");
    expect(returnPresets(evening).map((p) => p.key)).not.toContain("tonight");
  });

  it("only ever offers future times", () => {
    for (const preset of returnPresets(new Date(2026, 9, 31, 23, 50))) expect(preset.at.getTime()).toBeGreaterThan(new Date(2026, 9, 31, 23, 50).getTime());
  });

  it("composes a custom day and hour, clamped to a sensible range", () => {
    const base = new Date(2026, 9, 31, 10, 0);
    expect(composeReturn(base, 2, 14).getDate()).toBe(2);
    expect(composeReturn(base, 2, 14).getHours()).toBe(14);
    expect(composeReturn(base, -4, 99).getHours()).toBe(23);
    expect(composeReturn(base, 9999, 8).getTime() - base.getTime()).toBeLessThanOrEqual((MAX_RETURN_DAYS + 1) * 86_400_000);
  });
});

describe("returning a room to service", () => {
  const facts = (over: Partial<ReleaseFacts> = {}): ReleaseFacts => ({ primaryStatus: "completed", primaryHidden: false, otherActiveCount: 0, hiddenActiveCount: 0, ...over });

  it("is blocked while the repair the room was taken down for is still open", () => {
    for (const status of ["open", "escalated", "in_progress", "on_hold"] as const) {
      expect(releaseBlock(facts({ primaryStatus: status }))).toBe("primary_repair_open");
      expect(canConfirmRelease(facts({ primaryStatus: status }), { verified: true, acknowledgedOpenRepairs: true })).toBe(false);
    }
  });

  it("does not treat a completed repair as an automatic release: the person must still confirm they checked", () => {
    expect(releaseBlock(facts())).toBeNull();
    expect(canConfirmRelease(facts(), { verified: false, acknowledgedOpenRepairs: false })).toBe(false);
    expect(canConfirmRelease(facts(), { verified: true, acknowledgedOpenRepairs: false })).toBe(true);
  });

  it("allows a record with no linked repair, but still needs the confirmation", () => {
    expect(canConfirmRelease(facts({ primaryStatus: null }), { verified: false, acknowledgedOpenRepairs: false })).toBe(false);
    expect(canConfirmRelease(facts({ primaryStatus: null }), { verified: true, acknowledgedOpenRepairs: false })).toBe(true);
  });

  it("needs a second acknowledgement while other repairs, visible or held by colleagues, remain open", () => {
    for (const over of [{ otherActiveCount: 1 }, { hiddenActiveCount: 2 }, { primaryHidden: true }]) {
      expect(needsOpenRepairAcknowledgement(facts(over))).toBe(true);
      expect(canConfirmRelease(facts(over), { verified: true, acknowledgedOpenRepairs: false })).toBe(false);
      expect(canConfirmRelease(facts(over), { verified: true, acknowledgedOpenRepairs: true })).toBe(true);
    }
  });

  it("sends the mobile source and trims the notes", () => {
    expect(buildReleaseBody("  Replaced valve ")).toEqual({ release_notes: "Replaced valve", source: "MOBILE" });
    expect(buildReleaseBody("   ")).toEqual({ source: "MOBILE" });
  });

  it("reports a release only from a RELEASED period, and passes on the room status the server set (never assumes one)", () => {
    expect(interpretRelease({ period: { id: "p1", status: "RELEASED" } as never, room_status: { status: "DIRTY" } })).toEqual({ kind: "released", roomStatus: "DIRTY" });
    expect(interpretRelease({ period: { id: "p1", status: "ACTIVE" } as never })).toBeNull();
    expect(interpretRelease(null)).toBeNull();
    expect(interpretRelease({ period: { id: "p1", status: "RELEASED" } as never })).toEqual({ kind: "released", roomStatus: null });
  });
});
