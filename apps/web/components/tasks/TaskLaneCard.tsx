'use client'

import { useTranslation } from 'react-i18next'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { Avatar, Pill } from '@/components/ui/primitives'
import { TaskNextAction, type TaskNextActionContext } from './TaskNextAction'
import { taskDepartmentLabel, taskTypeIcon, DueTime, laneAccentColor } from './taskDisplay'

export function TaskLaneCard({ item, onOpen, actionContext, compact = false }: {
  item: UnifiedTaskItem
  onOpen: (item: UnifiedTaskItem) => void
  actionContext: TaskNextActionContext
  compact?: boolean
}) {
  const { t } = useTranslation()
  const isDone = item.displayStatus === 'done'
  const sourceLabel = t(item.sourceType === 'guest_request' ? 'tasks.board.sourceGuest' : 'tasks.board.sourceInternal')
  const departmentLabel = taskDepartmentLabel(t, item)
  const priorityLabel = item.priority === 'urgent'
    ? t('tasks.priorities.urgent')
    : item.priority === 'low'
      ? t('tasks.priorities.low')
      : null

  return (
    <article
      className={`relative rounded-[var(--r-md)] border border-line bg-surface p-[11px_13px] text-left shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] ${compact ? 'bg-surface-2 shadow-none' : ''}`}
      style={{ borderLeft: `3px solid ${laneAccentColor(item)}`, opacity: isDone ? 0.82 : 1 }}
    >
      <button type="button" onClick={() => onOpen(item)} aria-label={t('tasks.actions.openDetails', { title: item.title })} className="absolute inset-0 z-0 rounded-[var(--r-md)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" />
      <div className="pointer-events-none relative z-10">
        <div className="mb-1.5 flex items-start gap-1.5">
          <span className="shrink-0 text-ink3">{taskTypeIcon(item.department ?? '')}</span>
          <span className={`min-w-0 flex-1 text-[13.5px] font-semibold leading-[18px] text-ink ${compact ? 'truncate' : 'line-clamp-2'} ${isDone ? 'line-through decoration-ink4' : ''}`}>{item.title}</span>
          {priorityLabel && <Pill tone={item.priority === 'urgent' ? 'alert' : 'neutral'} size="sm" className="shrink-0 uppercase">{priorityLabel}</Pill>}
        </div>
        <div className="mb-1 truncate text-[11.5px] text-ink3">
          {item.roomNumber ? `${t('tasks.detail.room')} ${item.roomNumber}` : item.locationText ?? t('tasks.createModal.unassigned')}
          <> &middot; {sourceLabel}</>
        </div>
        {departmentLabel && <p className="mb-2 truncate text-[11.5px] text-ink3">{departmentLabel}</p>}
        {isDone ? (
          <div className="flex items-center gap-1.5">
            {item.assigneeName && <Avatar name={item.assigneeName} size={20} />}
            <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--ready)]">{item.completedAt ? t('tasks.board.completedBy', { time: new Date(item.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), name: item.assigneeName ?? t('tasks.createModal.unassigned') }) : item.assigneeName ?? t('tasks.createModal.unassigned')}</span>
            {item.finalOutcome && <span className="ml-auto text-[10px] text-ink4">{t(`tasks.board.outcomes.${item.finalOutcome}`)}</span>}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {item.assigneeId ? <div className="flex min-w-0 items-center gap-1.5"><Avatar name={item.assigneeName ?? '?'} size={20} /><span className="truncate text-[11.5px] text-ink2">{item.assigneeName}{item.displayStatus === 'in_progress' && item.startedAt && <span className="text-ink4"> &middot; {new Date(item.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}</span></div> : <Pill tone="caution" size="sm">{t('tasks.board.unassignedBadge')}</Pill>}
            <DueTime dueAt={item.dueAt} isDone={isDone} isOverdue={item.slaBreached} />
          </div>
        )}
      </div>
      {!isDone && <div className="relative z-20 mt-2"><TaskNextAction item={item} context={actionContext} /></div>}
    </article>
  )
}
