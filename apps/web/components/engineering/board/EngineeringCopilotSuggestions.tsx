'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import { Sparkles } from 'lucide-react'
import type { WorkOrder } from '@/lib/api/engineering'

interface Suggestion {
  id: string
  text: string
  actionLabel: string
  targetId: string
}

/**
 * Groups same-location, same-trade open work so a chief engineer can spot a
 * single-trip fix instead of two lockouts, flags the soonest-due unassigned
 * urgent/emergency work, and surfaces the longest-standing escalation. All
 * three read off work orders already loaded for the board -- no fabricated
 * data, no invented "merge"/"assign" backend calls; each suggestion just
 * opens the real work order so the engineer decides.
 */
export function buildCopilotSuggestions(workOrders: WorkOrder[], t: (key: string, opts?: Record<string, unknown>) => string): Suggestion[] {
  const suggestions: Suggestion[] = []
  const active = workOrders.filter((wo) => wo.status !== 'completed' && wo.status !== 'cancelled')

  const groups = new Map<string, WorkOrder[]>()
  for (const wo of active) {
    const locKey = wo.room_id ?? wo.location_text ?? wo.rooms?.room_number ?? ''
    if (!locKey) continue
    const key = `${locKey}|${wo.category}`
    groups.set(key, [...(groups.get(key) ?? []), wo])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const [a, b] = group
    suggestions.push({
      id: `pair-${a.id}`,
      text: t('engineering.workOrdersPage.copilotPairText', { a: `WO-${a.work_order_number}`, b: `WO-${b.work_order_number}`, category: a.category }),
      actionLabel: t('engineering.workOrdersPage.copilotReview'),
      targetId: a.id,
    })
    break
  }

  const unassignedUrgent = active
    .filter((wo) => wo.status === 'open' && !wo.assigned_to && (wo.priority === 'emergency' || wo.priority === 'urgent'))
    .sort((a, b) => (a.due_at ? new Date(a.due_at).getTime() : Infinity) - (b.due_at ? new Date(b.due_at).getTime() : Infinity))
  if (unassignedUrgent[0]) {
    const wo = unassignedUrgent[0]
    suggestions.push({
      id: `assign-${wo.id}`,
      text: t('engineering.workOrdersPage.copilotAssignText', { id: `WO-${wo.work_order_number}`, priority: wo.priority }),
      actionLabel: t('engineering.workOrdersPage.copilotAssign'),
      targetId: wo.id,
    })
  }

  const oldestEscalated = active
    .filter((wo) => wo.status === 'escalated')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
  if (oldestEscalated) {
    suggestions.push({
      id: `escalated-${oldestEscalated.id}`,
      text: t('engineering.workOrdersPage.copilotEscalatedText', {
        id: `WO-${oldestEscalated.work_order_number}`,
        age: formatDistanceToNowStrict(new Date(oldestEscalated.created_at)),
      }),
      actionLabel: t('engineering.workOrdersPage.copilotReview'),
      targetId: oldestEscalated.id,
    })
  }

  return suggestions.slice(0, 3)
}

interface CopilotSuggestionsCardProps {
  workOrders: WorkOrder[]
  onSelect: (id: string) => void
}

export function CopilotSuggestionsCard({ workOrders, onSelect }: CopilotSuggestionsCardProps) {
  const { t } = useTranslation()
  const suggestions = useMemo(() => buildCopilotSuggestions(workOrders, t), [workOrders, t])

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-surface p-3.5 shadow-[var(--shadow-sm)]">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-ai" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.workOrdersPage.copilotTitle')}</span>
      </div>
      {suggestions.length === 0 ? (
        <p className="text-[12px] text-ink4">{t('engineering.workOrdersPage.copilotEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.targetId)}
              className="flex items-start gap-2 rounded-[var(--r-md)] border border-line-2 bg-surface-2 p-2.5 text-left transition-colors hover:border-ai-line hover:bg-ai-soft"
            >
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-ai" />
              <span className="flex-1 text-[12px] leading-snug text-ink2">{s.text}</span>
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-accent">{s.actionLabel} →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
