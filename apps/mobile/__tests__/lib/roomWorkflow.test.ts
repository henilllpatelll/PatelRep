import type { Room } from "@/stores/appStore";
import {
  compareRoomsByPriority,
  getBeforeEnterWarnings,
  getPrimaryTimingLine,
  getPriorityScore,
  getRoomAction,
  getRoomBadges,
  hasRoomException,
  isArrivalSoon,
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
  it("lets normal dirty and in-progress rooms move quickly from the card", () => {
    expect(hasRoomException(room())).toBe(false);
    expect(getRoomAction(room()).label).toBe("Start");
    expect(getRoomAction(room()).targetStatus).toBe("IN_PROGRESS");

    const active = room({ status: "IN_PROGRESS" });
    expect(getRoomAction(active).label).toBe("Done");
    expect(getRoomAction(active).targetStatus).toBe("CLEAN");
  });

  it("forces exception rooms through review before start or done", () => {
    const vip = room({ vip_flag: true });
    expect(hasRoomException(vip)).toBe(true);
    expect(getRoomAction(vip).label).toBe("Review");

    const notedActive = room({ status: "IN_PROGRESS", latest_note: "Guest asked for extra towels" });
    expect(getRoomAction(notedActive).label).toBe("Review Done");
  });

  it("builds compact exception badges", () => {
    expect(
      getRoomBadges(room({
        vip_flag: true,
        dnd_flag: true,
        open_work_order_id: "wo-1",
        latest_note: "Key issue",
        risk_level: "HIGH",
      })).map((badge) => badge.label),
    ).toEqual(["VIP", "DND", "WO", "Note", "Risk"]);
  });

  it("scores operational priority before fallback floor and room sort", () => {
    expect(getPriorityScore(room({ status: "IN_PROGRESS" }), now)).toBeLessThan(
      getPriorityScore(room({ vip_flag: true }), now),
    );
    expect(getPriorityScore(room({ vip_flag: true }), now)).toBeLessThan(
      getPriorityScore(room({ clean_type: "DEP", actual_checkout_at: "2026-06-09T10:00:00.000Z" }), now),
    );
    expect(getPriorityScore(room({ status: "CLEAN" }), now)).toBeLessThan(
      getPriorityScore(room({ status: "INSPECTED" }), now),
    );
  });

  it("sorts my rooms by vacant dirty, pickup, occupied, then room number", () => {
    const rooms = [
      room({ id: "pickup-110", room_number: "110", floor: 1, status: "PICKUP", vip_flag: true }),
      room({ id: "occupied-102", room_number: "102", floor: 1, status: "OCCUPIED" }),
      room({ id: "dirty-203", room_number: "203", floor: 2, status: "DIRTY", dnd_flag: true }),
      room({ id: "pickup-101", room_number: "101", floor: 1, status: "PICKUP" }),
      room({ id: "dirty-102", room_number: "102", floor: 1, status: "DIRTY" }),
      room({ id: "occupied-101", room_number: "101", floor: 1, status: "OCCUPIED" }),
    ];

    expect(rooms.sort((a, b) => compareRoomsByPriority(a, b, now)).map((r) => r.id)).toEqual([
      "dirty-102",
      "dirty-203",
      "pickup-101",
      "pickup-110",
      "occupied-101",
      "occupied-102",
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
    expect(getBeforeEnterWarnings(arrival, now).map((warning) => warning.label)).toContain("Arrival soon");
    expect(getBeforeEnterWarnings(arrival, now).map((warning) => warning.label)).toContain("Latest note");
  });
});
