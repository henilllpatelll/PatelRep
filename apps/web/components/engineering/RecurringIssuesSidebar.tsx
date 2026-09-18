'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RefreshCw, CheckCircle } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { engineeringApi, type RecurringIssue } from '@/lib/api/engineering'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'

function SkeletonItem() {
  return (
    <div className="p-3 rounded-lg border border-line-2 animate-pulse space-y-2">
      <div className="h-3.5 bg-surface-2 rounded w-2/3" />
      <div className="h-3 bg-surface-2 rounded w-1/2" />
    </div>
  )
}

function IssueCard({ issue }: { issue: RecurringIssue }) {
  const { t } = useTranslation()
  const label = issue.asset_name
    ? issue.room_number
      ? t('engineering.recurringIssues.assetInRoom', { asset: issue.asset_name, room: issue.room_number })
      : issue.asset_name
    : issue.room_number
      ? t('engineering.recurringIssues.roomLabel', { room: issue.room_number })
      : t('engineering.recurringIssues.unknownLocation')

  let lastSeen = ''
  try {
    lastSeen = formatDistanceToNowStrict(new Date(issue.last_wo_at), { addSuffix: true })
  } catch {
    lastSeen = ''
  }

  return (
    <div className="p-3 rounded-lg border bg-[var(--caution-soft)] border-[var(--caution-line)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink leading-tight">{label}</p>
        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--caution)] text-white">
          {t('engineering.recurringIssues.nthInWindow', { count: issue.wo_count, days: issue.window_days })}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink3">
        {issue.category && <span className="capitalize">{issue.category}</span>}
        {issue.category && lastSeen && ' · '}
        {lastSeen && t('engineering.recurringIssues.lastReported', { time: lastSeen })}
      </p>
    </div>
  )
}

export function RecurringIssuesSidebar() {
  const { t } = useTranslation()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('engineering', hotel)

  const { data: issues, isLoading, isError, refetch } = useQuery({
    queryKey: ['recurring-issues'],
    queryFn: () => engineeringApi.getRecurringIssues(),
    select: (res) => res.data,
  })

  const items = issues ?? []

  return (
    <Card className="w-72 h-fit shrink-0 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5 text-[var(--caution)]" aria-hidden="true" />
          {t('engineering.recurringIssues.heading')}
        </h3>
        {items.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--caution-soft)] text-[var(--caution)] border border-[var(--caution-line)] font-medium">
            {items.length}
          </span>
        )}
      </div>

      {v2 && isError ? (
        <StateBlock
          status="error"
          error={{ message: t('engineering.recurringIssues.loadError'), onRetry: () => refetch() }}
          className="py-6"
        />
      ) : isLoading ? (
        <div className="space-y-3">
          <SkeletonItem />
          <SkeletonItem />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-[var(--ready-soft)] flex items-center justify-center mb-2.5">
            <CheckCircle size={18} className="text-[var(--ready)]" />
          </div>
          <p className="text-sm font-medium text-ink2">{t('engineering.recurringIssues.none')}</p>
          <p className="text-xs text-ink4 mt-1">{t('engineering.recurringIssues.noneSubtitle')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((issue) => (
            <IssueCard key={issue.key} issue={issue} />
          ))}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-white/60">
        <p className="text-xs text-ink4 text-center">{t('engineering.recurringIssues.footerNote')}</p>
      </div>
    </Card>
  )
}
