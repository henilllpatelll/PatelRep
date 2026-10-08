'use client'

import { formatShortDate, formatValue, titleCase } from '@/lib/reports/format'
import type { ManagementData } from '@/lib/reports/types'
import { ReportDataTable } from './ReportDataTable'
import { AvailabilityNotice, EmptyBlock, ReportSection } from './ReportPrimitives'
import { useReports } from './ReportsContext'
import { PreventiveMaintenanceSection } from './MaintenanceView'
import { StaffingOutlookSection } from './HousekeepingView'
import { KpiGrid, QueryBoundary, ViewHeader } from './ReportViewParts'
import { TrendCard } from './TrendCard'
import { useViewData } from './useReportData'

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--r-md)] bg-surface-2 p-3">
      <dt className="text-[12px] text-ink3">{label}</dt>
      <dd className="mt-0.5 font-display text-[22px] text-ink">{value}</dd>
      {hint && <dd className="text-[11.5px] text-ink3">{hint}</dd>}
    </div>
  )
}

export function ManagementView() {
  const query = useViewData<ManagementData>('management')
  const { openDrawer } = useReports()

  return (
    <QueryBoundary query={query} label="management">
      {(data) => {
        const exposure = data.downtime_exposure
        const training = data.quality_risk.training_readiness as Record<string, number | null>
        return (
          <>
            <ViewHeader title="Management Intelligence" subtitle="Financial and operational return in one place. Estimates are labelled; missing data is never shown as zero." />

            <ReportSection title="A · Time and labor" description="Cleaning effort per occupied room and how it compares with configured baselines.">
              <KpiGrid kpis={data.time_labor.kpis} columns={2} />
              <div className="mt-4">
                <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">Efficiency by room type</h3>
                {data.time_labor.by_room_type.length ? (
                  <ReportDataTable
                    caption="Housekeeping efficiency by room type"
                    rows={data.time_labor.by_room_type}
                    rowKey={(r) => r.room_type_id}
                    columns={[
                      { key: 'code', label: 'Room type', render: (r) => r.code ?? r.name ?? '—' },
                      { key: 'sessions', label: 'Sessions', align: 'right' },
                      { key: 'avg_minutes', label: 'Avg minutes', align: 'right', render: (r) => formatValue(r.avg_minutes, 'minutes') },
                      { key: 'baseline_minutes', label: 'Configured baseline', align: 'right', render: (r) => (r.baseline_minutes === null ? 'Not configured' : formatValue(r.baseline_minutes, 'minutes')) },
                      { key: 'variance_minutes', label: 'Variance', align: 'right', render: (r) => (r.variance_minutes === null ? '—' : `${r.variance_minutes > 0 ? '+' : ''}${r.variance_minutes} min`) },
                    ]}
                  />
                ) : (
                  <EmptyBlock title="No completed cleans in this period" />
                )}
              </div>
              <div className="mt-4"><TrendCard series={data.time_labor.trend} title="Cleaning minutes trend" /></div>
            </ReportSection>

            <ReportSection title="B · Quality and risk">
              <KpiGrid kpis={data.quality_risk.kpis} columns={2} />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">Repeat room failures</h3>
                  {data.quality_risk.repeat_room_failures.length ? (
                    <ReportDataTable
                      caption="Repeat room failures"
                      rows={data.quality_risk.repeat_room_failures}
                      rowKey={(r) => r.room_id}
                      onRowClick={(r) => openDrawer({ kind: 'room-asset-performance', entity: 'room', id: r.room_id })}
                      rowLabel={(r) => `Room ${r.room ?? ''}: open history`}
                      columns={[
                        { key: 'room', label: 'Room', render: (r) => `Room ${r.room ?? '—'}` },
                        { key: 'failure_count', label: 'Work orders', align: 'right' },
                      ]}
                    />
                  ) : (
                    <EmptyBlock positive title="No repeat room failures" />
                  )}
                </div>
                <div>
                  <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">Repeat asset failures</h3>
                  {data.quality_risk.repeat_asset_failures.length ? (
                    <ReportDataTable
                      caption="Repeat asset failures"
                      rows={data.quality_risk.repeat_asset_failures}
                      rowKey={(r) => r.asset_id}
                      onRowClick={(r) => openDrawer({ kind: 'room-asset-performance', entity: 'asset', id: r.asset_id })}
                      rowLabel={() => 'Open asset history'}
                      columns={[
                        { key: 'asset_id', label: 'Asset', render: () => 'View asset history' },
                        { key: 'failure_count', label: 'Work orders', align: 'right' },
                      ]}
                    />
                  ) : (
                    <EmptyBlock positive title="No repeat asset failures" />
                  )}
                </div>
              </div>
              <h3 className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink3">Training readiness (current)</h3>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Readiness" value={training.readiness_pct == null || !training.total_assignments ? 'Not applicable' : formatValue(training.readiness_pct as number, 'percent')} hint={training.total_assignments ? `${training.completed ?? 0} of ${training.total_assignments} assignments` : 'No assignments'} />
                <Stat label="Outstanding" value={training.outstanding ?? 0} />
                <Stat label="Overdue" value={training.overdue ?? 0} />
                <Stat label="Assignments" value={training.total_assignments ?? 0} />
              </dl>
            </ReportSection>

            <ReportSection title="C · Guest response" description="Same calculations as the Guest Experience screen.">
              <KpiGrid kpis={data.guest_response.kpis} />
            </ReportSection>

            <div className="space-y-4">
              <h2 className="sr-only">D · Maintenance and preventive maintenance</h2>
              <PreventiveMaintenanceSection pm={data.maintenance_pm.preventive_maintenance} />
              <ReportSection title="High-downtime rooms">
                {data.maintenance_pm.high_downtime_rooms.length ? (
                  <ReportDataTable
                    caption="Rooms with the most recorded downtime"
                    rows={data.maintenance_pm.high_downtime_rooms}
                    rowKey={(r) => r.room_id}
                    onRowClick={(r) => openDrawer({ kind: 'room-asset-performance', entity: 'room', id: r.room_id })}
                    rowLabel={(r) => `Room ${r.room ?? ''}: open history`}
                    columns={[
                      { key: 'room', label: 'Room', render: (r) => `Room ${r.room ?? '—'}` },
                      { key: 'downtime_hours', label: 'Downtime', align: 'right', render: (r) => formatValue(r.downtime_hours, 'hours') },
                    ]}
                  />
                ) : (
                  <EmptyBlock positive title="No recorded room downtime" />
                )}
              </ReportSection>
            </div>

            <ReportSection title="E · Downtime exposure (estimate)" description={exposure.caveat}>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Total room downtime" value={exposure.total_downtime_hours === null ? 'None recorded' : formatValue(exposure.total_downtime_hours, 'hours')} />
                <Stat label="Rooms affected" value={exposure.rooms_affected} />
                <Stat
                  label="Estimated revenue exposure"
                  value={exposure.adr_configured && exposure.estimate_cents !== null ? formatValue(exposure.estimate_cents, 'currency') : 'Not configured'}
                  hint={exposure.adr_configured ? 'Estimate only' : 'Set the average daily rate in Settings'}
                />
              </dl>
              {!exposure.adr_configured && <AvailabilityNotice className="mt-3" availability="not_configured" reason="No average daily rate is configured, so no revenue estimate is shown (this is not zero)." />}
              <button type="button" className="mt-3 text-[12.5px] font-medium text-[var(--accent)] underline-offset-2 hover:underline print:hidden" onClick={() => openDrawer({ kind: 'metric-detail', metric: 'downtime_exposure' })}>
                How is this calculated?
              </button>
            </ReportSection>

            <StaffingOutlookSection outlook={data.staffing_forecast} title="F · Staffing forecast" />

            <ReportSection title="AI credit usage" description="Credits consumed by AI features in this period (GM only).">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Credits used" value={data.ai_usage.total_credits_used} />
                <Stat label="Interactions" value={data.ai_usage.total_interactions} />
              </dl>
              {Object.keys(data.ai_usage.breakdown_by_type).length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5 text-[12.5px] text-ink2">
                  {Object.entries(data.ai_usage.breakdown_by_type).map(([type, credits]) => (
                    <li key={type} className="rounded-full border border-line px-2.5 py-1">{titleCase(type)}: {credits}</li>
                  ))}
                </ul>
              )}
            </ReportSection>
            <span className="sr-only">As of {formatShortDate(data.period.end)}</span>
          </>
        )
      }}
    </QueryBoundary>
  )
}
