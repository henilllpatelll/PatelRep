import { api } from "@/lib/api/client";
import { createWorkOrder } from "@/lib/api/workOrders";
import type { Room } from "@/stores/appStore";

/* Context-aware quick blockers for the room detail screen.
 *
 * Occupied / not-checked-out rooms get guest-related blockers; pickup
 * (stayover) rooms get service-refusal flows; vacant rooms get room-condition
 * flags. Every blocker posts a room note (the audit trail on room cards);
 * some also create a work order or a delegation task:
 *   - deep clean / pet room → LOW priority WO "Deep vacuum and change filter"
 *   - ozone / smoke smell   → housekeeping task for the supervisor/houseman on shift
 *   - late checkout         → task for front desk to confirm or change the time
 */

export type BlockerSideEffect = "work_order" | "ozone_task" | "frontdesk_task";

export interface RoomBlocker {
  key: string;
  /** i18n key under blockers.* for the button label */
  labelKey: string;
  /** Note text written to the room (kept in English — stored data) */
  note: string;
  /** When set, tapping opens a time entry; {time} in note is replaced */
  needsTime?: boolean;
  /** Preset chips for the time entry */
  timePresets?: string[];
  sideEffect?: BlockerSideEffect;
}

const OCCUPIED_BLOCKERS: RoomBlocker[] = [
  { key: "guest_inside", labelKey: "blockers.guestInside", note: "BLOCKER: Guest inside" },
  { key: "dnd_on_door", labelKey: "blockers.dndOnDoor", note: "BLOCKER: DND on door" },
  { key: "cant_enter", labelKey: "blockers.cantEnter", note: "BLOCKER: Can't enter (double-locked)" },
  {
    key: "late_checkout",
    labelKey: "blockers.lateCheckout",
    note: "BLOCKER: Late checkout — guest says {time}",
    needsTime: true,
    timePresets: ["12:00 PM", "1:00 PM", "2:00 PM"],
    sideEffect: "frontdesk_task",
  },
];

const PICKUP_BLOCKERS: RoomBlocker[] = [
  { key: "declined_service", labelKey: "blockers.declinedService", note: "BLOCKER: Guest declined service" },
  {
    key: "come_back_later",
    labelKey: "blockers.comeBackLater",
    note: "BLOCKER: Come back later — {time}",
    needsTime: true,
    timePresets: ["30 min", "1 hour", "2 hours"],
  },
  { key: "guest_inside", labelKey: "blockers.guestInside", note: "BLOCKER: Guest inside" },
];

const VACANT_BLOCKERS: RoomBlocker[] = [
  { key: "deep_clean", labelKey: "blockers.deepClean", note: "FLAG: Needs deep clean (work order created)", sideEffect: "work_order" },
  { key: "pet_room", labelKey: "blockers.petRoom", note: "FLAG: Pet room (work order created)", sideEffect: "work_order" },
  { key: "need_ozone", labelKey: "blockers.needOzone", note: "FLAG: Needs ozone treatment (task created)", sideEffect: "ozone_task" },
  { key: "smoke_smell", labelKey: "blockers.smokeSmell", note: "FLAG: Smoke smell — needs ozone (task created)", sideEffect: "ozone_task" },
];

const NO_BLOCKER_STATUSES = new Set<Room["status"]>([
  "CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE",
]);

export function getBlockersForRoom(room: Room): RoomBlocker[] {
  if (NO_BLOCKER_STATUSES.has(room.status)) return [];
  if (room.status === "PICKUP") return PICKUP_BLOCKERS;
  const guestContext =
    room.status === "OCCUPIED" || (room.fo_status === "OCC" && !room.actual_checkout_at);
  if (guestContext) return OCCUPIED_BLOCKERS;
  // DIRTY / IN_PROGRESS vacant rooms
  return VACANT_BLOCKERS;
}

export function buildBlockerNote(blocker: RoomBlocker, time?: string): string {
  return blocker.note.replace("{time}", time?.trim() || "unspecified");
}

/** Runs the blocker's side effect. The room note itself is posted by the
 *  caller (it owns local note state); failures here should not lose the note. */
export async function runBlockerSideEffect(room: Room, blocker: RoomBlocker, time?: string): Promise<void> {
  if (blocker.sideEffect === "work_order") {
    await createWorkOrder({
      room_id: room.id,
      title: `Deep vacuum and change filter — Room ${room.room_number}`,
      description: `Auto-created from housekeeping flag: ${buildBlockerNote(blocker, time)}`,
      category: "general",
      priority: "low",
    });
    return;
  }
  if (blocker.sideEffect === "ozone_task") {
    await api.post("/tasks", {
      title: `Ozone treatment — Room ${room.room_number}`,
      description:
        `${buildBlockerNote(blocker, time)}. For the supervisor or houseman on shift.`,
      task_type: "housekeeping",
      priority: "normal",
      room_id: room.id,
    });
    return;
  }
  if (blocker.sideEffect === "frontdesk_task") {
    await api.post("/tasks", {
      title: `Confirm late checkout — Room ${room.room_number} (guest says ${time?.trim() || "?"})`,
      description:
        "Guest told housekeeping they have a late checkout. Front desk: confirm or correct the checkout time.",
      task_type: "general",
      priority: "normal",
      room_id: room.id,
    });
  }
}
