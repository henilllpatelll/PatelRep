import type { Room } from "@/stores/appStore";
import { buildSmartQueue } from "@/lib/ai/briefing";

const NOW = new Date("2026-10-14T15:00:00.000Z");

function room(roomNumber: string, checkoutHour: number, overrides: Partial<Room> = {}): Room {
  return {
    id: `r${roomNumber}`,
    room_number: roomNumber,
    floor: Number(roomNumber[0]),
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    actual_checkout_at: `2026-10-14T${String(checkoutHour).padStart(2, "0")}:00:00.000Z`,
    clean_type: "DEP",
    clean_type_label: "Departure",
    ...overrides,
  };
}

const order = (rooms: Room[]) => buildSmartQueue(rooms, NOW).map((entry) => entry.room.room_number);

describe("suggested route and property topology", () => {
  it("does not invent buildings from room numbers when the property reports none", () => {
    // 117 leaves first, so the route starts there. 116 and 118 are equally near on the floor;
    // a hard-coded "rooms 01-16 are building A" rule would have pushed 116 to the end.
    const rooms = [room("116", 9), room("117", 8), room("118", 10)];
    expect(order(rooms)).toEqual(["117", "116", "118"]);
  });

  it("uses the property's own building data to keep the route inside one building", () => {
    const rooms = [
      room("116", 9, { building: "North" }),
      room("117", 8, { building: "South" }),
      room("118", 10, { building: "South" }),
    ];
    expect(order(rooms)).toEqual(["117", "118", "116"]);
  });

  it("treats building names case- and whitespace-insensitively", () => {
    const rooms = [
      room("116", 9, { building: " north " }),
      room("117", 8, { building: "South" }),
      room("118", 10, { building: "south" }),
    ];
    expect(order(rooms)).toEqual(["117", "118", "116"]);
  });

  it("applies no crossing penalty when only some rooms have a building", () => {
    const rooms = [room("116", 9, { building: "North" }), room("117", 8), room("118", 10, { building: "South" })];
    expect(order(rooms)).toEqual(["117", "116", "118"]);
  });

  it("works for other numbering schemes (four-digit room numbers)", () => {
    const rooms = [room("1204", 9), room("1202", 8), room("1210", 10)];
    expect(order(rooms)).toEqual(["1202", "1204", "1210"]);
  });

  it("is deterministic whatever order the API delivers rooms in", () => {
    const rooms = [room("201", 8), room("203", 8), room("205", 8), room("302", 8), room("304", 8), room("101", 8)];
    const expected = order(rooms);
    expect(order([...rooms].reverse())).toEqual(expected);
    expect(order([rooms[3], rooms[0], rooms[5], rooms[1], rooms[4], rooms[2]])).toEqual(expected);
  });
});
