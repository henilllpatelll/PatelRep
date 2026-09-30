'use client'

import { AlertCircle, Check, Sparkles } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { ShiftSummary } from '@/lib/api/logbook'
import { AILabel, Pill } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'

interface LogbookHandoffCardProps {
  summary?: ShiftSummary
  title: string
  isHistorical: boolean
  isLoading: boolean
  error: Error | null
  canGenerate: boolean
  canAcknowledge: boolean
  isGenerating: boolean
  isAcknowledging: boolean
  onGenerate: () => void
  onAcknowledge: () => void
  onRetry: () => void
  onViewFull: () => void
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="min-w-[96px] rounded-[var(--r-md)] border border-ai-line bg-surface px-3 py-2"><strong className="block font-mono text-base tabular-nums text-ink">{value}</strong><span className="block text-[10px] font-medium leading-4 text-ink3">{label}</span></div>
}

export function LogbookHandoffCard({ summary, title, isHistorical, isLoading, error, canGenerate, canAcknowledge, isGenerating, isAcknowledging, onGenerate, onAcknowledge, onRetry, onViewFull }: LogbookHandoffCardProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return <section aria-label={t('logbook.aiHandoff')} className="rounded-[var(--r-lg)] border border-ai-line bg-ai-soft/50 p-5"><Skeleton className="h-3 w-52" /><div className="mt-5 flex gap-2"><Skeleton className="h-14 w-24" /><Skeleton className="h-14 w-24" /><Skeleton className="h-14 w-24" /></div><Skeleton className="mt-5 h-4 w-full" /><Skeleton className="mt-2 h-4 w-4/5" /></section>
  }

  if (error) {
    return <section aria-label={t('logbook.aiHandoff')} className="rounded-[var(--r-lg)] border border-ai-line bg-ai-soft/50 p-5"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 size-4 text-alert" aria-hidden="true" /><div><p className="text-sm font-medium text-ink">{t('logbook.handoffUnavailable')}</p><Button variant="ghost" size="sm" onClick={onRetry} className="mt-2 px-0 text-ai">{t('common.retry')}</Button></div></div></section>
  }

  if (!summary) {
    if (isHistorical) return null
    return <section aria-label={t('logbook.aiHandoff')} className="rounded-[var(--r-lg)] border border-ai-line bg-ai-soft/50 p-5"><div className="flex items-center gap-2"><Sparkles className="size-4 text-ai" aria-hidden="true" /><AILabel>{t('logbook.aiHandoff')}</AILabel></div><p className="mt-4 text-sm text-ink2">{canGenerate ? t('logbook.handoffNotGenerated') : t('logbook.handoffNotAvailable')}</p>{canGenerate && <Button variant="ai" size="sm" loading={isGenerating} onClick={onGenerate} className="mt-4"><Sparkles className="size-4" />{t('logbook.generateHandoff')}</Button>}</section>
  }

  const stats = summary.stats ?? summary
  const acknowledgedAt = summary.acknowledged_at ? format(new Date(summary.acknowledged_at), 'MMM d · h:mm a') : null

  return (
    <section aria-label={t('logbook.aiHandoff')} className="rounded-[var(--r-lg)] border border-ai-line bg-ai-soft/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ai">{isHistorical ? t('logbook.historicalHandoff') : title}</p>
          <div className="mt-2 flex items-center gap-2"><Sparkles className="size-4 text-ai" aria-hidden="true" /><AILabel>{t('logbook.aiHandoff')}</AILabel></div>
        </div>
        <Pill tone="ai" size="sm">{t('logbook.ready')}</Pill>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Metric value={stats.pending_guest_issues_count ?? 0} label={t('logbook.pendingGuestIssues')} />
        <Metric value={stats.sla_breaches_count ?? 0} label={t('logbook.slaBreaches')} />
        <Metric value={stats.vip_arrivals_count ?? 0} label={t('logbook.vipArrivals')} />
        <Metric value={stats.open_work_orders ?? 0} label={t('logbook.openWorkOrders')} />
        <Metric value={stats.low_stock_parts_count ?? 0} label={t('logbook.lowStockParts')} />
      </div>
      <p className="mt-5 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-ink2">{summary.summary_text}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ai-line pt-4">
        <Button variant="ghost" size="sm" onClick={onViewFull} className="px-0 text-ai">
          {t('logbook.viewFullHandoff')}
        </Button>
        {summary.acknowledged_at ? <span className="inline-flex items-center gap-1.5 text-xs text-ink3"><Check className="size-3.5 text-ready" aria-hidden="true" />{t('logbook.acknowledgedBy', { name: summary.acknowledged_by_name ?? t('logbook.acknowledgedFallback'), time: acknowledgedAt })}</span> : canAcknowledge && summary.id ? <Button variant="outline" size="sm" onClick={onAcknowledge} loading={isAcknowledging}><Check className="size-3.5" />{t('logbook.acknowledge')}</Button> : null}
      </div>
    </section>
  )
}
