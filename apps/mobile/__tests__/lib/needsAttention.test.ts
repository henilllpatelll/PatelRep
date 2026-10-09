import type { Room } from "@/stores/appStore";
import { classifyRoom, getRushInfo, isEntryRestricted, isRushPriority } from "@/lib/housekeeping/needsAttention";

const NOW = new Date("2026-10-08T15:00:00.000Z");
const EARLIER = "2026-10-08T14:00:00.000Z";
const LATER = "2026-10-08T18:00:00.000Z";

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: "r1",
    room_number: "314",
    floor: 3,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    clean_type: "DEP",
    clean_type_label: "Departure",
    actual_checkout_at: "2026-10-08T12:00:00.000Z",
    ...overrides,
  };
}

const stayover = (overrides: Partial<Room> = {}) =>
  room({ status: "PICKUP", clean_type: "LIGHT", clean_type_label: "Light", actual_checkout_at: null, fo_status: "OCC", ...overrides });

const classify = (r: Room) => classifyRoom(r, { now: NOW });

describe("states", () => {
  it("maps every room to exactly one application state without inventing database statuses", () => {
    expect(classify(room()).state).toBe("cleanable");
    expect(classify(room({ status: "IN_PROGRESS" })).state).toBe("active");
    expect(classify(room({ dnd_flag: true })).state).toBe("needs_attention");
    expect(classify(room({ status: "CLEAN" })).state).toBe("completed");
    expect(classify(room({ status: "INSPECTED" })).state).toBe("completed");
    for (const status of ["OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"] as const) {
      expect(classify(room({ status })).state).toBe("unavailable");
    }
  });

  it("a live session makes a room active whatever the stale list status says", () => {
    expect(classifyRoom(room({ status: "DIRTY" }), { now: NOW, hasLiveSession: true }).state).toBe("active");
  });

  it("an unavailable room is never restricted, rushed or 'completed'", () => {
    const c = classify(room({ status: "OUT_OF_SERVICE", dnd_flag: true, priority: 1 }));
    expect(c).toMatchObject({ state: "unavailable", restricted: false, rush: null, reasons: [] });
  });
});

describe("restrictions", () => {
  it("DND bars entry and reports its persisted attempt history", () => {
    const c = classify(room({ dnd_flag: true, dnd_attempt_count: 2, dnd_last_attempt_at: EARLIER, dnd_retry_at: LATER }));
    expect(c).toMatchObject({ state: "needs_attention", primary: "dnd", restricted: true });
    expect(c.retry).toEqual({ at: LATER, due: false, attempts: 2, lastAttemptAt: EARLIER });
  });

  it("keeps Do Not Service and Service Declined distinct (a recorded reason/time means declined)", () => {
    expect(classify(stayover({ do_not_service: true })).primary).toBe("do_not_service");
    expect(classify(stayover({ do_not_service: true, service_declined_reason: "privacy_request" })).primary).toBe("service_declined");
    expect(classify(stayover({ do_not_service: true, service_declined_at: EARLIER })).primary).toBe("service_declined");
    expect(classify(stayover({ do_not_service: true })).restricted).toBe(true);
  });

  it("a verified checkout ends a stale decline", () => {
    expect(classify(room({ do_not_service: true })).state).toBe("cleanable");
  });

  it("come-back-later restricts until the retry time arrives, then the room is workable and the retry is 'due'", () => {
    const waiting = classify(stayover({ dnd_retry_at: LATER, dnd_attempt_count: 1 }));
    expect(waiting).toMatchObject({ state: "needs_attention", primary: "come_back_later", restricted: true });
    expect(waiting.retry?.due).toBe(false);

    const arrived = classify(stayover({ dnd_retry_at: EARLIER, dnd_attempt_count: 1 }));
    expect(arrived).toMatchObject({ state: "cleanable", restricted: false });
    expect(arrived.retry?.due).toBe(true);
  });

  it("never fabricates a retry: no stored retry time means no come-back-later and no due flag", () => {
    const c = classify(stayover({ dnd_retry_at: null, dnd_attempt_count: 0 }));
    expect(c.retry).toBeNull();
    expect(c.reasons).not.toContain("come_back_later");
  });

  it("DND outranks a retry time, and the retry stays visible", () => {
    const c = classify(stayover({ dnd_flag: true, dnd_retry_at: LATER }));
    expect(c.primary).toBe("dnd");
    expect(c.retry?.at).toBe(LATER);
    expect(c.reasons).not.toContain("come_back_later"); // dnd_flag wins; the pair is not double-reported
  });

  it("does not trust the clock for departure: scheduled checkout is not a verified checkout", () => {
    const c = classify(room({ status: "OCCUPIED", actual_checkout_at: null, checkout_time: "2026-10-08T11:00:00.000Z", fo_status: "OCC" }));
    expect(c).toMatchObject({ state: "needs_attention", primary: "checkout_unverified", restricted: false });
  });

  it("reads the attendant's own BLOCKER notes as guest-inside / access problems", () => {
    expect(classify(room({ latest_note: "BLOCKER: Guest inside" })).primary).toBe("guest_inside");
    expect(classify(room({ latest_note: "BLOCKER: Late checkout — guest says 1 PM" })).primary).toBe("guest_inside");
    expect(classify(room({ latest_note: "BLOCKER: Can't enter (double-locked)" })).primary).toBe("access_problem");
  });

  it("ignores legacy note-only DND / come-back-later / declined notes — the server columns are authoritative", () => {
    for (const note of ["BLOCKER: DND on door", "BLOCKER: Come back later — 1:00 PM", "BLOCKER: Guest declined service"]) {
      expect(classify(stayover({ latest_note: note })).state).toBe("cleanable");
    }
  });

  it("isEntryRestricted matches the classifier", () => {
    expect(isEntryRestricted(room({ dnd_flag: true }), NOW)).toBe(true);
    expect(isEntryRestricted(room(), NOW)).toBe(false);
  });
});

describe("rush", () => {
  it("is only a real backend priority of 1 or 2", () => {
    expect(isRushPriority({ priority: 1 })).toBe(true);
    expect(isRushPriority({ priority: 2 })).toBe(true);
    expect(isRushPriority({ priority: 3 })).toBe(false);
    expect(isRushPriority({ priority: 5 })).toBe(false);
    expect(isRushPriority({ priority: null })).toBe(false);
    expect(isRushPriority({})).toBe(false);
  });

  it("carries reason, deadline and supervisor note; handles no deadline and a passed one", () => {
    const withDeadline = getRushInfo(room({ priority: 1, priority_reason: "vip", priority_needed_by: LATER, priority_note: " Owner " }), NOW);
    expect(withDeadline).toEqual({ reason: "vip", neededBy: LATER, note: "Owner", overdue: false });
    expect(getRushInfo(room({ priority: 1 }), NOW)).toEqual({ reason: null, neededBy: null, note: null, overdue: false });
    expect(getRushInfo(room({ priority: 1, priority_needed_by: EARLIER }), NOW)?.overdue).toBe(true);
    expect(getRushInfo(room({ priority: 4, priority_needed_by: EARLIER }), NOW)).toBeNull();
  });

  it("a revoked priority disappears on the next refresh", () => {
    expect(classify(room({ priority: 1 })).rush).not.toBeNull();
    expect(classify(room({ priority: 5 })).rush).toBeNull();
  });

  it("is dropped once the room is done", () => {
    expect(classify(room({ status: "CLEAN", priority: 1 })).rush).toBeNull();
  });

  it("never lets Rush make a restricted room look ready", () => {
    const c = classify(
      stayover({ priority: 1, priority_needed_by: LATER, dnd_flag: true, checkin_time: "2026-10-08T20:00:00.000Z" }),
    );
    expect(c.state).toBe("needs_attention");
    expect(c.primary).toBe("dnd");
    expect(c.restricted).toBe(true);
    expect(c.rush?.neededBy).toBe(LATER); // retained as secondary information
  });
});

describe("multiple simultaneous reasons", () => {
  it("keeps every reason, strongest first, and leads with the strongest", () => {
    const c = classify(
      stayover({
        dnd_flag: true,
        latest_note: "BLOCKER: Guest inside",
        open_work_order_id: "wo-1",
        reclean_requested_at: EARLIER,
        reclean_corrections: ["Dust"],
        risk_level: "HIGH",
      }),
    );
    expect(c.primary).toBe("dnd");
    expect(c.reasons).toEqual(["dnd", "guest_inside", "reclean", "work_order", "high_risk"]);
  });

  it("checkout-unverified outranks reclean", () => {
    const c = classify(room({ actual_checkout_at: null, reclean_requested_at: EARLIER, reclean_corrections: ["Dust"] }));
    expect(c.primary).toBe("checkout_unverified");
    expect(c.reasons).toContain("reclean");
  });
});

describe("reclean", () => {
  const details = {
    inspection_id: "i1",
    inspected_at: EARLIER,
    overall_result: "failed",
    notes: null,
    items: [
      { id: "a", label: "Restock", note: null },
      { id: "b", label: "Mirror", note: "Streaks" },
    ],
  };

  it("a failed inspection returns the room to active work (it is not 'completed')", () => {
    const c = classify(room({ status: "DIRTY", reclean_requested_at: EARLIER, reclean_details: details }));
    expect(c.state).toBe("cleanable");
    expect(c.reclean).toEqual({ requestedAt: EARLIER, corrections: 2 });
  });

  it("counts corrections from the structured details, then the label list", () => {
    expect(classify(room({ reclean_requested_at: EARLIER, reclean_details: details })).reclean?.corrections).toBe(2);
    expect(classify(room({ reclean_requested_at: EARLIER, reclean_corrections: ["x"] })).reclean?.corrections).toBe(1);
    expect(classify(room({ reclean_requested_at: EARLIER })).reclean?.corrections).toBe(0);
  });

  it("a reclean the attendant has resubmitted waits for re-inspection, it is not an active reclean", () => {
    expect(classify(room({ status: "CLEAN", reclean_requested_at: EARLIER, reclean_details: details })).state).toBe("completed");
  });

  it("a reclean behind an access restriction is parked, with the reclean kept as a reason", () => {
    const c = classify(stayover({ dnd_flag: true, reclean_requested_at: EARLIER, reclean_details: details }));
    expect(c).toMatchObject({ state: "needs_attention", primary: "dnd" });
    expect(c.reasons).toContain("reclean");
  });
});
