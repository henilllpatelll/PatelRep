'use client'

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Clock, Plus, Sparkles } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import type { FailurePrediction, WorkOrder, WorkOrderStats } from '@/lib/api/engineering'
import { AILabel, Bar, Pill, SparkIcon, Stat } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { getAvatarColor } from '@/lib/utils/avatar'
import { CopilotSuggestionsCard } from './EngineeringCopilotSuggestions'

/** assigned_to is a staff UUID, not a display name -- there is no client-side name lookup, so this mirrors the short-id convention used elsewhere in this tab. */
function shortId(id: string): string {
  return id.slice(0, 2).toUpperCase()
}

export type KanbanColumnKey = 'open' | 'in_progress' | 'on_hold' | 'completed'
export type DrawerAutoAction = 'complete' | 'hold' | 'cancel' | 'reopen'

export type DropOutcome =
  | { kind: 'noop' }
  | { kind: 'claim' }
  | { kind: 'transition'; status: 'in_progress' }
  | { kind: 'auto'; action: DrawerAutoAction }
  | { kind: 'blocked' }

function columnOf(status: WorkOrder['status']): KanbanColumnKey | null {
  if (status === 'open' || status === 'escalated') return 'open'
  if (status === 'in_progress') return 'in_progress'
  if (status === 'on_hold') return 'on_hold'
  if (status === 'completed') return 'completed'
  return null
}

/**
 * Mirrors apps/api/services/work_orders/transitions.py _ALLOWED_TRANSITIONS.
 * Keep in sync if the backend graph changes -- this only decides whether a
 * drag can fire directly, open the drawer pre-focused on the right action, or
 * gets blocked client-side before it round-trips into a guaranteed 409.
 */
export function resolveDrop(status: WorkOrder['status'], target: KanbanColumnKey): DropOutcome {
  const source = columnOf(status)
  if (source === target) return { kind: 'noop' }
  if (target === 'in_progress') {
    if (status === 'open') return { kind: 'claim' }
    if (status === 'on_hold' || status === 'escalated') return { kind: 'transition', status: 'in_progress' }
    return { kind: 'blocked' }
  }
  if (target === 'on_hold') {
    if (status === 'in_progress' || status === 'escalated') return { kind: 'auto', action: 'hold' }
    return { kind: 'blocked' }
  }
  if (target === 'completed') {
    if (status === 'in_progress') return { kind: 'auto', action: 'complete' }
    return { kind: 'blocked' }
  }
  // target === 'open'
  if (status === 'completed') return { kind: 'auto', action: 'reopen' }
  return { kind: 'blocked' }
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: false })
  } catch {
    return ''
  }
}

const PRIORITY_TONE: Record<string, 'alert' | 'caution' | 'neutral'> = {
  emergency: 'alert',
  urgent: 'alert',
  normal: 'caution',
  low: 'neutral',
}

interface KanbanCardProps {
  wo: WorkOrder
  selected: boolean
  dragging: boolean
  aiTriageActive: boolean
  onClick: () => void
  onDragStart: () => void
  onDragEnd: () => void
}

function KanbanCard({ wo, selected, dragging, aiTriageActive, onClick, onDragStart, onDragEnd }: KanbanCardProps) {
  const { t } = useTranslation()
  const [now] = useState(() => Date.now())
  const location = wo.rooms?.room_number
    ? `${t('engineering.workOrderCard.room')} ${wo.rooms.room_number}`
    : (wo.location_text ?? wo.category)
  const overdue = !!wo.due_at && wo.status !== 'completed' && new Date(wo.due_at).getTime() < now

  // One-line AI note slot: a real pattern note from the AI-authored description
  // takes priority; otherwise, while AI triage is active, flag cards it would
  // have pulled to the front of their column (mirrors the deck's "annotates
  // the cards it moved").
  const aiNote = wo.is_ai_created && wo.description
    ? wo.description
    : aiTriageActive && (wo.priority === 'emergency' || wo.priority === 'urgent') && overdue
      ? t('engineering.workOrdersPage.aiTriagedChip')
      : null

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      className={`flex cursor-pointer flex-col gap-1.5 rounded-[var(--r-md)] border bg-surface p-2.5 transition-shadow hover:shadow-[var(--shadow-md)] ${selected ? 'border-accent shadow-[0_0_0_2px_var(--accent-soft)]' : 'border-line shadow-[var(--shadow-sm)]'}`}
      style={{ opacity: dragging ? 0.45 : 1 }}
    >
      <div className="flex items-center gap-1.5">
        <Pill tone={PRIORITY_TONE[wo.priority] ?? 'neutral'} size="sm">{wo.priority}</Pill>
        {wo.status === 'escalated' && (
          <Pill tone="alert" size="sm">
            <AlertTriangle className="h-2.5 w-2.5" /> {t('engineering.commandCenter.status_escalated')}
          </Pill>
        )}
        {overdue && (
          <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-[var(--alert)]">
            <Clock className="h-2.5 w-2.5" /> SLA
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px] text-ink3">WO-{wo.work_order_number}</span>
      </div>
      <p className="text-[12.5px] font-medium leading-snug text-ink">{wo.title}</p>
      <div className="flex items-center gap-1.5 text-[11px] text-ink3">
        <span className="font-mono">{location}</span>
        <span className="ml-auto">{timeAgo(wo.created_at)}</span>
      </div>
      {aiNote && (
        <div className="flex items-start gap-1.5 rounded-[6px] border border-ai-line bg-ai-soft px-1.5 py-1 text-[10.5px] leading-snug text-ai">
          <SparkIcon className="mt-[1px] h-2.5 w-2.5 shrink-0" />
          <span className="line-clamp-1">{aiNote}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-surface-3 px-1 py-px text-[10px] text-ink3">#{wo.category}</span>
        {wo.assigned_to && (
          <span
            className={`ml-auto flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] font-semibold text-white ${getAvatarColor(wo.assigned_to)}`}
          >
            {shortId(wo.assigned_to)}
          </span>
        )}
      </div>
    </div>
  )
}

interface EngineeringBoardViewProps {
  workOrders: WorkOrder[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  stats?: WorkOrderStats
  predictions: FailurePrediction[]
  predictionsLoading: boolean
  onCreateWOFromPrediction: (id: string) => void
  onAcknowledgePrediction: (id: string) => void
  predictionPendingId: string | null
  selectedId?: string | null
  onSelect: (wo: WorkOrder) => void
  onDrop: (wo: WorkOrder, outcome: DropOutcome) => void
  showRail?: boolean
  aiTriageActive?: boolean
}

const COLUMN_ORDER: { key: KanbanColumnKey; titleKey: string; hintKey: string; dot: string }[] = [
  { key: 'open', titleKey: 'engineering.workOrdersPage.columnOpen', hintKey: 'engineering.workOrdersPage.hintOpen', dot: 'var(--alert)' },
  { key: 'in_progress', titleKey: 'engineering.workOrdersPage.columnInProgress', hintKey: 'engineering.workOrdersPage.hintInProgress', dot: 'var(--caution)' },
  { key: 'on_hold', titleKey: 'engineering.workOrdersPage.columnReview', hintKey: 'engineering.workOrdersPage.hintReview', dot: 'var(--info)' },
  { key: 'completed', titleKey: 'engineering.workOrdersPage.columnCompleted', hintKey: 'engineering.workOrdersPage.hintCompleted', dot: 'var(--ready)' },
]

export function EngineeringBoardView({
  workOrders,
  isLoading,
  isError,
  onRetry,
  stats,
  predictions,
  predictionsLoading,
  onCreateWOFromPrediction,
  onAcknowledgePrediction,
  predictionPendingId,
  selectedId,
  onSelect,
  onDrop,
  showRail = true,
  aiTriageActive = false,
}: EngineeringBoardViewProps) {
  const { t } = useTranslation()
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<KanbanColumnKey | null>(null)

  const columns = useMemo(
    () => COLUMN_ORDER.map((col) => ({ ...col, cards: workOrders.filter((wo) => columnOf(wo.status) === col.key) })),
    [workOrders]
  )

  const activity = useMemo(() => {
    const events = workOrders.map((wo) => {
      const label = wo.rooms?.room_number ? `${t('engineering.workOrderCard.room')} ${wo.rooms.room_number}` : wo.title
      if (wo.completed_at) return { id: `${wo.id}-c`, t: wo.completed_at, text: `WO-${wo.work_order_number} · ${label} completed`, color: 'var(--ready)' }
      if (wo.started_at) return { id: `${wo.id}-s`, t: wo.started_at, text: `WO-${wo.work_order_number} · ${label} started`, color: 'var(--caution)' }
      return { id: `${wo.id}-o`, t: wo.created_at, text: `WO-${wo.work_order_number} · ${label} opened`, color: wo.status === 'escalated' ? 'var(--alert)' : 'var(--ink-3)' }
    })
    return events.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()).slice(0, 6)
  }, [workOrders, t])

  const avgResponse = stats?.avg_resolution_minutes != null
    ? stats.avg_resolution_minutes >= 60
      ? `${Math.round(stats.avg_resolution_minutes / 60)}h`
      : `${Math.round(stats.avg_resolution_minutes)}m`
    : '—'

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: showRail ? 'minmax(0,1fr) 300px' : 'minmax(0,1fr)' }}>
      <div className="grid min-h-[520px] grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="card" className="h-[520px]" />)
        ) : isError ? (
          <div className="col-span-4">
            <StateBlock status="error" error={{ message: t('engineering.commandCenter.loadError'), onRetry }} />
          </div>
        ) : (
          columns.map((col) => {
            const over = dragOverCol === col.key
            return (
              <div
                key={col.key}
                onDragOver={(e) => { e.preventDefault(); if (dragOverCol !== col.key) setDragOverCol(col.key) }}
                onDragLeave={() => setDragOverCol((c) => (c === col.key ? null : c))}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = dragId
                  setDragOverCol(null)
                  setDragId(null)
                  const wo = workOrders.find((w) => w.id === id)
                  if (wo) onDrop(wo, resolveDrop(wo.status, col.key))
                }}
                className={`flex min-h-[520px] flex-col rounded-[var(--r-lg)] border transition-colors ${over ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-line-2 bg-surface-2'}`}
              >
                <div className="flex items-center gap-2 border-b border-line-2 px-3 py-2.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: col.dot }} />
                  <span className="text-[12px] font-semibold text-ink">{t(col.titleKey)}</span>
                  <span className="font-mono text-[11px] text-ink3">{col.cards.length}</span>
                  <span className="ml-auto font-mono text-[10px] text-ink4">{t(col.hintKey)}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {col.cards.length === 0 ? (
                    <p className="px-2 py-4 text-center text-[12px] text-ink4">{t('engineering.workOrdersPage.emptyColumn', { label: '' })}</p>
                  ) : (
                    col.cards.map((wo) => (
                      <KanbanCard
                        key={wo.id}
                        wo={wo}
                        selected={selectedId === wo.id}
                        dragging={dragId === wo.id}
                        aiTriageActive={aiTriageActive}
                        onClick={() => onSelect(wo)}
                        onDragStart={() => setDragId(wo.id)}
                        onDragEnd={() => setDragId(null)}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {showRail && (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label={t('engineering.workOrdersPage.railToday')} value={stats?.open ?? '—'} unit="open" />
            <Stat label={t('engineering.workOrdersPage.railClosedToday')} value={stats?.completed_today ?? '—'} />
            <Stat label={t('engineering.workOrdersPage.railAvgResponse')} value={avgResponse} />
            <Stat label={t('engineering.workOrdersPage.railUnassigned')} value={stats?.unassigned ?? '—'} deltaTone={stats?.unassigned ? 'alert' : 'ready'} />
          </div>

          <div className="rounded-[var(--r-lg)] border border-ai-line bg-ai-soft p-3.5">
            <AILabel className="mb-2.5">{t('engineering.failurePrediction.heading')}</AILabel>
            {predictionsLoading ? (
              <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            ) : predictions.length === 0 ? (
              <p className="text-[12px] text-ink3">{t('engineering.failurePrediction.noHighRisk')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {predictions.slice(0, 3).map((p) => {
                  const pending = predictionPendingId === p.id
                  return (
                    <div key={p.id} className="flex flex-col gap-1.5 rounded-[var(--r-md)] border border-ai-line bg-surface p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-semibold text-ink">{p.assets?.name ?? t('engineering.failurePrediction.unknownAsset')}</span>
                        <span className="ml-auto font-mono text-[10.5px] text-ai">{p.risk_score}%</span>
                      </div>
                      <p className="text-[12.5px] italic leading-snug text-ink">{p.recommendation}</p>
                      <Bar value={p.risk_score} tone="ai" height={3} />
                      <div className="flex gap-1.5">
                        <Button variant="ai" size="sm" onClick={() => onCreateWOFromPrediction(p.id)} loading={pending} className="h-7 px-2 text-[11.5px]">
                          {!pending && <Plus className="h-3 w-3" />}
                          {t('engineering.failurePrediction.createWO')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onAcknowledgePrediction(p.id)} disabled={pending} className="h-7 px-2 text-[11.5px]">
                          {t('engineering.failurePrediction.acknowledge')}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <CopilotSuggestionsCard workOrders={workOrders} onSelect={(id) => { const wo = workOrders.find((w) => w.id === id); if (wo) onSelect(wo) }} />

          <div className="rounded-[var(--r-lg)] border border-line bg-surface p-3.5 shadow-[var(--shadow-sm)]">
            <div className="mb-2.5 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-ink3" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.workOrdersPage.railActivity')}</span>
            </div>
            {activity.length === 0 ? (
              <p className="text-[12px] text-ink4">{t('engineering.workOrdersPage.railNoActivity')}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activity.map((e) => (
                  <div key={e.id} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.color }} />
                    <span className="flex-1 text-[12px] leading-snug text-ink2">{e.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
