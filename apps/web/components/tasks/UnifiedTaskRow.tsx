'use client'

import { useTranslation } from 'react-i18next'
import type { UnifiedTaskItem, UnifiedDisplayStatus } from '@/lib/utils/unifiedTasks'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { taskTypeIcon, SparkIcon, DueTime, laneAccentColor } from './taskDisplay'

function displayStatusLabel(t: (key: string) => string, status: UnifiedDisplayStatus): string {
  return t(`tasks.unified.displayStatus.${status}`)
}

export function UnifiedTaskRow({
  item,
  onOpen,
  onEdit,
  onDelete,
  showActions = false,
}: {
  item: UnifiedTaskItem
  onOpen: (item: UnifiedTaskItem) => void
  onEdit?: (item: UnifiedTaskItem) => void
  onDelete?: (item: UnifiedTaskItem) => void
  showActions?: boolean
}) {
  const { t } = useTranslation()
  const isDone = item.displayStatus === 'done'
  const isGuest = item.sourceType === 'guest_request'

  return (
    <div
      role="button"
      tabIndex={0}
      className={`relative flex items-center gap-[11px] pl-4 pr-3 py-[10px] border-b border-[var(--line-2)] last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors ${isDone ? 'opacity-50' : ''}`}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
    >
      <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l" style={{ background: laneAccentColor(item) }} />

      <span className="text-ink3 shrink-0">{taskTypeIcon(item.department ?? '')}</span>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`truncate text-sm font-semibold text-ink ${isDone ? 'line-through text-ink3' : ''}`}>{item.title}</span>{item.isAiCreated && <span className="text-[10px] text-[var(--ai)]" aria-label={t('tasks.aiBadge')}><SparkIcon /></span>}</div><div className="mt-1 flex items-center gap-2 text-xs text-ink3"><span>{item.roomNumber ? `${t('tasks.detail.room')} ${item.roomNumber}` : item.locationText ?? t('tasks.createModal.unassigned')}</span><span aria-hidden>·</span><span>{item.department ?? t('tasks.unified.badgeInternal')}</span><span aria-hidden>·</span><span>{item.assigneeName ?? t('tasks.createModal.unassigned')}</span></div></div>
      <div className="hidden shrink-0 text-right sm:block"><span className="block text-xs text-ink3">{displayStatusLabel(t, item.displayStatus)}</span><DueTime dueAt={item.dueAt} isDone={isDone} isOverdue={item.slaBreached} /></div>

      {showActions && onDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <KebabMenu
            onEdit={!isDone && onEdit ? () => onEdit(item) : undefined}
            onDelete={() => onDelete(item)}
          />
        </div>
      )}
    </div>
  )
}
