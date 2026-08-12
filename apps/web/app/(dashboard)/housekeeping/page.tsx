'use client'

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { format, addDays, parseISO } from 'date-fns'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Clock, LogOut, MessageSquare, Wrench } from 'lucide-react'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { RoomStatusBoard } from '@/components/housekeeping/RoomStatusBoard'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { AssignmentSidebar } from '@/components/housekeeping/AssignmentSidebar'
import { PredictionPanel } from '@/components/housekeeping/PredictionPanel'
import { RoomPrediction, housekeepingApi } from '@/lib/api/housekeeping'
import { staffApi } from '@/lib/api/staff'
import { getInitials, getDisplayName } from '@/lib/utils/avatar'
import { useAuth } from '@/lib/hooks/useAuth'
import { useRole } from '@/lib/hooks/useRole'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import {
  getEffectiveRoomStatusForCleanType,
  getCleanTypeShortLabel,
} from '@/lib/utils/cleanType'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Pill } from '@/components/ui/primitives'

// -- Shift options -------------------------------------------------------------

const SHIFTS = [
  { value: '', key: 'all' },
  { value: 'morning', key: 'morning' },
  { value: 'evening', key: 'evening' },
  { value: 'night', key: 'night' },
]

const CLEAN_TYPE_TEXT_COLOR: Record<string, string> = {
  DEP: 'text-[var(--alert)]',
  FULL: 'text-[var(--caution)]',
  LIGHT: 'text-[var(--caution)]',
}

// -- Live sync badge -----------------------------------------------------------

function SyncBadge({ lastSyncedAt }: { lastSyncedAt: Date | null }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState(() => t('housekeeping.page.sync.never'))

  useEffect(() => {
    function compute() {
      if (!lastSyncedAt) { setLabel(t('housekeeping.page.sync.never')); return }
      const diffMin = Math.floor((Date.now() - lastSyncedAt.getTime()) / 60_000)
      if (diffMin < 1) setLabel(t('housekeeping.page.sync.justNow'))
      else if (diffMin === 1) setLabel(t('housekeeping.page.sync.oneMinAgo'))
      else setLabel(t('housekeeping.page.sync.minAgo', { count: diffMin }))
    }
    compute()
    const interval = setInterval(compute, 30_000)
    return () => clearInterval(interval)
  }, [lastSyncedAt, t])

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ready)]">
      <span className={`w-2 h-2 rounded-full bg-ready shrink-0 ${lastSyncedAt ? 'animate-pulse' : ''}`} />
      {t('housekeeping.page.sync.live')} &middot; {label}
    </span>
  )
}

// -- Housekeeper chip bar (mobile assign mode) --------------------------------

function HousekeeperBar() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const {
    selectedDate,
    selectedShift,
    activeAssigneeId,
    setActiveAssignee,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    clearPendingAssignments,
    setPendingAssignment,
  } = useHousekeepingStore()

  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
  })

  const housekeepers: any[] = (data?.data?.staff ?? [])
    .filter((s: any) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
    .map((s: any) => ({ housekeeper_id: s.user_id, name: getDisplayName(s.full_name) }))
  const pendingCount = Object.keys(pendingAssignments).length
  const hasPending = pendingCount > 0

  const handleSave = () => {
    if (!hasPending) return

    const pendingSnapshot = { ...pendingAssignments }
    const cleanTypeSnapshot = { ...pendingAssignmentCleanTypes }
    const assignmentsPayload = Object.entries(pendingAssignments)
      .filter(([roomId, housekeeperId]) => !!roomId && !!housekeeperId)
      .map(([roomId, housekeeperId]) => ({
        room_id: roomId,
        housekeeper_id: housekeeperId,
        ...(pendingAssignmentCleanTypes[roomId]
          ? { clean_type: pendingAssignmentCleanTypes[roomId] }
          : {}),
      }))

    // Optimistic: immediately show assigned rooms as purple in the board
    const boardKey = ['housekeeping-board', selectedDate, selectedShift]
    const prevBoardData = queryClient.getQueryData(boardKey)
    queryClient.setQueryData(boardKey, (old: any) => {
      if (!old?.data) return old
      return {
        ...old,
        data: old.data.map((room: any) => {
          const housekeeperId = pendingSnapshot[room.room_id]
          if (!housekeeperId) return room
          return { ...room, assigned_to: housekeeperId, assignment_id: `optimistic-${room.room_id}` }
        }),
      }
    })

    clearPendingAssignments()
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)

    housekeepingApi.saveAssignments({
      date: selectedDate,
      shift_id: null,
      assignments: assignmentsPayload,
      is_ai_suggested: false,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['staff-list'] })
    }).catch((err: any) => {
      queryClient.setQueryData(boardKey, prevBoardData)
      Object.entries(pendingSnapshot).forEach(([roomId, housekeeperId]) => {
        setPendingAssignment(roomId, housekeeperId, cleanTypeSnapshot[roomId as keyof typeof cleanTypeSnapshot])
      })
      setSaveSuccess(false)
      setSaveError(err?.message || t('housekeeping.page.assignBar.saveError'))
      setTimeout(() => setSaveError(null), 4000)
    })
  }

  return (
    <div data-testid="hk-bar" className="rounded-[var(--r-lg)] bg-surface border border-line shadow-sm p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink2">
          {activeAssigneeId
            ? <span className="text-[var(--caution)]">{t('housekeeping.page.assignBar.tapToAssign')}</span>
            : t('housekeeping.page.assignBar.selectHousekeeper')}
        </p>
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-[var(--ready)] font-medium">{t('housekeeping.page.assignBar.saved')}</span>
          )}
          {saveError && (
            <span className="text-xs text-[var(--alert)] font-medium">{saveError}</span>
          )}
          {hasPending && (
            <Button variant="primary" size="sm" onClick={handleSave} className="gap-1.5">
              {t('housekeeping.page.assignBar.save')} <span className="inline-flex items-center justify-center w-4 h-4 bg-white/20 rounded-full text-[10px] font-bold">{pendingCount}</span>
            </Button>
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
          {t('housekeeping.page.assignBar.noStaff')}{' '}
          <Link href="/staff" prefetch={false} className="text-accent underline">{t('housekeeping.page.assignBar.addStaff')}</Link>
        </p>
      ) : (
        <div data-testid="hk-chip-list" className="flex gap-2 overflow-x-auto pb-0.5 -mb-0.5">
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
                {assignedCount > 0 && (
                  <span className={`text-[10px] px-1 py-0.5 rounded-full min-w-[18px] text-center ${
                    isActive ? 'bg-white/20 text-paper' : 'bg-surface-3 text-ink3'
                  }`}>
                    {assignedCount}
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
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [donePending, setDonePending] = useState(false)
  const [undoPending, setUndoPending] = useState(false)
  const [showHint] = useState(() => {
    if (typeof window === 'undefined') return false
    if (localStorage.getItem('hk-notes-hint-seen')) return false
    localStorage.setItem('hk-notes-hint-seen', '1')
    return true
  })
  const roomNumber = room.rooms?.room_number ?? '--'
  const roomType = room.rooms?.room_types?.code ?? ''
  const status: string = room.status ?? 'DIRTY'
  const vip = !!room.vip_flag
  const cleanTypeLabel = getCleanTypeShortLabel(room.clean_type)
  const latestNote: string | null = room.latest_note ?? null
  const openWorkOrder = room.open_work_order_number ?? null
  const openWorkOrderTitle: string | null = room.open_work_order_title ?? null
  const workOrderLabel = openWorkOrder
    ? `WO-${openWorkOrder}${openWorkOrderTitle ? `: ${openWorkOrderTitle}` : ''}`
    : openWorkOrderTitle
  const isOccupiedRoom = Boolean(
    room.guest_name ||
    room.occupied ||
    room.is_occupied ||
    room.occupancy_status === 'occupied' ||
    room.room_occupancy === 'occupied',
  )
  const readyLabel = isOccupiedRoom
    ? t('housekeeping.page.roomItem.readyOccupied')
    : t('housekeeping.page.roomItem.readyVacant')

  const checkoutIso: string | null = room.actual_checkout_at ?? room.checkout_time ?? null
  const checkoutLabel = room.actual_checkout_at
    ? t('housekeeping.page.roomItem.checkedOut')
    : t('housekeeping.page.roomItem.dueOut')
  const checkoutTime = checkoutIso
    ? new Date(checkoutIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : null

  const statusConfig: Record<string, { label: string; pillClass: string }> = {
    DIRTY:      { label: t('housekeeping.page.roomItem.status.vacantDirty'),   pillClass: 'bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)]' },
    OCCUPIED:   { label: t('housekeeping.page.roomItem.status.occupiedDirty'), pillClass: 'bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)]' },
    PICKUP:     { label: t('housekeeping.page.roomItem.status.pickup'),       pillClass: 'bg-[var(--caution-soft)] text-[var(--caution)] border border-[var(--caution-line)]' },
    IN_PROGRESS:{ label: t('housekeeping.page.roomItem.status.inProgress'),  pillClass: 'bg-[var(--progress-soft)] text-[var(--progress)] border border-[var(--progress-line)]' },
    CLEAN:      { label: t('housekeeping.page.roomItem.status.clean'),      pillClass: 'bg-[var(--info-soft)] text-[var(--info)] border border-[var(--info-line)]' },
    INSPECTED:  { label: t('housekeeping.page.roomItem.status.inspectedReady'), pillClass: 'bg-[var(--ready-soft)] text-[var(--ready)] border border-[var(--ready-line)]' },
    OOO:        { label: t('housekeeping.page.roomItem.status.ooo'), pillClass: 'bg-[var(--blocked-soft)] text-[var(--blocked)] border border-[var(--blocked-line)]' },
  }
  const cfg = statusConfig[status] ?? { label: status, pillClass: 'bg-surface-3 text-ink3 border border-line' }

  useEffect(() => {
    setDonePending(false)
    setUndoPending(false)
  }, [status])

  async function handle(newStatus: string, e: React.MouseEvent) {
    e.stopPropagation()
    setLoading(true)
    try { await onAction(room.room_id, newStatus) } finally { setLoading(false) }
  }

  function handleDonePress(e: React.MouseEvent) {
    e.stopPropagation()
    if (!donePending) {
      setUndoPending(false)
      setDonePending(true)
      return
    }
    setDonePending(false)
    setLoading(true)
    onAction(room.room_id, 'CLEAN').finally(() => setLoading(false))
  }

  function cancelDone(e: React.MouseEvent) {
    e.stopPropagation()
    setDonePending(false)
  }

  function handleUndoPress(e: React.MouseEvent) {
    e.stopPropagation()
    if (!undoPending) {
      setDonePending(false)
      setUndoPending(true)
      return
    }
    setUndoPending(false)
    setLoading(true)
    onUndo(room.room_id).finally(() => setLoading(false))
  }

  function cancelUndo(e: React.MouseEvent) {
    e.stopPropagation()
    setUndoPending(false)
  }

  const doneButton = donePending ? (
    <div className="flex flex-col gap-1 items-end">
      <Button variant="primary" size="sm" loading={loading} onClick={handleDonePress} className="bg-[var(--ready)]">
        {t('housekeeping.page.roomItem.confirmDone')}
      </Button>
      <Button variant="ghost" size="sm" onClick={cancelDone} className="text-ink3">
        {t('housekeeping.page.roomItem.cancel')}
      </Button>
    </div>
  ) : (
    <Button variant="primary" loading={loading} onClick={handleDonePress} className="bg-[var(--ready)]">
      {t('housekeeping.page.roomItem.done')}
    </Button>
  )

  const undoButton = undoPending ? (
    <div className="flex flex-col gap-1 items-end">
      <Button variant="primary" size="sm" loading={loading} onClick={handleUndoPress} className="bg-[var(--alert)]">
        {t('housekeeping.page.roomItem.confirmUndo')}
      </Button>
      <Button variant="ghost" size="sm" onClick={cancelUndo} className="text-ink3">
        {t('housekeeping.page.roomItem.cancel')}
      </Button>
    </div>
  ) : (
    <Button variant="outline" size="sm" loading={loading} onClick={handleUndoPress}>
      {t('housekeeping.page.roomItem.undo')}
    </Button>
  )

  return (
    <Card
      className="flex items-center justify-between gap-3 p-4 active:bg-surface-2 transition-colors"
      onClick={() => onOpenDetail(room)}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono font-semibold text-base text-ink">{t('housekeeping.page.roomItem.roomLabel', { number: roomNumber })}</span>
          {vip && (
            <Pill tone="accent" size="sm">{t('housekeeping.roomCard.vip')}</Pill>
          )}
        </div>
        {roomType && <p className="text-xs text-ink3 font-mono">{roomType}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.pillClass}`}>
            {cfg.label}
          </span>
          {cleanTypeLabel && (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${CLEAN_TYPE_TEXT_COLOR[room.clean_type] ?? 'text-ink3'}`}>
              {room.clean_type === 'DEP' && <LogOut className="h-2.5 w-2.5" />}
              {cleanTypeLabel}
            </span>
          )}
        </div>
        {checkoutTime && (
          <div className="flex items-center gap-1 mt-1.5">
            <Clock className="h-3 w-3 text-ink3 shrink-0" />
            <span className="text-xs font-mono text-ink2">{checkoutLabel} {checkoutTime}</span>
          </div>
        )}
        {showHint && <p className="text-xs text-ink3 mt-1">{t('housekeeping.page.roomItem.notesHint')}</p>}
        {(workOrderLabel || latestNote) && (
          <div className="mt-2 space-y-1">
            {workOrderLabel && (
              <div className="flex items-center gap-1.5 min-w-0 text-xs text-orange-700">
                <Wrench className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{workOrderLabel}</span>
              </div>
            )}
            {latestNote && (
              <div className="flex items-center gap-1.5 min-w-0 text-xs text-ink3">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{latestNote}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        {(status === 'DIRTY' || status === 'PICKUP' || status === 'OCCUPIED') && (
          <Button variant="primary" loading={loading} onClick={(e) => handle('IN_PROGRESS', e)}>
            {t('housekeeping.page.roomItem.start')}
          </Button>
        )}
        {status === 'IN_PROGRESS' && (
          <div className="flex flex-col gap-1.5 items-end">
            {donePending ? (
              doneButton
            ) : undoPending ? (
              undoButton
            ) : (
              <>
                {doneButton}
                {undoButton}
              </>
            )}
          </div>
        )}
        {status === 'CLEAN' && (
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-xs text-[var(--caution)] font-medium">
              {t('housekeeping.page.roomItem.waitingForLine1')}<br />{t('housekeeping.page.roomItem.waitingForLine2')}
            </span>
            {undoButton}
          </div>
        )}
        {status === 'INSPECTED' && (
          <span className="text-sm text-[var(--ready)] font-semibold">{readyLabel}</span>
        )}
      </div>
    </Card>
  )
}

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

function HousekeeperMyRoomsView() {
  const { t } = useTranslation()
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
        clean_type: statusRow.clean_type ?? room.clean_type,
        status: getEffectiveRoomStatusForCleanType(
          statusRow.status,
          statusRow.clean_type ?? room.clean_type,
          statusRow.fo_status ?? room.fo_status,
        ),
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
    queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
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
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
    }
  }

  const todoCount = myRooms.filter((r: any) => r.status === 'DIRTY' || r.status === 'PICKUP' || r.status === 'OCCUPIED').length
  const inProgressCount = myRooms.filter((r: any) => r.status === 'IN_PROGRESS').length
  const doneCount = myRooms.filter((r: any) => r.status === 'INSPECTED').length

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <PageHeader title={t('housekeeping.page.myRooms.heading')} subtitle={format(new Date(), 'EEEE, MMMM d')} />

      {myRooms.length > 0 && (
        <Card hover={false} className="flex gap-5 px-4 py-3 text-sm">
          <span><strong className="font-display text-[var(--alert)]">{todoCount}</strong> <span className="text-ink3">{t('housekeeping.page.myRooms.todo')}</span></span>
          <span><strong className="font-display text-[var(--progress)]">{inProgressCount}</strong> <span className="text-ink3">{t('housekeeping.page.myRooms.inProgress')}</span></span>
          <span><strong className="font-display text-[var(--ready)]">{doneCount}</strong> <span className="text-ink3">{t('housekeeping.page.myRooms.done')}</span></span>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-surface-3 rounded-[var(--r-lg)] animate-pulse" />
          ))}
        </div>
      ) : myRooms.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-ink3">{t('housekeeping.page.myRooms.emptyTitle')}</p>
          <p className="text-ink4 text-sm mt-1">{t('housekeeping.page.myRooms.emptySubtitle')}</p>
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
      />
    </div>
  )
}

// -- Supervisor / GM board view -----------------------------------------------

function SupervisorHousekeepingPage() {
  const { t } = useTranslation()
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

  useEffect(() => {
    if (assignmentMode && !canAssignRooms) toggleAssignmentMode()
  }, [assignmentMode, canAssignRooms, toggleAssignmentMode])

  const [predictions, setPredictions] = useState<RoomPrediction[]>([])
  const [predictionsLoading, setPredictionsLoading] = useState(false)

  const fetchPredictions = useCallback(async () => {
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
  }, [setLastSyncedAt])

  useEffect(() => {
    fetchPredictions()
  }, [selectedDate, fetchPredictions])

  const navigate = (delta: number) => {
    const current = parseISO(selectedDate)
    setSelectedDate(format(addDays(current, delta), 'yyyy-MM-dd'))
  }

  const displayRooms = useMemo(() =>
    rooms.map((room: any) => {
      const status = getEffectiveRoomStatusForCleanType(room.status, room.clean_type, room.fo_status)
      if (status === room.status) return room
      return { ...room, status }
    }),
    [rooms],
  )

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader
        eyebrow={t('housekeeping.page.board.eyebrow')}
        title={t('housekeeping.page.board.title')}
        meta={<SyncBadge lastSyncedAt={lastSyncedAt} />}
        actions={
          <>
            {/* Date navigation */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(-1)}
              aria-label={t('housekeeping.page.board.previousDay')}
            >
              &larr; {format(addDays(parseISO(selectedDate), -1), 'MMM d')}
            </Button>
            <span className="px-3 py-1.5 rounded-lg bg-surface border border-line text-sm font-semibold text-ink">
              {format(parseISO(selectedDate), 'MMM d')}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(1)}
              aria-label={t('housekeeping.page.board.nextDay')}
            >
              {format(addDays(parseISO(selectedDate), 1), 'MMM d')} &rarr;
            </Button>
            <select
              value={selectedShift ?? ''}
              onChange={(e) => setSelectedShift(e.target.value || null)}
              className="px-2.5 py-2 rounded-lg border border-line text-xs text-ink2 bg-surface hover:border-line-2 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors"
            >
              {SHIFTS.map((s) => (
                <option key={s.value} value={s.value}>{t(`housekeeping.page.shifts.${s.key}`)}</option>
              ))}
            </select>
            {canAssignRooms && (
              <Button
                variant={assignmentMode ? 'primary' : 'secondary'}
                onClick={toggleAssignmentMode}
              >
                {assignmentMode ? t('housekeeping.page.board.exitAssign') : t('housekeeping.page.board.assignMode')}
              </Button>
            )}
          </>
        }
      />

      {/* Prediction alerts */}
      {predictions.some((p) => p.risk_level === 'HIGH' || p.risk_level === 'MEDIUM') && (
        <PredictionPanel
          predictions={predictions}
          isLoading={predictionsLoading}
          canAssignRooms={canAssignRooms}
          onActionComplete={fetchPredictions}
        />
      )}

      {/* Housekeeper chip bar (assign mode) */}
      {assignmentMode && canAssignRooms && <HousekeeperBar />}

      {/* Main layout */}
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0">
          <Suspense>
            <RoomStatusBoard />
          </Suspense>
        </div>
        {assignmentMode && canAssignRooms && (
          <div className="hidden lg:block">
            <AssignmentSidebar />
          </div>
        )}
      </div>
    </div>
  )
}

// -- Role-gated entry point ---------------------------------------------------

export default function HousekeepingPage() {
  const { t } = useTranslation()
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
        <p className="text-sm text-ink3">{t('housekeeping.page.noAccess')}</p>
      </div>
    )
  }

  return <SupervisorHousekeepingPage />
}
