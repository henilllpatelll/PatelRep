import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { BoardRoomRaw } from "@/lib/housekeeping/supervisor";
import { availableSource } from "@/lib/housekeeping/supervisorSources";
import { assignmentsOf, rosterOf, rosterRow, SETTINGS, shift, type FixtureOptions } from "./assignmentFixtures";
import { room } from "./bulkFixtures";
import { HOTEL_DATE, NOW, STAFF } from "./roomBoardFixtures";

/**
 * Ana Torres (hk-1) leaves early with nine rooms:
 *   completed    308 (submitted for inspection), 309 (inspected)
 *   in progress  307
 *   not started  301 · 302 · 303 (pickup) · 304 · 305 · 306            ← movable
 *   held back    310 (do not disturb), 311 (guest declined service)
 *   out of order 312
 * Ben Ortiz (hk-2) has two rooms, Cara Reyes (hk-3) one; both are on shift.
 */
export function midshiftBoard(): BoardRoomRaw[] {
  const ana = { owner: "hk-1" };
  return [
    room("301", "DIRTY", { ...ana, minutes: 30 }),
    room("302", "DIRTY", { ...ana, minutes: 35 }),
    room("303", "PICKUP", { ...ana, minutes: 15, cleanType: "LIGHT" }),
    room("304", "DIRTY", { ...ana, minutes: 30, building: "B", floor: 3 }),
    room("305", "DIRTY", { ...ana, minutes: 35 }),
    room("306", "DIRTY", { ...ana, minutes: 25, cleanType: "FULL" }),
    room("307", "IN_PROGRESS", { ...ana }),
    room("308", "CLEAN", { ...ana, inspection_required: true }),
    room("309", "INSPECTED", { ...ana }),
    room("310", "DIRTY", { ...ana, dnd_flag: true }),
    room("311", "DIRTY", { ...ana, do_not_service: true }),
    room("312", "OUT_OF_SERVICE", { ...ana }),
    room("401", "DIRTY", { owner: "hk-2", minutes: 30, floor: 4 }),
    room("402", "DIRTY", { owner: "hk-2", minutes: 30, floor: 4 }),
    room("501", "DIRTY", { owner: "hk-3", minutes: 30, floor: 5 }),
    room("601", "DIRTY", { minutes: 30, floor: 6 }),
  ];
}

export const anaEnded = () => rosterOf([rosterRow("hk-1", "ended", 9 * 60 * 60_000), rosterRow("hk-2", "active"), rosterRow("hk-3", "active")]);

export function midshiftModel(options: FixtureOptions = {}): AssignmentsModel {
  return assignmentsOf({ raw: midshiftBoard(), roster: anaEnded(), ...options });
}

export { HOTEL_DATE, NOW, SETTINGS, STAFF, availableSource, shift };
export const idsOf = (numbers: string[]) => numbers.map((number) => `room-${number}`);
export const numbersOfIds = (model: AssignmentsModel, ids: readonly string[]) =>
  ids.map((id) => (model.rooms ?? []).find((entry) => entry.room.roomId === id)?.room.roomNumber ?? id).sort();
