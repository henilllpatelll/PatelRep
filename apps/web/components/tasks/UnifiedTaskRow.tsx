'use client'

import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import type { UnifiedTaskItem, UnifiedDisplayStatus } from '@/lib/utils/unifiedTasks'
import { Pill, Mono } from '@/components/ui/primitives'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { priorityTone, taskTypeIcon, SparkIcon, DueTime } from './taskDisplay'

const DISPLAY_STATUS_TONE: Record<UnifiedDisplayStatus, 'info' | 'caution' | 'ready' | 'neutral'> = {
  new: 'info',
  in_progress: 'caution',
  verify: 'ready',
  done: 'neutral',
}

function displayStatusLabel(t: (key: string) => string, status: UnifiedDisplayStatus): string {
  return t(`tasks.unified.displayStatus.${status}`)
}

export function UnifiedTaskRow({
  item,
  onOpen,
  onEdit,
  onDelete,
}: {
  item: UnifiedTaskItem
  onOpen: (item: UnifiedTaskItem) => void
  onEdit?: (item: UnifiedTaskItem) => void
  onDelete?: (item: UnifiedTaskItem) => void
}) {
  const { t } = useTranslation()
  const isDone = item.displayStatus === 'done'
  const isGuest = item.sourceType === 'guest_request'

  return (
    <div
      role="button"
      tabIndex={0}
      className={`relative flex items-center gap-[11px] px-3 py-[10px] border-b border-[var(--line-2)] last:border-b-0 hover:bg-surface-2 cursor-pointer transition-colors ${isDone ? 'opacity-50' : ''}`}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
    >
      {item.slaBreached && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--alert)] rounded-l" />
      )}

      <Pill tone={isGuest ? 'info' : 'neutral'} size="sm">
        {isGuest ? t('tasks.unified.badgeGuest') : t('tasks.unified.badgeInternal')}
      </Pill>

      <Pill tone={priorityTone(item.priority)} size="sm">{item.priority}</Pill>

      <span className="text-ink3 shrink-0">{taskTypeIcon(item.department ?? '')}</span>

      <span className={`text-[13.5px] flex-1 min-w-0 text-ink truncate ${isDone ? 'line-through text-ink3' : ''}`}>
        {item.title}
      </span>

      {item.isAiCreated && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ai)] bg-[var(--ai-soft)] border border-[var(--ai-line)] px-[6px] py-px rounded-[4px] tracking-[0.4px] shrink-0">
          <SparkIcon /> {t('tasks.aiBadge')}
        </span>
      )}

      {item.roomNumber && (
        <span className="text-[10.5px] text-ink3 bg-surface-3 px-[5px] py-px rounded-[3px] shrink-0">
          #{item.roomNumber}
        </span>
      )}

      {item.assigneeName && (
        <span className="w-[22px] h-[22px] rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[9px] font-bold flex items-center justify-center shrink-0 uppercase">
          {item.assigneeName.slice(0, 2)}
        </span>
      )}

      <Pill tone={DISPLAY_STATUS_TONE[item.displayStatus]} size="sm">
        {displayStatusLabel(t, item.displayStatus)}
      </Pill>

      <DueTime dueAt={item.dueAt} isDone={isDone} isOverdue={item.slaBreached} />

      {onDelete && (
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
