'use client'

import { Clock, Paperclip } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { LogbookEntry } from '@/lib/api/logbook'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { AILabel, Avatar, Pill } from '@/components/ui/primitives'
import { categoryIcon, categoryLabel, statusLabel, statusTone } from '@/lib/utils/logbookDisplay'

interface LogbookActivityRowProps {
  entry: LogbookEntry
  canEdit: boolean
  onOpen: (entry: LogbookEntry) => void
  onEdit: (entry: LogbookEntry) => void
  onDelete: (entry: LogbookEntry) => void
}

export function LogbookActivityRow({ entry, canEdit, onOpen, onEdit, onDelete }: LogbookActivityRowProps) {
  const { t } = useTranslation()
  const authorName = entry.user_profiles?.preferred_name || entry.user_profiles?.full_name || t('logbook.teamMember')
  const departmentName = entry.departments?.name || t('logbook.general')
  const time = format(new Date(entry.created_at), 'h:mm a')
  const ownerName = entry.assigned_user_profiles?.preferred_name || entry.assigned_user_profiles?.full_name
  const showFollowUpLine = entry.status === 'follow_up' && (ownerName || entry.follow_up_at)

  return (
    <article className="grid gap-2 border-b border-line py-4 last:border-b-0 md:grid-cols-[82px_minmax(0,1fr)] md:gap-4">
      <time dateTime={entry.created_at} className="font-mono text-xs tabular-nums text-ink3 md:pt-3">{time}</time>
      <div
        role="button"
        tabIndex={0}
        aria-label={t('logbook.detailAria')}
        onClick={() => onOpen(entry)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(entry) } }}
        className="rounded-[var(--r-lg)] border border-line bg-surface px-4 py-3.5 transition-shadow hover:shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Pill tone="neutral" size="sm">{departmentName}</Pill>
              <Pill tone="neutral" size="sm">{categoryIcon(entry.category, 11)}{categoryLabel(t, entry.category)}</Pill>
              {entry.priority === 'important' && <Pill tone="alert" size="sm">{t('logbook.priorities.important')}</Pill>}
              {entry.status !== 'informational' && (
                <Pill tone={statusTone(entry.status)} size="sm">{statusLabel(t, entry.status)}</Pill>
              )}
              {entry.is_ai_generated && <AILabel />}
              {entry.expires_at && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ink3">
                  <Clock className="size-3" aria-hidden="true" />
                  {t('logbook.temporary')} · {t('logbook.hidesIn', { time: formatDistanceToNow(new Date(entry.expires_at)) })}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{entry.content}</p>
            {showFollowUpLine && (
              <p className="mt-2 text-xs text-ink3">
                {t('logbook.statuses.follow_up')}
                {ownerName ? ` · ${ownerName}` : ''}
                {entry.follow_up_at ? ` · ${t('logbook.dueAt', { time: format(new Date(entry.follow_up_at), 'MMM d · h:mm a') })}` : ''}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2 text-xs text-ink3">
              <Avatar name={authorName} size={22} />
              <span>{authorName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{time}</span>
              {entry.edited_at && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{t('logbook.edited')}</span>
                </>
              )}
              {entry.requires_acknowledgment && entry.acknowledgment ? <><span aria-hidden="true">·</span><span>{t('logbook.acknowledgmentCompact', { acknowledged: entry.acknowledgment.acknowledged_count, total: entry.acknowledgment.total_required })}</span></> : entry.comment_count ? <><span aria-hidden="true">·</span><span>{t('logbook.commentCount', { count: entry.comment_count })}</span>{entry.read_count ? <><span aria-hidden="true">·</span><span>{t('logbook.seenBy', { count: entry.read_count })}</span></> : null}</> : entry.read_count ? <><span aria-hidden="true">·</span><span>{t('logbook.seenBy', { count: entry.read_count })}</span></> : null}
            </div>
            {!!entry.attachment_count && <span className="mt-2 inline-flex items-center gap-1 text-xs text-ink3"><Paperclip size={12} aria-hidden="true" />{t('logbook.attachmentCount', { count: entry.attachment_count })}</span>}
          </div>
          {canEdit && <KebabMenu onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry)} />}
        </div>
      </div>
    </article>
  )
}
