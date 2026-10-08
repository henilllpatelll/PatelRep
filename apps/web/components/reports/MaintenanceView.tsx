'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDateTime, formatValue, titleCase } from '@/lib/reports/format'
import type { MaintenanceData, PmSection } from '@/lib/reports/types'
import { ReportBreakdownBars } from './ReportCharts'
import { ReportDataTable } from './ReportDataTable'
import { AvailabilityNotice, EmptyBlock, ErrorBlock, LiveBadge, ReportSection, SectionSkeleton } from './ReportPrimitives'
import { useReports } from './ReportsContext'
import { KpiGrid, QueryBoundary, ViewHeader } from './ReportViewParts'
import { TrendCard } from './TrendCard'
import { useTrend, useViewData } from './useReportData'

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--r-md)] bg-surface-2 p-3">
      <dt className="text-[12px] text-ink3">{label}</dt>
      <dd className="mt-0.5 font-display text-[22px] text-ink">{value}</dd>
      {hint && <dd className="text-[11.5px] text-ink3">{hint}</dd>}
    </div>
  )
}

const TREND_OPTIONS = [
  ['maintenance_sla', 'SLA compliance', 'line'],
  ['wo_created', 'Created', 'bar'],
  ['wo_completed', 'Completed', 'bar'],
  ['maintenance_response', 'Response time', 'line'],
  ['maintenance_repair', 'Repair time', 'line'],
] as const

function MaintenanceTrends() {
  const [metric, setMetric] = useState<(typeof TREND_OPTIONS)[number][0]>('maintenance_sla')
  const trend = useTrend(metric)
  const kind = TREND_OPTIONS.find((o) => o[0] === metric)?.[2] ?? 'line'
  return (
    <>
      <div role="radiogroup" aria-label="Maintenance trend" className="flex flex-wrap gap-1 print:hidden">
        {TREND_OPTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={metric === id}
            onClick={() => setMetric(id)}
            className={`rounded-full border px-3 py-1 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${metric === id ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-ink' : 'border-line text-ink2 hover:bg-surface-2'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {trend.isLoading && !trend.data ? <SectionSkeleton height="h-72" /> : trend.isError && !trend.data ? <ErrorBlock message="The trend could not be loaded." onRetry={() => trend.refetch()} /> : trend.data ? <TrendCard series={trend.data} kind={kind} /> : null}
    </>
  )
}

export function PreventiveMaintenanceSection({ pm }: { pm: PmSection }) {
  const { openDrawer } = useReports()
  return (
    <ReportSection title="Preventive maintenance" description="Compliance counts schedules completed in the period against all active schedules.">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="PM compliance rate" value={pm.compliance_pct === null ? 'Not applicable' : formatValue(pm.compliance_pct, 'percent')} hint={pm.active_schedules ? `${pm.completed_schedules} of ${pm.active_schedules} schedules` : 'No active schedules'} />
        <Stat label="Active schedules" value={pm.active_schedules} />
        <Stat label="Deferred schedules" value={pm.deferred_schedules} />
        <Stat label="Repeated deferrals" value={pm.repeated_deferral_count} hint="Deferred 2+ times" />
      </dl>
      <h3 className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink3">Highest-priority deferrals</h3>
      {pm.top_deferrals.length ? (
        <ReportDataTable
          caption="Most deferred preventive maintenance schedules"
          rows={pm.top_deferrals}
          rowKey={(r) => r.pm_schedule_id}
          columns={[
            { key: 'name', label: 'Schedule', render: (r) => <Link href="/engineering?tab=pm-schedules" className="text-ink underline-offset-2 hover:underline">{r.name}</Link> },
            { key: 'deferral_count', label: 'Deferrals', align: 'right', sortable: true, sortValue: (r) => r.deferral_count },
            { key: 'deferred_until', label: 'Deferred until', render: (r) => formatDateTime(r.deferred_until) },
            { key: 'reason', label: 'Latest reason', render: (r) => r.reason ?? '—' },
          ]}
        />
      ) : (
        <EmptyBlock positive title="No deferrals in this period" />
      )}
      {pm.deferred_schedules > 0 && (
        <button type="button" className="mt-2 text-[12.5px] font-medium text-[var(--accent)] underline-offset-2 hover:underline print:hidden" onClick={() => openDrawer({ kind: 'filtered-records', recordKind: 'pm_deferrals', filter: 'all', extra: {}, title: 'PM deferrals' })}>
          View all deferral records
        </button>
      )}
    </ReportSection>
  )
}

export function MaintenanceView() {
  const query = useViewData<MaintenanceData>('maintenance')
  const { openDrawer } = useReports()

  return (
    <QueryBoundary query={query} label="maintenance">
      {(data) => {
        const breach = data.active_breaches
        const dt = data.downtime
        return (
          <>
            <ViewHeader title="Maintenance Performance" subtitle="Work-order execution, recurring failures, preventive maintenance and room downtime." />
            <KpiGrid kpis={data.kpis} />
            <p className="-mt-2 text-[12.5px] text-ink3">
              {data.totals.total_work_orders} work orders created · {data.totals.completed} completed in this period
              {data.totals.labor_hours !== null ? ` · ${data.totals.labor_hours} labor hours recorded` : ' · no labor hours recorded'}
            </p>

            <ReportSection
              title="Active SLA breaches"
              description="Live inventory of every open work order past its due time. Not limited to work orders created in the selected period."
              actions={<LiveBadge />}
            >
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Overdue open work orders" value={breach.overdue_count ?? '—'} />
                <Stat label="Urgent overdue" value={breach.urgent_overdue_count ?? '—'} />
                <Stat label="Open work orders" value={breach.open_work_orders ?? '—'} />
                <Stat
                  label="Oldest overdue"
                  value={breach.oldest ? <span className="text-[15px]">{breach.oldest.title ?? 'Work order'}</span> : '—'}
                  hint={breach.oldest ? `${breach.oldest.room ? `Room ${breach.oldest.room} · ` : ''}due ${formatDateTime(breach.oldest.due_at)}` : 'Nothing overdue'}
                />
              </dl>
              {(breach.overdue_count ?? 0) > 0 && (
                <button type="button" className="mt-3 text-[12.5px] font-medium text-[var(--accent)] underline-offset-2 hover:underline print:hidden" onClick={() => openDrawer({ kind: 'filtered-records', recordKind: 'work_orders', filter: 'overdue_live', extra: {}, title: 'Overdue work orders' })}>
                  View overdue work orders
                </button>
              )}
            </ReportSection>

            <MaintenanceTrends />

            <div className="grid gap-4 xl:grid-cols-2">
              <ReportSection printPart="charts" title="Work orders by category" description="Select a category to see its work orders.">
                <ReportBreakdownBars rows={data.by_category} onSelect={(category) => openDrawer({ kind: 'filtered-records', recordKind: 'work_orders', filter: 'all', extra: { category }, title: `${titleCase(category)} work orders` })} />
              </ReportSection>
              <ReportSection printPart="charts" title="Work orders by priority">
                <ReportBreakdownBars rows={data.by_priority} onSelect={(priority) => openDrawer({ kind: 'filtered-records', recordKind: 'work_orders', filter: 'all', extra: { priority }, title: `${titleCase(priority)} priority work orders` })} />
              </ReportSection>
            </div>

            <ReportSection title="Repeat failures" description="Rooms or assets with 2+ work orders in this period. Similar categories do not prove a shared root cause.">
              {data.repeat_failures.length ? (
                <ReportDataTable
                  caption="Repeat failures"
                  rows={data.repeat_failures}
                  rowKey={(r) => `${r.kind}:${r.id}`}
                  onRowClick={(r) => openDrawer({ kind: 'room-asset-performance', entity: r.kind, id: r.id })}
                  rowLabel={(r) => `${r.label}: open history`}
                  columns={[
                    { key: 'label', label: 'Room / asset', sortable: true, sortValue: (r) => r.label },
                    { key: 'categories', label: 'Categories', render: (r) => r.categories.map((c) => `${titleCase(c.key)} (${c.count})`).join(', ') },
                    { key: 'failure_count', label: 'Events', align: 'right', sortable: true, sortValue: (r) => r.failure_count },
                    { key: 'most_recent_at', label: 'Most recent', render: (r) => formatDateTime(r.most_recent_at) },
                  ]}
                />
              ) : (
                <EmptyBlock positive title="No repeat failures in this period" />
              )}
            </ReportSection>

            <PreventiveMaintenanceSection pm={data.preventive_maintenance} />

            <ReportSection title="Room downtime" description="Recorded out-of-order time inside the period. The current out-of-order inventory is not counted as historical downtime.">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Total out-of-order downtime" value={dt.total_hours === null ? 'None recorded' : formatValue(dt.total_hours, 'hours')} />
                <Stat label="Rooms affected" value={dt.rooms_affected} />
                {dt.revenue_exposure && (
                  <Stat
                    label="Estimated revenue exposure"
                    value={dt.revenue_exposure.configured && dt.revenue_exposure.estimate_cents !== null ? formatValue(dt.revenue_exposure.estimate_cents, 'currency') : 'Not configured'}
                    hint={dt.revenue_exposure.configured ? 'Estimate from hours × configured ADR; not actual lost revenue' : 'Set the average daily rate in Settings to enable this estimate'}
                  />
                )}
              </dl>
              {dt.rooms.length > 0 && (
                <div className="mt-3">
                  <ReportDataTable
                    caption="Rooms with recorded downtime"
                    rows={dt.rooms}
                    rowKey={(r) => r.room_id}
                    onRowClick={(r) => openDrawer({ kind: 'room-asset-performance', entity: 'room', id: r.room_id })}
                    rowLabel={(r) => `Room ${r.room ?? ''}: open history`}
                    columns={[
                      { key: 'room', label: 'Room', render: (r) => `Room ${r.room ?? '—'}` },
                      { key: 'downtime_hours', label: 'Downtime', align: 'right', sortable: true, sortValue: (r) => r.downtime_hours, render: (r) => formatValue(r.downtime_hours, 'hours') },
                    ]}
                  />
                </div>
              )}
              <AvailabilityNotice className="mt-3" availability="unavailable" reason={`Return-to-service performance: ${dt.return_to_service.reason}`} />
            </ReportSection>
          </>
        )
      }}
    </QueryBoundary>
  )
}
