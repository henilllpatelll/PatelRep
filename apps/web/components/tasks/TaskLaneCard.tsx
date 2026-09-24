'use client'

import { useTranslation } from 'react-i18next'
import type { UnifiedTaskItem } from '@/lib/utils/unifiedTasks'
import { Avatar, Pill, SparkIcon } from '@/components/ui/primitives'
import { taskTypeIcon, DueTime, laneAccentColor } from './taskDisplay'

export function TaskLaneCard({ item, onOpen }: { item: UnifiedTaskItem; onOpen: (item: UnifiedTaskItem) => void }) {
  const { t } = useTranslation()
  const isDone = item.displayStatus === 'done'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
      className="cursor-pointer rounded-[var(--r-md)] border border-line bg-surface p-[11px_13px] shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
      style={{ borderLeft: `3px solid ${laneAccentColor(item)}`, opacity: isDone ? 0.9 : 1 }}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="shrink-0 text-ink3">{taskTypeIcon(item.department ?? '')}</span>
        <span className={`truncate text-[13.5px] font-semibold text-ink ${isDone ? 'line-through decoration-ink4' : ''}`}>{item.title}</span>
        {item.isAiCreated && <span className="shrink-0 text-[var(--ai)]" aria-label={t('tasks.aiBadge')}><SparkIcon size={9} /></span>}
      </div>
      <div className="mb-2 truncate text-[11.5px] text-ink3">
        {item.roomNumber ? `${t('tasks.detail.room')} ${item.roomNumber}` : item.locationText ?? t('tasks.createModal.unassigned')}
        {item.department && <> &middot; {item.department}</>}
      </div>

      {isDone ? (
        <div className="flex items-center gap-1.5">
          <Avatar name={item.assigneeName ?? '?'} size={20} />
          <span className="text-[11px] font-semibold text-[var(--ready)]">
            {item.completedAt
              ? t('tasks.board.completedBy', { time: new Date(item.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), name: item.assigneeName ?? t('tasks.createModal.unassigned') })
              : item.assigneeName}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          {item.assigneeId ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <Avatar name={item.assigneeName ?? '?'} size={20} />
              <span className="truncate text-[11.5px] text-ink2">
                {item.assigneeName}
                {item.displayStatus === 'in_progress' && item.startedAt && (
                  <span className="text-ink4"> &middot; {new Date(item.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                )}
              </span>
            </div>
          ) : (
            <Pill tone="caution" size="sm">{t('tasks.board.unassignedBadge')}</Pill>
          )}
          <DueTime dueAt={item.dueAt} isDone={isDone} isOverdue={item.slaBreached} />
        </div>
      )}
    </div>
  )
}
