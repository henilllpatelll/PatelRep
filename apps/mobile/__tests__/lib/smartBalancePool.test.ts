import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import {
  buildPool,
  buildReceivers,
  smartReadiness,
  type Receivers,
} from "@/lib/housekeeping/smartBalancePool";
import {
  DEFAULT_PROPERTY_PREFERENCES,
  parseAssignmentPreferences,
  staffPolicyFrom,
  togglesFromProperty,
  toWirePreferences,
} from "@/lib/housekeeping/smartBalancePolicy";
import { assignmentsOf } from "../helpers/assignmentFixtures";
import { bulkModel, everyoneOnShift, room } from "../helpers/bulkFixtures";
import { rosterOf, rosterRow } from "../helpers/assignmentFixtures";

const numbers = (rooms: { room: { roomNumber: string } }[]) => rooms.map((entry) => entry.room.roomNumber).sort();
const policy = staffPolicyFrom(DEFAULT_PROPERTY_PREFERENCES);

/* bulkBoard: A: 101 102 103(no estimate) free · 104 DND · 105 declined · 106 being cleaned · 107 owned by hk-1 ·
   108 submitted · 201 VIP free · 202 free · B: 301 free · 302 free (light stayover) */

describe("the pool for each scope", () => {
  it("defaults to rooms nobody owns that are free of any block, and leaves every existing owner alone", () => {
    const pool = buildPool(bulkModel(), "unassigned", new Set());
    expect(numbers(pool.rooms)).toEqual(["101", "102", "103", "201", "202", "301", "302"]);
    expect(pool.preservedAssignments).toBe(1); // 107 stays with hk-1
    expect(pool.protectedInProgress).toBe(1); // 106 is being cleaned: protected and counted, never planned
  });

  it("holds back soft-blocked rooms and reports them with the real block, never as plannable", () => {
    const pool = buildPool(bulkModel(), "unassigned", new Set());
    const held = Object.fromEntries(pool.excluded.map((item) => [item.roomNumber, item.exclusion]));
    expect(held["104"]).toEqual({ kind: "soft_blocked", blocks: ["dnd"] });
    expect(held["105"]).toEqual({ kind: "soft_blocked", blocks: ["service_declined"] });
  });

  it("never plans a room being cleaned, submitted, inspected or out of service", () => {
    for (const scope of ["unassigned", "all_unstarted"] as const) {
      const pool = buildPool(bulkModel(), scope, new Set());
      expect(numbers(pool.rooms)).not.toContain("106");
      expect(numbers(pool.rooms)).not.toContain("108");
    }
  });

  it("full rebalance adds owned, unstarted rooms and still protects work in progress", () => {
    const raw = [room("101", "DIRTY"), room("102", "DIRTY", { owner: "hk-1" }), room("103", "IN_PROGRESS", { owner: "hk-1" }), room("104", "CLEAN", { owner: "hk-1" }), room("105", "DIRTY", { dnd_flag: true, owner: "hk-2" })];
    const pool = buildPool(assignmentsOf({ raw, roster: everyoneOnShift() }), "all_unstarted", new Set());
    expect(numbers(pool.rooms)).toEqual(["101", "102"]);
    expect(pool.protectedInProgress).toBe(1);
    expect(pool.excluded.map((item) => item.roomNumber)).toEqual(["105"]); // a soft-blocked ASSIGNED room is held back too
  });

  it("selected scope uses only the selected rooms and does not expand", () => {
    const pool = buildPool(bulkModel(), "selected", new Set(["room-101", "room-301"]));
    expect(numbers(pool.rooms)).toEqual(["101", "301"]);
    expect(pool.excluded).toEqual([]);
  });

  it("selected scope names a selected room that stopped qualifying instead of dropping it or planning it", () => {
    const pool = buildPool(bulkModel(), "selected", new Set(["room-101", "room-107", "room-104", "room-106", "room-108"]));
    expect(numbers(pool.rooms)).toEqual(["101"]);
    const reasons = Object.fromEntries(pool.excluded.map((item) => [item.roomNumber, item.exclusion.kind]));
    expect(reasons).toEqual({ "107": "now_assigned", "104": "soft_blocked", "106": "no_longer_plannable", "108": "no_longer_plannable" });
  });

  it("keeps the most urgent rooms when more than one publication can carry", () => {
    const raw = Array.from({ length: MAX_BATCH_CHANGES + 12 }, (_, index) => room(String(1000 + index), "DIRTY", { floor: 10 }));
    const pool = buildPool(assignmentsOf({ raw, roster: everyoneOnShift() }), "unassigned", new Set());
    expect(pool.rooms).toHaveLength(MAX_BATCH_CHANGES);
    expect(pool.truncated).toBe(12);
  });

  it("an unknown board yields an empty pool, never a guess", () => {
    const model = assignmentsOf({ raw: [] });
    expect(buildPool({ ...model, rooms: null }, "unassigned", new Set()).rooms).toEqual([]);
  });
});

describe("who may receive rooms", () => {
  const modelWith = (rows: ReturnType<typeof rosterRow>[]) => bulkModel({ roster: rosterOf(rows) });
  const idsOf = (people: Receivers) => people.receivers.map((receiver) => receiver.member.userId);

  it("verified on-shift people receive; their existing rooms do not matter", () => {
    const people = buildReceivers(modelWith([rosterRow("hk-1", "active"), rosterRow("hk-2", "active")]), policy);
    expect(idsOf(people)).toEqual(["hk-1", "hk-2"]);
  });

  it("people on break, with a finished shift, or not clocked in are excluded with the reason", () => {
    const people = buildReceivers(modelWith([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "ended")]), policy);
    expect(idsOf(people)).toEqual(["hk-1"]);
    expect(people.excluded.map((item) => [item.userId, item.reason])).toEqual([["hk-2", "on_break"], ["hk-3", "shift_ended"]]);
    const noOne = buildReceivers(modelWith([rosterRow("hk-1", "active")]), policy);
    expect(noOne.excluded.map((item) => [item.userId, item.reason])).toEqual([["hk-2", "not_on_shift"], ["hk-3", "not_on_shift"]]);
  });

  it("scheduled is not clocked in: a scheduled person with no shift record does not receive", () => {
    const { shift } = jest.requireActual("../helpers/assignmentFixtures") as typeof import("../helpers/assignmentFixtures");
    const model = bulkModel({ roster: rosterOf([rosterRow("hk-1", "active")]), schedule: { status: "available", data: [shift("hk-2")], fetchedAt: Date.now(), error: null } as never });
    expect(buildReceivers(model, policy).receivers.map((r) => r.member.userId)).toEqual(["hk-1"]);
  });

  it("a property that stopped excluding break / off-shift people admits them, flagged for the acknowledgement", () => {
    const relaxed = { avoidOnBreak: false, excludeOffShift: false };
    const people = buildReceivers(modelWith([rosterRow("hk-1", "active"), rosterRow("hk-2", "on_break"), rosterRow("hk-3", "ended")]), relaxed);
    expect(people.receivers.map((r) => [r.member.userId, r.admittedDespite])).toEqual([["hk-1", null], ["hk-2", "on_break"], ["hk-3", "not_on_shift"]]);
  });

  it("an unverified roster means NO ONE is a receiver, whatever the property says", () => {
    const model = bulkModel({ roster: { status: "failed", error: "x", fetchedAt: null } as never });
    const relaxed = { avoidOnBreak: false, excludeOffShift: false };
    const people = buildReceivers(model, relaxed);
    expect(people.receivers).toEqual([]);
    expect(new Set(people.excluded.map((item) => item.reason))).toEqual(new Set(["attendance_unknown"]));
  });

  it("people the staff list does not name are not receivers", () => {
    const model = assignmentsOf({ raw: [room("101", "DIRTY", { owner: "ghost" })], roster: everyoneOnShift() });
    expect(idsOf(buildReceivers(model, policy))).toEqual(["hk-1", "hk-2", "hk-3"]);
  });
});

describe("whether a plan can be asked for", () => {
  const ready = (model = bulkModel(), over: Partial<Parameters<typeof smartReadiness>[0]> = {}) => {
    const scope = over.scope ?? "unassigned";
    return smartReadiness({
      model,
      gateAllowed: true,
      isOnline: true,
      scope,
      pool: buildPool(model, scope, new Set()),
      receivers: buildReceivers(model, policy),
      ...over,
    });
  };

  it("is ready with a live board, a verified roster, rooms and people", () => {
    expect(ready()).toBeNull();
  });

  it("says the board is unavailable, offline or not live before anything else", () => {
    expect(ready({ ...bulkModel(), rooms: null, team: null })).toBe("board_unavailable");
    expect(ready(bulkModel(), { isOnline: false })).toBe("offline");
    expect(ready(bulkModel(), { gateAllowed: false })).toBe("not_live");
  });

  it("a failed roster is 'attendance unavailable' - never 'no one is available'", () => {
    const model = bulkModel({ roster: { status: "failed", error: "x", fetchedAt: null } as never });
    expect(ready(model)).toBe("attendance_unavailable");
  });

  it("an unavailable staff list is its own reason", () => {
    const model = bulkModel({ staff: { status: "failed", error: "x", fetchedAt: null } as never });
    expect(ready(model)).toBe("staff_unavailable");
  });

  it("distinguishes nothing to plan, an empty selection and no available staff", () => {
    const allAssigned = assignmentsOf({ raw: [room("101", "DIRTY", { owner: "hk-1" })], roster: everyoneOnShift() });
    expect(ready(allAssigned)).toBe("no_rooms");
    expect(ready(bulkModel(), { scope: "selected" })).toBe("selection_empty");
    expect(ready(bulkModel({ roster: rosterOf([rosterRow("hk-1", "ended"), rosterRow("hk-2", "ended"), rosterRow("hk-3", "ended")]) }))).toBe("no_staff");
  });
});

describe("planning preferences", () => {
  it("reads the property's ten stored preferences strictly", () => {
    const stored = { prioritize_guest_waiting: true, prioritize_rush: false, prioritize_earliest_arrival: true, balance_workload: true, minimize_reassignment: false, avoid_on_break: true, exclude_off_shift: false, exclude_unavailable: true, prefer_same_building: false, prefer_same_floor: true };
    const parsed = parseAssignmentPreferences({ data: { assignment_preferences: stored } });
    expect(parsed.prioritizeRush).toBe(false);
    expect(parsed.excludeOffShift).toBe(false);
    expect(() => parseAssignmentPreferences({ data: { assignment_preferences: { ...stored, balance_workload: "yes" } } })).toThrow();
    expect(() => parseAssignmentPreferences({ data: {} })).toThrow();
    expect(() => parseAssignmentPreferences(null)).toThrow();
  });

  it("the four toggles start from the property's choices", () => {
    expect(togglesFromProperty({ ...DEFAULT_PROPERTY_PREFERENCES, prioritizeGuestWaiting: false, prioritizeRush: false, prioritizeEarliestArrival: false, preferSameBuilding: false, minimizeReassignment: false })).toEqual({
      balanceWorkload: true,
      prioritizeDeadlines: false,
      preferNearby: true,
      minimizeReassignment: false,
    });
  });

  it("a switched-on group uses the property's own sub-choices, or all of them if it stored none", () => {
    const property = { ...DEFAULT_PROPERTY_PREFERENCES, prioritizeRush: false };
    expect(toWirePreferences({ balanceWorkload: true, prioritizeDeadlines: true, preferNearby: true, minimizeReassignment: true }, property)).toMatchObject({ prioritize_guest_waiting: true, prioritize_rush: false, prioritize_arrival: true });
    const none = { ...DEFAULT_PROPERTY_PREFERENCES, prioritizeGuestWaiting: false, prioritizeRush: false, prioritizeEarliestArrival: false };
    expect(toWirePreferences({ balanceWorkload: true, prioritizeDeadlines: true, preferNearby: true, minimizeReassignment: true }, none)).toMatchObject({ prioritize_guest_waiting: true, prioritize_rush: true, prioritize_arrival: true });
    expect(toWirePreferences({ balanceWorkload: false, prioritizeDeadlines: false, preferNearby: false, minimizeReassignment: false }, property)).toEqual({
      balance_workload: false,
      prioritize_guest_waiting: false,
      prioritize_rush: false,
      prioritize_arrival: false,
      prefer_same_building: false,
      prefer_same_floor: false,
      minimize_reassignment: false,
    });
  });

  it("no toggle can switch off a safety rule: the wire carries no such field", () => {
    const wire = toWirePreferences({ balanceWorkload: false, prioritizeDeadlines: false, preferNearby: false, minimizeReassignment: false }, DEFAULT_PROPERTY_PREFERENCES);
    expect(Object.keys(wire).sort()).toEqual(["balance_workload", "minimize_reassignment", "prefer_same_building", "prefer_same_floor", "prioritize_arrival", "prioritize_guest_waiting", "prioritize_rush"]);
  });
});
