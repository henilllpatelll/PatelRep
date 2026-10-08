'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Pill } from '@/components/ui/primitives'
import { formatDateTime, formatValue, titleCase } from '@/lib/reports/format'
import { recordHref } from '@/lib/reports/links'
import type { GuestData } from '@/lib/reports/types'
import { ReportBreakdownBars } from './ReportCharts'
import { ReportDataTable, type Column } from './ReportDataTable'
import { EmptyBlock, LowSampleBadge, ReportSection, SectionSkeleton, ErrorBlock } from './ReportPrimitives'
import { useReports } from './ReportsContext'
import { KpiGrid, QueryBoundary, ViewHeader } from './ReportViewParts'
import { TrendCard } from './TrendCard'
import { useTrend, useViewData } from './useReportData'

const REVIEW_TONE = { breached: 'alert', near_deadline: 'caution', unverified_resolution: 'info' } as const
const REVIEW_TEXT = { breached: 'SLA breached', near_deadline: 'Near deadline', unverified_resolution: 'Unverified resolution' } as const
const DEPARTMENT_CATEGORY: Record<string, string> = { housekeeping: 'housekeeping', engineering: 'maintenance' }

type ReviewRow = GuestData['needs_review']['rows'][number]

function TrendSwitcher() {
  const [metric, setMetric] = useState<'guest_sla' | 'guest_ack_time'>('guest_sla')
  const trend = useTrend(metric)
  return (
    <>
      <div role="radiogroup" aria-label="Trend metric" className="inline-flex rounded-[var(--r-md)] border border-line bg-surface-2 p-0.5 print:hidden">
        {([['guest_sla', 'SLA compliance'], ['guest_ack_time', 'Acknowledgement time']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={metric === id}
            onClick={() => setMetric(id)}
            className={`rounded-[calc(var(--r-md)-2px)] px-3 py-1.5 text-[12.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${metric === id ? 'bg-surface text-ink shadow-sm' : 'text-ink3 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {trend.isLoading && !trend.data ? (
        <SectionSkeleton height="h-64" />
      ) : trend.isError && !trend.data ? (
        <ErrorBlock message="The trend could not be loaded." onRetry={() => trend.refetch()} />
      ) : trend.data ? (
        <TrendCard series={trend.data} />
      ) : null}
    </>
  )
}

export function GuestExperienceView() {
  const query = useViewData<GuestData>('guest-experience')
  const { openDrawer, role } = useReports()

  const reviewColumns: Column<ReviewRow>[] = [
    { key: 'request_number', label: '#', sortable: true, sortValue: (r) => r.request_number },
    { key: 'room', label: 'Room', sortable: true, sortValue: (r) => r.room },
    { key: 'category', label: 'Category', render: (r) => titleCase(r.category) },
    {
      key: 'summary',
      label: 'Issue',
      render: (r) => {
        const href = recordHref('guest_requests', r, role)
        return href ? (
          <Link href={href} className="text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
            {r.summary ?? 'Request'}
          </Link>
        ) : (
          <span>{r.summary ?? 'Request'}</span>
        )
      },
    },
    { key: 'created_at', label: 'Created', sortable: true, sortValue: (r) => r.created_at, render: (r) => formatDateTime(r.created_at) },
    { key: 'department', label: 'Department', render: (r) => (r.department ? titleCase(r.department) : 'Unattributed') },
    { key: 'sla_state', label: 'SLA state', render: (r) => <Pill tone={REVIEW_TONE[r.sla_state]} size="sm">{REVIEW_TEXT[r.sla_state]}</Pill> },
    { key: 'status', label: 'Status', render: (r) => titleCase(r.status) },
  ]

  return (
    <QueryBoundary query={query} label="guest experience">
      {(data) => (
        <>
          <ViewHeader title="Guest Experience" subtitle="How quickly and effectively the hotel responds to guest issues." />
          <KpiGrid kpis={data.kpis} columns={5} />
          <TrendSwitcher />

          <div className="grid gap-4 xl:grid-cols-2">
            <ReportSection title="Request categories" description="Share of guest requests by category. Select a category to see its requests.">
              <ReportBreakdownBars
                rows={data.categories}
                onSelect={(category) =>
                  openDrawer({ kind: 'filtered-records', recordKind: 'guest_requests', filter: 'all', extra: { category }, title: `${titleCase(category)} requests` })
                }
              />
            </ReportSection>

            <ReportSection title="Department comparison" description="Departments are only attributed where the request category records one. Low-volume rows are flagged, not judged.">
              {data.departments.length ? (
                <ReportDataTable
                  caption="Guest response by department"
                  rows={data.departments}
                  rowKey={(r) => r.department}
                  onRowClick={(r) => {
                    const category = DEPARTMENT_CATEGORY[r.department]
                    openDrawer(
                      category
                        ? { kind: 'filtered-records', recordKind: 'guest_requests', filter: 'all', extra: { category }, title: `${r.label} requests` }
                        : { kind: 'trend-comparison', metric: 'guest_sla' },
                    )
                  }}
                  rowLabel={(r) => `${r.label}: open requests`}
                  columns={[
                    { key: 'label', label: 'Department', render: (r) => titleCase(r.department === 'unattributed' ? 'Unattributed' : r.department) },
                    { key: 'total_requests', label: 'Requests', align: 'right' },
                    { key: 'sla', label: 'SLA met', align: 'right', render: (r) => (r.sla_compliance_pct === null ? 'Not applicable' : formatValue(r.sla_compliance_pct, 'percent')) },
                    { key: 'ack', label: 'Avg ack', align: 'right', render: (r) => formatValue(r.avg_acknowledgement_minutes, 'minutes') },
                    { key: 'low', label: '', render: (r) => (r.low_sample ? <LowSampleBadge n={r.total_requests} /> : null) },
                  ]}
                />
              ) : (
                <EmptyBlock title="No requests in this period" />
              )}
            </ReportSection>
          </div>

          <ReportSection
            title="Requests needing review"
            description={`${data.needs_review.total} request${data.needs_review.total === 1 ? '' : 's'} in this period need attention. Showing the most urgent.`}
            actions={
              <div className="flex flex-wrap gap-1.5">
                {(['breached', 'near_deadline', 'unverified_resolution'] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    disabled={!data.needs_review.counts[state]}
                    onClick={() => openDrawer({ kind: 'filtered-records', recordKind: 'guest_requests', filter: state, extra: {}, title: REVIEW_TEXT[state] })}
                    className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink2 hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                  >
                    {REVIEW_TEXT[state]}: {data.needs_review.counts[state]}
                  </button>
                ))}
              </div>
            }
          >
            {data.needs_review.rows.length ? (
              <ReportDataTable
                caption="Guest requests needing review"
                columns={reviewColumns}
                rows={data.needs_review.rows}
                rowKey={(r) => r.id}
                pageSize={10}
                searchText={(r) => `${r.summary ?? ''} ${r.room ?? ''} ${r.category}`}
                searchPlaceholder="Search requests"
              />
            ) : (
              <EmptyBlock positive title="No requests need review" body="Every request in this period is within SLA or already verified." />
            )}
          </ReportSection>
        </>
      )}
    </QueryBoundary>
  )
}
