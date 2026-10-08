'use client'

import Link from 'next/link'
import { formatShortDate, formatValue, titleCase } from '@/lib/reports/format'
import type { HousekeepingData, StaffingOutlook } from '@/lib/reports/types'
import { ReportDataTable } from './ReportDataTable'
import { AvailabilityNotice, EmptyBlock, ErrorBlock, LowSampleBadge, ReportSection, SectionSkeleton } from './ReportPrimitives'
import { useReports } from './ReportsContext'
import { KpiGrid, QueryBoundary, ViewHeader } from './ReportViewParts'
import { TrendCard } from './TrendCard'
import { useTrend, useViewData } from './useReportData'

/** Forward-looking: explicitly NOT tied to the selected historical dates. */
export function StaffingOutlookSection({ outlook, title = 'Staffing outlook' }: { outlook: StaffingOutlook; title?: string }) {
  const { role } = useReports()
  const canSchedule = role === 'gm' || role === 'housekeeping_supervisor'
  return (
    <ReportSection
      title={title}
      description={outlook.horizon ? `Forecast horizon: ${outlook.horizon}.` : 'Forward-looking forecast.'}
      actions={canSchedule ? <Link href="/scheduling" className="text-[12.5px] font-medium text-[var(--accent)] underline-offset-2 hover:underline">Open scheduling</Link> : undefined}
    >
      {outlook.availability !== 'available' || !outlook.days?.length ? (
        <AvailabilityNotice availability={outlook.availability === 'not_enough_data' ? 'not_enough_data' : 'unavailable'} reason={outlook.reason ?? 'There is not enough completed-clean history to forecast.'} />
      ) : (
        <>
          <ReportDataTable
            caption="Seven day housekeeping staffing outlook"
            rows={outlook.days}
            rowKey={(d) => d.date}
            columns={[
              { key: 'date', label: 'Date', render: (d) => formatShortDate(d.date) },
              { key: 'projected_labor_hours', label: 'Projected workload', align: 'right', render: (d) => formatValue(d.projected_labor_hours, 'hours') },
              { key: 'required_housekeepers', label: 'Required', align: 'right' },
              { key: 'scheduled_housekeepers', label: 'Scheduled', align: 'right' },
              {
                key: 'staffing_gap',
                label: 'Gap',
                align: 'right',
                render: (d) =>
                  d.staffing_gap === null ? '—' : d.staffing_gap > 0 ? <span className="font-medium text-[var(--alert)]">Short by {d.staffing_gap}</span> : <span className="text-[var(--ready)]">Covered</span>,
              },
            ]}
          />
          {outlook.basis && <p className="mt-2 text-[12px] text-ink3">{outlook.basis}</p>}
        </>
      )}
    </ReportSection>
  )
}

function CleaningTrend() {
  const trend = useTrend('cleaning_minutes')
  if (trend.isLoading && !trend.data) return <SectionSkeleton height="h-72" />
  if (trend.isError && !trend.data) return <ErrorBlock message="The cleaning trend could not be loaded." onRetry={() => trend.refetch()} />
  return trend.data ? <TrendCard series={trend.data} title="Cleaning efficiency" description="Average minutes per completed clean, by day. No benchmark line is drawn unless a baseline is configured for a room type." /> : null
}

function InspectionTrend() {
  const trend = useTrend('inspection_pass')
  if (!trend.data) return null
  return <TrendCard series={trend.data} title="Inspection quality trend" />
}

export function HousekeepingView() {
  const query = useViewData<HousekeepingData>('housekeeping')
  const { openDrawer } = useReports()

  return (
    <QueryBoundary query={query} label="housekeeping">
      {(data) => {
        const q = data.inspection_quality
        return (
          <>
            <ViewHeader title="Housekeeping Performance" subtitle="Room readiness, cleaning efficiency and inspection quality." />
            <KpiGrid kpis={data.kpis} />
            <CleaningTrend />

            <ReportSection title="Room type breakdown" description="Baselines come from each room type's configured clean time. A dash means no baseline is configured.">
              {data.room_types.length ? (
                <ReportDataTable
                  caption="Cleaning time by room type"
                  rows={data.room_types}
                  rowKey={(r) => r.room_type_id}
                  initialSort={{ key: 'code' }}
                  columns={[
                    { key: 'code', label: 'Room type', sortable: true, sortValue: (r) => r.code, render: (r) => r.code ?? r.name ?? '—' },
                    { key: 'sessions', label: 'Sessions', align: 'right', sortable: true, sortValue: (r) => r.sessions, render: (r) => <>{r.sessions} {r.low_sample && <LowSampleBadge />}</> },
                    { key: 'avg_minutes', label: 'Avg cleaning', align: 'right', sortable: true, sortValue: (r) => r.avg_minutes, render: (r) => formatValue(r.avg_minutes, 'minutes') },
                    { key: 'baseline_minutes', label: 'Configured baseline', align: 'right', render: (r) => (r.baseline_minutes === null ? 'Not configured' : formatValue(r.baseline_minutes, 'minutes')) },
                    {
                      key: 'variance_minutes',
                      label: 'Variance',
                      align: 'right',
                      sortable: true,
                      sortValue: (r) => r.variance_minutes,
                      render: (r) => (r.variance_minutes === null ? '—' : `${r.variance_minutes > 0 ? '+' : r.variance_minutes < 0 ? '−' : ''}${Math.abs(r.variance_minutes)} min${r.variance_pct !== null ? ` (${r.variance_pct > 0 ? '+' : ''}${r.variance_pct}%)` : ''}`),
                    },
                  ]}
                />
              ) : (
                <EmptyBlock title="No completed cleans in this period" body="Room type timings appear once rooms move from In Progress to Clean or Inspected." />
              )}
            </ReportSection>

            <div className="grid gap-4 xl:grid-cols-2">
              <ReportSection title="Inspection quality" description="Pass, fail and conditional results. Conditional is not counted as a pass.">
                {q.total ? (
                  <>
                    <dl className="grid grid-cols-3 gap-2 text-center">
                      {([['passed', 'Passed'], ['failed', 'Failed'], ['conditional', 'Conditional']] as const).map(([key, label]) => (
                        <div key={key} className="rounded-[var(--r-md)] bg-surface-2 p-3">
                          <dt className="text-[12px] text-ink3">{label}</dt>
                          <dd className="font-display text-[22px] text-ink">{q[key]}</dd>
                          <dd className="text-[11.5px] text-ink3">{q.shares[key] !== null ? `${q.shares[key]}%` : ''}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2 print:hidden">
                      <button type="button" className="rounded-full border border-line px-3 py-1 text-[12px] text-ink2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40" onClick={() => openDrawer({ kind: 'filtered-records', recordKind: 'inspections', filter: 'failed', extra: {}, title: 'Failed inspections' })}>
                        View failed inspections
                      </button>
                    </div>
                  </>
                ) : (
                  <EmptyBlock title="No inspections in this period" />
                )}
              </ReportSection>

              <ReportSection title="Most common failed checklist items" description="Repeat defects are items that failed in 2+ inspections. Re-cleans are not recorded separately.">
                {q.top_failed_items.length ? (
                  <ReportDataTable
                    caption="Failed checklist items"
                    rows={q.top_failed_items}
                    rowKey={(r) => r.template_item_id}
                    columns={[
                      { key: 'section', label: 'Section', render: (r) => r.section ?? 'Uncategorised' },
                      { key: 'description', label: 'Checklist item', render: (r) => r.description ?? '—' },
                      { key: 'fail_count', label: 'Failures', align: 'right', sortable: true, sortValue: (r) => r.fail_count, render: (r) => <>{r.fail_count}{q.repeat_defects.some((d) => d.template_item_id === r.template_item_id) ? <span className="ml-1 text-[11px] text-[var(--caution)]">repeat</span> : null}</> },
                    ]}
                  />
                ) : (
                  <EmptyBlock positive title="No failed checklist items" />
                )}
              </ReportSection>
            </div>

            <InspectionTrend />
            <StaffingOutlookSection outlook={data.staffing_outlook} />
            {data.truncated && <AvailabilityNotice availability="unavailable" reason="Some source data exceeded the reporting row limit; figures may be understated." />}
            
          </>
        )
      }}
    </QueryBoundary>
  )
}
