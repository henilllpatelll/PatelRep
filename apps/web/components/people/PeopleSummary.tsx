'use client'

import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import type { DirectorySummary } from '@/lib/people/peopleDirectory'
import { usePeopleLabels } from './usePeopleLabels'

type Source = 'loading' | 'error' | 'ready'

interface Props {
  summary: DirectorySummary
  sources: { staff: Source; invitations: Source; today: Source }
  onShowPending: () => void
}

function Metric({
  label, value, source, hint, onClick, clickLabel,
}: { label: string; value: number | null; source: Source; hint?: string | null; onClick?: () => void; clickLabel?: string }) {
  const { t } = usePeopleLabels()
  const unavailable = source === 'error' || (source === 'ready' && value === null)
  const body = (
    <>
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</span>
      {source === 'loading' ? (
        <Skeleton className="mt-1 h-5 w-8" />
      ) : unavailable ? (
        <span className="mt-0.5 text-[13px] text-ink-3" title={t('people.summary.unavailableHint')}>
          {t('people.summary.unavailable')}
        </span>
      ) : (
        <span className="mt-0.5 flex items-baseline gap-2">
          <span className="font-mono text-[20px] font-semibold leading-none text-ink">{value}</span>
          {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
        </span>
      )}
    </>
  )
  const cls = 'flex min-w-[96px] flex-col items-start text-left'
  if (!onClick || unavailable || source === 'loading') return <div className={cls}>{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}. ${clickLabel}`}
      className={cn(cls, 'rounded-md transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]')}
    >
      {body}
    </button>
  )
}

/** Compact context strip - deliberately not a dashboard. Unknown values are never shown as zero. */
export function PeopleSummary({ summary, sources, onShowPending }: Props) {
  const { t } = usePeopleLabels()
  const clocked = summary.clockedIn && summary.clockedIn > 0 ? t('people.summary.clockedIn', { count: summary.clockedIn }) : null
  return (
    <section
      aria-label={t('people.summary.label')}
      className="flex flex-wrap items-start gap-x-10 gap-y-3 rounded-xl border border-line bg-surface px-5 py-3"
    >
      <Metric label={t('people.summary.active')} value={summary.active} source={sources.staff} />
      <Metric label={t('people.summary.scheduled')} value={summary.scheduledToday} source={sources.staff === 'ready' ? sources.today : sources.staff} hint={clocked} />
      <Metric
        label={t('people.summary.pending')}
        value={summary.pendingInvites}
        source={sources.invitations}
        onClick={onShowPending}
        clickLabel={t('people.summary.viewPending')}
      />
    </section>
  )
}
