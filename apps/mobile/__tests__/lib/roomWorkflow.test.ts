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

    const dndDeparture = room({ dnd_flag: true, clean_type: "DEP", actual_checkout_at: null });
    expect(hasRoomException(dndDeparture, now)).toBe(true);
    expect(isNeedsAttention(dndDeparture, now)).toBe(true);
    expect(isCleanable(dndDeparture, now)).toBe(false);
    expect(getRoomAction(dndDeparture, now).label).toBe("Review");
  });

  it("classifies queue buckets for the task sheet sections", () => {
    expect(getRoomQueueBucket(room({ clean_type: "DEP", actual_checkout_at: "2026-06-09T10:00:00.000Z" }), now)).toBe(
      "next_to_clean",
    );
    expect(getRoomQueueBucket(room({ dnd_flag: true }), now)).toBe("needs_attention");
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

    expect(rooms.sort((a, b) => getPriorityScore(a, now) - getPriorityScore(b, now)).map((r) => r.id)).toEqual([
      "cleanable",
      "attention",
      "progress",
      "submitted",
      "ready",
      "blocked",
    ]);
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
