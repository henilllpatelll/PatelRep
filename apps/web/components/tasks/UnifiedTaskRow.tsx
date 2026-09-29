'use client'

import { useTranslation } from 'react-i18next'
import type { UnifiedTaskItem, UnifiedDisplayStatus } from '@/lib/utils/unifiedTasks'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { Avatar, Pill } from '@/components/ui/primitives'
import { TaskNextAction, type TaskNextActionContext } from './TaskNextAction'
import { taskDepartmentLabel, taskTypeIcon, DueTime, laneAccentColor } from './taskDisplay'

function displayStatusLabel(t: (key: string) => string, status: UnifiedDisplayStatus): string {
  return t(`tasks.unified.displayStatus.${status}`)
}

export function UnifiedTaskRow({
  item,
  onOpen,
  onEdit,
  onDelete,
  showActions = false,
  actionContext,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  item: UnifiedTaskItem
  onOpen: (item: UnifiedTaskItem) => void
  onEdit?: (item: UnifiedTaskItem) => void
  onDelete?: (item: UnifiedTaskItem) => void
  showActions?: boolean
  actionContext: TaskNextActionContext
  /** List-view bulk selection (Phase 6) — never shown on the Kanban board. */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (item: UnifiedTaskItem) => void
}) {
  const { t } = useTranslation()
  const isDone = item.displayStatus === 'done'
  const isInternal = item.sourceType === 'internal'
  const departmentLabel = taskDepartmentLabel(t, item)

  return (
    <div
      role="button"
      tabIndex={0}
      className={`relative flex items-center gap-[11px] border-b border-[var(--line-2)] py-[10px] pl-4 pr-3 transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${isDone ? 'opacity-60' : ''} ${selected ? 'bg-[var(--accent-soft)]' : ''}`}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(item) } }}
    >
      <span className="absolute bottom-0 left-0 top-0 w-[3px] rounded-l" style={{ background: laneAccentColor(item) }} />
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggleSelect?.(item)}
          aria-label={t('tasks.bulk.selectItemAria', { title: item.title })}
          className="h-4 w-4 shrink-0 rounded border-line"
        />
      )}
      <span className="shrink-0 text-ink3">{taskTypeIcon(item.department ?? '')}</span>
      <div className="min-w-0 flex-[1.5]">
        <span className={`block truncate text-sm font-semibold text-ink ${isDone ? 'line-through text-ink3' : ''}`}>{item.title}</span>
        <div className="mt-1 flex items-center gap-2 truncate text-xs text-ink3">
          <span>{item.roomNumber ? `${t('tasks.detail.room')} ${item.roomNumber}` : item.locationText ?? t('tasks.createModal.unassigned')}</span>
          <span aria-hidden>·</span>
          <span>{item.sourceType === 'guest_request' ? t('tasks.board.sourceGuest') : t('tasks.board.sourceInternal')}</span>
          {departmentLabel && <><span aria-hidden>·</span><span>{departmentLabel}</span></>}
        </div>
      </div>
      <div className="hidden min-w-[130px] shrink-0 items-center gap-1.5 md:flex">
        {item.assigneeName ? <><Avatar name={item.assigneeName} size={20} /><span className="truncate text-xs text-ink2">{item.assigneeName}</span></> : <Pill tone="caution" size="sm">{t('tasks.board.unassignedBadge')}</Pill>}
      </div>
      <div className="hidden min-w-[68px] shrink-0 md:block">
        {item.priority === 'urgent' ? <Pill tone="alert" size="sm" className="uppercase">{t('tasks.priorities.urgent')}</Pill> : item.priority === 'low' ? <Pill tone="neutral" size="sm">{t('tasks.priorities.low')}</Pill> : null}
      </div>
      <div className="hidden min-w-[84px] shrink-0 text-right sm:block">
        <span className="block text-xs text-ink3">{displayStatusLabel(t, item.displayStatus)}</span>
        <DueTime dueAt={item.dueAt} isDone={isDone} isOverdue={item.slaBreached} />
      </div>
      {!isDone && (
        <div onClick={(event) => event.stopPropagation()}>
          <TaskNextAction item={item} context={actionContext} />
        </div>
      )}
      {showActions && onDelete && (
        <div onClick={(event) => event.stopPropagation()}>
          <KebabMenu
            onEdit={!isDone && onEdit && isInternal ? () => onEdit(item) : undefined}
            onDelete={() => onDelete(item)}
          />
        </div>
      )}
    </div>
  )
}
