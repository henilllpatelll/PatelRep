'use client'

import { formatChange, formatValue, directionText, AVAILABILITY_TEXT } from '@/lib/reports/format'
import { VIEW_LABELS, COMPARISON_LABELS, describeRange } from '@/lib/reports/filters'
import { metaFor, recordsForTrend } from '@/lib/reports/metricMeta'
import type { Kpi } from '@/lib/reports/types'
import { ReportTrendChart } from './ReportCharts'
import { drawerPrimaryButton, drawerButton, ReportDrawer } from './ReportDrawer'
import { AvailabilityNotice, ErrorBlock, LiveBadge, LowSampleBadge, SectionSkeleton } from './ReportPrimitives'
import { useReports } from './ReportsContext'
import { useTrend, useViewData } from './useReportData'
import type { AnyViewData } from '@/lib/reports/types'

function findKpi(data: AnyViewData | undefined, key: string): Kpi | null {
  if (!data) return null
  const pool: Array<Kpi | null | undefined> = []
  const anyData = data as any
  if (Array.isArray(anyData.kpis)) pool.push(...anyData.kpis)
  for (const section of ['time_labor', 'quality_risk', 'guest_response']) if (anyData[section]?.kpis) pool.push(...anyData[section].kpis)
  for (const dept of anyData.departments ?? []) if (dept?.measures) pool.push(...dept.measures)
  return pool.find((k): k is Kpi => !!k && k.key === key) ?? null
}

export function KpiDetailDrawer({ metric }: { metric: string }) {
  const { filters, definitions, openDrawer } = useReports()
  const meta = metaFor(metric)
  const definition = definitions?.[metric]
  const view = useViewData(meta?.view ?? 'overview')
  const trend = useTrend(meta?.trend ?? '', undefined, !!meta?.trend)
  const kpi = findKpi(view.data, metric)
  const bucketRecords = meta?.trend ? recordsForTrend(meta.trend) : null

  return (
    <ReportDrawer
      title={definition?.label ?? kpi?.label ?? 'Metric detail'}
      subtitle={
        <>
          {meta ? VIEW_LABELS[meta.view] : 'Report'} · {describeRange(filters)} · {COMPARISON_LABELS[filters.compare]}
        </>
      }
      footer={
        meta?.records?.[0] ? (
          <button
            type="button"
            className={drawerPrimaryButton}
            onClick={() => openDrawer({ kind: 'filtered-records', recordKind: meta.records![0].kind, filter: meta.records![0].filter, extra: {}, title: meta.records![0].label })}
          >
            View related records
          </button>
        ) : (
          <p className="text-[12.5px] text-ink3">{meta?.recordsLimitation ?? 'No underlying record list is available for this metric.'}</p>
        )
      }
    >
      <section aria-label="Summary" className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        {view.isLoading && !view.data ? (
          <SectionSkeleton height="h-24" />
        ) : view.isError && !view.data ? (
          <ErrorBlock message="The metric could not be loaded." onRetry={() => view.refetch()} />
        ) : kpi ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-[34px] leading-none text-ink">
                {kpi.value === null ? AVAILABILITY_TEXT[kpi.availability === 'available' ? 'unavailable' : kpi.availability] : formatValue(kpi.value, kpi.unit)}
              </span>
              {kpi.scope === 'live' && <LiveBadge />}
              {kpi.low_sample && <LowSampleBadge n={kpi.sample_size} />}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <div>
                <dt className="text-ink3">Previous period</dt>
                <dd className="text-ink">{kpi.comparison ? formatValue(kpi.comparison.previous, kpi.unit) : filters.compare === 'none' ? 'Comparison off' : 'Not available'}</dd>
              </div>
              <div>
                <dt className="text-ink3">Change</dt>
                <dd className="text-ink">
                  {kpi.comparison ? (
                    <>
                      {formatChange(kpi.comparison)} <span className="text-ink3">· {directionText(kpi.comparison)}</span>
                    </>
                  ) : kpi.scope === 'live' ? (
                    'No historical comparison for a live count'
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-ink3">Eligible records</dt>
                <dd className="text-ink">
                  {kpi.eligible === null ? '—' : kpi.numerator !== null ? `${kpi.numerator} of ${kpi.eligible}` : kpi.eligible}
                </dd>
              </div>
              <div>
                <dt className="text-ink3">Unit</dt>
                <dd className="text-ink">{kpi.unit ?? 'count'}</dd>
              </div>
            </dl>
            {kpi.note && <p className="mt-2 text-[12.5px] text-ink3">{kpi.note}</p>}
          </>
        ) : (
          <AvailabilityNotice availability="unavailable" reason="This figure is explained below but is not part of the currently loaded report." />
        )}
      </section>

      {meta?.trend && (
        <section aria-label="Trend">
          <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Trend across the selected period</h3>
          {trend.isLoading && !trend.data ? (
            <SectionSkeleton height="h-56" />
          ) : trend.isError && !trend.data ? (
            <ErrorBlock message="The trend could not be loaded." onRetry={() => trend.refetch()} />
          ) : trend.data ? (
            <ReportTrendChart
              series={trend.data}
              height={220}
              onPointClick={
                bucketRecords
                  ? (point) => openDrawer({ kind: 'filtered-records', recordKind: bucketRecords.kind, filter: bucketRecords.filter, extra: { bucket_start: point.start, bucket_end: point.end }, title: `${trend.data!.label} · ${point.start}` })
                  : undefined
              }
            />
          ) : null}
          {meta.trend && (
            <button type="button" className={`${drawerButton} mt-2`} onClick={() => openDrawer({ kind: 'trend-comparison', metric: meta.trend! })}>
              Compare with another period
            </button>
          )}
        </section>
      )}

      <section aria-label="Definition" className="rounded-[var(--r-lg)] border border-line bg-surface p-4 text-[13px]">
        <h3 className="mb-2 text-[13px] font-semibold text-ink">How this is calculated</h3>
        {definition ? (
          <dl className="space-y-2">
            <div><dt className="text-ink3">What it measures</dt><dd className="text-ink">{definition.definition}</dd></div>
            <div><dt className="text-ink3">Numerator</dt><dd className="text-ink">{definition.numerator}</dd></div>
            <div><dt className="text-ink3">Denominator</dt><dd className="text-ink">{definition.denominator}</dd></div>
            <div><dt className="text-ink3">Reporting cohort</dt><dd className="text-ink">{definition.cohort}</dd></div>
            <div><dt className="text-ink3">Exclusions</dt><dd className="text-ink">{definition.exclusions}</dd></div>
            <div><dt className="text-ink3">Data source</dt><dd className="text-ink">{definition.source}</dd></div>
            <div><dt className="text-ink3">Freshness</dt><dd className="text-ink">{definition.scope === 'live' ? 'Live at the moment of loading.' : 'Calculated when this report loaded, from hotel-local calendar days.'}{view.dataUpdatedAt ? ` Loaded ${new Date(view.dataUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` : ''}</dd></div>
          </dl>
        ) : (
          <p className="text-ink3">The definition could not be loaded.</p>
        )}
      </section>

      {meta?.records && meta.records.length > 0 && (
        <section aria-label="Related records">
          <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Related records</h3>
          <ul className="space-y-1.5">
            {meta.records.map((group) => (
              <li key={`${group.kind}:${group.filter}`}>
                <button type="button" className={`${drawerButton} w-full justify-start`} onClick={() => openDrawer({ kind: 'filtered-records', recordKind: group.kind, filter: group.filter, extra: {}, title: group.label })}>
                  {group.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ReportDrawer>
  )
}
