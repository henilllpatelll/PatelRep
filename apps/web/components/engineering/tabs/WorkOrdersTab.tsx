'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Sparkles, Loader2, Search, SlidersHorizontal } from 'lucide-react'
import { engineeringApi, type FailurePrediction, type PMSchedule, type WorkOrder, type WorkOrderStats, type WorkOrderStatus } from '@/lib/api/engineering'
import { aiApi } from '@/lib/api/ai'
import { ApiClientError } from '@/lib/api/client'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { CreateWorkOrderDrawer } from '@/components/engineering/CreateWorkOrderDrawer'
import { WorkOrderDetailDrawer } from '@/components/engineering/WorkOrderDetailDrawer'
import { BulkArchiveModal } from '@/components/engineering/BulkArchiveModal'
import { EngineeringBoardView, type DrawerAutoAction, type DropOutcome } from '@/components/engineering/board/EngineeringBoardView'
import { EngineeringConsoleView } from '@/components/engineering/board/EngineeringConsoleView'
import { PMWeekGlance } from '@/components/engineering/board/PMWeekGlance'
import { roomUnavailabilityApi } from '@/lib/api/rooms'

// ── Types ────────────────────────────────────────────────────────────────────

type KanbanStatus = Extract<WorkOrderStatus, 'open' | 'escalated' | 'in_progress' | 'on_hold' | 'completed'>
type SubTab = 'board' | 'console' | 'week'

const CATEGORIES = ['plumbing', 'electrical', 'hvac', 'furniture', 'appliance', 'structural', 'safety', 'general']

// ── Helpers ──────────────────────────────────────────────────────────────────

function sortWOs(wos: WorkOrder[], aiTriageActive = false): WorkOrder[] {
  const priorityOrder = { emergency: 0, urgent: 1, normal: 2, low: 3 }
  return [...wos].sort((a, b) => {
    if (aiTriageActive) {
      const aOverdue = a.due_at ? new Date(a.due_at).getTime() < Date.now() : false
      const bOverdue = b.due_at ? new Date(b.due_at).getTime() < Date.now() : false
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
      if (!!a.assigned_to !== !!b.assigned_to) return a.assigned_to ? 1 : -1
    }
    const pa = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1
    const pb = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1
    if (pa !== pb) return pa - pb
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

// ── Tab ──────────────────────────────────────────────────────────────────────

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
}

export function WorkOrdersTab({
  hotelId,
  isEngineer,
  userId,
  canManage,
  focusId,
  showCreateModal,
  onCloseCreateModal,
  onRequestCreate,
  showArchiveModal,
  onCloseArchiveModal,
}: WorkOrdersTabProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const toast = useToast()
  const appliedFocusRef = useRef<string | null>(null)

  const [subTab, setSubTab] = useState<SubTab>('board')
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerAutoAction, setDrawerAutoAction] = useState<DrawerAutoAction | undefined>(undefined)
  const [aiTriageActive, setAiTriageActive] = useState(false)
  const [aiTriageLoading, setAiTriageLoading] = useState(false)
  const [aiTriageNotice, setAiTriageNotice] = useState<{ message: string; isError: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<string[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string[]>([])

  // Keyboard shortcuts: Cmd/Ctrl+K is already the app-wide CommandPalette
  // shortcut (searches work orders, rooms, and more from anywhere), so this
  // only adds Cmd/Ctrl+J to open the global AI copilot bubble (it listens for
  // this same event itself) and Escape to close the filters panel. The drawer
  // and the copilot bubble each close themselves on Escape via their own
  // listeners, so this only steps in for filters.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('copilot:open'))
      } else if (e.key === 'Escape' && !drawerOpen && filtersOpen) {
        setFiltersOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [drawerOpen, filtersOpen])

  // Realtime subscription
  useEffect(() => {
    if (!hotelId) return
    const supabase = createClient()
    const channel = supabase
      .channel('wo_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_orders', filter: `tenant_id=eq.${hotelId}` },
        () => { queryClient.invalidateQueries({ queryKey: ['work-orders'] }) },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [hotelId, queryClient])

  // Fetch all operational lanes in parallel. Status changes are deliberately
  // handled in the detail drawer so required reasons cannot be skipped.
  const queryOpts = (status: KanbanStatus) => ({
    queryKey: ['work-orders', status, isEngineer ? userId : null] as const,
    queryFn: () =>
      engineeringApi.listWorkOrders({
        status,
        assigned_to: isEngineer ? userId : undefined,
        per_page: 50,
      }),
    refetchInterval: 60_000,
    enabled: !!hotelId,
  })

  const openQ      = useQuery(queryOpts('open'))
  const escalatedQ = useQuery(queryOpts('escalated'))
  const progressQ  = useQuery(queryOpts('in_progress'))
  const holdQ      = useQuery(queryOpts('on_hold'))
  const completedQ = useQuery(queryOpts('completed'))

  const isLoading = [openQ, escalatedQ, progressQ, holdQ, completedQ].some((q) => q.isLoading)
  const isError = [openQ, escalatedQ, progressQ, holdQ, completedQ].some((q) => q.isError)
  const refetchAll = () => [openQ, escalatedQ, progressQ, holdQ, completedQ].forEach((q) => q.refetch())

  const allWOs = useMemo(
    () => [
      ...(openQ.data?.data ?? []),
      ...(escalatedQ.data?.data ?? []),
      ...(progressQ.data?.data ?? []),
      ...(holdQ.data?.data ?? []),
      ...(completedQ.data?.data ?? []),
    ],
    [openQ.data, escalatedQ.data, progressQ.data, holdQ.data, completedQ.data]
  )

  const emergencyCount = allWOs.filter((wo) => wo.priority === 'emergency').length
  const urgentCount = allWOs.filter((wo) => wo.priority === 'urgent').length

  // ── Shared filter/search/AI-triage pipeline feeding Board + Console ────────

  const queue = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = allWOs.filter((wo) => {
      if (priorityFilter.length && !priorityFilter.includes(wo.priority)) return false
      if (categoryFilter.length && !categoryFilter.includes(wo.category)) return false
      if (needle && ![wo.title, wo.category, wo.location_text, wo.rooms?.room_number, String(wo.work_order_number)]
        .some((value) => String(value ?? '').toLowerCase().includes(needle))) return false
      return true
    })
    return sortWOs(filtered, aiTriageActive)
  }, [aiTriageActive, allWOs, categoryFilter, priorityFilter, search])

  // ── Rail data: stats, failure predictions, PM schedules ─────────────────────
  // Same query keys/params the page-level KPI strip and Reliability/PM tabs use
  // -- React Query dedupes, so this never doubles a network call in practice.

  const statsQ = useQuery({
    queryKey: ['work-order-stats'],
    queryFn: () => engineeringApi.getWorkOrderStats(),
    select: (res) => res.data as WorkOrderStats,
    refetchInterval: 60_000,
    enabled: !!hotelId,
  })
  const predictionsQ = useQuery({
    queryKey: ['failure-predictions-history'],
    queryFn: () => engineeringApi.getFailurePredictionHistory(),
    select: (res) => (res.data as FailurePrediction[]).filter((p) => !p.is_acknowledged),
    enabled: !!hotelId,
  })
  const pmQ = useQuery({
    queryKey: ['pm-schedules'],
    queryFn: () => engineeringApi.listPMSchedules(),
    select: (res) => res.data as PMSchedule[],
    enabled: !!hotelId,
  })

  const [predictionPendingId, setPredictionPendingId] = useState<string | null>(null)
  const createWOFromPredictionMutation = useMutation({
    mutationFn: (id: string) => engineeringApi.createWorkOrderFromPrediction(id),
    onMutate: (id) => setPredictionPendingId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      toast.success(t('engineering.failurePrediction.createWO'))
    },
    onSettled: () => setPredictionPendingId(null),
  })
  const acknowledgePredictionMutation = useMutation({
    mutationFn: (id: string) => engineeringApi.acknowledgeFailurePrediction(id),
    onMutate: (id) => setPredictionPendingId(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['failure-predictions-history'] }),
    onSettled: () => setPredictionPendingId(null),
  })

  // ── Deep link: open the detail drawer for a specific work order ────────────

  const selectedRoomUnavailability = useQuery({
    queryKey: ['room-unavailability-active', selectedWO?.room_id],
    queryFn: () => roomUnavailabilityApi.getActiveForRoom(selectedWO!.room_id!),
    enabled: !!selectedWO?.room_id,
  })

  useEffect(() => {
    if (!focusId || appliedFocusRef.current === focusId) return
    const target = allWOs.find((wo) => wo.id === focusId)
    if (!target) return // graceful no-op: deleted/stale/cross-tenant id, or outside the loaded lanes
    appliedFocusRef.current = focusId
    setSelectedWO(target)
    setDrawerAutoAction(undefined)
    setDrawerOpen(true)
  }, [focusId, allWOs])

  const handleAITriage = async () => {
    const openOrders = allWOs.filter((wo) => wo.status !== 'completed')
    setAiTriageLoading(true)
    setAiTriageNotice(null)
    try {
      const res = await aiApi.chat('Triage open work orders and suggest the safest floor order for engineers.', {
        intent_hint: 'work_order_triage',
        source: 'work_orders_kanban',
        work_orders: openOrders.slice(0, 20).map((wo) => ({
          id: wo.id,
          title: wo.title,
          priority: wo.priority,
          status: wo.status,
          due_at: wo.due_at,
          assigned_to: wo.assigned_to,
          room_number: wo.rooms?.room_number,
        })),
      })
      setAiTriageNotice({ message: res.data.message, isError: false })
    } catch (err) {
      const detail = err instanceof ApiClientError ? err.message : null
      setAiTriageNotice({
        message: detail
          ? t('engineering.workOrdersPage.aiTriageErrorDetail', { error: detail })
          : t('engineering.workOrdersPage.aiTriageFallback'),
        isError: true,
      })
    } finally {
      setAiTriageActive(true)
      setAiTriageLoading(false)
    }
  }

  // ── Board actions: claim / direct transition / open-drawer-with-action ─────

  const claimMutation = useMutation({
    mutationFn: (id: string) => engineeringApi.claimWorkOrder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
  })
  const quickTransitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'in_progress' }) =>
      engineeringApi.transitionWorkOrder(id, { status, source: 'web' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['work-orders'] }),
  })

  const openDrawerFor = (wo: WorkOrder, autoAction?: DrawerAutoAction) => {
    setSelectedWO(wo)
    setDrawerAutoAction(autoAction)
    setDrawerOpen(true)
  }

  const handleBoardSelect = (wo: WorkOrder) => openDrawerFor(wo)
  const handleConsoleSelect = (wo: WorkOrder) => { setSelectedWO(wo); setDrawerAutoAction(undefined) }

  const handleDrop = async (wo: WorkOrder, outcome: DropOutcome) => {
    if (outcome.kind === 'noop') return
    if (outcome.kind === 'blocked') {
      toast.error(t('engineering.workOrdersPage.moveBlocked', { id: `WO-${wo.work_order_number}` }))
      return
    }
    if (outcome.kind === 'auto') {
      openDrawerFor(wo, outcome.action)
      return
    }
    try {
      if (outcome.kind === 'claim') {
        await claimMutation.mutateAsync(wo.id)
      } else {
        await quickTransitionMutation.mutateAsync({ id: wo.id, status: outcome.status })
      }
      toast.success(t('engineering.workOrdersPage.moveToast', { id: `WO-${wo.work_order_number}`, column: t('engineering.workOrdersPage.columnInProgress') }))
    } catch (err) {
      const detail = err instanceof ApiClientError ? err.message : null
      toast.error(detail ?? t('engineering.workOrderDetail.transitionError'))
    }
  }

  return (
    <div className="space-y-5">
      {/* Urgent alert */}
      {(emergencyCount > 0 || urgentCount > 0) && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-xl text-sm text-[var(--alert)]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-medium">
            {emergencyCount > 0 && t(
              emergencyCount === 1
                ? 'engineering.workOrdersPage.emergencyAlertOne'
                : 'engineering.workOrdersPage.emergencyAlertOther',
              { count: emergencyCount },
            )}
            {emergencyCount > 0 && urgentCount > 0 && ' · '}
            {urgentCount > 0 && t(
              urgentCount === 1
                ? 'engineering.workOrdersPage.urgentAlertOne'
                : 'engineering.workOrdersPage.urgentAlertOther',
              { count: urgentCount },
            )}
          </span>
        </div>
      )}

      {aiTriageNotice && (
        <div
          className={
            aiTriageNotice.isError
              ? 'flex items-start gap-2.5 px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-xl text-sm text-[var(--alert)]'
              : 'flex items-start gap-2.5 px-4 py-3 bg-ai-soft border border-ai-line rounded-xl text-sm text-ai'
          }
        >
          {aiTriageNotice.isError ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="font-medium">{aiTriageNotice.message}</span>
        </div>
      )}

      {/* Sub-tabs + search/filters/AI triage — shared across Board and Console */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full bg-surface-3 p-1">
          {([
            { key: 'board', label: t('engineering.workOrdersPage.subTabBoard') },
            { key: 'console', label: t('engineering.workOrdersPage.subTabConsole') },
            { key: 'week', label: t('engineering.workOrdersPage.subTabWeek') },
          ] as { key: SubTab; label: string }[]).map((s) => (
            <button
              key={s.key}
              onClick={() => setSubTab(s.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${subTab === s.key ? 'bg-surface text-ink shadow-[var(--shadow-sm)]' : 'text-ink3 hover:text-ink2'}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {subTab !== 'week' && (
          <>
            <label className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink3" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('engineering.workOrdersPage.searchPlaceholder')}
                className="min-h-[36px] w-full rounded-[var(--r-md)] border border-line bg-surface px-3 pl-9 text-sm text-ink outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>
            <Button variant="outline" size="sm" onClick={() => setFiltersOpen((v) => !v)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t('engineering.commandCenter.filterPriority')}
            </Button>
            <Button variant="ai" size="sm" onClick={handleAITriage} disabled={aiTriageLoading}>
              {aiTriageLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {t('engineering.workOrdersPage.aiTriage')}
            </Button>
          </>
        )}
      </div>

      {filtersOpen && subTab !== 'week' && (
        <div className="flex flex-wrap items-center gap-4 rounded-[var(--r-lg)] border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.commandCenter.filterPriority')}</span>
            {['emergency', 'urgent', 'normal', 'low'].map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p])}
                className={`rounded-full px-3 py-1 text-xs ${priorityFilter.includes(p) ? 'bg-ink text-paper' : 'border border-line text-ink2 hover:bg-surface-2'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.commandCenter.filterCategory')}</span>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter((cur) => cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c])}
                className={`rounded-full px-3 py-1 text-xs ${categoryFilter.includes(c) ? 'bg-ink text-paper' : 'border border-line text-ink2 hover:bg-surface-2'}`}
              >
                {c}
              </button>
            ))}
          </div>
          {(priorityFilter.length > 0 || categoryFilter.length > 0) && (
            <button
              onClick={() => { setPriorityFilter([]); setCategoryFilter([]) }}
              className="ml-auto text-xs font-medium text-accent"
            >
              {t('engineering.commandCenter.clearFilters')}
            </button>
          )}
        </div>
      )}

      {subTab === 'board' && (
        <EngineeringBoardView
          workOrders={queue}
          isLoading={isLoading}
          isError={isError}
          onRetry={refetchAll}
          stats={statsQ.data}
          predictions={predictionsQ.data ?? []}
          predictionsLoading={predictionsQ.isLoading}
          onCreateWOFromPrediction={(id) => createWOFromPredictionMutation.mutate(id)}
          onAcknowledgePrediction={(id) => acknowledgePredictionMutation.mutate(id)}
          predictionPendingId={predictionPendingId}
          selectedId={drawerOpen ? selectedWO?.id : undefined}
          onSelect={handleBoardSelect}
          onDrop={handleDrop}
          aiTriageActive={aiTriageActive}
        />
      )}

      {subTab === 'console' && (
        <EngineeringConsoleView
          workOrders={queue}
          isLoading={isLoading}
          isError={isError}
          onRetry={refetchAll}
          selected={selectedWO}
          onSelect={handleConsoleSelect}
          onUpdate={() => queryClient.invalidateQueries({ queryKey: ['work-orders'] })}
          roomUnavailabilityReason={selectedRoomUnavailability.data?.data?.reason_label ?? null}
        />
      )}

      {subTab === 'week' && (
        <PMWeekGlance
          schedules={pmQ.data ?? []}
          isLoading={pmQ.isLoading}
          isError={pmQ.isError}
          onRetry={() => pmQ.refetch()}
        />
      )}

      {/* Modals */}
      {showCreateModal && (
        <CreateWorkOrderDrawer
          isOpen={showCreateModal}
          onClose={onCloseCreateModal}
          onCreate={() => {
            onCloseCreateModal()
            queryClient.invalidateQueries({ queryKey: ['work-orders'] })
          }}
        />
      )}
      <BulkArchiveModal
        isOpen={showArchiveModal}
        onClose={onCloseArchiveModal}
        onArchived={() => queryClient.invalidateQueries({ queryKey: ['work-orders'] })}
      />

      {/* Detail drawer */}
      <WorkOrderDetailDrawer
        wo={selectedWO}
        isOpen={drawerOpen}
        autoAction={drawerAutoAction}
        onClose={() => { setDrawerOpen(false); setDrawerAutoAction(undefined) }}
        onUpdate={() => queryClient.invalidateQueries({ queryKey: ['work-orders'] })}
        roomUnavailabilityReason={selectedRoomUnavailability.data?.data?.reason_label ?? null}
      />
    </div>
  )
}
