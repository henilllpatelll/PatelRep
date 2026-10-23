import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { HOTEL_DATE, NOW, rawRoom } from "./roomBoardFixtures";
import { assignmentsOf, rosterOf, rosterRow, type FixtureOptions } from "./assignmentFixtures";

/** Room helper with an explicit floor/building/estimate; `minutes: null` = no estimate recorded. */
export function room(
  number: string,
  status: string,
  options: { floor?: number; building?: string; minutes?: number | null; cleanType?: "DEP" | "FULL" | "LIGHT"; owner?: string } & Partial<BoardRoomRaw> = {},
): BoardRoomRaw {
  const { floor = Number(number.slice(0, -2)) || 1, building = "A", minutes = 30, cleanType = "DEP", owner, ...rest } = options;
  return rawRoom(number, status, {
    clean_type: cleanType,
    ...(owner ? { assigned_to: owner, assignment_id: `as-${number}`, assignment_date: HOTEL_DATE } : {}),
    rooms: {
      id: `room-${number}`,
      room_number: number,
      floor,
      building,
      room_types: minutes === null ? { code: "Q" } : { name: "King", code: "K", base_clean_minutes: minutes },
    },
    ...rest,
  });
}

/**
 * A hotel for bulk work, two buildings:
 *   A: 101 · 102 · 103 (no estimate) are free; 104 DND; 105 declined; 106 being cleaned; 107 owned by hk-1;
 *      108 submitted for inspection; 201 VIP; 202 free
 *   B: 301 free; 302 free, a light stayover clean
 */
export function bulkBoard(): BoardRoomRaw[] {
  return [
    room("101", "DIRTY"),
    room("102", "DIRTY"),
    room("103", "DIRTY", { minutes: null }),
    room("104", "DIRTY", { dnd_flag: true }),
    room("105", "DIRTY", { do_not_service: true }),
    room("106", "IN_PROGRESS"),
    room("107", "DIRTY", { owner: "hk-1" }),
    room("108", "CLEAN"),
    room("201", "DIRTY", { vip_flag: true }),
    room("202", "DIRTY"),
    room("301", "DIRTY", { building: "B", floor: 3 }),
    room("302", "PICKUP", { building: "B", floor: 3, cleanType: "LIGHT", minutes: 15 }),
  ];
}

export const everyoneOnShift = () => rosterOf([rosterRow("hk-1", "active"), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]);

export function bulkModel(options: FixtureOptions = {}): AssignmentsModel {
  return assignmentsOf({ raw: bulkBoard(), roster: everyoneOnShift(), ...options });
}

export function entryOf(model: AssignmentsModel, number: string) {
  const found = (model.rooms ?? []).find((entry) => entry.room.roomNumber === number);
  if (!found) throw new Error(`no room ${number}`);
  return found;
}

export const idsOf = (numbers: string[]) => numbers.map((number) => `room-${number}`);
export { HOTEL_DATE, NOW };
