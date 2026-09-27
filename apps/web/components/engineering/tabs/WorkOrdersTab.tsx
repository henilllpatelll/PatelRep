'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Columns3, MoreHorizontal, Search, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { engineeringApi, type WorkOrder, type WorkOrderStats, type WorkOrderStatus } from '@/lib/api/engineering'
import { roomUnavailabilityApi } from '@/lib/api/rooms'
import { staffApi } from '@/lib/api/staff'
import { ApiClientError } from '@/lib/api/client'
import { createClient } from '@/lib/supabase/client'
import { groupWorkOrderQueue, orderWorkOrders } from '@/lib/utils/workOrderQueue'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { CreateWorkOrderDrawer } from '@/components/engineering/CreateWorkOrderDrawer'
import { WorkOrderDetailDrawer } from '@/components/engineering/WorkOrderDetailDrawer'
import { BulkArchiveModal } from '@/components/engineering/BulkArchiveModal'
import { EngineeringBoardView, type DrawerAutoAction, type DropOutcome } from '@/components/engineering/board/EngineeringBoardView'
import { EngineeringConsoleView } from '@/components/engineering/board/EngineeringConsoleView'

type KanbanStatus = Extract<WorkOrderStatus, 'open' | 'escalated' | 'in_progress' | 'on_hold' | 'completed'>
type View = 'queue' | 'board'
type QuickFilter = 'active' | 'critical' | 'ooo' | 'unassigned' | 'mine' | 'waiting' | null

const CATEGORIES = ['plumbing', 'electrical', 'hvac', 'furniture', 'appliance', 'structural', 'safety', 'general']

interface WorkOrdersTabProps {
  hotelId: string
  isEngineer: boolean
  userId?: string
  canManage: boolean
  focusId: string | null
  showCreateModal: boolean
  onCloseCreateModal: () => void
  onRequestCreate: () => void
  showArchiveModal: boolean
  onCloseArchiveModal: () => void
  onRequestArchive: () => void
  onRequestReliability: () => void
}

export function WorkOrdersTab({
  hotelId, isEngineer, userId, focusId, showCreateModal, onCloseCreateModal, showArchiveModal,
  onCloseArchiveModal, onRequestArchive, onRequestReliability,
}: WorkOrdersTabProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const toast = useToast()
  const appliedFocusRef = useRef<string | null>(null)
  const [view, setView] = useState<View>('queue')
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerAutoAction, setDrawerAutoAction] = useState<DrawerAutoAction>()
  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<string[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])
  const [completedExpanded, setCompletedExpanded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !drawerOpen) {
        setFiltersOpen(false)
        setMoreOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [drawerOpen])

  useEffect(() => {
    if (!hotelId) return
    const supabase = createClient()
    const channel = supabase.channel('wo_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders', filter: `tenant_id=eq.${hotelId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['work-orders'] })
        queryClient.invalidateQueries({ queryKey: ['work-order-stats'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [hotelId, queryClient])

  const queryOptions = (status: KanbanStatus) => ({
    queryKey: ['work-orders', status, isEngineer ? userId : null] as const,
    queryFn: () => engineeringApi.listWorkOrders({ status, assigned_to: isEngineer ? userId : undefined, per_page: 50 }),
    refetchInterval: 60_000,
    enabled: !!hotelId,
  })
  const openQ = useQuery(queryOptions('open'))
  const escalatedQ = useQuery(queryOptions('escalated'))
  const progressQ = useQuery(queryOptions('in_progress'))
  const holdQ = useQuery(queryOptions('on_hold'))
  const completedQ = useQuery(queryOptions('completed'))
  const statsQ = useQuery({
    queryKey: ['work-order-stats'], queryFn: () => engineeringApi.getWorkOrderStats(),
    select: (response) => response.data as WorkOrderStats, refetchInterval: 60_000, enabled: !!hotelId,
  })
  const staffQ = useQuery({ queryKey: ['staff-picker'], queryFn: () => staffApi.list(), staleTime: 300_000, enabled: !!hotelId })
  const unavailableRoomsQ = useQuery({ queryKey: ['room-unavailability-active-list'], queryFn: () => roomUnavailabilityApi.list('ACTIVE'), staleTime: 60_000, enabled: !!hotelId })

  const allWorkOrders = useMemo(() => [
    ...(openQ.data?.data ?? []), ...(escalatedQ.data?.data ?? []), ...(progressQ.data?.data ?? []),
    ...(holdQ.data?.data ?? []), ...(completedQ.data?.data ?? []),
  ], [openQ.data, escalatedQ.data, progressQ.data, holdQ.data, completedQ.data])
  const staffNames = useMemo(() => new Map((staffQ.data?.data.staff ?? []).map((staff) => [staff.user_id, staff.full_name])), [staffQ.data])
  const unavailableRoomIds = useMemo(() => new Set((unavailableRoomsQ.data?.data ?? []).map((period) => period.room_id)), [unavailableRoomsQ.data])
  const isLoading = [openQ, escalatedQ, progressQ, holdQ, completedQ].some((query) => query.isLoading)
  const isError = [openQ, escalatedQ, progressQ, holdQ, completedQ].some((query) => query.isError)
  const refetchAll = () => [openQ, escalatedQ, progressQ, holdQ, completedQ].forEach((query) => query.refetch())

  const visibleWorkOrders = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = allWorkOrders.filter((workOrder) => {
      if (priorityFilter.length && !priorityFilter.includes(workOrder.priority)) return false
      if (categoryFilter.length && !categoryFilter.includes(workOrder.category)) return false
      if (needle && ![workOrder.title, workOrder.category, workOrder.location_text, workOrder.rooms?.room_number, workOrder.work_order_number].some((value) => String(value ?? '').toLowerCase().includes(needle))) return false
      if (quickFilter === 'active') return !['completed', 'cancelled'].includes(workOrder.status)
      if (quickFilter === 'critical') return ['emergency', 'urgent'].includes(workOrder.priority)
      if (quickFilter === 'ooo') return !!workOrder.room_id && unavailableRoomIds.has(workOrder.room_id)
      if (quickFilter === 'unassigned') return !workOrder.assigned_to
      if (quickFilter === 'mine') return !!userId && workOrder.assigned_to === userId
      if (quickFilter === 'waiting') return workOrder.status === 'on_hold'
      return true
    })
    return orderWorkOrders(filtered, new Date(), unavailableRoomIds)
  }, [allWorkOrders, categoryFilter, priorityFilter, quickFilter, search, unavailableRoomIds, userId])
  const queueGroups = useMemo(() => groupWorkOrderQueue(visibleWorkOrders, new Date(), unavailableRoomIds), [unavailableRoomIds, visibleWorkOrders])
  const emergencyCount = allWorkOrders.filter((workOrder) => workOrder.priority === 'emergency' && workOrder.status !== 'completed').length
  const selectedRoomUnavailability = useQuery({ queryKey: ['room-unavailability-active', selectedWO?.room_id], queryFn: () => roomUnavailabilityApi.getActiveForRoom(selectedWO!.room_id!), enabled: !!selectedWO?.room_id })

  useEffect(() => { if (!selectedWO && visibleWorkOrders[0]) setSelectedWO(visibleWorkOrders[0]) }, [selectedWO, visibleWorkOrders])
  useEffect(() => {
    if (!focusId || appliedFocusRef.current === focusId) return
    const target = allWorkOrders.find((workOrder) => workOrder.id === focusId)
    if (!target) return
    appliedFocusRef.current = focusId
    setSelectedWO(target)
    setDrawerOpen(true)
  }, [allWorkOrders, focusId])

  const claimMutation = useMutation({ mutationFn: (id: string) => engineeringApi.claimWorkOrder(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-orders'] }) })
  const quickTransitionMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'in_progress' }) => engineeringApi.transitionWorkOrder(id, { status, source: 'web' }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-orders'] }) })
  const openDrawerFor = (workOrder: WorkOrder, autoAction?: DrawerAutoAction) => { setSelectedWO(workOrder); setDrawerAutoAction(autoAction); setDrawerOpen(true) }
  const handleQueueSelect = (workOrder: WorkOrder) => isMobile ? openDrawerFor(workOrder) : (setSelectedWO(workOrder), setDrawerAutoAction(undefined))
  const handleDrop = async (workOrder: WorkOrder, outcome: DropOutcome) => {
    if (outcome.kind === 'noop') return
    if (outcome.kind === 'blocked') return toast.error(t('engineering.workOrdersPage.moveBlocked', { id: `WO-${workOrder.work_order_number}` }))
    if (outcome.kind === 'auto') return openDrawerFor(workOrder, outcome.action)
    try {
      if (outcome.kind === 'claim') await claimMutation.mutateAsync(workOrder.id)
      else await quickTransitionMutation.mutateAsync({ id: workOrder.id, status: outcome.status })
      toast.success(t('engineering.workOrdersPage.moveToast', { id: `WO-${workOrder.work_order_number}`, column: t('engineering.workOrdersPage.columnInProgress') }))
    } catch (error) { toast.error(error instanceof ApiClientError ? error.message : t('engineering.workOrderDetail.transitionError')) }
  }

  const quickFilters: { key: Exclude<QuickFilter, null>; label: string }[] = [
    { key: 'active', label: t('engineering.workOrdersPage.quickActive') }, { key: 'critical', label: t('engineering.workOrdersPage.quickCritical') },
    { key: 'ooo', label: t('engineering.workOrdersPage.quickOOO') }, { key: 'unassigned', label: t('engineering.workOrdersPage.quickUnassigned') },
    { key: 'mine', label: t('engineering.workOrdersPage.quickMine') }, { key: 'waiting', label: t('engineering.workOrdersPage.quickWaiting') },
  ]

  return <div className="space-y-3">
    <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-[var(--r-md)] border border-line bg-surface sm:grid-cols-5 sm:divide-y-0">
      {[
        [t('engineering.workOrdersPage.metricActive'), statsQ.data?.open ?? 0, 'text-ink'], [t('engineering.workOrdersPage.metricEmergency'), emergencyCount, emergencyCount ? 'text-[var(--alert)]' : 'text-ink'],
        [t('engineering.workOrdersPage.metricOverdue'), statsQ.data?.overdue ?? 0, statsQ.data?.overdue ? 'text-[var(--alert)]' : 'text-ink'], [t('engineering.workOrdersPage.metricUnassigned'), statsQ.data?.unassigned ?? 0, statsQ.data?.unassigned ? 'text-[var(--caution)]' : 'text-ink'],
        [t('engineering.workOrdersPage.metricWaiting'), statsQ.data?.on_hold ?? 0, statsQ.data?.on_hold ? 'text-[var(--caution)]' : 'text-ink'],
      ].map(([label, value, tone]) => <div key={String(label)} className="flex items-baseline gap-1.5 px-3 py-2.5"><span className={`font-mono text-[15px] font-semibold ${tone}`}>{value}</span><span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink3">{label}</span></div>)}
    </div>

    <div className="flex flex-wrap items-center gap-2" aria-label={t('engineering.workOrdersPage.queueControlsAria')}>
      <label className="relative min-w-[13rem] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink3" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('engineering.workOrdersPage.searchPlaceholder')} className="min-h-[36px] w-full rounded-[var(--r-md)] border border-line bg-surface px-3 pl-9 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>
      <div className="order-3 flex w-full gap-1 overflow-x-auto pb-0.5 lg:order-none lg:w-auto">{quickFilters.map((filter) => <button key={filter.key} type="button" onClick={() => setQuickFilter((current) => current === filter.key ? null : filter.key)} className={`min-h-[32px] shrink-0 rounded-[var(--r-sm)] border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${quickFilter === filter.key ? 'border-accent bg-[var(--accent-soft)] text-accent' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}>{filter.label}</button>)}</div>
      <Button variant="outline" size="sm" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}><SlidersHorizontal className="h-3.5 w-3.5" />{t('engineering.workOrdersPage.filters')}</Button>
      <div className="flex items-center rounded-[var(--r-md)] border border-line bg-surface p-0.5" aria-label={t('engineering.workOrdersPage.viewLabel')}>
        <button type="button" onClick={() => setView('queue')} aria-pressed={view === 'queue'} className={`inline-flex min-h-[30px] items-center gap-1 rounded-[5px] px-2 text-xs font-medium ${view === 'queue' ? 'bg-surface-3 text-ink' : 'text-ink3 hover:text-ink'}`}>
          <Columns3 className="h-3.5 w-3.5" />{t('engineering.workOrdersPage.viewQueue')}
        </button>
        <button type="button" onClick={() => setView('board')} aria-pressed={view === 'board'} className={`inline-flex min-h-[30px] items-center gap-1 rounded-[5px] px-2 text-xs font-medium ${view === 'board' ? 'bg-surface-3 text-ink' : 'text-ink3 hover:text-ink'}`}>
          <Columns3 className="h-3.5 w-3.5" />{t('engineering.workOrdersPage.viewBoard')}
        </button>
      </div>
      <div className="relative"><Button variant="ghost" size="sm" aria-label={t('engineering.workOrdersPage.moreActions')} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal className="h-4 w-4" /></Button>{moreOpen && <div role="menu" className="absolute right-0 z-10 mt-1 w-52 rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-[var(--shadow-md)]"><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onRequestArchive() }} className="w-full rounded px-2.5 py-2 text-left text-sm text-ink2 hover:bg-surface-2">{t('engineering.workOrdersPage.archiveAction')}</button><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onRequestReliability() }} className="w-full rounded px-2.5 py-2 text-left text-sm text-ink2 hover:bg-surface-2">{t('engineering.workOrdersPage.tabReliability')}</button></div>}</div>
    </div>

    {filtersOpen && <div className="flex flex-wrap gap-4 rounded-[var(--r-md)] border border-line bg-surface-2 p-3"><div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-ink3">{t('engineering.commandCenter.filterPriority')}</span>{['emergency', 'urgent', 'normal', 'low'].map((priority) => <button key={priority} type="button" onClick={() => setPriorityFilter((current) => current.includes(priority) ? current.filter((value) => value !== priority) : [...current, priority])} className={`rounded-[var(--r-sm)] px-2 py-1 text-xs ${priorityFilter.includes(priority) ? 'bg-ink text-paper' : 'border border-line bg-surface text-ink2'}`}>{priority}</button>)}</div><div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-ink3">{t('engineering.commandCenter.filterCategory')}</span>{CATEGORIES.map((category) => <button key={category} type="button" onClick={() => setCategoryFilter((current) => current.includes(category) ? current.filter((value) => value !== category) : [...current, category])} className={`rounded-[var(--r-sm)] px-2 py-1 text-xs ${categoryFilter.includes(category) ? 'bg-ink text-paper' : 'border border-line bg-surface text-ink2'}`}>{category}</button>)}</div></div>}

    {view === 'queue' ? <EngineeringConsoleView workOrders={visibleWorkOrders} groups={queueGroups} isLoading={isLoading} isError={isError} onRetry={refetchAll} selected={selectedWO} onSelect={handleQueueSelect} onUpdate={() => queryClient.invalidateQueries({ queryKey: ['work-orders'] })} roomUnavailability={selectedRoomUnavailability.data?.data ?? null} staffNames={staffNames} completedExpanded={completedExpanded} onCompletedExpandedChange={setCompletedExpanded} /> : <EngineeringBoardView workOrders={visibleWorkOrders} isLoading={isLoading} isError={isError} onRetry={refetchAll} stats={statsQ.data} predictions={[]} predictionsLoading={false} onCreateWOFromPrediction={() => undefined} onAcknowledgePrediction={() => undefined} predictionPendingId={null} selectedId={drawerOpen ? selectedWO?.id : undefined} onSelect={(workOrder) => openDrawerFor(workOrder)} onDrop={handleDrop} showRail={false} staffNames={staffNames} />}
    {showCreateModal && <CreateWorkOrderDrawer isOpen={showCreateModal} onClose={onCloseCreateModal} onCreate={() => { onCloseCreateModal(); queryClient.invalidateQueries({ queryKey: ['work-orders'] }) }} />}
    <BulkArchiveModal isOpen={showArchiveModal} onClose={onCloseArchiveModal} onArchived={() => queryClient.invalidateQueries({ queryKey: ['work-orders'] })} />
    <WorkOrderDetailDrawer wo={selectedWO} isOpen={drawerOpen} autoAction={drawerAutoAction} onClose={() => { setDrawerOpen(false); setDrawerAutoAction(undefined) }} onUpdate={() => queryClient.invalidateQueries({ queryKey: ['work-orders'] })} roomUnavailability={selectedRoomUnavailability.data?.data ?? null} />
  </div>
}
