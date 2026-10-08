'use client'

import { GitCompare } from 'lucide-react'
import { formatShortDate } from '@/lib/reports/format'
import { recordsForTrend } from '@/lib/reports/metricMeta'
import { printHides } from '@/lib/reports/printOptions'
import type { TrendSeries } from '@/lib/reports/types'
import { ReportTrendChart } from './ReportCharts'
import { EmptyBlock, ReportSection } from './ReportPrimitives'
import { useReports } from './ReportsContext'

/** A trend with its real data, click-through to the records behind a point, and the comparison drawer. */
export function TrendCard({
  series,
  title,
  description,
  kind = 'line',
  actions,
}: {
  series: TrendSeries
  title?: string
  description?: string
  kind?: 'line' | 'bar' | 'area'
  actions?: React.ReactNode
}) {
  const { openDrawer, printOptions } = useReports()
  const records = recordsForTrend(series.metric)
  const hasData = series.points.some((p) => p.value !== null)

  return (
    <ReportSection
      printPart="charts"
      title={title ?? series.label}
      description={description ?? `${series.granularity === 'day' ? 'Daily' : series.granularity === 'week' ? 'Weekly' : 'Monthly'} · hotel-local dates${records ? ' · select a point to see its records' : ''}`}
      actions={
        <>
          {actions}
          {hasData && (
            <button
              type="button"
              onClick={() => openDrawer({ kind: 'trend-comparison', metric: series.metric })}
              className="inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
            >
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" /> Compare periods
            </button>
          )}
        </>
      }
    >
      {hasData ? (
        <ReportTrendChart
          series={printHides(printOptions, 'comparison') ? { ...series, comparison: null } : series}
          kind={kind}
          onPointClick={
            records
              ? (point) =>
                  openDrawer({
                    kind: 'filtered-records',
                    recordKind: records.kind,
                    filter: records.filter,
                    extra: { bucket_start: point.start, bucket_end: point.end },
                    title: `${series.label} · ${formatShortDate(point.start)}${point.end !== point.start ? ` – ${formatShortDate(point.end)}` : ''}`,
                  })
              : undefined
          }
        />
      ) : (
        <EmptyBlock title="No data points in this period" body="Trend lines appear once there are eligible records. Empty periods are not drawn as zero." />
      )}
    </ReportSection>
  )
}
