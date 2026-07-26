'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AlertCircle, Plus, Sparkles, Loader2 } from 'lucide-react'
import { engineeringApi, type WorkOrder, type WorkOrderStatus } from '@/lib/api/engineering'
import { aiApi } from '@/lib/api/ai'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { PageHeader } from '@/components/shared/PageHeader'
import { CreateWorkOrderModal } from '@/components/engineering/CreateWorkOrderModal'
import { WorkOrderDetailDrawer } from '@/components/engineering/WorkOrderDetailDrawer'
import { FailurePredictionSidebar } from '@/components/engineering/FailurePredictionSidebar'
import { EngineeringRoomBoard } from '@/components/engineering/EngineeringRoomBoard'
import { formatDistanceToNowStrict } from 'date-fns'

// ── Types ────────────────────────────────────────────────────────────────────

type KanbanStatus = Extract<WorkOrderStatus, 'open' | 'escalated' | 'in_progress' | 'on_hold' | 'completed'>

type PillTone = 'alert' | 'caution' | 'info' | 'ready' | 'neutral'

// ── Constants ────────────────────────────────────────────────────────────────

function getColumns(t: TFunction): { status: KanbanStatus; label: string; tone: PillTone }[] {
  return [
    { status: 'open',        label: t('engineering.workOrdersPage.columnOpen'),       tone: 'info'    },
    { status: 'escalated',   label: t('engineering.workOrdersPage.columnEscalated'),  tone: 'alert'   },
    { status: 'in_progress', label: t('engineering.workOrdersPage.columnInProgress'), tone: 'caution' },
    { status: 'on_hold',     label: t('engineering.workOrdersPage.columnOnHold'),     tone: 'alert'   },
    { status: 'completed',   label: t('engineering.workOrdersPage.columnCompleted'),  tone: 'ready'   },
  ]
}

const PRIORITY_BORDER: Record<string, string> = {
  emergency: 'border-l-red-700',
  urgent: 'border-l-[var(--alert)]',
  normal: 'border-l-[var(--caution)]',
  low:    'border-l-[var(--ready)]',
}

const AVATAR_COLORS = [
  'bg-[var(--accent-soft)] text-[var(--accent)]',
  'bg-[var(--info-soft)] text-[var(--info)]',
  'bg-[var(--ready-soft)] text-[var(--ready)]',
  'bg-[var(--caution-soft)] text-[var(--caution)]',
  'bg-[var(--ai-soft)] text-[var(--ai)]',
]

function avatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function initials(id: string): string {
  return id.slice(0, 2).toUpperCase()
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

// ── WO Card ──────────────────────────────────────────────────────────────────

function WorkOrderCard({
  wo,
  onClick,
}: {
  wo: WorkOrder
  onClick: () => void
}) {
  const { t } = useTranslation()
  const location = wo.rooms?.room_number
    ? `${t('engineering.workOrderCard.room')} ${wo.rooms.room_number}`
    : wo.location_text ?? null

  const borderColor = PRIORITY_BORDER[wo.priority] ?? PRIORITY_BORDER.normal
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      className={`bg-surface border border-line rounded-[var(--r-lg)] p-3.5 cursor-pointer hover:shadow-md transition-all duration-200 border-l-[3px] ${borderColor} outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ${wo.priority === 'emergency' ? 'bg-red-50' : ''}`}
    >
      {/* WO number */}
      <p className="font-mono text-[10px] text-ink3 mb-0.5">
        WO-{wo.work_order_number}
      </p>

      {/* Title */}
      <p className="text-[13px] font-medium text-ink leading-snug line-clamp-2 mb-2">
        {wo.title}
      </p>

      {/* Location chip */}
      {location && (
        <span className="inline-block font-mono text-[11px] bg-surface-2 border border-line-2 rounded px-1.5 py-px text-ink3 mb-2">
          {location}
        </span>
      )}

      {/* Footer: assignee + time */}
      <div className="flex items-center justify-between gap-2">
        {wo.assigned_to ? (
          <span
            className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold shrink-0 ${avatarColor(wo.assigned_to)}`}
          >
            {initials(wo.assigned_to)}
          </span>
        ) : (
          <span className="w-5 h-5 rounded-full bg-surface-3 border border-line shrink-0" />
        )}
        <span className="font-mono text-[11px] text-ink3 truncate text-right">
          {timeAgo(wo.created_at)}
        </span>
      </div>
    </div>
  )
}

// ── Column ───────────────────────────────────────────────────────────────────

function KanbanColumn({
  label,
  tone,
  status,
  workOrders,
  canAdd,
  onAdd,
  onCardClick,
  isLoading,
}: {
  label: string
  tone: PillTone
  status: KanbanStatus
  workOrders: WorkOrder[]
  canAdd: boolean
  onAdd: () => void
  onCardClick: (wo: WorkOrder) => void
  isLoading: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid={`work-order-column-${status}`}
      className="flex flex-col bg-surface border border-line rounded-[var(--r-lg)] shadow-card overflow-hidden min-h-[400px]"
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-line bg-surface-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-ink">{label}</span>
          <Pill tone={tone} size="sm">{workOrders.length}</Pill>
        </div>
        {canAdd && status === 'open' && (
          <button
            onClick={onAdd}
            aria-label={t('engineering.workOrdersPage.newWorkOrderAriaLabel')}
            className="w-6 h-6 flex items-center justify-center rounded-md text-ink3 hover:bg-surface-3 hover:text-ink transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Column body */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[88px] bg-surface-3 rounded-[var(--r-lg)] animate-pulse border border-line"
              />
            ))}
          </>
        ) : workOrders.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[12px] text-ink3">{t('engineering.workOrdersPage.emptyColumn', { label: label.toLowerCase() })}</p>
          </div>
        ) : (
          workOrders.map((wo) => (
            <WorkOrderCard
              key={wo.id}
              wo={wo}
              onClick={() => onCardClick(wo)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WorkOrdersPage() {
  const { t } = useTranslation()
  const { role } = useRole()
  const user = useAuthStore((s) => s.user)
  const session = useAuthStore((s) => s.session)
  const hotelId = getHotelIdFromToken(session?.access_token)
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<'work-orders' | 'room-board'>('work-orders')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [aiTriageActive, setAiTriageActive] = useState(false)
  const [aiTriageLoading, setAiTriageLoading] = useState(false)
  const [aiTriageNotice, setAiTriageNotice] = useState<string | null>(null)
  const isEngineer = role === 'engineer'
  const canManage = role === 'engineer' || role === 'gm'
  const COLUMNS = getColumns(t)

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
    queryKey: ['work-orders', status, isEngineer ? user?.id : null] as const,
    queryFn: () =>
      engineeringApi.listWorkOrders({
        status,
        assigned_to: isEngineer ? user?.id : undefined,
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

  const columnData: Record<KanbanStatus, WorkOrder[]> = {
    open:        sortWOs(openQ.data?.data ?? [], aiTriageActive),
    escalated:   sortWOs(escalatedQ.data?.data ?? [], aiTriageActive),
    in_progress: sortWOs(progressQ.data?.data ?? [], aiTriageActive),
    on_hold:     sortWOs(holdQ.data?.data ?? [], aiTriageActive),
    completed:   sortWOs(completedQ.data?.data ?? [], aiTriageActive),
  }

  const columnLoading: Record<KanbanStatus, boolean> = {
    open:        openQ.isLoading,
    escalated:   escalatedQ.isLoading,
    in_progress: progressQ.isLoading,
    on_hold:     holdQ.isLoading,
    completed:   completedQ.isLoading,
  }

  const emergencyCount = Object.values(columnData).flat().filter((wo) => wo.priority === 'emergency').length
  const urgentCount = Object.values(columnData).flat().filter((wo) => wo.priority === 'urgent').length

  const handleAITriage = async () => {
    const openOrders = Object.values(columnData).flat().filter((wo) => wo.status !== 'completed')
    setAiTriageLoading(true)
    setAiTriageNotice(null)
    try {
      await aiApi.chat('Triage open work orders and suggest the safest floor order for engineers.', {
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
      setAiTriageNotice(t('engineering.workOrdersPage.aiTriageApplied'))
    } catch {
      setAiTriageNotice(t('engineering.workOrdersPage.aiTriageFallback'))
    } finally {
      setAiTriageActive(true)
      setAiTriageLoading(false)
    }
  }

  const handleCardClick = (wo: WorkOrder) => {
    setSelectedWO(wo)
    setDrawerOpen(true)
  }

  const handleDrawerClose = () => {
    setDrawerOpen(false)
  }

  const handleDrawerUpdate = () => {
    queryClient.invalidateQueries({ queryKey: ['work-orders'] })
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0 space-y-5">
        <PageHeader
          eyebrow="Engineering"
          title={t('engineering.workOrdersPage.heading')}
          subtitle={isEngineer ? t('engineering.workOrdersPage.subtitleEngineer') : t('engineering.workOrdersPage.subtitleAll')}
          tabs={[
            { label: t('engineering.workOrdersPage.tabWorkOrders'), active: activeTab === 'work-orders', onClick: () => setActiveTab('work-orders') },
            { label: t('engineering.workOrdersPage.tabRoomBoard'), active: activeTab === 'room-board', onClick: () => setActiveTab('room-board') },
          ]}
          actions={activeTab === 'work-orders' && (
            <>
              <Button
                variant="ai"
                onClick={handleAITriage}
                disabled={aiTriageLoading}
                className="shrink-0"
              >
                {aiTriageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {t('engineering.workOrdersPage.aiTriage')}
              </Button>
              {canManage && (
                <Button variant="primary" onClick={() => setShowCreateModal(true)} className="shrink-0">
                  <Plus className="w-4 h-4" />
                  {t('engineering.workOrdersPage.newWorkOrder')}
                </Button>
              )}
            </>
          )}
        />

        {activeTab === 'work-orders' ? (
          <>
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
              <div className="flex items-start gap-2.5 px-4 py-3 bg-ai-soft border border-ai-line rounded-xl text-sm text-ai">
                <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="font-medium">{aiTriageNotice}</span>
              </div>
            )}

            {/* Kanban board */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                {COLUMNS.map(({ status, label, tone }) => (
                  <KanbanColumn
                    key={status}
                    label={label}
                    tone={tone}
                    status={status}
                    workOrders={columnData[status]}
                    canAdd={canManage}
                    onAdd={() => setShowCreateModal(true)}
                    onCardClick={handleCardClick}
                    isLoading={columnLoading[status]}
                  />
                ))}
              </div>
          </>
        ) : (
          <EngineeringRoomBoard />
        )}

        {/* Modals */}
        {showCreateModal && (
          <CreateWorkOrderModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onCreate={() => {
              setShowCreateModal(false)
              queryClient.invalidateQueries({ queryKey: ['work-orders'] })
            }}
          />
        )}
      </div>

      {activeTab === 'work-orders' && <FailurePredictionSidebar />}

      {/* Detail drawer */}
      <WorkOrderDetailDrawer
        wo={selectedWO}
        isOpen={drawerOpen}
        onClose={handleDrawerClose}
        onUpdate={handleDrawerUpdate}
      />
    </div>
  )
}
