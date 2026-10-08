'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Avatar } from '@/components/ui/primitives'
import { reportsV2Api } from '@/lib/reports/api'
import { describeRange } from '@/lib/reports/filters'
import { formatDateTime, formatValue, titleCase } from '@/lib/reports/format'
import { assetHref, assignedWorkHref, recordHref, roomHref } from '@/lib/reports/links'
import type { TrendPoint, TrendSeries } from '@/lib/reports/types'
import { ReportBreakdownBars, ReportTrendChart } from './ReportCharts'
import { ReportDrawer, drawerButton, drawerPrimaryButton } from './ReportDrawer'
import { AvailabilityNotice, EmptyBlock, ErrorBlock, LowSampleBadge, ReportPill, SectionSkeleton } from './ReportPrimitives'
import { ReportMetricCard } from './ReportMetricCard'
import { useReports } from './ReportsContext'

function syntheticSeries(metric: string, label: string, unit: string, points: TrendPoint[], period: TrendSeries['period']): TrendSeries {
  return { metric, label, unit, definition_key: null, granularity: 'day', period, points, total: null, comparison: null }
}

export function EmployeeDrawer({ userId }: { userId: string }) {
  const { filters, queryScope, ready, openDrawer, definitions, role } = useReports()
  const query = useQuery({
    queryKey: [...queryScope, 'employee', userId, filters.start, filters.end],
    queryFn: () => reportsV2Api.employee(userId, filters),
    enabled: ready,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const data = query.data
  const workHref = data ? assignedWorkHref(userId, data.employee.role === 'housekeeper' || data.employee.role === 'housekeeping_supervisor' ? 'housekeeper' : role ?? undefined) : null

  return (
    <ReportDrawer
      title={data?.employee.name ?? 'Employee performance'}
      subtitle={data ? `${titleCase(data.employee.role)} · ${titleCase(data.employee.department ?? '')} · ${describeRange(filters)}` : describeRange(filters)}
      footer={workHref ? <Link href={workHref} className={drawerPrimaryButton}>View assigned work</Link> : undefined}
    >
      {query.isLoading ? (
        <SectionSkeleton height="h-72" />
      ) : query.isError || !data ? (
        <ErrorBlock message="This employee's performance is not available. They may be outside your department or no longer active." onRetry={() => query.refetch()} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={data.employee.name} size={40} />
            <div>
              <p className="text-[14px] font-medium text-ink">{data.employee.name}</p>
              <p className="text-[12.5px] text-ink3">{titleCase(data.employee.role)}</p>
            </div>
            {data.low_sample && <LowSampleBadge />}
          </div>
          {data.low_sample && <AvailabilityNotice availability="not_enough_data" reason="Few assignments were recorded in this period, so these figures are not a reliable measure of performance." />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.kpis.filter(Boolean).map((k) => (
              <ReportMetricCard key={k!.key} kpi={k!} definition={definitions?.[k!.key]} hideComparison />
            ))}
          </div>

          <section aria-label="Completed assignments">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Completed assignments</h3>
            <ReportTrendChart kind="bar" height={170} series={syntheticSeries('employee_completed', 'Completed assignments', 'count', data.trend.completed, data.period)} />
          </section>
          <section aria-label="Eligible SLA over time">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Eligible SLA compliance over time</h3>
            <ReportTrendChart height={170} series={syntheticSeries('employee_sla', 'Eligible SLA compliance', 'percent', data.trend.sla, data.period)} />
          </section>

          <section aria-label="Work breakdown">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">{data.work_breakdown.type === 'work_order_category' ? 'Work orders by category' : 'Assigned vs completed'}</h3>
            {data.work_breakdown.rows.length ? (
              <ReportBreakdownBars rows={data.work_breakdown.rows.map((r) => ({ key: r.key, count: r.count, share_pct: null }))} />
            ) : (
              <EmptyBlock title="No assignments in this period" />
            )}
          </section>

          <section aria-label="Follow-up">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Needs follow-up</h3>
            <ul className="space-y-1.5 text-[13px]">
              <li className="flex items-center justify-between rounded-[var(--r-md)] border border-line px-3 py-2">
                <span>SLA misses</span>
                <button type="button" disabled={!data.exceptions.sla_misses} className={`${drawerButton} !py-1 disabled:opacity-40`} onClick={() => openDrawer({ kind: 'filtered-records', recordKind: 'work_orders', filter: 'sla_missed', extra: { assigned_to: userId }, title: `${data.employee.name} · missed SLA` })}>
                  {data.exceptions.sla_misses} · View
                </button>
              </li>
              <li className="flex items-center justify-between rounded-[var(--r-md)] border border-line px-3 py-2">
                <span>Open assignments</span>
                <button type="button" disabled={!data.exceptions.open_assignments} className={`${drawerButton} !py-1 disabled:opacity-40`} onClick={() => openDrawer({ kind: 'filtered-records', recordKind: 'tasks', filter: 'open', extra: { assigned_to: userId }, title: `${data.employee.name} · open assignments` })}>
                  {data.exceptions.open_assignments} · View
                </button>
              </li>
            </ul>
          </section>
          {data.notes.map((n) => <p key={n} className="text-[12px] text-ink3">{n}</p>)}
        </>
      )}
    </ReportDrawer>
  )
}

export function RoomAssetDrawer({ entity, id }: { entity: 'room' | 'asset'; id: string }) {
  const { filters, queryScope, ready, openDrawer, role, definitions } = useReports()
  const query = useQuery({
    queryKey: [...queryScope, 'room-asset', entity, id, filters.start, filters.end],
    queryFn: () => reportsV2Api.roomAsset(entity, id, filters),
    enabled: ready,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const data = query.data
  const external = entity === 'room' ? roomHref(id, role) : assetHref(id)

  return (
    <ReportDrawer
      title={data?.entity.label ?? (entity === 'room' ? 'Room history' : 'Asset history')}
      subtitle={
        <>
          {describeRange(filters)}
          {data?.entity.current_status ? ` · Status now: ${titleCase(data.entity.current_status)}` : ''}
        </>
      }
      footer={
        <>
          {external && <Link href={external} className={drawerPrimaryButton}>{entity === 'room' ? 'Open room details' : 'Open asset details'}</Link>}
          <button type="button" className={drawerButton} onClick={() => openDrawer({ kind: 'filtered-records', recordKind: 'work_orders', filter: 'all', extra: entity === 'room' ? { room_id: id } : { asset_id: id }, title: 'Related work orders' })}>
            View related work orders
          </button>
        </>
      }
    >
      {query.isLoading ? (
        <SectionSkeleton height="h-72" />
      ) : query.isError || !data ? (
        <ErrorBlock message="This record is not available. It may have been removed or you may not have access." onRetry={() => query.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.kpis.map((k) => (
              <ReportMetricCard key={k.key + k.label} kpi={{ ...k, label: k.key === 'wo_completed' ? 'Work orders in period' : k.label }} definition={definitions?.[k.key]} hideComparison />
            ))}
          </div>
          {data.repeat_notice && <AvailabilityNotice availability="not_applicable" label={null} reason={data.repeat_notice} />}
          <section aria-label="Downtime">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Recorded downtime</h3>
            {data.downtime.availability === 'available' ? (
              <p className="text-[13px] text-ink2">{data.downtime.hours ? `${formatValue(data.downtime.hours, 'hours')} out of order in this period.` : 'No out-of-order time was recorded in this period.'} Operational room status is separate from PMS occupancy.</p>
            ) : (
              <AvailabilityNotice availability="unavailable" reason={data.downtime.reason} />
            )}
            {data.latest_repair_at && <p className="mt-1 text-[12.5px] text-ink3">Latest repair completed {formatDateTime(data.latest_repair_at)}.</p>}
          </section>
          <section aria-label="Timeline">
            <h3 className="mb-1.5 text-[13px] font-semibold text-ink">Maintenance and quality timeline</h3>
            {data.timeline.length === 0 ? (
              <EmptyBlock title="No recorded events in this period" />
            ) : (
              <ol className="space-y-2 border-l border-line pl-4">
                {data.timeline.map((event) => {
                  const href = event.type === 'work_order' ? recordHref('work_orders', event, role) : null
                  return (
                    <li key={`${event.type}:${event.id}`} className="relative text-[13px]">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                      <p className="text-[12px] text-ink3">{formatDateTime(event.at)} · {titleCase(event.type)}</p>
                      <p className="text-ink">{href ? <Link href={href} className="underline-offset-2 hover:underline">{event.title ?? 'Work order'}</Link> : event.title ?? '—'}</p>
                      <p className="flex flex-wrap gap-1 text-[12px] text-ink3">
                        {event.category && <ReportPill tone="neutral" size="sm">{titleCase(event.category)}</ReportPill>}
                        {event.status && <ReportPill tone="info" size="sm">{titleCase(event.status)}</ReportPill>}
                      </p>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </>
      )}
    </ReportDrawer>
  )
}
