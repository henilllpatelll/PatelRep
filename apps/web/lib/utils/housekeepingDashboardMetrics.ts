export interface HousekeepingDashboardRoom {
  room_id?: string | null
  status?: string | null
  assigned_to?: string | null
}

export interface HousekeepingDashboardMetrics {
  totalRooms: number
  remaining: number
  done: number
  inspectNow: number
  assignedTotal: number
  inspected: number
  cleanPending: number
  inspectedPct: number
}

const HOUSEKEEPER_ROOM_PRIORITY: Record<string, number> = {
  IN_PROGRESS: 0,
  DIRTY: 1,
  PICKUP: 2,
  CLEAN: 3,
  INSPECTED: 4,
}

function getBoardRows(boardData: unknown): HousekeepingDashboardRoom[] | null {
  const data = (boardData as { data?: unknown } | undefined)?.data
  return Array.isArray(data) ? data as HousekeepingDashboardRoom[] : null
}

function getResponseRows(response: unknown): HousekeepingDashboardRoom[] {
  const data = (response as { data?: unknown } | undefined)?.data
  return Array.isArray(data) ? data as HousekeepingDashboardRoom[] : []
}

function getSummaryCount(
  breakdown: Record<string, number | undefined>,
  status: string,
): number {
  return breakdown[status] ?? 0
}

export function getSupervisorHousekeepingMetrics(
  boardData: unknown,
  fallbackBreakdown: Record<string, number | undefined> = {},
): HousekeepingDashboardMetrics {
  const boardRows = getBoardRows(boardData)
  const hasBoardRows = boardRows !== null

  const totalRooms = hasBoardRows
    ? boardRows.length
    : Object.values(fallbackBreakdown).reduce<number>((sum, count) => sum + (count ?? 0), 0)
  const assignedTotal = hasBoardRows
    ? boardRows.filter((room) => !!room.assigned_to).length
    : 0
  const inspected = hasBoardRows
    ? boardRows.filter((room) => room.status === 'INSPECTED').length
    : getSummaryCount(fallbackBreakdown, 'INSPECTED')
  const cleanPending = hasBoardRows
    ? boardRows.filter((room) => room.status === 'CLEAN').length
    : getSummaryCount(fallbackBreakdown, 'CLEAN')
  const inspectedPct = assignedTotal > 0 ? Math.round((inspected / assignedTotal) * 100) : 0

  return {
    totalRooms,
    remaining: boardRows?.filter((room) => room.status === 'DIRTY' || room.status === 'IN_PROGRESS' || room.status === 'PICKUP').length ?? 0,
    done: inspected,
    inspectNow: cleanPending,
    assignedTotal,
    inspected,
    cleanPending,
    inspectedPct,
  }
}

export function getHousekeeperDashboardRooms(
  myRoomsResponse: unknown,
  boardData: unknown,
  userId?: string | null,
): HousekeepingDashboardRoom[] {
  const myRooms = getResponseRows(myRoomsResponse)
  const rooms = myRooms.length > 0
    ? myRooms
    : getResponseRows(boardData).filter((room) => !!userId && room.assigned_to === userId)

  return [...rooms].sort((a, b) => {
    return (HOUSEKEEPER_ROOM_PRIORITY[a.status ?? ''] ?? 5) -
      (HOUSEKEEPER_ROOM_PRIORITY[b.status ?? ''] ?? 5)
  })
}

export function getHousekeeperDashboardMetrics(
  rooms: HousekeepingDashboardRoom[],
): Pick<HousekeepingDashboardMetrics, 'totalRooms' | 'remaining' | 'done' | 'inspectNow'> {
  return {
    totalRooms: rooms.length,
    remaining: rooms.filter((room) => room.status === 'DIRTY' || room.status === 'IN_PROGRESS' || room.status === 'PICKUP').length,
    done: rooms.filter((room) => room.status === 'INSPECTED').length,
    inspectNow: rooms.filter((room) => room.status === 'CLEAN').length,
  }
}
