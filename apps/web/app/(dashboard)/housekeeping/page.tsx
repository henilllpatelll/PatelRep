'use client'

export const dynamic = 'force-dynamic'

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
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'

// ── Shift options ─────────────────────────────────────────────────────────────

const SHIFTS = [
  { value: '', label: 'All Shifts' },
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
]

// ── Synced-ago badge ──────────────────────────────────────────────────────────

function SyncBadge({ lastSyncedAt }: { lastSyncedAt: Date | null }) {
  const [label, setLabel] = useState('Never synced')

  useEffect(() => {
    function compute() {
      if (!lastSyncedAt) {
        setLabel('Never synced')
        return
      }
      const diffMs = Date.now() - lastSyncedAt.getTime()
      const diffMin = Math.floor(diffMs / 60_000)
      if (diffMin < 1) setLabel('Synced just now')
      else if (diffMin === 1) setLabel('Synced 1 min ago')
      else setLabel(`Synced ${diffMin} min ago`)
    }

    compute()
    const interval = setInterval(compute, 30_000)
    return () => clearInterval(interval)
  }, [lastSyncedAt])

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
      <span className={`w-2 h-2 rounded-full ${lastSyncedAt ? 'bg-green-400' : 'bg-gray-300'}`} />
      {label}
    </span>
  )
}

// ── Housekeeper chip bar (mobile-first tap-to-assign) ─────────────────────────

function HousekeeperBar() {
  const queryClient = useQueryClient()
  const {
    selectedDate,
    selectedShift,
    activeAssigneeId,
    setActiveAssignee,
    pendingAssignments,
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
      // noop — sidebar shows error on desktop
    } finally {
      setSaveLoading(false)
    }
  }

  function getInitials(name: string) {
    return name.split(' ').slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
  }

  return (
    <div className="rounded-xl bg-white/80 backdrop-blur-sm border border-white/90 shadow-sm p-3 space-y-2.5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700">
          {activeAssigneeId
            ? <span className="text-amber-700">Tap rooms to assign &rarr;</span>
            : 'Select a housekeeper:'}
        </p>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-green-600 font-medium">Saved ✓</span>
          )}
          {hasPending && (
            <button
              onClick={handleSave}
              disabled={saveLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 active:bg-amber-700 transition-colors disabled:opacity-60"
            >
              {saveLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <>Save <span className="inline-flex items-center justify-center w-4 h-4 bg-white/25 rounded-full text-[10px] font-bold">{pendingCount}</span></>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Housekeeper chips */}
      {isLoading ? (
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-24 h-9 bg-gray-200 rounded-lg animate-pulse shrink-0" />
          ))}
        </div>
      ) : housekeepers.length === 0 ? (
        <p className="text-xs text-gray-400">
          No housekeeper staff found.{' '}
          <Link href="/staff" prefetch={false} className="text-amber-600 underline">Add staff</Link>
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
                onClick={() =>
                  setActiveAssignee(
                    isActive ? null : hk.housekeeper_id,
                    isActive ? null : hk.name,
                  )
                }
                className={`flex items-center gap-2 shrink-0 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all select-none ${
                  isActive
                    ? 'bg-amber-500 text-white border-amber-500 shadow-sm scale-[1.02]'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-amber-300 active:bg-amber-50'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    isActive ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {initials}
                </span>
                <span>{hk.name.split(' ')[0]}</span>
                {(hk.rooms_assigned > 0 || assignedCount > 0) && (
                  <span
                    className={`text-[10px] px-1 py-0.5 rounded-full min-w-[18px] text-center ${
                      isActive
                        ? 'bg-white/25 text-white'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {hk.rooms_assigned + assignedCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Housekeeper simple view ───────────────────────────────────────────────────

function HousekeeperRoomItem({
  room,
  onAction,
  onOpenDetail,
}: {
  room: any
  onAction: (roomId: string, status: string) => Promise<void>
  onOpenDetail: (room: any) => void
}) {
  const [loading, setLoading] = useState(false)
  const roomNumber = room.rooms?.room_number ?? '—'
  const roomType = room.rooms?.room_types?.name ?? ''
  const status: string = room.status ?? 'DIRTY'
  const vip = !!room.vip_flag

  const statusConfig: Record<string, { label: string; pill: string }> = {
    DIRTY:      { label: 'To Clean',             pill: 'bg-red-100 text-red-700' },
    PICKUP:     { label: 'Pickup',               pill: 'bg-purple-100 text-purple-700' },
    IN_PROGRESS:{ label: 'In Progress',          pill: 'bg-blue-100 text-blue-700' },
    CLEAN:      { label: 'Awaiting Inspection',  pill: 'bg-amber-100 text-amber-700' },
    INSPECTED:  { label: 'Approved',             pill: 'bg-green-100 text-green-700' },
  }
  const cfg = statusConfig[status] ?? { label: status, pill: 'bg-gray-100 text-gray-600' }

  async function handle(newStatus: string, e: React.MouseEvent) {
    e.stopPropagation()
    setLoading(true)
    try { await onAction(room.room_id, newStatus) } finally { setLoading(false) }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm cursor-pointer active:bg-gray-50 transition-colors"
      onClick={() => onOpenDetail(room)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(room) } }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-base font-bold text-gray-900">Room {roomNumber}</span>
          {vip && (
            <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
              VIP
            </span>
          )}
        </div>
        {roomType && <p className="text-xs text-gray-400">{roomType}</p>}
        <span className={`inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.pill}`}>
          {cfg.label}
        </span>
        <p className="text-xs text-gray-400 mt-1">Tap for notes &amp; issues</p>
      </div>

      <div className="shrink-0 text-right">
        {(status === 'DIRTY' || status === 'PICKUP') && (
          <button
            disabled={loading}
            onClick={(e) => handle('IN_PROGRESS', e)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-50"
          >
            {loading ? '…' : 'Start'}
          </button>
        )}
        {status === 'IN_PROGRESS' && (
          <button
            disabled={loading}
            onClick={(e) => handle('CLEAN', e)}
            className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-xl hover:bg-amber-600 active:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {loading ? '…' : 'Done'}
          </button>
        )}
        {status === 'CLEAN' && (
          <span className="text-xs text-amber-600 font-medium">
            Waiting for<br />supervisor
          </span>
        )}
        {status === 'INSPECTED' && (
          <span className="text-sm text-green-600 font-semibold">✓ Approved</span>
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

    const mergeRoom = (room: any) =>
      room.room_id === row.room_id ? { ...room, ...row } : room

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
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token)
    }

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
    // Optimistic update — reflect new status immediately without waiting for refetch
    queryClient.setQueryData(['housekeeping-board', today], (old: any) => {
      if (!old?.data) return old
      return { ...old, data: (old.data as any[]).map((r: any) => r.room_id === roomId ? { ...r, status } : r) }
    })
    try {
      await housekeepingApi.updateRoomStatus(roomId, status)
    } catch {
      // Rollback on error
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', today] })
      return
    }
    queryClient.invalidateQueries({ queryKey: ['housekeeping-board', today] })
  }

  const todoCount = myRooms.filter((r: any) => r.status === 'DIRTY' || r.status === 'PICKUP').length
  const inProgressCount = myRooms.filter((r: any) => r.status === 'IN_PROGRESS').length
  const doneCount = myRooms.filter((r: any) => r.status === 'INSPECTED').length

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">My Rooms</h1>
        <p className="text-sm text-gray-500 mt-0.5">{format(new Date(), 'EEEE, MMMM d')}</p>
      </div>

      {myRooms.length > 0 && (
        <div className="flex gap-5 px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm text-sm">
          <span><strong className="text-red-600">{todoCount}</strong> to do</span>
          <span><strong className="text-blue-600">{inProgressCount}</strong> in progress</span>
          <span><strong className="text-green-600">{doneCount}</strong> done</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : myRooms.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-gray-400">No rooms assigned to you today.</p>
          <p className="text-gray-300 text-sm mt-1">Check with your supervisor.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {myRooms.map((room: any) => (
            <HousekeeperRoomItem
              key={room.room_id}
              room={room}
              onAction={handleAction}
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
      />
    </div>
  )
}

// ── Supervisor / GM board view ────────────────────────────────────────────────

function SupervisorHousekeepingPage() {
  const queryClient = useQueryClient()
  const { canAssignRooms } = useRole()
  const {
    selectedDate,
    selectedShift,
    assignmentMode,
    lastSyncedAt,
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
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
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
        assignments: [{ room_id: roomId, housekeeper_id: housekeeperId }],
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
        // silently fail — predictions are optional
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

  const dateLabel = format(parseISO(selectedDate), 'MMM d, yyyy')
  const totalRooms = rooms.length
  const needAttention = rooms.filter((r) => r.status === 'DIRTY' || r.status === 'IN_PROGRESS').length
  const readyRooms = rooms.filter((r) => r.status === 'INSPECTED').length
  const highRiskCount = predictions.filter((p) => p.risk_level === 'HIGH').length

  return (
    <div className="space-y-3">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: title + date nav */}
        <div className="space-y-1.5">
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Housekeeping Board</h1>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => navigate(-1)}
              className="px-2.5 py-1 rounded-lg bg-white/70 border border-white/90 text-xs font-medium text-gray-600 hover:bg-white/90 transition-colors"
              aria-label="Previous day"
            >
              &#8592; {format(addDays(parseISO(selectedDate), -1), 'MMM d')}
            </button>

            <span className="px-3 py-1 rounded-lg bg-white border border-gray-200 text-sm font-semibold text-gray-900 shadow-sm">
              {dateLabel}
            </span>

            <button
              onClick={() => navigate(1)}
              className="px-2.5 py-1 rounded-lg bg-white/70 border border-white/90 text-xs font-medium text-gray-600 hover:bg-white/90 transition-colors"
              aria-label="Next day"
            >
              {format(addDays(parseISO(selectedDate), 1), 'MMM d')} &#8594;
            </button>

            <select
              value={selectedShift ?? ''}
              onChange={(e) => setSelectedShift(e.target.value || null)}
              className="px-2.5 py-1 rounded-lg border border-white/90 text-xs text-gray-700 bg-white/70 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
            >
              {SHIFTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View / Assign toggle */}
          {canAssignRooms && (
            <>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs bg-white shadow-sm">
                <button
                  onClick={() => assignmentMode && toggleAssignmentMode()}
                  className={`px-3 py-2 font-medium transition-colors ${
                    !assignmentMode ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  View
                </button>
                <button
                  onClick={() => !assignmentMode && toggleAssignmentMode()}
                  className={`px-3 py-2 font-medium transition-colors ${
                    assignmentMode ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Assign
                </button>
              </div>

              <Link
                href="/onboarding?step=2"
                prefetch={false}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-600 hover:bg-gray-50 transition-colors shadow-sm"
              >
                + Rooms
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Stats + sync ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          <span><strong className="text-gray-900 text-sm">{totalRooms}</strong> rooms</span>
          <span><strong className="text-orange-600">{needAttention}</strong> need attention</span>
          <span><strong className="text-green-600">{readyRooms}</strong> ready</span>
          {highRiskCount > 0 && (
            <span><strong className="text-red-600">{highRiskCount}</strong> at risk</span>
          )}
        </div>
        <SyncBadge lastSyncedAt={lastSyncedAt} />
      </div>

      {/* ── Prediction alerts ─────────────────────────────────────────────── */}
      {predictions.some((p) => p.risk_level === 'HIGH' || p.risk_level === 'MEDIUM') && (
        <PredictionPanel predictions={predictions} isLoading={predictionsLoading} />
      )}

      {/* ── Drag error banner ─────────────────────────────────────────────── */}
      {dragError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <span>{dragError}</span>
          <button
            onClick={() => setDragError(null)}
            className="shrink-0 text-red-500 hover:text-red-700 font-medium"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Housekeeper bar (mobile assign mode) ──────────────────────────── */}
      {assignmentMode && canAssignRooms && <HousekeeperBar />}

      {/* ── Main layout ───────────────────────────────────────────────────── */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 items-start">
          {/* Board */}
          <div className="flex-1 min-w-0">
            <RoomStatusBoard />
          </div>

          {/* Sidebar — desktop only */}
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

// ── Role-gated entry point ────────────────────────────────────────────────────

export default function HousekeepingPage() {
  const { role } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)

  if (isAuthLoading || !role) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded-lg bg-gray-100 animate-pulse" />
        <div className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
        <div className="h-72 rounded-2xl bg-gray-100 animate-pulse" />
      </div>
    )
  }

  if (role === 'housekeeper') {
    return <HousekeeperMyRoomsView />
  }

  if (role !== 'gm' && role !== 'housekeeping_supervisor' && role !== 'front_desk') {
    return null
  }

  return <SupervisorHousekeepingPage />
}
