'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import type { WorkOrder } from '@/lib/api/engineering'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { WorkOrderRecord } from '@/components/engineering/WorkOrderRecord'

/** assigned_to is a staff UUID, not a display name -- there is no client-side name lookup here. */
function shortId(id: string): string {
  return id.slice(0, 2).toUpperCase()
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

const GROUP_ORDER: { statuses: WorkOrder['status'][]; titleKey: string }[] = [
  { statuses: ['escalated'], titleKey: 'engineering.workOrdersPage.columnEscalated' },
  { statuses: ['open'], titleKey: 'engineering.workOrdersPage.columnOpen' },
  { statuses: ['in_progress'], titleKey: 'engineering.workOrdersPage.columnInProgress' },
  { statuses: ['on_hold'], titleKey: 'engineering.workOrdersPage.columnReview' },
  { statuses: ['completed'], titleKey: 'engineering.workOrdersPage.columnCompleted' },
]

interface QueueRowProps {
  wo: WorkOrder
  selected: boolean
  onClick: () => void
}

function QueueRow({ wo, selected, onClick }: QueueRowProps) {
  const { t } = useTranslation()
  const [now] = useState(() => Date.now())
  const location = wo.rooms?.room_number
    ? `${t('engineering.workOrderCard.room')} ${wo.rooms.room_number}`
    : (wo.location_text ?? `WO-${wo.work_order_number}`)
  const overdue = !!wo.due_at && wo.status !== 'completed' && new Date(wo.due_at).getTime() < now

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b border-line px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 ${selected ? 'bg-[var(--accent-soft)]' : 'bg-surface hover:bg-surface-2'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink3">{location}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ink">{wo.title}</p>
          <p className="mt-1 truncate text-xs text-ink3">
            {wo.assigned_to ? shortId(wo.assigned_to) : t('engineering.workOrdersPage.unassigned')} · {wo.category}
          </p>
        </div>
        <span className={`shrink-0 text-xs ${overdue ? 'font-medium text-[var(--alert)]' : 'text-ink3'}`}>
          {wo.priority === 'emergency' ? t('engineering.workOrdersPage.priorityEmergency') : (wo.due_at ? timeAgo(wo.due_at) : '')}
        </span>
      </div>
    </button>
  )
}

interface EngineeringConsoleViewProps {
  workOrders: WorkOrder[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  selected: WorkOrder | null
  onSelect: (wo: WorkOrder) => void
  onUpdate: () => void
  roomUnavailabilityReason?: string | null
}

export function EngineeringConsoleView({
  workOrders,
  isLoading,
  isError,
  onRetry,
  selected,
  onSelect,
  onUpdate,
  roomUnavailabilityReason,
}: EngineeringConsoleViewProps) {
  const { t } = useTranslation()

  const groups = useMemo(
    () => GROUP_ORDER
      .map((g) => ({ ...g, rows: workOrders.filter((wo) => g.statuses.includes(wo.status)) }))
      .filter((g) => g.rows.length > 0),
    [workOrders]
  )

  return (
    <div className="grid h-[calc(100vh-268px)] min-h-[440px] overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface lg:grid-cols-[minmax(20rem,42%)_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r" aria-label={t('engineering.workOrdersPage.queueTitle')}>
        <div className="shrink-0 border-b border-line px-3 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.workOrdersPage.queueTitle')}</span>
          <span className="ml-2 font-mono text-[11px] text-ink3">{workOrders.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">{[1, 2, 3, 4].map((id) => <Skeleton key={id} className="h-20" />)}</div>
          ) : isError ? (
            <StateBlock status="error" error={{ message: t('engineering.workOrderList.loadError'), onRetry }} />
          ) : groups.length === 0 ? (
            <StateBlock status="empty" empty={{ title: t('engineering.workOrdersPage.emptyColumn', { label: '' }) }} />
          ) : (
            groups.map((g) => (
              <div key={g.titleKey}>
                <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-line-2 bg-surface-2 px-4 py-1.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3">{t(g.titleKey)}</span>
                  <span className="font-mono text-[10.5px] text-ink4">{g.rows.length}</span>
                </div>
                {g.rows.map((wo) => (
                  <QueueRow key={wo.id} wo={wo} selected={selected?.id === wo.id} onClick={() => onSelect(wo)} />
                ))}
              </div>
            ))
          )}
        </div>
      </section>
      <section className="h-full min-h-0 overflow-hidden" aria-live="polite">
        {selected ? (
          <WorkOrderRecord
            key={selected.id}
            wo={selected}
            onUpdate={onUpdate}
            roomUnavailabilityReason={roomUnavailabilityReason}
          />
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center bg-surface-2 text-center">
            <div>
              <p className="font-medium text-ink">{t('engineering.workOrdersPage.selectWorkOrder')}</p>
              <p className="mt-1 text-sm text-ink3">{t('engineering.workOrdersPage.selectWorkOrderHint')}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
