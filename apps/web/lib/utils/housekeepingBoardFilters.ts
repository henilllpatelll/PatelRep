import type { CleanType } from './cleanType'
import { getEffectiveRoomStatusForCleanType } from './cleanType'

export type CleanTypeFilter = CleanType[]

export interface HousekeepingBoardFilterOptions {
  statusFilter: string | null
  cleanTypeFilter: CleanTypeFilter
  showRiskOnly: boolean
  predictions: Record<string, any>
}

export function getHousekeepingBoardFilterCounts(rooms: any[]) {
  const statusCounts = rooms.reduce<Record<string, number>>((acc, room) => {
    const status = room.status || 'DIRTY'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})

  const cleanTypeCounts = rooms.reduce<Record<CleanType, number>>((acc, room) => {
    const cleanType = room.clean_type as CleanType | null | undefined
    if (cleanType === 'DEP' || cleanType === 'FULL' || cleanType === 'LIGHT') {
      acc[cleanType] = (acc[cleanType] || 0) + 1
    }
    return acc
  }, { DEP: 0, FULL: 0, LIGHT: 0 })

  return { statusCounts, cleanTypeCounts }
}

export function normalizeHousekeepingBoardRoom(room: any): any {
  const cleanType = room.clean_type
    ?? (room.status === 'DIRTY' && room.fo_status === 'OCC' ? 'DEP' : null)
  const status = getEffectiveRoomStatusForCleanType(
    room.status,
    cleanType,
    room.fo_status,
  )
  if (status === room.status && cleanType === room.clean_type) return room
  return { ...room, clean_type: cleanType, status }
}

export function filterHousekeepingBoardRooms(
  rooms: any[],
  options: HousekeepingBoardFilterOptions,
): any[] {
  const { statusFilter, cleanTypeFilter, showRiskOnly, predictions } = options
  let result = rooms

  if (statusFilter !== null) {
    result = result.filter((room: any) => room.status === statusFilter)
  }

  if (cleanTypeFilter.length > 0) {
    result = result.filter((room: any) => cleanTypeFilter.includes(room.clean_type))
  }

  if (showRiskOnly) {
    result = result.filter((room: any) => {
      const pred = predictions[room.room_id] ?? room.prediction
      return pred?.risk_level === 'HIGH' || pred?.risk_level === 'MEDIUM'
    })
  }

  return result
}
