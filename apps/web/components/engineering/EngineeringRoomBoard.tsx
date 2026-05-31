'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Loader2, AlertCircle } from 'lucide-react'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { RoomCard } from '@/components/housekeeping/RoomCard'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { StatusDot } from '@/components/ui/primitives'
import { normalizeHousekeepingBoardRoom } from '@/lib/utils/housekeepingBoardFilters'

type FilterMode = 'all' | 'vacant' | 'ai'

function filterRooms(rooms: any[], mode: FilterMode): any[] {
  if (mode === 'vacant') return rooms.filter((r) => r.fo_status === 'VAC')
  if (mode === 'ai') return rooms.filter((r) => {
    const risk = r.prediction?.risk_level
    return risk === 'HIGH' || risk === 'MEDIUM'
  })
  return rooms
}

export function EngineeringRoomBoard() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['eng-room-board', today],
    queryFn: () => housekeepingApi.getBoard(today, undefined, true),
    refetchInterval: 60_000,
  })

  const allRooms = useMemo(() => {
    const raw = (data as any)?.data ?? []
    return raw.map((r: any) => normalizeHousekeepingBoardRoom(r))
  }, [data])

  const rooms = useMemo(() => filterRooms(allRooms, filter), [allRooms, filter])
  const vacantCount = useMemo(() => filterRooms(allRooms, 'vacant').length, [allRooms])
  const aiCount = useMemo(() => filterRooms(allRooms, 'ai').length, [allRooms])

  const byFloor = rooms.reduce<Record<number, any[]>>((acc, room) => {
    const floor: number = room.rooms?.floor ?? 0
    if (!acc[floor]) acc[floor] = []
    acc[floor].push(room)
    return acc
  }, {})
  const sortedFloors = Object.keys(byFloor).map(Number).sort((a, b) => a - b)

  const chipClass = (active: boolean) =>
    `shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-full border transition-colors ${
      active
        ? 'bg-ink text-paper border-ink font-medium'
        : 'bg-surface border border-line text-ink2 hover:bg-surface-2'
    }`

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-sm text-ink3">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading rooms…
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-sm">
        <AlertCircle className="w-5 h-5 text-[var(--alert)]" />
        <p className="text-[13px] text-ink3">Failed to load rooms.</p>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-accent text-white rounded-[var(--r-md)] text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        <button
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          className={chipClass(filter === 'all')}
        >
          <StatusDot tone="neutral" size={7} />
          All
          <span className="font-mono font-semibold text-[11px] opacity-70">{allRooms.length}</span>
        </button>

        <button
          onClick={() => setFilter('vacant')}
          aria-pressed={filter === 'vacant'}
          className={chipClass(filter === 'vacant')}
        >
          <StatusDot tone="dirty" size={7} />
          Vacant
          <span className="font-mono font-semibold text-[11px] opacity-70">{vacantCount}</span>
        </button>

        <button
          onClick={() => setFilter('ai')}
          aria-pressed={filter === 'ai'}
          disabled={aiCount === 0}
          className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-default ${
            filter === 'ai'
              ? 'bg-[var(--ai)] text-white border-[var(--ai)]'
              : 'bg-[var(--ai-soft)] text-[var(--ai)] border-[var(--ai-line)] hover:opacity-90'
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" />
          </svg>
          AI risk
          <span className="font-mono font-bold text-[11px]">{aiCount}</span>
        </button>
      </div>

      {/* Floor-grouped grid */}
      {sortedFloors.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-[13px] text-ink3">
          No rooms match the current filter
        </div>
      ) : (
        <div className="space-y-8">
          {sortedFloors.map((floor) => {
            const floorRooms = byFloor[floor]
            return (
              <div key={floor}>
                <div className="flex items-baseline gap-3 mb-3 pb-2 border-b border-dashed border-line-2">
                  <h3 className="font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">
                    {floor === 0 ? 'Ground Floor' : `Floor ${floor}`}
                  </h3>
                  <span className="font-mono text-[11px] text-ink3">
                    {floorRooms.length} room{floorRooms.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
                  {floorRooms.map((room) => (
                    <RoomCard
                      key={room.room_id}
                      room={room}
                      assignmentMode={false}
                      onOpenDetail={() => setSelectedRoom(room)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <RoomDetailDrawer
        room={selectedRoom}
        isOpen={selectedRoom !== null}
        onClose={() => setSelectedRoom(null)}
        onCheckoutTimeSaved={(time) =>
          setSelectedRoom((prev: any) => (prev ? { ...prev, checkout_time: time } : prev))
        }
      />
    </div>
  )
}
