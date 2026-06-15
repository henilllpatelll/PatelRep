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
  isArrivalSoon,
  isBlocked,
  isCleanable,
  isNeedsAttention,
  isReady,
  isSkipped,
  isSubmitted,
} from "@/lib/housekeeping/roomWorkflow";

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

  it("builds compact operational badges with unsafe warnings louder than VIP", () => {
    expect(
      getRoomBadges(
        room({
          vip_flag: true,
          dnd_flag: true,
          open_work_order_id: "wo-1",
          latest_note: "Key issue",
          risk_level: "HIGH",
          clean_type: "DEP",
          checkin_time: "2026-06-09T13:00:00.000Z",
        }),
        now,
      ).map((badge) => badge.label),
    ).toEqual(["DND", "VIP", "WO", "Note", "Risk", "Arrival Soon", "Not Checked Out"]);
  });

  it("sorts cleanable queue by floor urgency, not by attention flags", () => {
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

    expect(rooms.sort((a, b) => compareRoomsForCleaningQueue(a, b, now)).map((r) => r.id)).toEqual([
      "arrival",
      "vip",
      "checked-out",
      "normal",
      "full",
      "pickup",
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
