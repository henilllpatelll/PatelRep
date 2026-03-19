'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { RoomCard } from '@/components/housekeeping/RoomCard'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { Card } from '@/components/ui/Card'
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
    label: 'Clean',
    activeBg: 'bg-yellow-500',
    activeText: 'text-white',
    inactiveBg: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100',
  },
  {
    key: 'INSPECTED',
    label: 'Inspected',
    activeBg: 'bg-green-600',
    activeText: 'text-white',
    inactiveBg: 'bg-green-50 text-green-700 hover:bg-green-100',
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
      <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-28 bg-gray-200 rounded-xl animate-pulse" />
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
}

function StatusSummaryBar({ rooms, statusFilter, onFilter }: SummaryBarProps) {
  const counts = rooms.reduce<Record<string, number>>((acc, r) => {
    const s = r.status || 'DIRTY'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-wrap gap-2 mb-4">
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
            style={isActive && chipBg ? { backgroundColor: chipBg, color: '#fff' } : undefined}
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
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function RoomStatusBoard() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  const {
    filteredRooms,
    setRooms,
    setPredictions,
    setLastSyncedAt,
    lastSyncedAt,
    pendingAssignments,
    assignmentMode,
    selectedDate,
    selectedShift,
    statusFilter,
    setStatusFilter,
  } = useHousekeepingStore()

  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)

  // Debounce ref for realtime invalidation
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── React Query fetch ─────────────────────────────────────────────────────
  const { isLoading, isError, data: boardData } = useQuery({
    queryKey: ['housekeeping-board', selectedDate, selectedShift],
    queryFn: () => housekeepingApi.getBoard(
      selectedDate,
      selectedShift ?? undefined,
      true,
    ),
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
  }, [boardData])

  // ── Supabase Realtime subscription ────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('room_status_board_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_status' },
        () => {
          if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
          realtimeDebounce.current = setTimeout(() => {
            queryClient.invalidateQueries({
              queryKey: ['housekeeping-board', selectedDate, selectedShift],
            })
          }, 500)
        },
      )
      .subscribe()

    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      supabase.removeChannel(channel)
    }
    // Re-subscribe when date/shift change
  }, [selectedDate, selectedShift]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status change handler ─────────────────────────────────────────────────
  const handleStatusChange = async (roomId: string, status: string) => {
    // Skip internal assignment-mode signals
    if (status === '__remove_assignment') return
    await housekeepingApi.updateRoomStatus(roomId, status)
    queryClient.invalidateQueries({
      queryKey: ['housekeeping-board', selectedDate, selectedShift],
    })
  }

  // ── Derived data ──────────────────────────────────────────────────────────
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

  // All rooms (unfiltered) for summary counts — pull directly from store
  const allRooms = useHousekeepingStore.getState().rooms

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
      />

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
                <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-8">
                  {floorRooms.map((room) => (
                    <RoomCard
                      key={room.room_id}
                      room={room}
                      assignmentMode={assignmentMode}
                      onStatusChange={(roomId: string, newStatus: string) =>
                        handleStatusChange(roomId, newStatus)
                      }
                      onOpenDetail={() => setSelectedRoom(room)}
                      pendingAssignee={pendingAssignments[room.room_id] ?? null}
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
      />
    </div>
  )
}
