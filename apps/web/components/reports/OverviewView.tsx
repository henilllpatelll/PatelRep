'use client'

import { Pill } from '@/components/ui/primitives'
import { titleCase } from '@/lib/reports/format'
import type { OverviewData } from '@/lib/reports/types'
import { ReportExceptionList } from './ReportExceptionList'
import { EmptyBlock, LiveBadge, ReportSection } from './ReportPrimitives'
import { KpiGrid, QueryBoundary, ViewHeader } from './ReportViewParts'
import { TrendCard } from './TrendCard'
import { useViewData } from './useReportData'

export function OverviewView() {
  const query = useViewData<OverviewData>('overview')

  return (
    <QueryBoundary query={query} label="overview">
      {(data) => (
        <>
          <ViewHeader title="Operations Overview" subtitle="Your hotel's operational performance at a glance." />
          {data.kpis.length ? <KpiGrid kpis={data.kpis} /> : <EmptyBlock title="No overview metrics for your access" />}

          <div className="grid gap-4 xl:grid-cols-5">
            <ReportSection
              className="xl:col-span-3"
              title="Needs attention"
              description="Ranked by urgency. Counts reflect live records for your departments."
            >
              <ReportExceptionList items={data.needs_attention} />
            </ReportSection>

            {data.daily_brief && (
              <ReportSection
                className="xl:col-span-2"
                title="Daily brief"
                description="Live operational counts as of now. These are not part of the selected period."
                actions={<LiveBadge />}
              >
                <dl className="grid grid-cols-2 gap-3 text-[13px]">
                  <div className="rounded-[var(--r-md)] bg-surface-2 p-3">
                    <dt className="text-ink3">Tasks completed today</dt>
                    <dd className="mt-1 font-display text-[24px] text-ink">{data.daily_brief.tasks_completed_today}</dd>
                  </div>
                  <div className="rounded-[var(--r-md)] bg-surface-2 p-3">
                    <dt className="text-ink3">Open work orders</dt>
                    <dd className="mt-1 font-display text-[24px] text-ink">{data.daily_brief.open_work_orders}</dd>
                  </div>
                </dl>
                <h3 className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink3">Room status now</h3>
                {Object.keys(data.daily_brief.room_status).length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {Object.entries(data.daily_brief.room_status)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([status, count]) => (
                        <li key={status}>
                          <Pill tone="neutral">{titleCase(status)}: {count}</Pill>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-ink3">No room status data.</p>
                )}
              </ReportSection>
            )}
          </div>

          {Object.keys(data.trends).length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {Object.values(data.trends).map((series) => (
                <TrendCard key={series.metric} series={series} />
              ))}
            </div>
          )}

          {data.departments.length > 0 && (
            <ReportSection title="Department performance" description="Each department is measured on its own KPIs; they are not forced onto one scale.">
              <div className="grid gap-4 md:grid-cols-2">
                {data.departments.map((dept) => (
                  <div key={dept.department} className="rounded-[var(--r-md)] border border-line p-3">
                    <h3 className="mb-2 text-[13px] font-semibold text-ink">{titleCase(dept.department)}</h3>
                    <KpiGrid kpis={dept.measures} columns={2} />
                  </div>
                ))}
              </div>
            </ReportSection>
          )}
        </>
      )}
    </QueryBoundary>
  )
}
