'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { staffApi } from '@/lib/api/staff'
import { RoomCard } from '@/components/housekeeping/RoomCard'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { createClient } from '@/lib/supabase/client'
import { STATUS_BG } from '@/lib/utils/roomStatus'

// ── Status chip config ────────────────────────────────────────────────────────

interface StatusChip {
  key: string | null
  label: string
  activeBg: string
  activeText: string
  inactiveBg: string
}

const STATUS_CHIPS: StatusChip[] = [
  {
    key: null,
    label: 'All',
    activeBg: 'bg-gray-800',
    activeText: 'text-white',
    inactiveBg: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
  },
  {
    key: 'DIRTY',
    label: 'Dirty',
    activeBg: 'bg-red-600',
    activeText: 'text-white',
    inactiveBg: 'bg-red-50 text-red-700 hover:bg-red-100',
  },
  {
    key: 'IN_PROGRESS',
    label: 'In Progress',
    activeBg: 'bg-blue-600',
    activeText: 'text-white',
    inactiveBg: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
  },
  {
    key: 'CLEAN',
    label: 'To Inspect',
    activeBg: 'bg-green-600',
    activeText: 'text-white',
    inactiveBg: 'bg-green-50 text-green-700 hover:bg-green-100',
  },
  {
    key: 'INSPECTED',
    label: 'Ready',
    activeBg: 'bg-emerald-600',
    activeText: 'text-white',
    inactiveBg: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  },
  {
    key: 'OOO',
    label: 'OOO',
    activeBg: 'bg-gray-600',
    activeText: 'text-white',
    inactiveBg: 'bg-gray-100 text-gray-600 hover:bg-gray-200',
  },
]

// ── Skeleton loader ───────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] bg-gray-200 rounded-2xl animate-pulse" />
        ))}
      </div>
    </div>
  )
}

// ── Status summary bar ────────────────────────────────────────────────────────

interface SummaryBarProps {
  rooms: any[]
  statusFilter: string | null
  onFilter: (status: string | null) => void
  showRiskOnly?: boolean
  onToggleRisk?: () => void
  riskCount?: number
}

function StatusSummaryBar({ rooms, statusFilter, onFilter, showRiskOnly, onToggleRisk, riskCount }: SummaryBarProps) {
  const counts = rooms.reduce<Record<string, number>>((acc, r) => {
    const s = r.status || 'DIRTY'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  return (
    <div className="relative mb-4">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {STATUS_CHIPS.map((chip) => {
        const count = chip.key === null ? rooms.length : (counts[chip.key] ?? 0)
        const isActive = statusFilter === chip.key
        const chipBg = chip.key ? (STATUS_BG[chip.key] ?? undefined) : undefined
        return (
          <button
            key={chip.key ?? 'all'}
            onClick={() => onFilter(chip.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              isActive
                ? `${chip.activeBg} ${chip.activeText}`
                : chip.inactiveBg
            }`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={
                chip.key && !isActive
                  ? { backgroundColor: STATUS_BG[chip.key] ?? '#9CA3AF' }
                  : { backgroundColor: isActive ? 'rgba(255,255,255,0.8)' : '#9CA3AF' }
              }
            />
            {chip.label}
            <span className={`font-bold ${isActive ? 'opacity-90' : ''}`}>{count}</span>
          </button>
        )
      })}

      {/* At Risk toggle chip */}
      {onToggleRisk && (
        <button
          onClick={onToggleRisk}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            showRiskOnly
              ? 'bg-orange-500 text-white'
              : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
          }`}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: showRiskOnly ? 'rgba(255,255,255,0.8)' : '#f97316' }}
          />
          At Risk
          <span className={`font-bold ${showRiskOnly ? 'opacity-90' : ''}`}>{riskCount ?? 0}</span>
        </button>
      )}
      </div>
      {/* Fade hint — signals horizontal scroll when chips overflow */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-white to-transparent" />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

export function RoomStatusBoard() {
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const session = useAuthStore((s) => s.session)
  const hotelId = getHotelIdFromToken(session?.access_token)

  const {
    filteredRooms,
    rooms: allRooms,
    setRooms,
    setPredictions,
    setLastSyncedAt,
    pendingAssignments,
    assignmentMode,
    activeAssigneeId,
    setPendingAssignment,
    removePendingAssignment,
    selectedDate,
    selectedShift,
    statusFilter,
    setStatusFilter,
    showRiskOnly,
    toggleRiskOnly,
    predictions,
  } = useHousekeepingStore()

  const riskCount = useMemo(
    () => allRooms.filter((r: any) => {
      const pred = predictions[r.room_id] ?? r.prediction
      return pred?.risk_level === 'HIGH' || pred?.risk_level === 'MEDIUM'
    }).length,
    [allRooms, predictions],
  )

  // ── Staff name lookup (cache hit — same key as AssignmentSidebar) ─────────
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
  })
  const hkNameById = useMemo(() =>
    ((staffData?.data?.staff ?? []) as any[]).reduce<Record<string, string>>(
      (acc, s) => { acc[s.user_id] = s.full_name; return acc },
      {}
    ),
    [staffData]
  )

  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Debounce ref for realtime invalidation
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyRoomStatusPayload = useCallback((payload: any) => {
    const row = payload?.new
    if (!row?.room_id) return

    const mergeRoom = (room: any) =>
      room.room_id === row.room_id
        ? {
            ...room,
            ...row,
            rooms: room.rooms,
            prediction: room.prediction,
          }
        : room

    setRooms(useHousekeepingStore.getState().rooms.map(mergeRoom))
    queryClient.setQueryData(
      ['housekeeping-board', selectedDate, selectedShift],
      (old: any) => old?.data ? { ...old, data: old.data.map(mergeRoom) } : old,
    )
    setSelectedRoom((prev: any) => prev?.room_id === row.room_id ? mergeRoom(prev) : prev)
    setLastSyncedAt(new Date())
  }, [queryClient, selectedDate, selectedShift, setLastSyncedAt, setRooms])

  // ── React Query fetch ─────────────────────────────────────────────────────
  const { isLoading, isError, data: boardData } = useQuery({
    queryKey: ['housekeeping-board', selectedDate, selectedShift],
    queryFn: () => housekeepingApi.getBoard(
      selectedDate,
      selectedShift ?? undefined,
      true,
    ),
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (!boardData) return
    const rooms: any[] = (boardData as any)?.data ?? []
    setRooms(rooms)
    const preds = rooms
      .filter((r: any) => r.prediction != null)
      .map((r: any) => ({ ...r.prediction, room_id: r.room_id }))
    if (preds.length > 0) setPredictions(preds)
    setLastSyncedAt(new Date())
    // Sync the detail drawer with the freshest room data so status updates
    // are reflected immediately without needing a hard reload.
    setSelectedRoom((prev: any) => {
      if (!prev) return prev
      return rooms.find((r: any) => r.room_id === prev.room_id) ?? prev
    })
  }, [boardData, setLastSyncedAt, setPredictions, setRooms])

  // ── Supabase Realtime subscription ────────────────────────────────────────
  // Listens to both room_status (status changes) and room_assignments (new
  // assignments) so every device auto-refreshes when either changes.
  useEffect(() => {
    const invalidateBoard = () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      realtimeDebounce.current = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ['housekeeping-board', selectedDate, selectedShift],
        })
        queryClient.invalidateQueries({
          queryKey: ['housekeeping-assignments', selectedDate],
        })
      }, 500)
    }

    if (!hotelId) return
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token)
    }

    const channel = supabase
      .channel('room_status_board_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_status', filter: `tenant_id=eq.${hotelId}` }, (payload) => {
        applyRoomStatusPayload(payload)
        invalidateBoard()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments', filter: `tenant_id=eq.${hotelId}` }, invalidateBoard)
      .subscribe()

    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      supabase.removeChannel(channel)
    }
    // Re-subscribe when date/shift/tenant change
  }, [applyRoomStatusPayload, hotelId, queryClient, selectedDate, selectedShift, session?.access_token, supabase])

  // ── Status change handler ─────────────────────────────────────────────────
  const handleStatusChange = async (roomId: string, status: string) => {
    if (status === '__remove_assignment') {
      removePendingAssignment(roomId)
      return
    }
    await housekeepingApi.updateRoomStatus(roomId, status)
    queryClient.invalidateQueries({
      queryKey: ['housekeeping-board', selectedDate, selectedShift],
    })
    // Refresh history panel in the detail drawer if it's open for this room
    queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
  }

  // ── Tap-to-assign (mobile assign mode) ───────────────────────────────────
  const handleTapAssign = useCallback((roomId: string) => {
    if (!activeAssigneeId) return

    // Already pending for this housekeeper
    if (pendingAssignments[roomId] === activeAssigneeId) {
      setAssignError('Room already added to this housekeeper')
      setTimeout(() => setAssignError(null), 3000)
      return
    }

    const roomData = allRooms.find((r: any) => r.room_id === roomId)

    // Already assigned in DB to this housekeeper
    if (roomData?.assigned_to === activeAssigneeId) {
      setAssignError('Room is already assigned to this housekeeper')
      setTimeout(() => setAssignError(null), 3000)
      return
    }

    // Reassigning from a different housekeeper — add to pending directly;
    // the sidebar's strikethrough display lets the supervisor review before saving.
    setAssignError(null)
    setPendingAssignment(roomId, activeAssigneeId)
  }, [activeAssigneeId, pendingAssignments, allRooms, setPendingAssignment])

  // ── Derived data ──────────────────────────────────────────────────────────
  // Maps roomId → housekeeper name for rooms already assigned to someone OTHER
  // than the active assignee, so RoomCard can show the dimmed "already assigned" state.
  const roomAssignedNames = useMemo(() =>
    allRooms.reduce<Record<string, string>>((acc, r: any) => {
      if (r.room_id && r.assigned_to && r.assigned_to !== activeAssigneeId) {
        acc[r.room_id] = hkNameById[r.assigned_to] ?? 'another housekeeper'
      }
      return acc
    }, {}),
    [allRooms, activeAssigneeId, hkNameById]
  )

  const rooms = filteredRooms()

  // Group by floor
  const byFloor = rooms.reduce<Record<number, any[]>>((acc, room) => {
    const floor: number = room.rooms?.floor ?? 0
    if (!acc[floor]) acc[floor] = []
    acc[floor].push(room)
    return acc
  }, {})

  const sortedFloors = Object.keys(byFloor)
    .map(Number)
    .sort((a, b) => a - b)

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return <SkeletonGrid />

  if (isError) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        Failed to load rooms. Please try refreshing.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Status summary bar */}
      <StatusSummaryBar
        rooms={allRooms}
        statusFilter={statusFilter}
        onFilter={setStatusFilter}
        showRiskOnly={showRiskOnly}
        onToggleRisk={toggleRiskOnly}
        riskCount={riskCount}
      />

      {/* Assign error banner */}
      {assignError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <span>{assignError}</span>
          <button
            onClick={() => setAssignError(null)}
            className="shrink-0 text-red-500 hover:text-red-700 font-medium"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floor-grouped grid */}
      {sortedFloors.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-sm text-gray-400">
          No rooms match the current filters
        </div>
      ) : (
        <div className="space-y-6">
          {sortedFloors.map((floor) => {
            const floorRooms = byFloor[floor]
            return (
              <div key={floor}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Floor {floor}{' '}
                  <span className="font-normal text-gray-400">
                    · {floorRooms.length} room{floorRooms.length !== 1 ? 's' : ''}
                  </span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {floorRooms.map((room) => (
                    <RoomCard
                      key={room.room_id}
                      room={room}
                      assignmentMode={assignmentMode}
                      onStatusChange={(roomId: string, newStatus: string) =>
                        handleStatusChange(roomId, newStatus)
                      }
                      onOpenDetail={() => setSelectedRoom(room)}
                      onAssign={assignmentMode ? handleTapAssign : undefined}
                      pendingAssignee={pendingAssignments[room.room_id] ?? null}
                      assignedToName={assignmentMode ? (roomAssignedNames[room.room_id] ?? null) : null}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Room detail drawer */}
      <RoomDetailDrawer
        room={selectedRoom}
        isOpen={selectedRoom !== null}
        onClose={() => setSelectedRoom(null)}
        onStatusChange={(roomId: string, newStatus: string) =>
          handleStatusChange(roomId, newStatus)
        }
        cleanQueue={allRooms.filter((r: any) => r.status === 'CLEAN')}
        onNextRoom={(next: any) => setSelectedRoom(next)}
      />
    </div>
  )
}
