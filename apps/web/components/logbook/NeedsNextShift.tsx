'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { LogbookEntry } from '@/lib/api/logbook'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { categoryLabel, relatedTypeLabel } from '@/lib/utils/logbookDisplay'
import { formatDuration } from '@/components/tasks/taskDisplay'
import { isFollowUpOverdue, sortLogbookFollowUps } from '@/lib/utils/logbookFollowUps'

const COLLAPSED_COUNT = 6

interface NeedsNextShiftProps {
  entries: LogbookEntry[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onOpen: (entry: LogbookEntry) => void
}

function DueLabel({ entry, now }: { entry: LogbookEntry; now: Date }) {
  const { t } = useTranslation()
  if (!entry.follow_up_at) return null
  const due = new Date(entry.follow_up_at)
  if (isFollowUpOverdue(entry, now)) {
    const minutes = Math.round((now.getTime() - due.getTime()) / 60_000)
    return <span className="font-medium text-[var(--alert)]">{t('logbook.overdueBy', { duration: formatDuration(t, minutes) })}</span>
  }
  const sameDay = due.toDateString() === now.toDateString()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const isTomorrow = due.toDateString() === tomorrow.toDateString()
  const time = format(due, 'h:mm a')
  if (sameDay) return <span>{t('logbook.dueToday', { time })}</span>
  if (isTomorrow) return <span>{t('logbook.dueTomorrow', { time })}</span>
  return <span>{t('logbook.dueOn', { date: format(due, 'MMM d'), time })}</span>
}

function Row({ entry, now, onOpen }: { entry: LogbookEntry; now: Date; onOpen: (entry: LogbookEntry) => void }) {
  const { t } = useTranslation()
  const ownerName = entry.assigned_user_profiles?.preferred_name || entry.assigned_user_profiles?.full_name || t('logbook.unassigned')
  const departmentName = entry.departments?.name || t('logbook.general')
  const overdue = isFollowUpOverdue(entry, now)

  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      className="flex w-full items-start gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset"
    >
      {(overdue || entry.priority === 'important') && (
        <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${overdue ? 'text-[var(--alert)]' : 'text-[var(--caution)]'}`} aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Pill tone="neutral" size="sm">{categoryLabel(t, entry.category)}</Pill>
          {entry.priority === 'important' && <Pill tone="alert" size="sm">{t('logbook.priorities.important')}</Pill>}
          {entry.related_type && <span className="text-[11px] text-ink3">{relatedTypeLabel(t, entry.related_type)}</span>}
        </div>
        <p className="line-clamp-2 text-sm text-ink">{entry.content}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink3">
          <span>{departmentName}</span>
          <span aria-hidden="true">·</span>
          <span>{ownerName}</span>
          {entry.follow_up_at && (
            <>
              <span aria-hidden="true">·</span>
              <DueLabel entry={entry} now={now} />
            </>
          )}
        </p>
      </div>
      <span className="mt-0.5 shrink-0 text-sm font-medium text-accent">{t('logbook.open')} →</span>
    </button>
  )
}

export function NeedsNextShift({ entries, isLoading, isError, onRetry, onOpen }: NeedsNextShiftProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => new Date())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (!isLoading && !isError && entries.length === 0) return null

  const sorted = sortLogbookFollowUps(entries, now)
  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED_COUNT)

  return (
    <section aria-labelledby="logbook-needs-next-shift-heading" className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--alert-line)] bg-surface">
      <div className="flex items-center justify-between border-b border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-2.5">
        <h2 id="logbook-needs-next-shift-heading" className="text-xs font-semibold uppercase tracking-[.08em] text-[var(--alert)]">
          {t('logbook.needsNextShift')}
        </h2>
        {!isLoading && <span className="text-xs font-semibold text-[var(--alert)]">{t('logbook.needsNextShiftCount', { count: sorted.length })}</span>}
      </div>
      {isLoading ? (
        <div className="space-y-3 p-4"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
      ) : (
        <StateBlock status={isError ? 'error' : null} error={{ message: t('logbook.loadError'), onRetry }}>
          <div>
            {visible.map((entry) => <Row key={entry.id} entry={entry} now={now} onOpen={onOpen} />)}
          </div>
          {sorted.length > COLLAPSED_COUNT && (
            <div className="border-t border-line px-4 py-2.5 text-center">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
                {expanded ? t('logbook.showFewer') : t('logbook.viewAllFollowUps', { count: sorted.length })}
              </Button>
            </div>
          )}
        </StateBlock>
      )}
    </section>
  )
}
