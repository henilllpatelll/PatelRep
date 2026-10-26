import { evaluateEligibility, mayAssign } from "@/lib/housekeeping/assignmentEligibility";
import { normalizeBoardRecords, type BoardRoom } from "@/lib/housekeeping/roomBoardModel";
import { buildBoardMetrics } from "@/lib/housekeeping/roomBoardSelectors";
import { NOW, rawRoom } from "../helpers/roomBoardFixtures";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";

const room = (status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoom =>
  normalizeBoardRecords([rawRoom("101", status, extra)]).rooms[0];
const owned: Partial<BoardRoomRaw> = { assigned_to: "hk-1", assignment_id: "as-1", assignment_date: "2026-10-16" };

describe("hard blocks — the normal flow refuses", () => {
  it.each([
    ["IN_PROGRESS", "in_progress"],
    ["CLEAN", "awaiting_inspection"],
    ["INSPECTED", "guest_ready"],
    ["OOO", "out_of_service"],
    ["OUT_OF_ORDER", "out_of_service"],
    ["OUT_OF_SERVICE", "out_of_service"],
    ["SOMETHING_NEW", "unknown_status"],
  ])("%s → %s: cannot be assigned, reassigned or removed", (status, kind) => {
    for (const extra of [{}, owned]) {
      const eligibility = evaluateEligibility(room(status, extra), NOW);
      expect(eligibility.kind).toBe(kind);
      expect(eligibility.hardBlock).toBe(kind);
      expect(eligibility).toMatchObject({ canAssign: false, canReassign: false, canRemove: false, autoAssignable: false });
    }
  });

  it("an in-progress room is never reassignable even when its owner is known", () => {
    const eligibility = evaluateEligibility(room("IN_PROGRESS", owned), NOW);
    expect(eligibility.canReassign).toBe(false);
    expect(mayAssign(eligibility)).toBe(false);
  });

  it("a hard block dominates: soft blocks are not reported on a room that cannot be assigned anyway", () => {
    const eligibility = evaluateEligibility(room("IN_PROGRESS", { dnd_flag: true, do_not_service: true }), NOW);
    expect(eligibility.kind).toBe("in_progress");
    expect(eligibility.softBlocks).toEqual([]);
  });
});

describe("eligible rooms", () => {
  it.each(["DIRTY", "OCCUPIED", "PICKUP"])("an unowned %s room may be assigned and bulk-assigned", (status) => {
    expect(evaluateEligibility(room(status), NOW)).toMatchObject({
      kind: "eligible",
      canAssign: true,
      canReassign: false,
      canRemove: false,
      autoAssignable: true,
      needsAssignee: true,
      requiresAcknowledgement: [],
    });
  });

  it("an owned to-clean room may be reassigned or removed, and is not offered to bulk assignment", () => {
    expect(evaluateEligibility(room("DIRTY", owned), NOW)).toMatchObject({
      kind: "eligible",
      canAssign: false,
      canReassign: true,
      canRemove: true,
      autoAssignable: false,
      needsAssignee: false,
    });
  });

  it("a mirror-only assignment is owned: it can be reassigned and removed", () => {
    const eligibility = evaluateEligibility(room("DIRTY", { assigned_to: "hk-1", assignment_id: null }), NOW);
    expect(eligibility).toMatchObject({ canReassign: true, canRemove: true, needsAssignee: false });
  });
});

describe("soft blocks — never silently eligible", () => {
  it.each([
    ["dnd", { dnd_flag: true }],
    ["service_declined", { do_not_service: true }],
    ["occupancy_discrepancy", { occupancy_discrepancy: true }],
    ["return_later", { dnd_flag: true, dnd_retry_at: new Date(NOW + 60 * 60_000).toISOString() }],
  ])("%s requires acknowledgement and keeps the room out of auto-assignment", (kind, extra) => {
    const eligibility = evaluateEligibility(room("DIRTY", extra as Partial<BoardRoomRaw>), NOW);
    expect(eligibility.kind).toBe(kind);
    expect(eligibility.canAssign).toBe(true);
    expect(eligibility.autoAssignable).toBe(false);
    expect(eligibility.requiresAcknowledgement).toContain(kind);
  });

  it("reports every soft block in a stable order, the most specific first", () => {
    const eligibility = evaluateEligibility(
      room("DIRTY", { dnd_flag: true, do_not_service: true, occupancy_discrepancy: true, dnd_retry_at: new Date(NOW + 60_000).toISOString() }),
      NOW,
    );
    expect(eligibility.softBlocks).toEqual(["service_declined", "return_later", "dnd", "occupancy_discrepancy"]);
    expect(eligibility.kind).toBe("service_declined");
  });

  it("a return-later time that has passed (or is unreadable) blocks nothing", () => {
    expect(evaluateEligibility(room("DIRTY", { dnd_retry_at: new Date(NOW - 60_000).toISOString() }), NOW).softBlocks).toEqual([]);
    expect(evaluateEligibility(room("DIRTY", { dnd_retry_at: "not a time" }), NOW).softBlocks).toEqual([]);
    expect(evaluateEligibility(room("DIRTY", { dnd_retry_at: new Date(NOW).toISOString() }), NOW).returnLaterUntil).toBeNull();
  });

  it("exposes how long a return-later block lasts", () => {
    const until = new Date(NOW + 90 * 60_000).toISOString();
    expect(evaluateEligibility(room("DIRTY", { dnd_retry_at: until }), NOW).returnLaterUntil).toBe(until);
  });
});

describe("needing attention is not the same as being reassignable", () => {
  it("an unowned in-progress room needs an owner but cannot be assigned through the normal flow", () => {
    const eligibility = evaluateEligibility(room("IN_PROGRESS"), NOW);
    expect(eligibility.needsAssignee).toBe(true);
    expect(eligibility.canAssign).toBe(false);
  });

  it("needsAssignee is exactly Supervisor Today's unassigned definition, for every status", () => {
    const statuses = ["DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS", "CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE", "WEIRD"];
    const rooms = statuses.map((status, index) => ({ ...rawRoom(`${101 + index}`, status) }));
    const snapshot = normalizeBoardRecords(rooms).rooms;
    const flagged = snapshot.filter((r) => evaluateEligibility(r, NOW).needsAssignee).length;
    expect(flagged).toBe(buildBoardMetrics(snapshot).unassigned);
  });
});
