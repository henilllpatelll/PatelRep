import {
  deriveRoomAttentionItems,
  getHousekeepingRoomMetrics,
  getRoomWorkloadCredits,
  type HousekeepingAttentionCode,
  type HousekeepingOperationalRoom,
} from './roomState'
import type { CleanType } from '@/lib/utils/cleanType'

export type BoardStatusFilter = 'needs_action' | 'dirty' | 'cleaning' | 'inspect' | 'ready' | 'ooo'
  | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO'

export interface BoardViewFilters {
  status: BoardStatusFilter | null
  building: string | null
  floor: number | null
  assigneeId: string | null
  cleanTypes: CleanType[]
  search: string
  attention: HousekeepingAttentionCode | 'service_issue' | null
  unassignedOnly: boolean
}

export interface BoardKpis {
  needsCleaning: number
  needsCleaningCredits: number
  inProgress: number
  inspection: number
  inspectionPriority: number
  ready: number
  outOfOrder: number
  outOfOrderArrivalConflict: number
}

export interface AttentionSummaryItem {
  code: HousekeepingAttentionCode | 'service_issue'
  count: number
}

const OUT_OF_ORDER = new Set(['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'])
const NEEDS_CLEANING = new Set(['DIRTY', 'PICKUP', 'OCCUPIED'])

function isNeedsCleaning(room: HousekeepingOperationalRoom): boolean {
  return NEEDS_CLEANING.has(room.housekeepingStatus)
}

function matchesStatus(room: HousekeepingOperationalRoom, status: BoardStatusFilter | null): boolean {
  if (!status) return true
  switch (status) {
    case 'needs_action':
      return deriveRoomAttentionItems(room).length > 0
    case 'dirty':
      return isNeedsCleaning(room)
    case 'cleaning':
    case 'IN_PROGRESS': return room.housekeepingStatus === 'IN_PROGRESS'
    case 'inspect':
    case 'CLEAN': return room.housekeepingStatus === 'CLEAN'
    case 'ready':
    case 'INSPECTED': return room.housekeepingStatus === 'INSPECTED'
    case 'ooo':
    case 'OOO': return OUT_OF_ORDER.has(room.housekeepingStatus)
  }
}

function matchesAttention(room: HousekeepingOperationalRoom, attention: BoardViewFilters['attention']): boolean {
  if (!attention) return true
  if (attention === 'service_issue') return room.dnd || room.serviceDeclined
  return deriveRoomAttentionItems(room).some((item) => item.code === attention)
}

/**
 * The room-board filter pipeline is intentionally data-only, so KPI tiles,
 * quick filters, attention, and URL state cannot quietly diverge in JSX.
 */
export function filterHousekeepingBoardView(
  rooms: HousekeepingOperationalRoom[],
  filters: BoardViewFilters,
  staffNames: Record<string, string> = {},
): HousekeepingOperationalRoom[] {
  const needle = filters.search.trim().toLocaleLowerCase()
  return rooms.filter((room) => {
    if (!matchesStatus(room, filters.status)) return false
    if (filters.building && room.building !== filters.building) return false
    if (filters.floor !== null && room.floor !== filters.floor) return false
    if (filters.assigneeId && room.assignedHousekeeperId !== filters.assigneeId) return false
    if (filters.unassignedOnly && room.assignmentState !== 'unassigned') return false
    if (filters.cleanTypes.length > 0 && (!room.cleanType || !filters.cleanTypes.includes(room.cleanType))) return false
    if (!matchesAttention(room, filters.attention)) return false
    if (!needle) return true
    const assignee = room.assignedHousekeeperId ? staffNames[room.assignedHousekeeperId] ?? '' : ''
    return room.roomNumber.toLocaleLowerCase().includes(needle) || assignee.toLocaleLowerCase().includes(needle)
  })
}

export function getBoardKpis(rooms: HousekeepingOperationalRoom[]): BoardKpis {
  const metrics = getHousekeepingRoomMetrics(rooms)
  return {
    needsCleaning: rooms.filter(isNeedsCleaning).length,
    needsCleaningCredits: rooms
      .filter(isNeedsCleaning)
      .reduce((total, room) => total + getRoomWorkloadCredits(room), 0),
    inProgress: metrics.inProgress,
    // The supervisor queue must surface every CLEAN room. Sampling is useful
    // for reporting metrics, but it must not hide a room from inspection.
    inspection: rooms.filter((room) => room.housekeepingStatus === 'CLEAN').length,
    inspectionPriority: rooms.filter((room) => room.housekeepingStatus === 'CLEAN' && (room.isVip || (room.priority !== null && room.priority <= 2))).length,
    ready: metrics.ready,
    outOfOrder: metrics.outOfOrder,
    outOfOrderArrivalConflict: deriveAttentionCount(rooms, 'ooo_arrival_conflict'),
  }
}

function deriveAttentionCount(rooms: HousekeepingOperationalRoom[], code: HousekeepingAttentionCode): number {
  return rooms.filter((room) => deriveRoomAttentionItems(room).some((item) => item.code === code)).length
}

export function getAttentionSummary(rooms: HousekeepingOperationalRoom[]): AttentionSummaryItem[] {
  const categories: AttentionSummaryItem['code'][] = [
    'dnd',
    'dnd_welfare_escalation',
    'return_later_due',
    'service_issue',
    'rush',
    'arrival_risk',
    'failed_inspection',
    'reclean',
    'occupancy_discrepancy',
    'ooo_arrival_conflict',
    'unassigned_priority_room',
    'open_blocking_work_order',
  ]
  return categories.map((code) => ({
    code,
    count: code === 'service_issue'
      ? rooms.filter((room) => room.serviceDeclined && !room.dnd).length
      : deriveAttentionCount(rooms, code),
  })).filter((item) => item.count > 0)
}
