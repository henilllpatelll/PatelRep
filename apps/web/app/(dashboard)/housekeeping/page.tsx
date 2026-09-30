'use client'

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { format, addDays, parseISO } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Clock, LogOut, MessageSquare, Phone, Wrench } from 'lucide-react'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { RoomStatusBoard } from '@/components/housekeeping/RoomStatusBoard'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { AssignmentWorkspace } from '@/components/housekeeping/AssignmentWorkspace'
import { OccupancyImportModal } from '@/components/housekeeping/OccupancyImportModal'
import { TeamPlan } from '@/components/housekeeping/TeamPlan'
import { BoardSearchInput } from '@/components/housekeeping/HousekeepingBoardShell'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { useAuth } from '@/lib/hooks/useAuth'
import { useRole } from '@/lib/hooks/useRole'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'
import { getCleanTypeShortLabel } from '@/lib/utils/cleanType'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Pill } from '@/components/ui/primitives'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { StateBlock } from '@/components/ui/StateBlock'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { ServiceAttemptForm } from '@/components/housekeeping/ServiceAttemptForm'
import { buildHousekeeperMyRoomsView } from '@/lib/housekeeping/housekeeperMyRooms'
import { normalizeHousekeepingRoom } from '@/lib/housekeeping/roomState'

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
    <span title={label} className={`inline-flex items-center gap-1.5 text-[12px] ${lastSyncedAt ? 'text-[var(--ready)]' : 'text-[var(--caution)]'}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${lastSyncedAt ? 'bg-ready animate-pulse' : 'bg-[var(--caution)]'}`} />
      {lastSyncedAt ? t('housekeeping.page.sync.live') : t('housekeeping.page.sync.delayed')}
    </span>
  )
}

// -- Housekeeper "my rooms" view ----------------------------------------------

function HousekeeperRoomItem({
  room,
  onAction,
  onUndo,
  onOpenDetail,
  onRecordAttempt,
  isBlocked = false,
  isReclean = false,
  v2,
}: {
  room: any
  onAction: (roomId: string, status: string) => Promise<void>
  onUndo: (roomId: string) => Promise<void>
  onOpenDetail: (room: any) => void
  onRecordAttempt?: (room: any) => void
  isBlocked?: boolean
  isReclean?: boolean
  v2?: boolean
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
  const status: string = room.dnd_flag ? 'DND' : room.do_not_service ? 'SERVICE_DECLINED' : room.status ?? 'DIRTY'
  const vip = !!room.vip_flag
  const rush = typeof room.priority === 'number' && room.priority <= 2
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
    DND:        { label: t('housekeeping.roomCard.status.dnd'), pillClass: 'bg-surface-3 text-ink2 border border-line' },
    SERVICE_DECLINED: { label: t('housekeeping.roomCard.status.serviceDeclined'), pillClass: 'bg-surface-3 text-ink2 border border-line' },
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
    <Card className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono font-semibold text-base text-ink">{t('housekeeping.page.roomItem.roomLabel', { number: roomNumber })}</span>
          {vip && (
            <Pill tone="accent" size="sm">{t('housekeeping.roomCard.vip')}</Pill>
          )}
          {rush && <Pill tone="alert" size="sm">{t('housekeeping.boardV2.attention.categories.rush')}</Pill>}
          {isReclean && <Pill tone="alert" size="sm">{t('housekeeping.page.myRooms.reclean')}</Pill>}
        </div>
        {roomType && <p className="text-xs text-ink3 font-mono">{roomType}</p>}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${v2 ? 'font-normal' : 'font-medium'} ${cfg.pillClass}`}>
            {cfg.label}
          </span>
          {cleanTypeLabel && (
            <span className={`inline-flex items-center gap-0.5 ${v2 ? 'text-xs font-normal' : 'text-[10px] font-semibold'} ${CLEAN_TYPE_TEXT_COLOR[room.clean_type] ?? 'text-ink3'}`}>
              {room.clean_type === 'DEP' && <LogOut className="h-2.5 w-2.5" />}
              {cleanTypeLabel}
            </span>
          )}
        </div>
        {isReclean && Array.isArray(room.reclean_corrections) && room.reclean_corrections.length > 0 && (
          <div className="mt-1.5">
            <p className="text-xs font-semibold text-[var(--alert)]">{t('housekeeping.page.myRooms.correctionsCount', { count: room.reclean_corrections.length })}</p>
            <ul className="mt-0.5 space-y-0.5">
              {room.reclean_corrections.map((correction: string, i: number) => (
                <li key={i} className="text-xs text-ink2">• {correction}</li>
              ))}
            </ul>
          </div>
        )}
        {checkoutTime && (
          <div className="flex items-center gap-1 mt-1.5">
            <Clock className="h-3 w-3 text-ink3 shrink-0" />
            <span className="text-xs font-mono text-ink2">{checkoutLabel} {checkoutTime}</span>
          </div>
        )}
        {room.priority_needed_by && (
          <div className="flex items-center gap-1 mt-1.5">
            <Clock className="h-3 w-3 text-ink3 shrink-0" aria-hidden="true" />
            <span className="text-xs font-mono text-ink2">{t('housekeeping.page.myRooms.neededBy', { time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(room.priority_needed_by)) })}</span>
          </div>
        )}
        {room.checkin_time && !room.priority_needed_by && (
          <div className="flex items-center gap-1 mt-1.5">
            <Clock className="h-3 w-3 text-ink3 shrink-0" aria-hidden="true" />
            <span className="text-xs font-mono text-ink2">{t('housekeeping.roomCard.timing.arrival', { time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(room.checkin_time)) })}</span>
          </div>
        )}
        {room.priority_reason && (
          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--alert)]"><AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />{room.priority_reason}</p>
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
        {isBlocked && status === 'DND' && onRecordAttempt && (
          <Button variant="outline" onClick={() => onRecordAttempt(room)}>
            {t('housekeeping.page.myRooms.recordAttempt')}
          </Button>
        )}
        {isBlocked && status !== 'DND' && (
          <Button variant="outline" onClick={() => onOpenDetail(room)}>
            {t('housekeeping.page.myRooms.viewDetails')}
          </Button>
        )}
        {!isBlocked && (status === 'DIRTY' || status === 'PICKUP' || status === 'OCCUPIED') && (
          <Button variant="primary" loading={loading} onClick={(e) => handle('IN_PROGRESS', e)}>
            {isReclean ? t('housekeeping.page.myRooms.startReclean') : t('housekeeping.page.myRooms.startCleaning')}
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
        {status === 'IN_PROGRESS' && (
          <Button variant="ghost" size="sm" onClick={() => onOpenDetail(room)}>
            {t('housekeeping.page.myRooms.reportIssue')}
          </Button>
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
        <Button variant="ghost" size="sm" onClick={() => onOpenDetail(room)} className="mt-1">
          {t('housekeeping.page.myRooms.viewDetails')}
        </Button>
      </div>
    </Card>
  )
}

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

function HousekeeperMyRoomsView({ v2 }: { v2: boolean }) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const toast = useToast()
  const hotelId = getHotelIdFromToken(session?.access_token)
  const today = format(new Date(), 'yyyy-MM-dd')
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)
  const [attemptRoom, setAttemptRoom] = useState<any | null>(null)
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')

  const { data: myRoomsData, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-rooms', today],
    queryFn: () => housekeepingApi.getMyRooms(today),
    refetchInterval: 60_000,
  })

  const rawRooms = useMemo(() => ((myRoomsData as { data?: any[] } | undefined)?.data ?? []), [myRoomsData])
  const roomView = useMemo(
    () => buildHousekeeperMyRoomsView(rawRooms.map(normalizeHousekeepingRoom)),
    [rawRooms],
  )
  const rawRoomById = useMemo(
    () => new Map(rawRooms.map((room) => [room.room_id, room])),
    [rawRooms],
  )

  useEffect(() => {
    if (!hotelId) return
    if (session?.access_token) supabase.realtime.setAuth(session.access_token)

    const invalidate = () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      realtimeDebounce.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['my-rooms', today] })
      }, 500)
    }

    const channel = supabase
      .channel('hk_my_rooms_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_status', filter: `tenant_id=eq.${hotelId}` }, () => {
        invalidate()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_assignments', filter: `tenant_id=eq.${hotelId}` }, invalidate)
      .subscribe((status) => {
        setRealtimeState(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'reconnecting' : 'connecting')
      })
    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
      supabase.removeChannel(channel)
    }
  }, [hotelId, queryClient, session?.access_token, supabase, today])

  async function handleAction(roomId: string, status: string) {
    queryClient.setQueryData(['my-rooms', today], (old: any) => {
      if (!old?.data) return old
      return { ...old, data: (old.data as any[]).map((r: any) => r.room_id === roomId ? { ...r, status } : r) }
    })
    setSelectedRoom((prev: any) => prev?.room_id === roomId ? { ...prev, status } : prev)
    try {
      await housekeepingApi.updateRoomStatus(roomId, status)
    } catch {
      toast.error(t('housekeeping.page.myRooms.actionError'))
      queryClient.invalidateQueries({ queryKey: ['my-rooms', today] })
      return
    }
    toast.success(status === 'IN_PROGRESS' ? t('housekeeping.page.myRooms.started') : t('housekeeping.page.myRooms.completionQueued'))
    queryClient.invalidateQueries({ queryKey: ['my-rooms', today] })
    queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
  }

  async function handleUndo(roomId: string) {
    try {
      const response: any = await housekeepingApi.undoRoomStatus(roomId)
      const nextStatus = response?.data?.status
      if (nextStatus) {
        queryClient.setQueryData(['my-rooms', today], (old: any) => {
          if (!old?.data) return old
          return { ...old, data: (old.data as any[]).map((r: any) => r.room_id === roomId ? { ...r, status: nextStatus } : r) }
        })
        setSelectedRoom((prev: any) => prev?.room_id === roomId ? { ...prev, status: nextStatus } : prev)
      }
    } finally {
      queryClient.invalidateQueries({ queryKey: ['my-rooms', today] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
    }
  }

  const openRoom = (roomId: string) => {
    const room = rawRoomById.get(roomId)
    if (room) setSelectedRoom(room)
  }

  const renderRoom = (roomId: string, options?: { blocked?: boolean; reclean?: boolean }) => {
    const room = rawRoomById.get(roomId)
    if (!room) return null
    return (
      <HousekeeperRoomItem
        key={roomId}
        room={room}
        onAction={handleAction}
        onUndo={handleUndo}
        onOpenDetail={setSelectedRoom}
        onRecordAttempt={setAttemptRoom}
        isBlocked={options?.blocked}
        isReclean={options?.reclean}
        v2={v2}
      />
    )
  }

  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date())
  const realtimeLabel = realtimeState === 'connected'
    ? t('housekeeping.page.myRooms.realtimeConnected')
    : realtimeState === 'reconnecting'
      ? t('housekeeping.page.myRooms.reconnecting')
      : t('housekeeping.page.myRooms.connecting')
  const allAssignedComplete = rawRooms.length > 0
    && !roomView.upNext
    && roomView.active.length === 0
    && roomView.reclean.length === 0
    && roomView.toDo.length === 0
    && roomView.blocked.length === 0

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <PageHeader
        title={t('housekeeping.page.myRooms.heading')}
        subtitle={dateLabel}
        dataI18nSkip={v2}
      />

      <p className="text-xs text-ink3" role="status" aria-live="polite">{realtimeLabel}</p>

      {rawRooms.length > 0 && (
        <Card hover={false} className="grid grid-cols-3 gap-2 px-4 py-3 text-center text-sm">
          <span><strong className="block text-xl font-display font-semibold text-[var(--alert)]">{roomView.counts.toDo}</strong><span className="text-ink3">{t('housekeeping.page.myRooms.todo')}</span></span>
          <span><strong className="block text-xl font-display font-semibold text-[var(--progress)]">{roomView.counts.cleaning}</strong><span className="text-ink3">{t('housekeeping.page.myRooms.inProgress')}</span></span>
          <span><strong className="block text-xl font-display font-semibold text-[var(--ready)]">{roomView.counts.done}</strong><span className="text-ink3">{t('housekeeping.page.myRooms.done')}</span></span>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="card" className="h-24" />
          ))}
        </div>
      ) : (
        <StateBlock
          status={(isError && !myRoomsData) ? 'error' : rawRooms.length === 0 ? 'empty' : null}
          error={{ message: t('housekeeping.page.myRooms.loadError'), onRetry: refetch }}
          empty={{ title: t('housekeeping.page.myRooms.emptyTitle'), body: t('housekeeping.page.myRooms.emptySubtitle') }}
        >
          <div className="space-y-6">
            {allAssignedComplete && (
              <Card hover={false} className="border-[var(--ready-line)] bg-[var(--ready-soft)]/40 p-4">
                <h2 className="text-base font-semibold text-ink">{t('housekeeping.page.myRooms.allCompleteTitle')}</h2>
                <p className="mt-1 text-sm text-ink2">{t('housekeeping.page.myRooms.allCompleteSummary', { ready: roomView.done.filter((room) => room.housekeepingStatus === 'INSPECTED').length, inspection: roomView.done.filter((room) => room.housekeepingStatus === 'CLEAN').length })}</p>
              </Card>
            )}
            {roomView.upNext && (
              <section aria-labelledby="my-rooms-up-next">
                <h2 id="my-rooms-up-next" className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink3">{t('housekeeping.page.myRooms.upNext')}</h2>
                {renderRoom(roomView.upNext.roomId, { reclean: roomView.upNext.recleanRequired })}
              </section>
            )}
            {roomView.active.length > 0 && (
              <section aria-labelledby="my-rooms-in-progress">
                <h2 id="my-rooms-in-progress" className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink3">{t('housekeeping.page.myRooms.inProgress')}</h2>
                <div className="space-y-2">{roomView.active.map((room) => renderRoom(room.roomId))}</div>
              </section>
            )}
            {roomView.reclean.length > 0 && (
              <section aria-labelledby="my-rooms-reclean">
                <h2 id="my-rooms-reclean" className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink3">{t('housekeeping.page.myRooms.reclean')}</h2>
                <div className="space-y-2">{roomView.reclean.map((room) => renderRoom(room.roomId, { reclean: true }))}</div>
              </section>
            )}
            {roomView.toDo.length > 0 && (
              <section aria-labelledby="my-rooms-to-do">
                <h2 id="my-rooms-to-do" className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink3">{t('housekeeping.page.myRooms.todo')}</h2>
                <div className="space-y-2">{roomView.toDo.map((room) => renderRoom(room.roomId))}</div>
              </section>
            )}
            {roomView.blocked.length > 0 && (
              <section aria-labelledby="my-rooms-blocked">
                <h2 id="my-rooms-blocked" className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-ink3"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('housekeeping.page.myRooms.blocked')}</h2>
                <div className="space-y-2">{roomView.blocked.map((room) => renderRoom(room.roomId, { blocked: true, reclean: room.recleanRequired }))}</div>
              </section>
            )}
            {roomView.done.length > 0 && (
              <section aria-labelledby="my-rooms-done">
                <h2 id="my-rooms-done" className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink3">{t('housekeeping.page.myRooms.done')}</h2>
                <div className="rounded-[var(--r-lg)] border border-line bg-surface px-3">
                  {roomView.done.map((room) => (
                    <button key={room.roomId} type="button" onClick={() => openRoom(room.roomId)} className="flex min-h-10 w-full items-center justify-between border-b border-line text-left text-sm text-ink last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
                      <span className="font-mono font-medium">{room.roomNumber}</span>
                      <span className={room.housekeepingStatus === 'INSPECTED' ? 'text-[var(--ready)]' : 'text-[var(--caution)]'}>{room.housekeepingStatus === 'INSPECTED' ? t('housekeeping.page.myRooms.ready') : t('housekeeping.page.myRooms.waitingForInspection')}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </StateBlock>
      )}
      <RoomDetailDrawer
        room={selectedRoom}
        isOpen={selectedRoom !== null}
        onClose={() => setSelectedRoom(null)}
        selectedDate={today}
      />
      {attemptRoom && (
        <ServiceAttemptForm
          roomId={attemptRoom.room_id}
          roomNumber={attemptRoom.rooms?.room_number ?? attemptRoom.room_number ?? '—'}
          open
          onClose={() => setAttemptRoom(null)}
        />
      )}
    </div>
  )
}

// -- Supervisor / GM board view -----------------------------------------------

function SupervisorHousekeepingPage({ v2 }: { v2: boolean }) {
  const { t } = useTranslation()
  const router = useRouter()
  const { canAssignRooms } = useRole()
  const {
    selectedDate,
    assignmentMode,
    lastSyncedAt,
    setSelectedDate,
    toggleAssignmentMode,
    boardSearch,
    setBoardSearch,
    setRoomSelection,
  } = useHousekeepingStore()

  useEffect(() => {
    if (assignmentMode && !canAssignRooms) toggleAssignmentMode()
  }, [assignmentMode, canAssignRooms, toggleAssignmentMode])

  const [showOperaImport, setShowOperaImport] = useState(false)
  const [showTeamPlan, setShowTeamPlan] = useState(false)

  const handleOpenAssignment = (roomIds?: string[]) => {
    if (roomIds && roomIds.length > 0) setRoomSelection(roomIds)
    if (!assignmentMode && canAssignRooms) toggleAssignmentMode()
    setShowTeamPlan(false)
  }

  const navigate = (delta: number) => {
    const current = parseISO(selectedDate)
    setSelectedDate(format(addDays(current, delta), 'yyyy-MM-dd'))
  }

  return (
    <div className="space-y-4">
      {showOperaImport && (
        <OccupancyImportModal
          date={selectedDate}
          onClose={() => setShowOperaImport(false)}
        />
      )}

      {/* Page header — Board/Routes stay a single persistent header with a tab
          switcher, instead of swapping to a differently-styled screen, so moving
          between them reads as one workspace rather than a jump to another page. */}
      <PageHeader
        title={t('housekeeping.page.board.eyebrow')}
        subtitle={t('housekeeping.boardV2.subtitle')}
        meta={<SyncBadge lastSyncedAt={lastSyncedAt} />}
        dataI18nSkip={v2}
        tabs={
          canAssignRooms
            ? [
                { label: t('housekeeping.page.board.boardTab'), active: !showTeamPlan, onClick: () => setShowTeamPlan(false) },
                { label: t('housekeeping.teamPlan.tabLabel'), active: showTeamPlan, onClick: () => setShowTeamPlan(true) },
              ]
            : undefined
        }
        actions={
          <>
            {!showTeamPlan && (
              <>
                {/* Date navigation */}
                <Button variant="outline" size="sm" onClick={() => navigate(-1)} aria-label={t('housekeeping.page.board.previousDay')}>&larr;</Button>
                <span className="px-3 py-1.5 rounded-lg bg-surface border border-line text-sm font-semibold text-ink whitespace-nowrap">
                  {format(parseISO(selectedDate), 'EEE, MMM d')}
                </span>
                <Button variant="outline" size="sm" onClick={() => navigate(1)} aria-label={t('housekeeping.page.board.nextDay')}>&rarr;</Button>
                <BoardSearchInput value={boardSearch} onChange={setBoardSearch} />
              </>
            )}
            {showTeamPlan && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/tasks?type=guest_request')}
              >
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                {t('housekeeping.teamPlan.logGuestRequest')}
              </Button>
            )}
            {canAssignRooms && (
              <>
                {!showTeamPlan && (
                  <>
                    <span className="w-px h-6 bg-line" aria-hidden="true" />
                    <Button
                      variant="secondary"
                      onClick={() => setShowOperaImport(true)}
                    >
                      {t('housekeeping.assignmentsPage.importFromOpera')}
                    </Button>
                  </>
                )}
                <Button
                  variant={assignmentMode ? 'primary' : 'secondary'}
                  onClick={toggleAssignmentMode}
                >
                  {assignmentMode ? t('housekeeping.page.board.exitAssign') : t('housekeeping.page.board.assignMode')}
                </Button>
              </>
            )}
          </>
        }
      />

      {showTeamPlan ? (
        <TeamPlan onOpenAssignment={handleOpenAssignment} />
      ) : assignmentMode && canAssignRooms ? (
        <AssignmentWorkspace />
      ) : (
        <Suspense>
          <RoomStatusBoard />
        </Suspense>
      )}
    </div>
  )
}

// -- Role-gated entry point ---------------------------------------------------

export default function HousekeepingPage() {
  const { t } = useTranslation()
  const { role } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('housekeeping', hotel)

  if (isAuthLoading || !role) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <p className="text-sm text-ink3">{t('housekeeping.roomStatus.loading')}</p>
        {v2 ? (
          <>
            <Skeleton className="h-8 w-56" />
            <Skeleton variant="card" className="h-24" />
            <Skeleton variant="card" className="h-72" />
          </>
        ) : (
          <>
            <div className="h-8 w-56 rounded-lg bg-surface-3 animate-pulse" />
            <div className="h-24 rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
            <div className="h-72 rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
          </>
        )}
      </div>
    )
  }

  if (role === 'housekeeper') {
    return <HousekeeperMyRoomsView v2={v2} />
  }

  if (role !== 'gm' && role !== 'housekeeping_supervisor' && role !== 'front_desk') {
    return v2 ? (
      <div className="flex items-center justify-center h-64">
        <EmptyState title={t('housekeeping.page.noAccess')} />
      </div>
    ) : (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-ink3">{t('housekeeping.page.noAccess')}</p>
      </div>
    )
  }

  return <SupervisorHousekeepingPage v2={v2} />
}
