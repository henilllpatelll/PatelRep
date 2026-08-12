'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ChevronDown } from 'lucide-react'

import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { staffApi } from '@/lib/api/staff'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import { tasksApi } from '@/lib/api/tasks'
import { lateCheckoutApi } from '@/lib/api/lateCheckout'
import { RoomCard } from '@/components/housekeeping/RoomCard'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { createClient } from '@/lib/supabase/client'
import { StatusDot } from '@/components/ui/primitives'
import { Button, IconButton } from '@/components/ui/Button'
import { CLEAN_TYPE_OPTIONS, getEffectiveRoomStatusForCleanType } from '@/lib/utils/cleanType'
import type { CleanType } from '@/lib/utils/cleanType'
import { getPendingLateCheckoutByRoom, withPendingLateCheckout } from '@/lib/utils/lateCheckoutRequests'
import {
  filterHousekeepingBoardRooms,
  getHousekeepingBoardFilterCounts,
  normalizeHousekeepingBoardRoom,
  type CleanTypeFilter,
} from '@/lib/utils/housekeepingBoardFilters'

// -- Status chip config --------------------------------------------------------

function getCleanTypeChips(t: TFunction): Array<{ key: CleanType; label: string; dotTone: string }> {
  return [
    { key: 'DEP', label: t('housekeeping.roomStatus.filters.departure'), dotTone: 'dirty' },
    { key: 'FULL', label: t('housekeeping.roomStatus.filters.full'), dotTone: 'pickup' },
    { key: 'LIGHT', label: t('housekeeping.roomStatus.filters.light'), dotTone: 'pickup' },
  ]
}

function getStatusWorkflowChips(t: TFunction): Array<{ key: string; label: string; dotTone: string }> {
  return [
    { key: 'IN_PROGRESS', label: t('housekeeping.roomStatus.filters.inProgress'), dotTone: 'progress' },
    { key: 'CLEAN',       label: t('housekeeping.roomStatus.filters.clean'),       dotTone: 'clean' },
    { key: 'INSPECTED',   label: t('housekeeping.roomStatus.filters.inspected'),   dotTone: 'inspected' },
    { key: 'OOO',         label: t('housekeeping.roomStatus.filters.ooo'),         dotTone: 'ooo' },
  ]
}

// -- Skeleton loader -----------------------------------------------------------

function SkeletonGrid() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-40 bg-surface-3 rounded animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
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
  cleanTypeFilter: CleanTypeFilter
  onCleanTypeFilter: (cleanTypes: CleanTypeFilter) => void
  statusFilter: string | null
  onStatusFilter: (status: string | null) => void
  assignmentMode?: boolean
  showRiskOnly?: boolean
  onToggleRisk?: () => void
  riskCount?: number
}

function StatusSummaryBar({
  rooms,
  cleanTypeFilter,
  onCleanTypeFilter,
  statusFilter,
  onStatusFilter,
  assignmentMode,
  showRiskOnly,
  onToggleRisk,
  riskCount,
}: SummaryBarProps) {
  const { t } = useTranslation()
  const cleanTypeChips = getCleanTypeChips(t)
  const statusWorkflowChips = getStatusWorkflowChips(t)
  const { cleanTypeCounts, statusCounts } = getHousekeepingBoardFilterCounts(rooms)
  const allActive = assignmentMode
    ? cleanTypeFilter.length === 0 && statusFilter === null
    : statusFilter === null

  const chipClass = (active: boolean) =>
    `shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-full border transition-colors ${
      active
        ? 'bg-ink text-paper border-ink font-medium'
        : 'bg-surface border border-line text-ink2 hover:bg-surface-2'
    }`

  return (
    <div className="relative mb-4">
      <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* All */}
        <button
          onClick={() => { onCleanTypeFilter([]); onStatusFilter(null) }}
          aria-pressed={allActive}
          className={chipClass(allActive)}
        >
          <StatusDot tone="neutral" size={7} />
          {t('housekeeping.roomStatus.filters.all')}
          <span className="font-mono font-semibold text-[11px] opacity-70">{rooms.length}</span>
        </button>

        {assignmentMode ? (
          /* Assignment mode: DEP / FULL / LIGHT only */
          cleanTypeChips.map((chip) => {
            const count = cleanTypeCounts[chip.key] ?? 0
            const isActive = cleanTypeFilter.includes(chip.key)
            return (
              <button
                key={chip.key}
                onClick={() => {
                  const next = isActive
                    ? cleanTypeFilter.filter((k) => k !== chip.key)
                    : [...cleanTypeFilter, chip.key]
                  onCleanTypeFilter(next)
                }}
                aria-pressed={isActive}
                className={chipClass(isActive)}
              >
                <StatusDot tone={chip.dotTone} size={7} />
                {chip.label}
                <span className="font-mono font-semibold text-[11px] opacity-70">{count}</span>
              </button>
            )
          })
        ) : (
          <>
            {/* Workflow status chips */}
            {statusWorkflowChips.map((chip) => {
              const count = statusCounts[chip.key] ?? 0
              const isActive = statusFilter === chip.key
              return (
                <button
                  key={chip.key}
                  onClick={() => onStatusFilter(isActive ? null : chip.key)}
                  aria-pressed={isActive}
                  className={chipClass(isActive)}
                >
                  <StatusDot tone={chip.dotTone} size={7} />
                  {chip.label}
                  <span className="font-mono font-semibold text-[11px] opacity-70">{count}</span>
                </button>
              )
            })}

            {/* AI Risk */}
            {onToggleRisk && (
              <>
                <span className="shrink-0 w-px h-5 bg-line self-center" aria-hidden="true" />
                <button
                  onClick={onToggleRisk}
                  aria-pressed={showRiskOnly}
                  disabled={(riskCount ?? 0) === 0}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-[6px] rounded-full text-xs font-medium transition-colors border disabled:opacity-40 disabled:cursor-default ${
                    showRiskOnly
                      ? 'bg-[var(--ai)] text-white border-[var(--ai)]'
                      : 'bg-[var(--ai-soft)] text-[var(--ai)] border-[var(--ai-line)] hover:opacity-90'
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
                  </svg>
                  {t('housekeeping.roomStatus.filters.aiRisk')}
                  <span className="font-mono font-bold text-[11px]">{riskCount}</span>
                </button>
              </>
            )}
          </>
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

function roomNeedsAssignmentCleanTypePrompt(room: any): boolean {
  if (!room || room.clean_type) return false
  const status = room.status
  const foStatus = room.fo_status
  return status === 'OCCUPIED' || (foStatus === 'OCC' && (status === 'DIRTY' || status === 'PICKUP'))
}

export function RoomStatusBoard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const session = useAuthStore((s) => s.session)
  const hotelId = getHotelIdFromToken(session?.access_token)
  const searchParams = useSearchParams()

  const {
    rooms: allRooms,
    setRooms,
    setPredictions,
    setLastSyncedAt,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    assignmentMode,
    activeAssigneeId,
    setPendingAssignment,
    removePendingAssignment,
    selectedDate,
    selectedShift,
    statusFilter,
    setStatusFilter,
    cleanTypeFilter,
    setCleanTypeFilter,
    showRiskOnly,
    toggleRiskOnly,
    predictions,
    buildingFilter,
    setBuildingFilter,
  } = useHousekeepingStore()

  const displayRooms = useMemo(() =>
    allRooms.map((room: any) => normalizeHousekeepingBoardRoom(room)),
    [allRooms],
  )

  const availableBuildings = useMemo(() => {
    const seen = new Set<string>()
    for (const room of displayRooms) {
      const b = (room.rooms as any)?.building
      if (b) seen.add(b as string)
    }
    return Array.from(seen).sort()
  }, [displayRooms])

  const rooms = useMemo(() => {
    return filterHousekeepingBoardRooms(displayRooms, {
      statusFilter,
      cleanTypeFilter,
      showRiskOnly,
      predictions,
      buildingFilter,
    })
  }, [buildingFilter, cleanTypeFilter, displayRooms, predictions, showRiskOnly, statusFilter])

  const riskCount = useMemo(
    () => displayRooms.filter((r: any) => {
      const pred = predictions[r.room_id] ?? r.prediction
      return pred?.risk_level === 'HIGH' || pred?.risk_level === 'MEDIUM'
    }).length,
    [displayRooms, predictions],
  )

  // -- Staff name lookup -------------------------------------------------------
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
  })
  const { data: guestRequestsData } = useQuery({
    queryKey: ['guest-requests-board'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 200 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const guestRequestsByRoom = useMemo<Record<string, number>>(() => {
    const all: any[] = (guestRequestsData as any)?.data ?? []
    return all
      .filter((r: any) => r.status === 'open' || r.status === 'in_progress')
      .reduce<Record<string, number>>((acc, r) => {
        if (r.room_id) acc[r.room_id] = (acc[r.room_id] ?? 0) + 1
        return acc
      }, {})
  }, [guestRequestsData])

  const { data: tasksData } = useQuery({
    queryKey: ['tasks-board'],
    queryFn: () => tasksApi.list({ per_page: 100 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const { data: lateCheckoutData } = useQuery({
    queryKey: ['late-checkout-requests-board', 'pending'],
    queryFn: () => lateCheckoutApi.list({ status: 'pending' }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const openTasksByRoom = useMemo<Record<string, number>>(() => {
    const all: any[] = (tasksData as any)?.data ?? []
    return all
      .filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled')
      .reduce<Record<string, number>>((acc, t) => {
        if (t.room_id) acc[t.room_id] = (acc[t.room_id] ?? 0) + 1
        return acc
      }, {})
  }, [tasksData])

  const pendingLateCheckoutByRoom = useMemo(
    () => getPendingLateCheckoutByRoom(lateCheckoutData?.data ?? []),
    [lateCheckoutData],
  )

  const withLateCheckout = useCallback((room: any) => {
    return withPendingLateCheckout(room, pendingLateCheckoutByRoom)
  }, [pendingLateCheckoutByRoom])

  const hkNameById = useMemo(() =>
    ((staffData?.data?.staff ?? []) as any[]).reduce<Record<string, string>>(
      (acc, s) => { acc[s.user_id] = s.full_name; return acc },
      {}
    ),
    [staffData]
  )

  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)

  useEffect(() => {
    const roomId = searchParams.get('room')
    if (!roomId || allRooms.length === 0) return
    const match = displayRooms.find((r: any) => r.room_id === roomId)
    if (match) setSelectedRoom(withLateCheckout(match))
    // no match => graceful no-op (room deleted / already cleaned off today's
    // board / belongs to a different tenant — displayRooms is already
    // tenant-scoped server-side, so this can never leak cross-tenant data)
  }, [searchParams, allRooms, displayRooms, withLateCheckout])

  const [assignError, setAssignError] = useState<string | null>(null)
  const [cleanTypePrompt, setCleanTypePrompt] = useState<{ roomId: string; roomNumber: string } | null>(null)
  const [collapsedFloors, setCollapsedFloors] = useState<Set<number>>(new Set())
  const toggleFloorCollapsed = useCallback((floor: number) => {
    setCollapsedFloors((prev) => {
      const next = new Set(prev)
      if (next.has(floor)) next.delete(floor)
      else next.add(floor)
      return next
    })
  }, [])

  const assignmentToRoomId = useMemo(() =>
    allRooms.reduce<Record<string, string>>((acc, r: any) => {
      if (r.assignment_id && r.room_id) acc[r.assignment_id] = r.room_id
      return acc
    }, {}),
    [allRooms]
  )

  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyRoomStatusPayload = useCallback((payload: any) => {
    const row = payload?.new
    if (!row?.room_id) return
    const { assigned_to: _assignedTo, ...statusRow } = row

    const mergeRoom = (room: any) => {
      if (room.room_id !== row.room_id) return room
      const nextCleanType = statusRow.clean_type ?? room.clean_type
      const nextStatus = getEffectiveRoomStatusForCleanType(
        statusRow.status,
        nextCleanType,
        statusRow.fo_status ?? room.fo_status,
      )
      return {
        ...room,
        ...statusRow,
        clean_type: nextCleanType,
        status: nextStatus,
        rooms: room.rooms,
        prediction: room.prediction,
      }
    }

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

  useEffect(() => {
    setSelectedRoom((prev: any) => prev ? withLateCheckout(prev) : prev)
  }, [withLateCheckout])

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
    queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
    queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
  }

  const handleRemoveSavedAssignment = useCallback(async (assignmentId: string) => {
    const roomId = assignmentToRoomId[assignmentId]
    setAssignError(null)

    const clearAssignment = (room: any) => {
      if (!roomId || room.room_id !== roomId) return room
      return { ...room, assignment_id: null, assigned_to: null }
    }

    const prevBoardData = queryClient.getQueryData(['housekeeping-board', selectedDate, selectedShift])
    queryClient.setQueryData(
      ['housekeeping-board', selectedDate, selectedShift],
      (old: any) => old?.data ? { ...old, data: old.data.map(clearAssignment) } : old,
    )
    setSelectedRoom((prev: any) => prev?.room_id === roomId ? clearAssignment(prev) : prev)

    // Optimistic IDs are not yet persisted — no server call needed
    if (assignmentId.startsWith('optimistic-')) return

    try {
      await housekeepingApi.deleteAssignment(assignmentId)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
    } catch {
      queryClient.setQueryData(['housekeeping-board', selectedDate, selectedShift], prevBoardData)
      setSelectedRoom((prev: any) =>
        prev?.room_id === roomId ? { ...prev, assignment_id: assignmentId } : prev,
      )
      setAssignError(t('housekeeping.roomStatus.error.removeAssignmentFailed'))
      setTimeout(() => setAssignError(null), 3000)
    }
  }, [queryClient, selectedDate, selectedShift, assignmentToRoomId, t])

  // -- Tap-to-assign -----------------------------------------------------------
  const handleTapAssign = useCallback((roomId: string) => {
    if (!activeAssigneeId) return
    if (pendingAssignments[roomId] === activeAssigneeId) {
      return
    }
    const roomData = allRooms.find((r: any) => r.room_id === roomId)
    if (roomData?.assigned_to === activeAssigneeId) {
      return
    }
    if (roomNeedsAssignmentCleanTypePrompt(roomData)) {
      setCleanTypePrompt({
        roomId,
        roomNumber: roomData.rooms?.room_number ?? roomData.room_number ?? 'room',
      })
      return
    }
    setAssignError(null)
    setPendingAssignment(roomId, activeAssigneeId)
  }, [activeAssigneeId, pendingAssignments, allRooms, setPendingAssignment])

  const handleCleanTypePromptSelect = useCallback((cleanType: CleanType) => {
    if (!cleanTypePrompt || !activeAssigneeId) return
    setAssignError(null)
    setPendingAssignment(cleanTypePrompt.roomId, activeAssigneeId, cleanType)
    setCleanTypePrompt(null)
  }, [activeAssigneeId, cleanTypePrompt, setPendingAssignment])

  // -- Derived data ------------------------------------------------------------
  const roomAssignedNames = useMemo(() =>
    allRooms.reduce<Record<string, string>>((acc, r: any) => {
      if (r.room_id && r.assigned_to && r.assigned_to !== activeAssigneeId) {
        acc[r.room_id] = hkNameById[r.assigned_to] ?? t('housekeeping.roomStatus.unknownHousekeeper')
      }
      return acc
    }, {}),
    [allRooms, activeAssigneeId, hkNameById, t]
  )

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
        <p className="text-[13px] text-ink3">{t('housekeeping.roomStatus.error.failedToLoad')}</p>
        <Button
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })}
        >
          {t('housekeeping.roomStatus.error.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Building filter — only shown when rooms span multiple buildings */}
      {availableBuildings.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-ink3 shrink-0 uppercase tracking-wide">{t('housekeeping.roomStatus.building.label')}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setBuildingFilter(null)}
              aria-pressed={buildingFilter === null}
              className={`px-3 py-1 text-[12px] font-medium rounded-full border transition-colors ${
                buildingFilter === null
                  ? 'bg-ink text-paper border-ink'
                  : 'bg-surface border-line text-ink2 hover:bg-surface-2'
              }`}
            >
              {t('housekeeping.roomStatus.building.all')}
            </button>
            {availableBuildings.map((b) => (
              <button
                key={b}
                onClick={() => setBuildingFilter(buildingFilter === b ? null : b)}
                aria-pressed={buildingFilter === b}
                className={`px-3 py-1 text-[12px] font-medium rounded-full border transition-colors ${
                  buildingFilter === b
                    ? 'bg-ink text-paper border-ink'
                    : 'bg-surface border-line text-ink2 hover:bg-surface-2'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Status filter chips */}
      <StatusSummaryBar
        rooms={displayRooms}
        cleanTypeFilter={cleanTypeFilter}
        onCleanTypeFilter={setCleanTypeFilter}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        assignmentMode={assignmentMode}
        showRiskOnly={showRiskOnly}
        onToggleRisk={toggleRiskOnly}
        riskCount={riskCount}
      />

      {/* Assign error banner */}
      {assignError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-[var(--alert-soft)] border border-[var(--alert-line)] text-sm text-[var(--alert)]">
          <span>{assignError}</span>
          <IconButton
            onClick={() => setAssignError(null)}
            variant="ghost"
            size="sm"
            className="shrink-0 text-[var(--alert)] font-medium hover:text-[var(--alert)]"
            aria-label={t('housekeeping.roomStatus.error.dismiss')}
          >
            &times;
          </IconButton>
        </div>
      )}

      {/* Floor-grouped grid */}
      {sortedFloors.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-[13px] text-ink3">
          {t('housekeeping.roomStatus.empty.noMatch')}
        </div>
      ) : (
        <div className="space-y-8">
          {sortedFloors.map((floor) => {
            const floorRooms = byFloor[floor]
            const isCollapsed = collapsedFloors.has(floor)
            return (
              <div key={floor}>
                {/* Floor divider header */}
                <button
                  type="button"
                  onClick={() => toggleFloorCollapsed(floor)}
                  aria-expanded={!isCollapsed}
                  className="w-full flex items-baseline gap-3 mb-3 pb-2 border-b border-dashed border-line-2 text-left group"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-ink3 shrink-0 self-center transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                  <h3 className="font-mono text-[12px] font-bold uppercase tracking-widest text-ink2 group-hover:text-ink transition-colors">
                    {floor === 0 ? t('housekeeping.roomStatus.floor.ground') : t('housekeeping.roomStatus.floor.numbered', { floor })}
                  </h3>
                  <span className="font-mono text-[11px] text-ink3">
                    {floorRooms.length === 1
                      ? t('housekeeping.roomStatus.floor.roomCountOne', { count: floorRooms.length })
                      : t('housekeeping.roomStatus.floor.roomCountOther', { count: floorRooms.length })}
                  </span>
                </button>
                {!isCollapsed && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
                  {floorRooms.map((room) => {
                    const pendingCleanType = pendingAssignmentCleanTypes[room.room_id] ?? null
                    const cardRoom = pendingCleanType
                      ? {
                          ...room,
                          clean_type: pendingCleanType,
                          status: getEffectiveRoomStatusForCleanType(room.status, pendingCleanType, room.fo_status),
                        }
                      : room
                    const visibleRoom = withLateCheckout(cardRoom)
                    return (
                      <RoomCard
                        key={room.room_id}
                        room={visibleRoom}
                        assignmentMode={assignmentMode}
                        guestRequestCount={guestRequestsByRoom[room.room_id] ?? 0}
                        openTaskCount={openTasksByRoom[room.room_id] ?? 0}
                        onStatusChange={(roomId: string, newStatus: string) =>
                          handleStatusChange(roomId, newStatus)
                        }
                        onOpenDetail={() => setSelectedRoom(visibleRoom)}
                        onAssign={assignmentMode && !!activeAssigneeId ? handleTapAssign : undefined}
                        pendingAssignee={pendingAssignments[room.room_id] ?? null}
                        assignedToName={assignmentMode ? (roomAssignedNames[room.room_id] ?? null) : null}
                        assignedToActive={assignmentMode && !!activeAssigneeId && room.assigned_to === activeAssigneeId}
                        savedAssignmentId={room.assignment_id ?? null}
                        onRemoveSavedAssignment={handleRemoveSavedAssignment}
                      />
                    )
                  })}
                </div>
                )}
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
        onCheckoutTimeSaved={(time) => setSelectedRoom((prev: any) => prev ? { ...prev, checkout_time: time } : prev)}
      />

      {cleanTypePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-clean-type-title"
        >
          <div className="w-full max-w-sm rounded-[var(--r-lg)] border border-line bg-surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="assign-clean-type-title" className="text-sm font-semibold text-ink">
                  {t('housekeeping.roomStatus.cleanTypePrompt.title', { roomNumber: cleanTypePrompt.roomNumber })}
                </h2>
                <p className="mt-1 text-xs text-ink3">
                  {t('housekeeping.roomStatus.cleanTypePrompt.subtitle')}
                </p>
              </div>
              <IconButton
                variant="ghost"
                size="sm"
                onClick={() => setCleanTypePrompt(null)}
                aria-label={t('housekeeping.roomStatus.cleanTypePrompt.cancelAria')}
              >
                &times;
              </IconButton>
            </div>
            <div className="mt-4 space-y-2">
              {CLEAN_TYPE_OPTIONS.map((option) => {
                const optionKey = option.value.toLowerCase() as 'dep' | 'full' | 'light'
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleCleanTypePromptSelect(option.value)}
                    className="w-full rounded-[var(--r-md)] border border-line bg-paper px-3 py-2 text-left transition-colors hover:border-amber-400 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <span className="block text-sm font-semibold text-ink">
                      {t(`housekeeping.roomStatus.cleanTypePrompt.options.${optionKey}.label`)}
                    </span>
                    <span className="block text-xs text-ink3">
                      {t(`housekeeping.roomStatus.cleanTypePrompt.options.${optionKey}.hint`)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
