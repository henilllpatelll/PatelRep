'use client'

import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { resolvePreset } from '@/lib/reports/filters'
import { metaFor } from '@/lib/reports/metricMeta'
import { definitionsForPrint, printHides } from '@/lib/reports/printOptions'
import type { Kpi } from '@/lib/reports/types'
import { cn } from '@/lib/utils'
import { ReportMetricCard } from './ReportMetricCard'
import { ErrorBlock, LoadingBlock } from './ReportPrimitives'
import { useReports } from './ReportsContext'

/** Title + one-line purpose at the top of each screen (the page <h1> is "Reports"). */
export function ViewHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-display text-[22px] leading-tight text-ink">{title}</h2>
        <p className="mt-0.5 text-[13px] text-ink3">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

/** KPI cards. A card opens its detail drawer only if the metric has a documented explanation. */
export function KpiGrid({ kpis, columns = 4, className }: { kpis: Array<Kpi | null>; columns?: 2 | 3 | 4 | 5; className?: string }) {
  const { definitions, openDrawer, printOptions } = useReports()
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4', 5: 'sm:grid-cols-2 xl:grid-cols-5' }[columns]
  return (
    <div className={cn('grid grid-cols-1 gap-3', cols, className)}>
      {kpis.filter((k): k is Kpi => !!k).map((kpi) => (
        <ReportMetricCard
          key={kpi.key}
          kpi={kpi}
          definition={definitions?.[kpi.key]}
          hideComparison={printHides(printOptions, 'comparison')}
          onOpen={metaFor(kpi.key) ? () => openDrawer({ kind: 'metric-detail', metric: kpi.key }) : undefined}
        />
      ))}
    </div>
  )
}

/**
 * A report whose source data exceeded the reporting record limit cannot be shown as hotel performance:
 * every figure and breakdown derived from a capped cohort would be a partial count presented as complete.
 * The body is replaced by this notice (the API has already withheld the affected KPIs and tables).
 */
export function TruncationNotice({ notice, onNarrow }: { notice?: string | null; onNarrow?: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-[var(--r-lg)] border border-[var(--caution-line,var(--line))] bg-[var(--caution-soft,var(--surface-2))] p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--caution)]" aria-hidden="true" />
        <div>
          <p className="text-[14px] font-semibold text-ink">This report is too large to show for the selected dates</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink2">
            {notice ?? 'Some source data exceeded the reporting record limit, so the figures that depend on it are hidden rather than shown as hotel-wide results.'}
          </p>
        </div>
      </div>
      {onNarrow && (
        <button
          type="button"
          onClick={onNarrow}
          className="inline-flex min-h-9 items-center rounded-[var(--r-md)] border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 print:hidden"
        >
          Show the last 7 days
        </button>
      )}
    </div>
  )
}

/** Appended while printing with "metric definitions" on: what each KPI on this page means. */
function PrintDefinitions({ items }: { items: Array<{ key: string; label: string; definition: string }> }) {
  if (!items.length) return null
  return (
    <section aria-labelledby="print-definitions" className="report-avoid-break">
      <h2 id="print-definitions" className="text-[14px] font-semibold text-ink">Metric definitions</h2>
      <dl className="mt-2 space-y-2 text-[12px]">
        {items.map((item) => (
          <div key={item.key}>
            <dt className="font-medium text-ink">{item.label}</dt>
            <dd className="text-ink2">{item.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Shared query-state wrapper so every view handles loading / error / partial data the same way. */
export function QueryBoundary<T>({
  query,
  children,
  label,
}: {
  query: { data: T | undefined; isLoading: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown }
  children: (data: T) => ReactNode
  label: string
}) {
  const { setFilters, today, printOptions, definitions } = useReports()
  if (query.isLoading && !query.data) return <LoadingBlock label={`Loading ${label}`} />
  if (query.isError && !query.data) return <ErrorBlock message={`The ${label} report could not be loaded.`} onRetry={() => query.refetch()} />
  if (!query.data) return null
  return (
    <div aria-busy={query.isFetching} className={cn('space-y-5 transition-opacity', query.isFetching && 'opacity-70')}>
      {query.isError && <ErrorBlock message="Showing the last loaded data; the latest refresh failed." onRetry={() => query.refetch()} />}
      {(query.data as { truncated?: boolean } | undefined)?.truncated ? (
        <TruncationNotice
          notice={(query.data as { truncation_notice?: string | null }).truncation_notice}
          onNarrow={() => setFilters({ preset: 'last_7_days', ...resolvePreset('last_7_days', today) })}
        />
      ) : (
        <>
          {children(query.data)}
          {printOptions?.definitions && <PrintDefinitions items={definitionsForPrint(query.data, definitions)} />}
        </>
      )}
    </div>
  )
}
