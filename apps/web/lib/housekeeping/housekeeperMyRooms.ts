import {
  compareHousekeepingExecutionOrder,
  type HousekeepingOperationalRoom,
} from './roomState'

export interface HousekeeperMyRoomsView {
  upNext: HousekeepingOperationalRoom | null
  active: HousekeepingOperationalRoom[]
  toDo: HousekeepingOperationalRoom[]
  reclean: HousekeepingOperationalRoom[]
  blocked: HousekeepingOperationalRoom[]
  done: HousekeepingOperationalRoom[]
  counts: { toDo: number; cleaning: number; done: number; reclean: number }
}

function isCompleted(room: HousekeepingOperationalRoom): boolean {
  return room.housekeepingStatus === 'CLEAN' || room.housekeepingStatus === 'INSPECTED'
}

function isBlocked(room: HousekeepingOperationalRoom): boolean {
  return room.dnd
    || room.serviceDeclined
    || room.hasOpenBlockingWorkOrder
    || room.occupancyDiscrepancy
    || ['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.housekeepingStatus)
}

function roomNumberOrder(left: HousekeepingOperationalRoom, right: HousekeepingOperationalRoom): number {
  return left.roomNumber.localeCompare(right.roomNumber, undefined, { numeric: true })
}

/**
 * A deliberately small work queue for the person cleaning rooms. It groups
 * blocked/completed work away from the next action, while using the same
 * urgency comparator as Team Plan for every actionable stop.
 */
export function buildHousekeeperMyRoomsView(
  rooms: HousekeepingOperationalRoom[],
  now: Date = new Date(),
): HousekeeperMyRoomsView {
  const active = rooms.filter((room) => room.housekeepingStatus === 'IN_PROGRESS').sort(roomNumberOrder)
  const completed = rooms.filter(isCompleted).sort(roomNumberOrder)
  const blocked = rooms.filter((room) => !isCompleted(room) && room.housekeepingStatus !== 'IN_PROGRESS' && isBlocked(room))
    .sort((left, right) => compareHousekeepingExecutionOrder(left, right, now))
  const actionable = rooms
    .filter((room) => !isCompleted(room) && room.housekeepingStatus !== 'IN_PROGRESS' && !isBlocked(room))
    .sort((left, right) => compareHousekeepingExecutionOrder(left, right, now))
  const upNext = actionable[0] ?? null
  const remaining = actionable.slice(1)
  const reclean = remaining.filter((room) => room.recleanRequired)
  const toDo = remaining.filter((room) => !room.recleanRequired)

  return {
    upNext,
    active,
    toDo,
    reclean,
    blocked,
    done: completed,
    counts: {
      toDo: actionable.filter((room) => !room.recleanRequired).length,
      cleaning: active.length,
      done: completed.length,
      reclean: actionable.filter((room) => room.recleanRequired).length,
    },
  }
}
