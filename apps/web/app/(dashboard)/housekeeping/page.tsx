'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, addDays, parseISO } from 'date-fns'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { RoomStatusBoard } from '@/components/housekeeping/RoomStatusBoard'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { AssignmentSidebar } from '@/components/housekeeping/AssignmentSidebar'
import { PredictionPanel } from '@/components/housekeeping/PredictionPanel'
import { RoomPrediction, housekeepingApi } from '@/lib/api/housekeeping'
import { staffApi } from '@/lib/api/staff'
import { useAuth } from '@/lib/hooks/useAuth'
import { useRole } from '@/lib/hooks/useRole'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import {
  CLEAN_TYPE_OPTIONS,
  getEffectiveRoomStatusForCleanType,
  getCleanTypeShortLabel,
} from '@/lib/utils/cleanType'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Pill, StatusDot } from '@/components/ui/primitives'

// -- Shift options -------------------------------------------------------------

const SHIFTS = [
  { value: '', label: 'All Shifts' },
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
]

// -- Live sync badge -----------------------------------------------------------

function SyncBadge({ lastSyncedAt }: { lastSyncedAt: Date | null }) {
  const [label, setLabel] = useState('Never synced')

  useEffect(() => {
    function compute() {
      if (!lastSyncedAt) { setLabel('Never synced'); return }
      const diffMin = Math.floor((Date.now() - lastSyncedAt.getTime()) / 60_000)
      if (diffMin < 1) setLabel('synced just now')
      else if (diffMin === 1) setLabel('synced 1 min ago')
      else setLabel(`synced ${diffMin} min ago`)
    }
    compute()
    const interval = setInterval(compute, 30_000)
    return () => clearInterval(interval)
  }, [lastSyncedAt])

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ready)]">
      <span className={`w-2 h-2 rounded-full bg-ready shrink-0 ${lastSyncedAt ? 'animate-pulse' : ''}`} />
      Live &middot; {label}
    </span>
  )
}

// -- Housekeeper chip bar (mobile assign mode) --------------------------------

function HousekeeperBar() {
  const queryClient = useQueryClient()
  const {
    selectedDate,
    selectedShift,
    activeAssigneeId,
    setActiveAssignee,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    activeCleanType,
    setActiveCleanType,
    clearPendingAssignments,
  } = useHousekeepingStore()

  const [saveLoading, setSaveLoading] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
  })

  const housekeepers: any[] = (data?.data?.staff ?? [])
    .filter((s: any) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
    .map((s: any) => ({ housekeeper_id: s.user_id, name: s.full_name }))
  const pendingCount = Object.keys(pendingAssignments).length
  const hasPending = pendingCount > 0

  const handleSave = async () => {
    if (!hasPending) return
    setSaveLoading(true)
    try {
      await housekeepingApi.saveAssignments({
        date: selectedDate,
        shift_id: null,
        assignments: Object.entries(pendingAssignments)
          .filter(([roomId, housekeeperId]) => !!roomId && !!housekeeperId)
          .map(([roomId, housekeeperId]) => ({
            room_id: roomId,
            housekeeper_id: housekeeperId,
            clean_type: pendingAssignmentCleanTypes[roomId] ?? activeCleanType,
          })),
        is_ai_suggested: false,
      })
      clearPendingAssignments()
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['staff-list'] })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    } catch {
      // noop - sidebar shows error on desktop
    } finally {
      setSaveLoading(false)
    }
  }

  function getInitials(name: string) {
    return name.split(' ').slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
  }

  return (
    <div className="rounded-[var(--r-lg)] bg-surface border border-line shadow-sm p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink2">
          {activeAssigneeId
            ? <span className="text-[var(--caution)]">Tap rooms to assign</span>
            : 'Select a housekeeper:'}
        </p>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-[var(--ready)] font-medium">Saved</span>
          )}
          {hasPending && (
            <button
              onClick={handleSave}
              disabled={saveLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saveLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <>Save <span className="inline-flex items-center justify-center w-4 h-4 bg-white/20 rounded-full text-[10px] font-bold">{pendingCount}</span></>
              )}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-24 h-9 bg-surface-3 rounded-lg animate-pulse shrink-0" />
          ))}
        </div>
      ) : housekeepers.length === 0 ? (
        <p className="text-xs text-ink3">
          No housekeeper staff found.{' '}
          <Link href="/staff" prefetch={false} className="text-accent underline">Add staff</Link>
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-0.5 -mb-0.5">
          {housekeepers.map((hk) => {
            const isActive = activeAssigneeId === hk.housekeeper_id
            const initials = getInitials(hk.name)
            const assignedCount = pendingAssignments
              ? Object.values(pendingAssignments).filter((id) => id === hk.housekeeper_id).length
              : 0

            return (
              <button
                key={hk.housekeeper_id}
                onClick={() => setActiveAssignee(
                  isActive ? null : hk.housekeeper_id,
                  isActive ? null : hk.name,
                )}
                className={`flex items-center gap-2 shrink-0 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all select-none ${
                  isActive
                    ? 'bg-ink text-paper border-ink'
                    : 'bg-surface border-line text-ink2 hover:border-line-2'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    isActive ? 'bg-white/15 text-paper' : 'bg-[var(--caution-soft)] text-[var(--caution)]'
                  }`}
                >
                  {initials}
                </span>
                <span>{hk.name.split(' ')[0]}</span>
                {(hk.rooms_assigned > 0 || assignedCount > 0) && (
                  <span className={`text-[10px] px-1 py-0.5 rounded-full min-w-[18px] text-center ${
                    isActive ? 'bg-white/20 text-paper' : 'bg-surface-3 text-ink3'
                  }`}>
                    {hk.rooms_assigned + assignedCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 rounded-[var(--r-md)] bg-surface-2 p-1">
        {CLEAN_TYPE_OPTIONS.map((option) => {
          const selected = activeCleanType === option.value
          return (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={selected}
              onClick={() => setActiveCleanType(option.value)}
              className={`min-h-[36px] rounded-[var(--r-sm)] px-2 text-[11px] font-semibold transition-colors ${
                selected
                  ? 'bg-surface text-ink shadow-sm border border-line'
                  : 'text-ink3 hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// -- Housekeeper "my rooms" view ----------------------------------------------

function HousekeeperRoomItem({
  room,
  onAction,
  onUndo,
  onOpenDetail,
}: {
  room: any
  onAction: (roomId: string, status: string) => Promise<void>
  onUndo: (roomId: string) => Promise<void>
  onOpenDetail: (room: any) => void
}) {
  const [loading, setLoading] = useState(false)
  const [showHint] = useState(() => {
    if (typeof window === 'undefined') return false
    if (localStorage.getItem('hk-notes-hint-seen')) return false
    localStorage.setItem('hk-notes-hint-seen', '1')
    return true
  })
  const roomNumber = room.rooms?.room_number ?? '--'
  const roomType = room.rooms?.room_types?.name ?? ''
  const status: string = room.status ?? 'DIRTY'
  const vip = !!room.vip_flag
  const cleanTypeLabel = getCleanTypeShortLabel(room.clean_type)

  const statusConfig: Record<string, { label: string; pillClass: string }> = {
    DIRTY:      { label: 'Vacant Dirty',        pillClass: 'bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)]' },
    PICKUP:     { label: 'Pickup',              pillClass: 'bg-[var(--caution-soft)] text-[var(--caution)] border border-[var(--caution-line)]' },
    IN_PROGRESS:{ label: 'In Progress',         pillClass: 'bg-[var(--progress-soft)] text-[var(--progress)] border border-[var(--progress-line)]' },
    CLEAN:      { label: 'Clean ready for inspection', pillClass: 'bg-[var(--info-soft)] text-[var(--info)] border border-[var(--info-line)]' },
    INSPECTED:  { label: 'Inspected / Ready',   pillClass: 'bg-[var(--ready-soft)] text-[var(--ready)] border border-[var(--ready-line)]' },
    OOO:        { label: 'Out of Order / Out of Service', pillClass: 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)]' },
  }
  const cfg = statusConfig[status] ?? { label: status, pillClass: 'bg-surface-3 text-ink3 border border-line' }

  async function handle(newStatus: string, e: React.MouseEvent) {
    e.stopPropagation()
    setLoading(true)
    try { await onAction(room.room_id, newStatus) } finally { setLoading(false) }
  }

  async function handleUndo(e: React.MouseEvent) {
    e.stopPropagation()
    setLoading(true)
    try { await onUndo(room.room_id) } finally { setLoading(false) }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 p-4 bg-surface rounded-[var(--r-lg)] border border-line cursor-pointer active:bg-surface-2 transition-colors"
      onClick={() => onOpenDetail(room)}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono font-semibold text-base text-ink">Room {roomNumber}</span>
          {vip && (
            <Pill tone="accent" size="sm">VIP</Pill>
          )}
        </div>
        {roomType && <p className="text-xs text-ink3 font-mono">{roomType}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.pillClass}`}>
            {cfg.label}
          </span>
          {cleanTypeLabel && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-ink2 border border-line">
              {cleanTypeLabel}
            </span>
          )}
        </div>
        {showHint && <p className="text-xs text-ink3 mt-1">Tap for notes &amp; issues</p>}
      </div>

      <div className="shrink-0 text-right">
        {(status === 'DIRTY' || status === 'PICKUP') && (
          <button
            disabled={loading}
            onClick={(e) => handle('IN_PROGRESS', e)}
            className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? '...' : 'Start'}
          </button>
        )}
        {status === 'IN_PROGRESS' && (
          <div className="flex flex-col gap-1.5">
            <button
              disabled={loading}
              onClick={(e) => handle('CLEAN', e)}
              className="px-4 py-2 bg-[var(--ready)] text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? '...' : 'Done'}
            </button>
            <button
              disabled={loading}
              onClick={handleUndo}
              className="px-4 py-1.5 bg-surface border border-line text-ink2 text-xs font-semibold rounded-xl hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              Undo
            </button>
          </div>
        )}
        {status === 'CLEAN' && (
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-xs text-[var(--caution)] font-medium">
              Waiting for<br />supervisor
            </span>
            <button
              disabled={loading}
              onClick={handleUndo}
              className="px-3 py-1.5 bg-surface border border-line text-ink2 text-xs font-semibold rounded-xl hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              Undo
            </button>
          </div>
        )}
        {status === 'INSPECTED' && (
          <span className="text-sm text-[var(--ready)] font-semibold">Approved</span>
        )}
      </div>
    </div>
  )
}

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

function HousekeeperMyRoomsView() {
  const { user, session } = useAuth()
  const hotelId = getHotelIdFromToken(session?.access_token)
  const today = format(new Date(), 'yyyy-MM-dd')
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)

  const { data: boardData, isLoading } = useQuery({
    queryKey: ['housekeeping-board', today],
    queryFn: () => housekeepingApi.getBoard(today, undefined, false),
    refetchInterval: 10_000,
  })

  const allRooms: any[] = (boardData as any)?.data ?? []
  const myRooms = allRooms
    .filter((r: any) => r.assigned_to === user?.id)
    .sort((a: any, b: any) => {
      const priority: Record<string, number> = {
        IN_PROGRESS: 0, DIRTY: 1, PICKUP: 2, CLEAN: 3, INSPECTED: 4,
      }
      return (priority[a.status] ?? 5) - (priority[b.status] ?? 5)
    })

  const applyRoomStatusPayload = useCallback((payload: any) => {
    const row = payload?.new
    if (!row?.room_id) return
    const { assigned_to: _assignedTo, ...statusRow } = row
    const mergeRoom = (room: any) => {
      if (room.room_id !== row.room_id) return room
      return {
        ...room,
        ...statusRow,
        status: getEffectiveRoomStatusForCleanType(statusRow.status, room.clean_type),
      }
    }
    queryClient.setQueryData(['housekeeping-board', today], (old: any) => {
      if (!old?.data) return old
      return { ...old, data: (old.data as any[]).map(mergeRoom) }
    })
    setSelectedRoom((current: any | null) =>
      current?.room_id === row.room_id ? mergeRoom(current) : current,
    )
  }, [queryClient, today])

  useEffect(() => {
    if (!hotelId) return
    if (session?.access_token) supabase.realtime.setAuth(session.access_token)

    const invalidate = () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      realtimeDebounce.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['housekeeping-board', today] })
      }, 500)
    }

    const channel = supabase
      .channel('hk_my_rooms_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_status', filter: `tenant_id=eq.${hotelId}` }, (payload) => {
        applyRoomStatusPayload(payload)
        invalidate()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments', filter: `tenant_id=eq.${hotelId}` }, invalidate)
      .subscribe()
    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      supabase.removeChannel(channel)
    }
  }, [applyRoomStatusPayload, hotelId, queryClient, session?.access_token, supabase, today])

  async function handleAction(roomId: string, status: string) {
    queryClient.setQueryData(['housekeeping-board', today], (old: any) => {
      if (!old?.data) return old
      return { ...old, data: (old.data as any[]).map((r: any) => r.room_id === roomId ? { ...r, status } : r) }
    })
    setSelectedRoom((prev: any) => prev?.room_id === roomId ? { ...prev, status } : prev)
    try {
      await housekeepingApi.updateRoomStatus(roomId, status)
    } catch {
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', today] })
      return
    }
    queryClient.invalidateQueries({ queryKey: ['housekeeping-board', today] })
  }

  async function handleUndo(roomId: string) {
    try {
      const response: any = await housekeepingApi.undoRoomStatus(roomId)
      const nextStatus = response?.data?.status
      if (nextStatus) {
        queryClient.setQueryData(['housekeeping-board', today], (old: any) => {
          if (!old?.data) return old
          return { ...old, data: (old.data as any[]).map((r: any) => r.room_id === roomId ? { ...r, status: nextStatus } : r) }
        })
        setSelectedRoom((prev: any) => prev?.room_id === roomId ? { ...prev, status: nextStatus } : prev)
      }
    } finally {
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', today] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
    }
  }

  const todoCount = myRooms.filter((r: any) => r.status === 'DIRTY' || r.status === 'PICKUP').length
  const inProgressCount = myRooms.filter((r: any) => r.status === 'IN_PROGRESS').length
  const doneCount = myRooms.filter((r: any) => r.status === 'INSPECTED').length

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="font-display text-[32px] font-normal text-ink tracking-[-0.4px]">My Rooms</h1>
        <p className="text-sm text-ink3 mt-0.5">{format(new Date(), 'EEEE, MMMM d')}</p>
      </div>

      {myRooms.length > 0 && (
        <div className="flex gap-5 px-4 py-3 bg-surface rounded-[var(--r-lg)] border border-line text-sm">
          <span><strong className="font-display text-[var(--alert)]">{todoCount}</strong> <span className="text-ink3">to do</span></span>
          <span><strong className="font-display text-[var(--progress)]">{inProgressCount}</strong> <span className="text-ink3">in progress</span></span>
          <span><strong className="font-display text-[var(--ready)]">{doneCount}</strong> <span className="text-ink3">done</span></span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface-3 rounded-[var(--r-lg)] animate-pulse" />
          ))}
        </div>
      ) : myRooms.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-ink3">No rooms assigned to you today.</p>
          <p className="text-ink4 text-sm mt-1">Check with your supervisor.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {myRooms.map((room: any) => (
            <HousekeeperRoomItem
              key={room.room_id}
              room={room}
              onAction={handleAction}
              onUndo={handleUndo}
              onOpenDetail={setSelectedRoom}
            />
          ))}
        </div>
      )}
      <RoomDetailDrawer
        room={selectedRoom}
        isOpen={selectedRoom !== null}
        onClose={() => setSelectedRoom(null)}
        onStatusChange={handleAction}
        onUndoStatus={handleUndo}
      />
    </div>
  )
}

// -- Supervisor / GM board view -----------------------------------------------

function SupervisorHousekeepingPage() {
  const queryClient = useQueryClient()
  const { canAssignRooms } = useRole()
  const {
    selectedDate,
    selectedShift,
    assignmentMode,
    lastSyncedAt,
    activeCleanType,
    pendingAssignmentCleanTypes,
    rooms,
    setSelectedDate,
    setSelectedShift,
    toggleAssignmentMode,
    setLastSyncedAt,
  } = useHousekeepingStore()

  const [dragError, setDragError] = useState<string | null>(null)

  useEffect(() => {
    if (assignmentMode && !canAssignRooms) toggleAssignmentMode()
  }, [assignmentMode, canAssignRooms, toggleAssignmentMode])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const roomId = active.id as string
    const housekeeperId = over.data?.current?.housekeeperId as string | undefined
    if (!housekeeperId) return
    try {
      await housekeepingApi.saveAssignments({
        date: selectedDate,
        shift_id: null,
        assignments: [{ room_id: roomId, housekeeper_id: housekeeperId, clean_type: activeCleanType }],
        is_ai_suggested: false,
      })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
    } catch {
      setDragError('Failed to assign room. Please try again.')
    }
  }

  const [predictions, setPredictions] = useState<RoomPrediction[]>([])
  const [predictionsLoading, setPredictionsLoading] = useState(false)

  useEffect(() => {
    const fetchPredictions = async () => {
      setPredictionsLoading(true)
      try {
        const res = await housekeepingApi.getPredictions()
        setPredictions(res.data?.rooms || [])
        setLastSyncedAt(new Date())
      } catch {
        // silently fail - predictions are optional
      } finally {
        setPredictionsLoading(false)
      }
    }
    fetchPredictions()
  }, [selectedDate, setLastSyncedAt])

  const navigate = (delta: number) => {
    const current = parseISO(selectedDate)
    setSelectedDate(format(addDays(current, delta), 'yyyy-MM-dd'))
  }

  const displayRooms = useMemo(() =>
    rooms.map((room: any) => {
      const pendingCleanType = pendingAssignmentCleanTypes[room.room_id]
      const cleanType = pendingCleanType ?? room.clean_type
      const status = getEffectiveRoomStatusForCleanType(room.status, cleanType)
      if (!pendingCleanType && status === room.status) return room
      return { ...room, clean_type: cleanType, status }
    }),
    [pendingAssignmentCleanTypes, rooms],
  )

  const needAttention = displayRooms.filter((r) => r.status === 'DIRTY' || r.status === 'IN_PROGRESS').length
  const readyRooms = displayRooms.filter((r) => r.status === 'INSPECTED').length
  const dirtyRooms = displayRooms.filter((r) => r.status === 'DIRTY').length

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader
        eyebrow="Housekeeping"
        title="Room status board"
        meta={
          <>
            <Pill tone="ready" size="md">
              <span className="font-mono">{readyRooms} ready</span>
            </Pill>
            <Pill tone="progress" size="md">
              <span className="font-mono">{needAttention - dirtyRooms} in progress</span>
            </Pill>
            <Pill tone="dirty" size="md">
              <span className="font-mono">{dirtyRooms} vacant dirty</span>
            </Pill>
            <span className="text-ink4 text-xs">&middot;</span>
            <SyncBadge lastSyncedAt={lastSyncedAt} />
          </>
        }
        actions={
          <>
            {/* Date navigation */}
            <button
              onClick={() => navigate(-1)}
              className="px-2.5 py-2 rounded-lg bg-surface border border-line text-xs font-medium text-ink2 hover:bg-surface-2 transition-colors"
              aria-label="Previous day"
            >
              &larr; {format(addDays(parseISO(selectedDate), -1), 'MMM d')}
            </button>
            <span className="px-3 py-1.5 rounded-lg bg-surface border border-line text-sm font-semibold text-ink">
              {format(parseISO(selectedDate), 'MMM d')}
            </span>
            <button
              onClick={() => navigate(1)}
              className="px-2.5 py-2 rounded-lg bg-surface border border-line text-xs font-medium text-ink2 hover:bg-surface-2 transition-colors"
              aria-label="Next day"
            >
              {format(addDays(parseISO(selectedDate), 1), 'MMM d')} &rarr;
            </button>
            <select
              value={selectedShift ?? ''}
              onChange={(e) => setSelectedShift(e.target.value || null)}
              className="px-2.5 py-2 rounded-lg border border-line text-xs text-ink2 bg-surface hover:border-line-2 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
            >
              {SHIFTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {canAssignRooms && (
              <Button
                variant={assignmentMode ? 'primary' : 'secondary'}
                onClick={toggleAssignmentMode}
              >
                {assignmentMode ? 'Exit assign' : 'Assign mode'}
              </Button>
            )}
          </>
        }
      />

      {/* Prediction alerts */}
      {predictions.some((p) => p.risk_level === 'HIGH' || p.risk_level === 'MEDIUM') && (
        <PredictionPanel predictions={predictions} isLoading={predictionsLoading} />
      )}

      {/* Drag error banner */}
      {dragError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-[var(--alert-soft)] border border-[var(--alert-line)] text-sm text-[var(--alert)]">
          <span>{dragError}</span>
          <button onClick={() => setDragError(null)} className="shrink-0 font-medium" aria-label="Dismiss">
            &times;
          </button>
        </div>
      )}

      {/* Housekeeper chip bar (mobile assign mode) */}
      {assignmentMode && canAssignRooms && <HousekeeperBar />}

      {/* Main layout */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <RoomStatusBoard />
          </div>
          {assignmentMode && canAssignRooms && (
            <div className="hidden lg:block">
              <AssignmentSidebar />
            </div>
          )}
        </div>
      </DndContext>
    </div>
  )
}

// -- Role-gated entry point ---------------------------------------------------

export default function HousekeepingPage() {
  const { role } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)

  if (isAuthLoading || !role) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded-lg bg-surface-3 animate-pulse" />
        <div className="h-24 rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
        <div className="h-72 rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
      </div>
    )
  }

  if (role === 'housekeeper') {
    return <HousekeeperMyRoomsView />
  }

  if (role !== 'gm' && role !== 'housekeeping_supervisor' && role !== 'front_desk') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-ink3">You don&apos;t have access to this section.</p>
      </div>
    )
  }

  return <SupervisorHousekeepingPage />
}
