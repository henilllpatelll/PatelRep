'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { WorkOrder } from '@/lib/api/engineering'
import type { RoomUnavailabilityPeriod } from '@/lib/api/rooms'
import type { WorkOrderQueueGroup } from '@/lib/utils/workOrderQueue'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { WorkOrderRecord } from '@/components/engineering/WorkOrderRecord'

function dueLabel(workOrder: WorkOrder): string | null {
  if (!workOrder.due_at) return null
  try { return formatDistanceToNowStrict(new Date(workOrder.due_at), { addSuffix: true }) } catch { return null }
}

interface QueueRowProps {
  workOrder: WorkOrder
  selected: boolean
  staffNames: Map<string, string>
  onClick: () => void
}

function QueueRow({ workOrder, selected, staffNames, onClick }: QueueRowProps) {
  const { t } = useTranslation()
  const [now] = useState(() => Date.now())
  const overdue = Boolean(workOrder.due_at && workOrder.status !== 'completed' && new Date(workOrder.due_at).getTime() < now)
  const location = workOrder.rooms?.room_number
    ? `${t('engineering.workOrderCard.room')} ${workOrder.rooms.room_number}`
    : workOrder.location_text ?? `WO-${workOrder.work_order_number}`
  const assignee = workOrder.assigned_to ? staffNames.get(workOrder.assigned_to) : null
  const state = workOrder.status === 'on_hold'
    ? t('engineering.workOrdersPage.queueWaiting')
    : workOrder.status === 'escalated'
      ? t('engineering.workOrdersPage.columnEscalated')
      : t(`engineering.commandCenter.priority_${workOrder.priority}`)

  return <button type="button" onClick={onClick} aria-pressed={selected} className={`w-full border-b border-line px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${selected ? 'bg-[var(--accent-soft)]' : 'bg-surface hover:bg-surface-2'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-ink3">{location}</p>
        <p className="mt-0.5 truncate text-sm font-semibold leading-snug text-ink">{workOrder.title}</p>
        <p className="mt-1 truncate text-xs text-ink3">{state} · {assignee ?? t('engineering.workOrdersPage.unassigned')}</p>
      </div>
      <span className={`shrink-0 text-xs ${overdue ? 'font-semibold text-[var(--alert)]' : 'text-ink3'}`}>{overdue ? t('engineering.workOrderCard.slaBreached') : dueLabel(workOrder)}</span>
    </div>
  </button>
}

interface EngineeringConsoleViewProps {
  workOrders: WorkOrder[]
  groups: WorkOrderQueueGroup[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  selected: WorkOrder | null
  onSelect: (workOrder: WorkOrder) => void
  onUpdate: () => void
  roomUnavailability: RoomUnavailabilityPeriod | null
  staffNames: Map<string, string>
  completedExpanded: boolean
  onCompletedExpandedChange: (expanded: boolean) => void
}

const groupLabelKeys = {
  attention: 'engineering.workOrdersPage.queueNeedsAttention',
  in_progress: 'engineering.workOrdersPage.queueInProgress',
  waiting: 'engineering.workOrdersPage.queueWaiting',
  completed: 'engineering.workOrdersPage.queueCompletedToday',
} as const

export function EngineeringConsoleView({ workOrders, groups, isLoading, isError, onRetry, selected, onSelect, onUpdate, roomUnavailability, staffNames, completedExpanded, onCompletedExpandedChange }: EngineeringConsoleViewProps) {
  const { t } = useTranslation()

  return <div className="grid min-h-[440px] overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface lg:h-[calc(100vh-248px)] lg:grid-cols-[minmax(20rem,40%)_minmax(0,1fr)]">
    <section className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r" aria-label={t('engineering.workOrdersPage.queueTitle')}>
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.workOrdersPage.queueTitle')}</span><span className="font-mono text-[11px] text-ink3">{workOrders.length}</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? <div className="space-y-2 p-3">{[1, 2, 3, 4].map((id) => <Skeleton key={id} className="h-20" />)}</div>
          : isError ? <StateBlock status="error" error={{ message: t('engineering.workOrderList.loadError'), onRetry }} />
            : groups.length === 0 ? <StateBlock status="empty" empty={{ title: t('engineering.workOrdersPage.emptyColumn', { label: '' }) }} />
              : groups.map((group) => {
                const isCompleted = group.key === 'completed'
                const isCollapsed = isCompleted && !completedExpanded
                return <div key={group.key}>
                  <button type="button" onClick={() => isCompleted && onCompletedExpandedChange(!completedExpanded)} disabled={!isCompleted} aria-expanded={isCompleted ? completedExpanded : undefined} className={`sticky top-0 z-[1] flex w-full items-center gap-2 border-b border-line-2 bg-surface-2 px-4 py-1.5 text-left ${isCompleted ? 'cursor-pointer hover:bg-surface-3' : 'cursor-default'}`}>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3">{t(groupLabelKeys[group.key])}</span><span className="font-mono text-[10.5px] text-ink4">{group.items.length}</span>{isCompleted && <ChevronRight className={`ml-auto h-3.5 w-3.5 text-ink3 transition-transform ${completedExpanded ? 'rotate-90' : ''}`} />}
                  </button>
                  {!isCollapsed && group.items.map((workOrder) => <QueueRow key={workOrder.id} workOrder={workOrder} selected={selected?.id === workOrder.id} staffNames={staffNames} onClick={() => onSelect(workOrder)} />)}
                </div>
              })}
      </div>
    </section>
    <section className="hidden h-full min-h-0 overflow-hidden lg:block" aria-live="polite">
      {selected ? <WorkOrderRecord key={selected.id} wo={selected} onUpdate={onUpdate} roomUnavailability={roomUnavailability} /> : <div className="flex h-full min-h-64 items-center justify-center bg-surface-2 text-center"><div><p className="font-medium text-ink">{t('engineering.workOrdersPage.selectWorkOrder')}</p><p className="mt-1 text-sm text-ink3">{t('engineering.workOrdersPage.selectWorkOrderHint')}</p></div></div>}
    </section>
  </div>
}
