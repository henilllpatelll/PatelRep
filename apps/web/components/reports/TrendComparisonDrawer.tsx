'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsV2Api } from '@/lib/reports/api'
import { COMPARISON_LABELS, describeRange } from '@/lib/reports/filters'
import { compareTotals, formatChange, formatValue, titleCase } from '@/lib/reports/format'
import { TREND_LABELS, TREND_POLARITY, TREND_SEGMENTS, recordsForTrend } from '@/lib/reports/metricMeta'
import { ReportTrendChart } from './ReportCharts'
import { ReportDataTable } from './ReportDataTable'
import { ReportDrawer, drawerPrimaryButton } from './ReportDrawer'
import { AvailabilityNotice, EmptyBlock, ErrorBlock, LowSampleBadge, SectionSkeleton } from './ReportPrimitives'
import { useReports } from './ReportsContext'
import { useTrend } from './useReportData'

const DEPARTMENT_CATEGORY: Record<string, string> = { housekeeping: 'housekeeping', engineering: 'maintenance' }

export function TrendComparisonDrawer({ metric, segment }: { metric: string; segment?: string }) {
  const { filters, queryScope, ready, openDrawer, setFilters } = useReports()
  const trend = useTrend(metric)
  const dimensions = TREND_SEGMENTS[metric] ?? []
  const [dimension, setDimension] = useState(segment && dimensions.includes(segment) ? segment : dimensions[0] ?? '')
  const segments = useQuery({
    queryKey: [...queryScope, 'segments', metric, dimension, filters],
    queryFn: () => reportsV2Api.segments(metric, dimension, filters),
    enabled: ready && !!dimension,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const series = trend.data
  const comparison = series?.comparison
  const unit = series?.unit ?? null
  const change = series && comparison ? compareTotals(series.total, comparison.total, unit) : null
  const polarity = TREND_POLARITY[metric]
  const direction = change ? (change.change === 0 || polarity === null || polarity === undefined ? 'neutral' : (change.change > 0) === polarity ? 'favorable' : 'unfavorable') : null
  const records = recordsForTrend(metric)
  const sampleOf = (points: Array<{ sample_size: number }>) => points.reduce((sum, p) => sum + p.sample_size, 0)

  return (
    <ReportDrawer
      title={TREND_LABELS[metric] ?? series?.label ?? 'Trend comparison'}
      subtitle={`${describeRange(filters)} · ${COMPARISON_LABELS[filters.compare]}`}
      footer={records ? (
        <button type="button" className={drawerPrimaryButton} onClick={() => openDrawer({ kind: 'filtered-records', recordKind: records.kind, filter: records.filter, extra: {}, title: `${TREND_LABELS[metric] ?? 'Records'} · ${describeRange(filters)}` })}>
          View records for this period
        </button>
      ) : undefined}
    >
      {trend.isLoading && !series ? (
        <SectionSkeleton height="h-80" />
      ) : trend.isError && !series ? (
        <ErrorBlock message="The trend could not be loaded." onRetry={() => trend.refetch()} />
      ) : series ? (
        <>
          <section aria-label="Comparison summary" className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <div>
                <dt className="text-ink3">Current period</dt>
                <dd className="font-display text-[26px] leading-none text-ink">{formatValue(series.total, unit)}</dd>
                <dd className="text-[12px] text-ink3">{series.period.start} to {series.period.end} · n={sampleOf(series.points)}</dd>
              </div>
              <div>
                <dt className="text-ink3">Comparison period</dt>
                {comparison ? (
                  <>
                    <dd className="font-display text-[26px] leading-none text-ink">{formatValue(comparison.total, unit)}</dd>
                    <dd className="text-[12px] text-ink3">{comparison.period.start} to {comparison.period.end} · n={sampleOf(comparison.points)}</dd>
                  </>
                ) : (
                  <dd className="text-ink2">Not selected</dd>
                )}
              </div>
              <div className="col-span-2">
                <dt className="text-ink3">Difference</dt>
                <dd className="text-ink">
                  {change ? (
                    <>
                      {formatChange(change)} <span className="text-ink3">· {direction === 'favorable' ? 'Favorable' : direction === 'unfavorable' ? 'Unfavorable' : 'No meaningful change'}</span>
                    </>
                  ) : comparison ? (
                    'Not available: one of the periods has no data.'
                  ) : (
                    'Choose a comparison period to see the difference.'
                  )}
                </dd>
              </div>
            </dl>
            {!comparison && (
              <button type="button" className="mt-2 text-[12.5px] font-medium text-[var(--accent)] underline-offset-2 hover:underline" onClick={() => setFilters({ compare: 'previous' })}>
                Compare with the previous equivalent period
              </button>
            )}
          </section>

          <ReportTrendChart
            series={series}
            height={240}
            onPointClick={records ? (point) => openDrawer({ kind: 'filtered-records', recordKind: records.kind, filter: records.filter, extra: { bucket_start: point.start, bucket_end: point.end }, title: `${series.label} · ${point.start}` }) : undefined}
          />
          <p className="text-[12px] text-ink3">Periods have equal length and are aligned bucket by bucket. Empty buckets are gaps, not zeros.</p>

          {dimensions.length > 0 && (
            <section aria-label="Breakdown">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-ink">Breakdown</h3>
                <div role="radiogroup" aria-label="Breakdown dimension" className="inline-flex rounded-[var(--r-md)] border border-line bg-surface-2 p-0.5">
                  {dimensions.map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={dimension === d} onClick={() => setDimension(d)} className={`rounded-[calc(var(--r-md)-2px)] px-2.5 py-1 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${dimension === d ? 'bg-surface text-ink shadow-sm' : 'text-ink3 hover:text-ink'}`}>
                      {titleCase(d)}
                    </button>
                  ))}
                </div>
              </div>
              {segments.isLoading ? (
                <SectionSkeleton height="h-32" />
              ) : segments.isError ? (
                <ErrorBlock message="The breakdown could not be loaded." onRetry={() => segments.refetch()} />
              ) : segments.data && segments.data.segments.length ? (
                <ReportDataTable
                  caption={`${series.label} by ${dimension}`}
                  rows={segments.data.segments}
                  rowKey={(r) => r.segment}
                  onRowClick={records && (dimension === 'category' || dimension === 'priority' || dimension === 'department') ? (row) => {
                    const extra = dimension === 'department' ? (DEPARTMENT_CATEGORY[row.segment] ? { category: DEPARTMENT_CATEGORY[row.segment] } : null) : { [dimension]: row.segment }
                    if (extra) openDrawer({ kind: 'filtered-records', recordKind: records.kind, filter: 'all', extra, title: `${titleCase(row.segment)} · ${TREND_LABELS[metric] ?? ''}` })
                  } : undefined}
                  rowLabel={(r) => `${titleCase(r.segment)}: open records`}
                  columns={[
                    { key: 'segment', label: titleCase(dimension), render: (r) => titleCase(r.segment) },
                    { key: 'value', label: 'Current', align: 'right', render: (r) => (r.value === null ? 'Not applicable' : formatValue(r.value, unit)) },
                    { key: 'previous', label: 'Comparison', align: 'right', render: (r) => (r.previous === null ? '—' : formatValue(r.previous, unit)) },
                    { key: 'sample_size', label: 'Sample', align: 'right', render: (r) => <>{r.sample_size} {r.low_sample && <LowSampleBadge />}</> },
                  ]}
                />
              ) : (
                <EmptyBlock title="No segments in this period" />
              )}
              <AvailabilityNotice className="mt-2" availability="not_applicable" label={null} reason="Small segments are flagged as low sample instead of being judged as poor performance." />
            </section>
          )}
        </>
      ) : null}
    </ReportDrawer>
  )
}
