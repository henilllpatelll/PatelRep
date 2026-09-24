'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import type { PMSchedule } from '@/lib/api/engineering'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'

interface PMWeekGlanceProps {
  schedules: PMSchedule[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

const MAX_ROWS = 8

export function PMWeekGlance({ schedules, isLoading, isError, onRetry }: PMWeekGlanceProps) {
  const { t } = useTranslation()

  const days = useMemo(() => {
    const today = startOfDay(new Date())
    return Array.from({ length: 7 }, (_, i) => addDays(today, i))
  }, [])

  const rows = useMemo(() => {
    const weekEnd = addDays(days[0], 7)
    return schedules
      .filter((s) => {
        const due = new Date(s.next_due_at)
        const done = s.last_completed_at ? new Date(s.last_completed_at) : null
        return due < weekEnd || (done && done >= days[0] && done < weekEnd)
      })
      .sort((a, b) => new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime())
      .slice(0, MAX_ROWS)
  }, [schedules, days])

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3.5 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-normal text-ink">{t('engineering.workOrdersPage.weekTitle')}</h2>
        <span className="text-[12px] text-ink3">{t('engineering.workOrdersPage.weekScheduledCount', { count: rows.length })}</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : isError ? (
        <StateBlock status="error" error={{ message: t('engineering.commandCenter.loadError'), onRetry }} />
      ) : rows.length === 0 ? (
        <StateBlock status="empty" empty={{ title: t('engineering.workOrdersPage.weekEmpty') }} />
      ) : (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: '200px repeat(7, minmax(0, 1fr))' }}>
          <span />
          {days.map((d) => (
            <div key={d.toISOString()} className={`pb-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.06em] ${isSameDay(d, days[0]) ? 'text-accent' : 'text-ink3'}`}>
              {format(d, 'EEE d')}
            </div>
          ))}
          {rows.map((s) => {
            const due = new Date(s.next_due_at)
            const done = s.last_completed_at ? new Date(s.last_completed_at) : null
            const overdue = due < days[0]
            return (
              <div key={s.id} className="contents">
                <div className="flex min-w-0 items-center gap-1.5 py-2 text-[12px] text-ink2">
                  <span className="truncate">{s.name}</span>
                </div>
                {days.map((d) => {
                  const isToday = isSameDay(d, days[0])
                  const isDone = done ? isSameDay(d, done) : false
                  // 'at risk' surfaces on today's cell once the schedule has already
                  // slipped past its due date -- distinct from 'due' (due today) and
                  // 'sched' (due later this week, nothing urgent yet).
                  const state: 'done' | 'atRisk' | 'due' | 'sched' | null = isDone
                    ? 'done'
                    : overdue && isToday
                    ? 'atRisk'
                    : !overdue && isSameDay(d, due)
                    ? (isToday ? 'due' : 'sched')
                    : null
                  const STYLES: Record<string, string> = {
                    done: 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]',
                    atRisk: 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]',
                    due: 'border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)]',
                    sched: 'border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]',
                  }
                  const LABELS: Record<string, string> = {
                    done: t('engineering.workOrdersPage.weekDone'),
                    atRisk: t('engineering.workOrdersPage.weekAtRisk'),
                    due: t('engineering.workOrdersPage.weekDue'),
                    sched: t('engineering.workOrdersPage.weekSched'),
                  }
                  return (
                    <div key={d.toISOString()} className={`flex min-h-[32px] items-center justify-center rounded-[var(--r-sm)] border text-[10px] font-medium ${state ? STYLES[state] : 'border-line-2 bg-surface-2 text-ink4'}`}>
                      {state ? LABELS[state] : ''}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
