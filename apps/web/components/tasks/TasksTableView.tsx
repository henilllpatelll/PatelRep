'use client'

import { useTranslation } from 'react-i18next'
import type { Lane, LaneKey } from '@/lib/utils/taskWorkspace'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { UnifiedTaskRow } from './UnifiedTaskRow'
import type { TaskNextActionContext } from './TaskNextAction'

const LANE_TEXT: Record<LaneKey, string> = {
  new: 'text-ink3',
  in_progress: 'text-[var(--progress)]',
  verify: 'text-[var(--info)]',
  done_today: 'text-[var(--ready)]',
}

export function TasksTableView({
  lanes, onOpen, onEdit, onDelete, showActions, actionContext,
  selection,
}: {
  lanes: Lane[]
  onOpen: (item: UnifiedTaskItem) => void
  onEdit?: (item: UnifiedTaskItem) => void
  onDelete?: (item: UnifiedTaskItem) => void
  showActions?: boolean
  actionContext: TaskNextActionContext
  /** Bulk selection (Phase 6) — omit entirely to render the plain read-only list. */
  selection?: {
    selectedIds: Set<string>
    onToggle: (item: UnifiedTaskItem) => void
    onSelectAllVisible: (items: UnifiedTaskItem[]) => void
    onClear: () => void
  }
}) {
  const { t } = useTranslation()
  const nonEmpty = lanes.filter((lane) => lane.key !== 'done_today' && lane.items.length > 0)

  if (nonEmpty.length === 0) return null

  const visibleItems = nonEmpty.flatMap((lane) => lane.items)
  const allVisibleSelected = !!selection && visibleItems.length > 0 && visibleItems.every((item) => selection.selectedIds.has(item.id))

  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-sm)]">
      {selection && (
        <label className="flex items-center gap-2.5 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-ink2">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={() => (allVisibleSelected ? selection.onClear() : selection.onSelectAllVisible(visibleItems))}
            aria-label={t('tasks.bulk.selectAllVisibleAria')}
            className="h-4 w-4 rounded border-line"
          />
          {t('tasks.bulk.selectAllVisible')}
        </label>
      )}
      {nonEmpty.map((lane) => (
        <div key={lane.key}>
          <p className={`border-b border-line bg-surface-2 px-4 py-2 text-[11px] font-bold uppercase tracking-[.1em] ${LANE_TEXT[lane.key]}`}>
            {t(`tasks.board.lanes.${lane.key}`)} &middot; {lane.items.length}
          </p>
          {lane.items.map((item) => {
            // Guest-request-sourced items are edited/deleted through their own
            // GuestRequestDrawer transition flow, never this internal-task path.
            const isInternal = item.sourceType === 'internal'
            return (
              <UnifiedTaskRow
                key={item.id}
                item={item}
                onOpen={onOpen}
                onEdit={isInternal ? onEdit : undefined}
                onDelete={isInternal ? onDelete : undefined}
                showActions={showActions && isInternal}
                actionContext={actionContext}
                selectable={!!selection}
                selected={!!selection?.selectedIds.has(item.id)}
                onToggleSelect={selection?.onToggle}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
