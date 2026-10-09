import { EMPTY_EXCEPTION_DRAFT, EXCEPTION_NOTE_MAX, isExceptionDirty, planException, type ExceptionDraft } from "@/lib/housekeeping/serviceException";

const ZONE = "America/Chicago";
// 10:00 AM Chicago on 2026-10-08 (CDT, UTC-5).
const NOW = new Date("2026-10-08T15:00:00.000Z");
const draft = (patch: Partial<ExceptionDraft>): ExceptionDraft => ({ ...EMPTY_EXCEPTION_DRAFT, ...patch });

describe("planException", () => {
  it("needs a reason", () => {
    expect(planException(draft({}), ZONE, NOW)).toEqual({ ok: false, error: { field: "reason", code: "required" } });
  });

  it("Do Not Disturb is a dnd_no_response attempt (the server owns the count)", () => {
    expect(planException(draft({ reason: "dnd" }), ZONE, NOW)).toEqual({
      ok: true,
      plan: { kind: "attempt", result: "dnd_no_response", note: undefined },
    });
  });

  it("passes an optional note through", () => {
    const planned = planException(draft({ reason: "dnd", note: "  Sign on door  " }), ZONE, NOW);
    expect(planned).toMatchObject({ ok: true, plan: { note: "Sign on door" } });
  });

  it("Guest inside logs an 'other' attempt and keeps the BLOCKER room note", () => {
    expect(planException(draft({ reason: "guest_inside" }), ZONE, NOW)).toEqual({
      ok: true,
      plan: { kind: "attempt", result: "other", note: "Guest inside", roomNote: "BLOCKER: Guest inside" },
    });
  });

  it("Door double-locked logs an 'other' attempt with the matching BLOCKER note", () => {
    expect(planException(draft({ reason: "double_locked", note: "Chain on" }), ZONE, NOW)).toEqual({
      ok: true,
      plan: { kind: "attempt", result: "other", note: "Door double-locked: Chain on", roomNote: "BLOCKER: Can't enter (double-locked)" },
    });
  });

  it("Guest declined uses the reason-bearing declined record, not an attempt", () => {
    expect(planException(draft({ reason: "guest_declined", note: "Said no thanks" }), ZONE, NOW)).toEqual({
      ok: true,
      plan: { kind: "declined", note: "Said no thanks" },
    });
  });

  describe("Come back later", () => {
    it("never invents a return time", () => {
      expect(planException(draft({ reason: "come_back_later" }), ZONE, NOW)).toEqual({ ok: false, error: { field: "time", code: "required" } });
      expect(planException(draft({ reason: "come_back_later", returnText: "   " }), ZONE, NOW)).toMatchObject({ ok: false, error: { code: "required" } });
    });

    it("rejects text that is not a time", () => {
      expect(planException(draft({ reason: "come_back_later", returnText: "soonish" }), ZONE, NOW)).toEqual({ ok: false, error: { field: "time", code: "invalid" } });
    });

    it("rejects a time that has already passed in hotel-local time", () => {
      expect(planException(draft({ reason: "come_back_later", returnText: "9:00 AM" }), ZONE, NOW)).toEqual({ ok: false, error: { field: "time", code: "past" } });
    });

    it("resolves the time in the hotel's zone, not the device's", () => {
      const planned = planException(draft({ reason: "come_back_later", returnText: "1:30 PM" }), ZONE, NOW);
      expect(planned.ok).toBe(true);
      if (planned.ok && planned.plan.kind === "attempt") {
        expect(planned.plan.result).toBe("return_later");
        // 1:30 PM CDT == 18:30 UTC
        expect(planned.plan.returnAt).toBe("2026-10-08T18:30:00.000Z");
      }
    });
  });

  describe("Other access issue", () => {
    it("requires a note, and a meaningful one", () => {
      expect(planException(draft({ reason: "other" }), ZONE, NOW)).toEqual({ ok: false, error: { field: "note", code: "required" } });
      expect(planException(draft({ reason: "other", note: "ab" }), ZONE, NOW)).toEqual({ ok: false, error: { field: "note", code: "tooShort" } });
    });

    it("records the note with the attempt", () => {
      expect(planException(draft({ reason: "other", note: "Elevator out" }), ZONE, NOW)).toMatchObject({
        ok: true,
        plan: { kind: "attempt", result: "other", note: "Access issue: Elevator out", roomNote: "BLOCKER: Access issue — Elevator out" },
      });
    });
  });

  it("bounds the note", () => {
    expect(planException(draft({ reason: "dnd", note: "x".repeat(EXCEPTION_NOTE_MAX + 1) }), ZONE, NOW)).toEqual({ ok: false, error: { field: "note", code: "tooLong" } });
  });

  it("no plan ever names a clean session or a status change", () => {
    for (const reason of ["dnd", "guest_inside", "double_locked", "guest_declined"] as const) {
      const planned = planException(draft({ reason }), ZONE, NOW);
      expect(JSON.stringify(planned)).not.toMatch(/session|status|CLEAN|IN_PROGRESS|INSPECTED/i);
    }
  });
});

describe("isExceptionDirty", () => {
  it("is clean only when nothing was chosen or typed", () => {
    expect(isExceptionDirty(EMPTY_EXCEPTION_DRAFT)).toBe(false);
    expect(isExceptionDirty(draft({ reason: "dnd" }))).toBe(true);
    expect(isExceptionDirty(draft({ note: "x" }))).toBe(true);
  });
});
