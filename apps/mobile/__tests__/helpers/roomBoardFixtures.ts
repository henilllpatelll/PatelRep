import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";

/** 12:00 in Chicago (CDT) on 2026-10-16. */
export const NOW = Date.parse("2026-10-16T17:00:00Z");
export const ZONE = "America/Chicago";
export const HOTEL_DATE = "2026-10-16";

/**
 * A realistic GET /housekeeping/board row: the room_status columns spread at the top level with the
 * `rooms` join nested under it, exactly as the API returns them.
 */
export function rawRoom(number: string, status: string, extra: Partial<BoardRoomRaw> = {}): BoardRoomRaw {
  const floor = Number(number.slice(0, number.length - 2)) || 1;
  return {
    room_id: `room-${number}`,
    status,
    vip_flag: false,
    dnd_flag: false,
    fo_status: "VAC",
    assigned_to: null,
    assignment_id: null,
    priority: 5,
    rooms: {
      id: `room-${number}`,
      room_number: number,
      floor,
      building: "A",
      room_types: { name: "King", code: "K", base_clean_minutes: 30 },
    },
    ...extra,
  };
}

/** A small hotel covering every status the board can show, in two buildings. */
export function hotelBoard(): BoardRoomRaw[] {
  return [
    rawRoom("101", "DIRTY"),
    rawRoom("102", "OCCUPIED", { fo_status: "OCC", assigned_to: "hk-1", assignment_id: "as-102", assignment_date: HOTEL_DATE }),
    rawRoom("103", "PICKUP", { clean_type: "FULL", clean_type_label: "Stayover", assigned_to: "hk-1", assignment_id: "as-103" }),
    rawRoom("104", "IN_PROGRESS", { assigned_to: "hk-2", assignment_id: "as-104" }),
    rawRoom("105", "CLEAN", { assigned_to: "hk-2", assignment_id: "as-105", inspection_required: true }),
    rawRoom("106", "INSPECTED"),
    rawRoom("107", "OOO"),
    rawRoom("108", "OUT_OF_ORDER"),
    rawRoom("109", "OUT_OF_SERVICE"),
    rawRoom("201", "DIRTY", { vip_flag: true, rooms: { id: "room-201", room_number: "201", floor: 2, building: "B", room_types: { code: "Q" } } }),
  ];
}

export const STAFF = [
  { userId: "hk-1", name: "Ana Torres", role: "housekeeper" },
  { userId: "hk-2", name: "Ben Ortiz", role: "housekeeper" },
  { userId: "hk-3", name: "Cara Reyes", role: "housekeeper" },
];
