import type { Room } from "@/stores/appStore";
import {
  compareRoomsForCleaningQueue,
  getBeforeEnterWarnings,
  getPrimaryTimingLine,
  getPriorityScore,
  getRoomAction,
  getRoomBadges,
  getRoomQueueBucket,
  hasRoomException,
  hasRoomInProgress,
  isArrivalSoon,
  isBlocked,
  isCleanable,
  isNeedsAttention,
  isReady,
  isSkipped,
  isSubmitted,
} from "@/lib/housekeeping/roomWorkflow";
import { buildSmartQueue } from "@/lib/ai/briefing";

const now = new Date("2026-06-09T12:00:00.000Z");

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    room_number: "101",
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: null,
    clean_type: null,
    ...overrides,
  };
}

describe("roomWorkflow helpers", () => {
  it("separates cleanable priority from needs-attention rooms", () => {
    const vip = room({ vip_flag: true });
    expect(isNeedsAttention(vip, now)).toBe(false);
    expect(isCleanable(vip, now)).toBe(true);
    expect(getRoomAction(vip, now).label).toBe("Start");

    // DND rooms go to the "skipped" bucket, not needs_attention
    const dndRoom = room({ dnd_flag: true, clean_type: "DEP", actual_checkout_at: null });
    expect(isSkipped(dndRoom)).toBe(true);
    expect(isNeedsAttention(dndRoom, now)).toBe(false);
    expect(hasRoomException(dndRoom, now)).toBe(false);
    expect(isCleanable(dndRoom, now)).toBe(false);
    expect(getRoomQueueBucket(dndRoom, now)).toBe("skipped");
    expect(getRoomAction(dndRoom, now).label).toBe("DND");

    // Vacant departure rooms with notes/WO stay in smart order (Review, not needs_attention)
    const depWithNote = room({ clean_type: "DEP", actual_checkout_at: "2026-06-09T10:00:00.000Z", latest_note: "Extra blanket left" });
    expect(isNeedsAttention(depWithNote, now)).toBe(false);
    expect(isCleanable(depWithNote, now)).toBe(true);
    expect(getRoomQueueBucket(depWithNote, now)).toBe("next_to_clean");
    expect(getRoomAction(depWithNote, now).label).toBe("Review");

    const depWithWo = room({ clean_type: "DEP", actual_checkout_at: "2026-06-09T10:00:00.000Z", open_work_order_id: "wo-1" });
    expect(isNeedsAttention(depWithWo, now)).toBe(false);
    expect(isCleanable(depWithWo, now)).toBe(true);
    expect(getRoomAction(depWithWo, now).label).toBe("Review");
  });

  it("classifies queue buckets for the task sheet sections", () => {
    expect(getRoomQueueBucket(room({ clean_type: "DEP", actual_checkout_at: "2026-06-09T10:00:00.000Z" }), now)).toBe(
      "next_to_clean",
    );
    expect(getRoomQueueBucket(room({ dnd_flag: true }), now)).toBe("skipped");
    expect(getRoomQueueBucket(room({ status: "IN_PROGRESS" }), now)).toBe("in_progress");
    expect(getRoomQueueBucket(room({ status: "CLEAN" }), now)).toBe("submitted");
    expect(getRoomQueueBucket(room({ status: "INSPECTED" }), now)).toBe("ready");
    expect(getRoomQueueBucket(room({ status: "OUT_OF_ORDER" }), now)).toBe("blocked");

    expect(isSubmitted(room({ status: "CLEAN" }))).toBe(true);
    expect(isReady(room({ status: "INSPECTED" }))).toBe(true);
    expect(isBlocked(room({ status: "OOO" }))).toBe(true);
  });

  it("builds compact operational badges", () => {
    expect(
      getRoomBadges(
        room({
          dnd_flag: true,
          open_work_order_id: "wo-1",
          latest_note: "Key issue",
          risk_level: "HIGH",
          clean_type: "DEP",
          checkin_time: "2026-06-09T13:00:00.000Z",
        }),
        now,
      ).map((badge) => badge.label),
    ).toEqual(["DND", "WO", "Note", "Risk", "Arrival Soon", "Not Checked Out"]);
  });

  it("sorts cleanable queue: arrival-soon DEP → other DEP → vanilla dirty → stayover/pickup", () => {
    const rooms = [
      room({ id: "pickup", room_number: "104", floor: 1, status: "PICKUP" }),
      room({ id: "normal", room_number: "102", floor: 1, status: "DIRTY" }),
      room({ id: "vip", room_number: "103", floor: 1, status: "DIRTY", vip_flag: true }),
      room({
        id: "arrival",
        room_number: "101",
        floor: 1,
        status: "DIRTY",
        clean_type: "DEP",
        actual_checkout_at: "2026-06-09T10:00:00.000Z",
        checkin_time: "2026-06-09T13:00:00.000Z",
      }),
      room({
        id: "checked-out",
        room_number: "105",
        floor: 1,
        status: "DIRTY",
        clean_type: "DEP",
        actual_checkout_at: "2026-06-09T09:30:00.000Z",
      }),
      room({ id: "full", room_number: "106", floor: 1, status: "DIRTY", clean_type: "FULL" }),
    ];

    // vip_flag no longer a priority factor; vip room is plain DIRTY (score 30)
    // normal (102) sorts before vip (103) in same tier by room number
    // pickup (104) sorts before full (106) in same tier by room number
    expect(rooms.sort((a, b) => compareRoomsForCleaningQueue(a, b, now)).map((r) => r.id)).toEqual([
      "arrival",
      "checked-out",
      "normal",
      "vip",
      "pickup",
      "full",
    ]);
  });

  it("keeps task-sheet grouping order separate from the cleaning comparator", () => {
    const rooms = [
      room({ id: "ready", room_number: "106", status: "INSPECTED" }),
      room({ id: "attention", room_number: "102", dnd_flag: true }),
      room({ id: "cleanable", room_number: "101", clean_type: "DEP", actual_checkout_at: "2026-06-09T10:00:00.000Z" }),
      room({ id: "progress", room_number: "103", status: "IN_PROGRESS" }),
      room({ id: "submitted", room_number: "104", status: "CLEAN" }),
      room({ id: "blocked", room_number: "105", status: "OUT_OF_SERVICE" }),
    ];

    // DND rooms are now "skipped" (bucket 3), after in_progress (bucket 2)
    expect(rooms.sort((a, b) => getPriorityScore(a, now) - getPriorityScore(b, now)).map((r) => r.id)).toEqual([
      "cleanable",
      "progress",
      "attention",
      "submitted",
      "ready",
      "blocked",
    ]);
  });

  it("guest_checkout action targets IN_PROGRESS so the tap starts cleaning immediately", () => {
    // OCCUPIED + DEP = housekeeper sees "Guest Checked Out — Start Cleaning"
    const occupiedDep = room({ status: "OCCUPIED", clean_type: "DEP", fo_status: "OCC" });
    const action = getRoomAction(occupiedDep, now);
    expect(action.kind).toBe("guest_checkout");
    // targetStatus must be IN_PROGRESS — OCCUPIED→DIRTY is not in ALLOWED_TRANSITIONS on the API
    expect(action.targetStatus).toBe("IN_PROGRESS");
    expect(action.allowUndo).toBeUndefined();
  });

  it("IN_PROGRESS DEP room shows Mark Clean / Undo even when fo_status is still OCC", () => {
    // After guest_checkout tap, status=IN_PROGRESS but fo_status is still OCC (not reset by PATCH /status).
    // The housekeeper must see "done" (Mark Clean) + Undo, not "Review" with no action.
    const inProgressDep = room({ status: "IN_PROGRESS", clean_type: "DEP", fo_status: "OCC" });
    const action = getRoomAction(inProgressDep, now);
    expect(action.kind).toBe("done");
    expect(action.targetStatus).toBe("CLEAN");
    expect(action.allowUndo).toBe(true);
    // stale fo_status should not flag "guest may be inside" once cleaning has started
    const warnings = getBeforeEnterWarnings(inProgressDep, now);
    expect(warnings.find((w) => w.key === "occupied" || w.key === "checkout")).toBeUndefined();
  });

  it("buildSmartQueue routes same-tier rooms by corridor proximity", () => {
    // Rooms in scrambled order — all same priority (score 40, vanilla DIRTY)
    // Expected: greedy nearest-neighbor sweeps 109→111→113→115 without backtracking
    const scattered = [
      room({ id: "115", room_number: "115", floor: 1, status: "DIRTY" }),
      room({ id: "109", room_number: "109", floor: 1, status: "DIRTY" }),
      room({ id: "113", room_number: "113", floor: 1, status: "DIRTY" }),
      room({ id: "111", room_number: "111", floor: 1, status: "DIRTY" }),
    ];
    const queue = buildSmartQueue(scattered, now);
    expect(queue.map((e) => e.room.id)).toEqual(["109", "111", "113", "115"]);
    expect(queue.map((e) => e.position)).toEqual([1, 2, 3, 4]);
  });

  it("buildSmartQueue completes one floor before crossing to the next", () => {
    const mixed = [
      room({ id: "201", room_number: "201", floor: 2, status: "DIRTY" }),
      room({ id: "103", room_number: "103", floor: 1, status: "DIRTY" }),
      room({ id: "205", room_number: "205", floor: 2, status: "DIRTY" }),
      room({ id: "101", room_number: "101", floor: 1, status: "DIRTY" }),
    ];
    const queue = buildSmartQueue(mixed, now);
    const floors = queue.map((e) => e.room.floor);
    // First two rooms should be the same floor, second two the other floor
    expect(floors[0]).toBe(floors[1]);
    expect(floors[2]).toBe(floors[3]);
    expect(floors[0]).not.toBe(floors[2]);
  });

  it("buildSmartQueue respects priority tiers regardless of physical proximity", () => {
    // DEP rooms (score 10/20) always before PICKUP (score 40) regardless of distance
    const arrivalSoon = room({
      id: "arrival",
      room_number: "110",
      floor: 1,
      status: "DIRTY",
      clean_type: "DEP",
      actual_checkout_at: "2026-06-09T09:00:00.000Z",
      checkin_time: "2026-06-09T13:00:00.000Z", // arrival in 1h — score 10
    });
    const depFar = room({
      id: "dep-far",
      room_number: "203",
      floor: 2,
      status: "DIRTY",
      clean_type: "DEP",
      actual_checkout_at: "2026-06-09T09:00:00.000Z", // score 20, far away
    });
    const pickupNearby = room({
      id: "pickup-nearby",
      room_number: "111",
      floor: 1,
      status: "PICKUP", // score 40, adjacent to arrivalSoon
    });
    const queue = buildSmartQueue([pickupNearby, depFar, arrivalSoon], now);
    // Priority must win: arrival-soon DEP → other DEP → PICKUP
    expect(queue[0].room.id).toBe("arrival");
    expect(queue[1].room.id).toBe("dep-far");
    expect(queue[2].room.id).toBe("pickup-nearby");
  });

  it("buildSmartQueue does not carry lastRoom across tiers when nothing is in progress", () => {
    // Bug: the end of tier-1 (DEP rooms) was used as the startFrom for tier-2 (PICKUP rooms).
    // If the last DEP room was near 123, the algorithm picked 123 before 118 even though
    // 118 < 123 and Claudia had not cleaned anything yet.
    // Fix: tier chaining is disabled when no room is IN_PROGRESS.
    const dep105 = room({ id: "105", room_number: "105", floor: 1, status: "DIRTY", clean_type: "DEP", actual_checkout_at: "2026-06-09T09:00:00.000Z" });
    const dep125 = room({ id: "125", room_number: "125", floor: 1, status: "DIRTY", clean_type: "DEP", actual_checkout_at: "2026-06-09T09:30:00.000Z" });
    const dirty118 = room({ id: "118", room_number: "118", floor: 1, status: "DIRTY" });
    const dirty123 = room({ id: "123", room_number: "123", floor: 1, status: "DIRTY" });
    const queue = buildSmartQueue([dep105, dep125, dirty118, dirty123], now);
    // DEP rooms come first (higher priority), then DIRTY rooms in numeric order from their own start
    expect(queue.map((e) => e.room.id)).toEqual(["105", "125", "118", "123"]);
  });

  it("buildSmartQueue chains tiers when a room is in progress", () => {
    // When a room is IN_PROGRESS (housekeeper has a known position), tier chaining is active.
    const inProg = room({ id: "ip", room_number: "120", floor: 1, status: "IN_PROGRESS" });
    const dirty118 = room({ id: "118", room_number: "118", floor: 1, status: "DIRTY" });
    const dirty123 = room({ id: "123", room_number: "123", floor: 1, status: "DIRTY" });
    const queue = buildSmartQueue([inProg, dirty118, dirty123], now);
    // IN_PROGRESS first (score 0), then DIRTY tier starts from room 120 (suffix=20):
    // distance to 123=3, distance to 118=2 → 118 first, then 123
    expect(queue[0].room.id).toBe("ip");
    expect(queue[1].room.id).toBe("118");
    expect(queue[2].room.id).toBe("123");
  });

  it("FLAG notes do not move a room out of smart order; BLOCKER notes do", () => {
    const flagNote = room({ status: "DIRTY", latest_note: "FLAG: Pet room (work order created)" });
    expect(isNeedsAttention(flagNote, now)).toBe(false);
    expect(getRoomQueueBucket(flagNote, now)).toBe("next_to_clean");

    const blockerNote = room({ status: "DIRTY", latest_note: "BLOCKER: Guest inside" });
    expect(isNeedsAttention(blockerNote, now)).toBe(true);
    expect(getRoomQueueBucket(blockerNote, now)).toBe("needs_attention");

    // Custom (freeform) notes still count as blocking
    const customNote = room({ status: "DIRTY", latest_note: "Left extra blanket on bed" });
    expect(isNeedsAttention(customNote, now)).toBe(true);
  });

  it("hasRoomInProgress blocks starting a second room", () => {
    const ip = room({ id: "ip", room_number: "101", status: "IN_PROGRESS" });
    const dirty = room({ id: "dirty", room_number: "102", status: "DIRTY" });
    const clean = room({ id: "clean", room_number: "103", status: "CLEAN" });

    // another room is in progress → returns true when querying from dirty's perspective
    expect(hasRoomInProgress([ip, dirty, clean], "dirty")).toBe(true);
    // from the in-progress room's own perspective → should be false (excludes itself)
    expect(hasRoomInProgress([ip, dirty, clean], "ip")).toBe(false);
    // no in-progress rooms at all
    expect(hasRoomInProgress([dirty, clean], "dirty")).toBe(false);
  });

  it("detects useful timing and before-enter warnings", () => {
    const arrival = room({
      clean_type: "DEP",
      checkin_time: "2026-06-09T13:30:00.000Z",
      latest_note: "Guest requested feather-free room",
    });

    expect(isArrivalSoon(arrival, now)).toBe(true);
    expect(getPrimaryTimingLine(arrival, now)?.label).toBe("Arrival");
    expect(getPrimaryTimingLine(arrival, now)?.value).toMatch(/\d+:\d{2}\s[AP]M/);
    // "Not checked out" is only warned for OCCUPIED departures — a vacant-dirty
    // DEP room without a checkout timestamp is safe to enter.
    expect(getBeforeEnterWarnings(arrival, now).map((warning) => warning.label)).toEqual([
      "Latest note",
      "Arrival soon",
    ]);
  });
});
