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
import { StatusDot } from '@/components/ui/primitives'

// -- Status chip config --------------------------------------------------------

interface StatusChip {
  key: string | null
  label: string
  dotTone: string
}

const STATUS_CHIPS: StatusChip[] = [
  { key: null,          label: 'All',          dotTone: 'neutral' },
  { key: 'DIRTY',       label: 'Vacant Dirty', dotTone: 'dirty' },
  { key: 'IN_PROGRESS', label: 'In Progress',  dotTone: 'progress' },
  { key: 'CLEAN',       label: 'Clean ready for inspection', dotTone: 'clean' },
  { key: 'INSPECTED',   label: 'Ready',        dotTone: 'ready' },
  { key: 'PICKUP',      label: 'Pickup',       dotTone: 'pickup' },
  { key: 'OOO',         label: 'OOO/OOS',      dotTone: 'ooo' },
]

// -- Skeleton loader -----------------------------------------------------------

function SkeletonGrid() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-40 bg-surface-3 rounded animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-[116px] bg-surface-3 rounded-[var(--r-lg)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}

// -- Status filter chips -------------------------------------------------------

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
      <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {STATUS_CHIPS.map((chip) => {
          const count = chip.key === null ? rooms.length : (counts[chip.key] ?? 0)
          const isActive = statusFilter === chip.key
          return (
            <button
              key={chip.key ?? 'all'}
              onClick={() => onFilter(chip.key)}
              aria-pressed={isActive}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-full border transition-colors ${
                isActive
                  ? 'bg-ink text-paper border-ink font-medium'
                  : 'bg-surface border border-line text-ink2 hover:bg-surface-2'
              }`}
            >
              <StatusDot tone={chip.dotTone} size={7} />
              {chip.label}
              <span className="font-mono font-semibold text-[11px] opacity-70">{count}</span>
            </button>
          )
        })}

        {/* At Risk toggle chip */}
        {onToggleRisk && (
          <button
            onClick={onToggleRisk}
            aria-pressed={showRiskOnly}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-[6px] rounded-full text-xs font-medium transition-colors border ${
              showRiskOnly
                ? 'bg-[var(--ai)] text-white border-[var(--ai)]'
                : 'bg-[var(--ai-soft)] text-[var(--ai)] border-[var(--ai-line)] hover:opacity-90'
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
            </svg>
            At risk
            <span className="font-mono font-bold text-[11px]">{riskCount ?? 0}</span>
          </button>
        )}
      </div>
      <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-paper to-transparent" />
    </div>
  )
}

// -- Main component -----------------------------------------------------------

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

  // -- Staff name lookup -------------------------------------------------------
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

  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyRoomStatusPayload = useCallback((payload: any) => {
    const row = payload?.new
    if (!row?.room_id) return
    const { assigned_to: _assignedTo, ...statusRow } = row

    const mergeRoom = (room: any) =>
      room.room_id === row.room_id
        ? { ...room, ...statusRow, rooms: room.rooms, prediction: room.prediction }
        : room

    setRooms(useHousekeepingStore.getState().rooms.map(mergeRoom))
    queryClient.setQueryData(
      ['housekeeping-board', selectedDate, selectedShift],
      (old: any) => old?.data ? { ...old, data: old.data.map(mergeRoom) } : old,
    )
    setSelectedRoom((prev: any) => prev?.room_id === row.room_id ? mergeRoom(prev) : prev)
    setLastSyncedAt(new Date())
  }, [queryClient, selectedDate, selectedShift, setLastSyncedAt, setRooms])

  // -- React Query fetch -------------------------------------------------------
  const { isLoading, isError, data: boardData } = useQuery({
    queryKey: ['housekeeping-board', selectedDate, selectedShift],
    queryFn: () => housekeepingApi.getBoard(selectedDate, selectedShift ?? undefined, true),
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
    setSelectedRoom((prev: any) => {
      if (!prev) return prev
      return rooms.find((r: any) => r.room_id === prev.room_id) ?? prev
    })
  }, [boardData, setLastSyncedAt, setPredictions, setRooms])

  // -- Supabase Realtime subscription ------------------------------------------
  useEffect(() => {
    const invalidateBoard = () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      realtimeDebounce.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
        queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
      }, 500)
    }

    if (!hotelId) return
    if (session?.access_token) supabase.realtime.setAuth(session.access_token)

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
  }, [applyRoomStatusPayload, hotelId, queryClient, selectedDate, selectedShift, session?.access_token, supabase])

  // -- Status change handler ---------------------------------------------------
  const handleStatusChange = async (roomId: string, status: string) => {
    if (status === '__remove_assignment') {
      removePendingAssignment(roomId)
      return
    }
    setSelectedRoom((prev: any) => prev?.room_id === roomId ? { ...prev, status } : prev)
    await housekeepingApi.updateRoomStatus(roomId, status)
    queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
    queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
  }

  // -- Tap-to-assign -----------------------------------------------------------
  const handleTapAssign = useCallback((roomId: string) => {
    if (!activeAssigneeId) return
    if (pendingAssignments[roomId] === activeAssigneeId) {
      setAssignError('Room already added to this housekeeper')
      setTimeout(() => setAssignError(null), 3000)
      return
    }
    const roomData = allRooms.find((r: any) => r.room_id === roomId)
    if (roomData?.assigned_to === activeAssigneeId) {
      setAssignError('Room is already assigned to this housekeeper')
      setTimeout(() => setAssignError(null), 3000)
      return
    }
    setAssignError(null)
    setPendingAssignment(roomId, activeAssigneeId)
  }, [activeAssigneeId, pendingAssignments, allRooms, setPendingAssignment])

  // -- Derived data ------------------------------------------------------------
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
  const byFloor = rooms.reduce<Record<number, any[]>>((acc, room) => {
    const floor: number = room.rooms?.floor ?? 0
    if (!acc[floor]) acc[floor] = []
    acc[floor].push(room)
    return acc
  }, {})
  const sortedFloors = Object.keys(byFloor).map(Number).sort((a, b) => a - b)

  // -- Render ------------------------------------------------------------------
  if (isLoading) return <SkeletonGrid />

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3 text-sm">
        <p className="text-[13px] text-ink3">Failed to load rooms.</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })}
          className="px-4 py-2 bg-accent text-white rounded-[var(--r-md)] text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Status filter chips */}
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
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-[var(--alert-soft)] border border-[var(--alert-line)] text-sm text-[var(--alert)]">
          <span>{assignError}</span>
          <button
            onClick={() => setAssignError(null)}
            className="shrink-0 font-medium"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* Floor-grouped grid */}
      {sortedFloors.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-[13px] text-ink3">
          No rooms match the current filters
        </div>
      ) : (
        <div className="space-y-8">
          {sortedFloors.map((floor) => {
            const floorRooms = byFloor[floor]
            return (
              <div key={floor}>
                {/* Floor divider header */}
                <div className="flex items-baseline gap-3 mb-3 pb-2 border-b border-dashed border-line-2">
                  <h3 className="font-display text-[20px] font-normal text-ink tracking-[-0.2px]">
                    {floor === 0 ? 'Ground Floor' : `Floor ${floor}`}
                  </h3>
                  <span className="font-mono text-[11px] text-ink3">
                    {floorRooms.length} room{floorRooms.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
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
