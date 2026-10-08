'use client'

import type { ReactNode } from 'react'
import { metaFor } from '@/lib/reports/metricMeta'
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
  const { definitions, openDrawer } = useReports()
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4', 5: 'sm:grid-cols-2 xl:grid-cols-5' }[columns]
  return (
    <div className={cn('grid grid-cols-1 gap-3', cols, className)}>
      {kpis.filter((k): k is Kpi => !!k).map((kpi) => (
        <ReportMetricCard
          key={kpi.key}
          kpi={kpi}
          definition={definitions?.[kpi.key]}
          onOpen={metaFor(kpi.key) ? () => openDrawer({ kind: 'metric-detail', metric: kpi.key }) : undefined}
        />
      ))}
    </div>
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
  if (query.isLoading && !query.data) return <LoadingBlock label={`Loading ${label}`} />
  if (query.isError && !query.data) return <ErrorBlock message={`The ${label} report could not be loaded.`} onRetry={() => query.refetch()} />
  if (!query.data) return null
  return (
    <div aria-busy={query.isFetching} className={cn('space-y-5 transition-opacity', query.isFetching && 'opacity-70')}>
      {query.isError && <ErrorBlock message="Showing the last loaded data; the latest refresh failed." onRetry={() => query.refetch()} />}
      {children(query.data)}
    </div>
  )
}
