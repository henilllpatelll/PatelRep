'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Clock,
  CheckCircle2,
  MessageSquare,
  DollarSign,
  ShieldCheck,
  Wrench,
  GraduationCap,
  Gauge,
} from 'lucide-react'
import { managementRoiApi } from '@/lib/api/managementRoi'
import { reportsApi } from '@/lib/api/reports'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { Stat, Pill } from '@/components/ui/primitives'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

// ── Types ─────────────────────────────────────────────────────────────────────

type DateRange = '7d' | '30d' | '90d'

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDateRange(range: DateRange): { start_date: string; end_date: string } {
  const today = new Date()
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const start = new Date(today)
  start.setDate(start.getDate() - days)
  return {
    start_date: toLocalDateStr(start),
    end_date: toLocalDateStr(today),
  }
}

const CONFIDENCE_TONE: Record<string, 'caution' | 'info' | 'ready'> = {
  low: 'caution',
  medium: 'info',
  high: 'ready',
}

// ── DateRangeSelector (cloned from reports/page.tsx) ─────────────────────────

function DateRangeSelector({
  value,
  onChange,
}: {
  value: DateRange
  onChange: (r: DateRange) => void
}) {
  const options: { label: string; value: DateRange }[] = [
    { label: 'Last 7 days', value: '7d' },
    { label: 'Last 30 days', value: '30d' },
    { label: 'Last 90 days', value: '90d' },
  ]
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-gray-50 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value
              ? 'bg-surface text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function StatSkeleton() {
  return <div className="min-h-[96px] animate-pulse rounded-[var(--r-lg)] bg-gray-100" />
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <StatSkeleton key={i} />
      ))}
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  loading,
  statCount,
  children,
}: {
  title: string
  icon: React.ReactNode
  loading: boolean
  statCount: number
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-[20px] font-semibold text-ink">
        {icon}
        {title}
      </h2>
      {loading ? <SkeletonGrid count={statCount} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      )}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ManagementRoiPage() {
  const { isGM } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)
  const [range, setRange] = useState<DateRange>('30d')
  const { start_date, end_date } = getDateRange(range)

  const housekeepingEfficiencyQuery = useQuery({
    queryKey: ['management-roi', 'housekeeping-efficiency', range],
    queryFn: () => managementRoiApi.getHousekeepingEfficiency({ start_date, end_date }),
    enabled: isGM,
  })
  const inspectionTrendsQuery = useQuery({
    queryKey: ['management-roi', 'inspection-trends', range],
    queryFn: () => managementRoiApi.getInspectionTrends({ start_date, end_date }),
    enabled: isGM,
  })
  const repeatFailuresQuery = useQuery({
    queryKey: ['management-roi', 'repeat-failures', range],
    queryFn: () => managementRoiApi.getRepeatFailures({ start_date, end_date }),
    enabled: isGM,
  })
  const downtimeRevenueQuery = useQuery({
    queryKey: ['management-roi', 'downtime-revenue', range],
    queryFn: () => managementRoiApi.getDowntimeRevenue({ start_date, end_date }),
    enabled: isGM,
  })
  const pmComplianceQuery = useQuery({
    queryKey: ['management-roi', 'pm-compliance', range],
    queryFn: () => managementRoiApi.getPmCompliance({ start_date, end_date }),
    enabled: isGM,
  })
  const trainingReadinessQuery = useQuery({
    queryKey: ['management-roi', 'training-readiness', range],
    queryFn: () => managementRoiApi.getTrainingReadiness(),
    enabled: isGM,
  })
  const forecastQuery = useQuery({
    queryKey: ['management-roi', 'forecast-7day', range],
    queryFn: () => managementRoiApi.getForecast(),
    enabled: isGM,
  })
  const guestRecoveryQuery = useQuery({
    queryKey: ['management-roi', 'guest-recovery', range],
    queryFn: () => reportsApi.getGuestRecovery({ start_date, end_date }),
    enabled: isGM,
  })
  const maintenanceQuery = useQuery({
    queryKey: ['management-roi', 'maintenance', range],
    queryFn: () => reportsApi.getMaintenance({ start_date, end_date }),
    enabled: isGM,
  })

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    )
  }

  if (!isGM) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-[var(--r-lg)] border border-line bg-surface p-6 text-center">
          <p className="text-[20px] font-semibold text-ink">
            Management ROI is available to the general manager.
          </p>
          <p className="mt-2 text-sm text-ink3">
            Ask your GM for access to hotel-wide ROI reporting.
          </p>
        </div>
      </div>
    )
  }

  const housekeeping = housekeepingEfficiencyQuery.data?.data
  const inspections = inspectionTrendsQuery.data?.data
  const repeatFailures = repeatFailuresQuery.data?.data
  const downtimeRevenue = downtimeRevenueQuery.data?.data
  const pmCompliance = pmComplianceQuery.data?.data
  const trainingReadiness = trainingReadinessQuery.data?.data
  const forecast = forecastQuery.data?.data
  const guestRecovery = guestRecoveryQuery.data?.data
  const maintenance = maintenanceQuery.data?.data

  const timeSavedLoading = housekeepingEfficiencyQuery.isLoading || pmComplianceQuery.isLoading || forecastQuery.isLoading
  const qualityLoading = inspectionTrendsQuery.isLoading || repeatFailuresQuery.isLoading
  const responseLoading = guestRecoveryQuery.isLoading || maintenanceQuery.isLoading
  const revenueLoading = downtimeRevenueQuery.isLoading || trainingReadinessQuery.isLoading

  const errors: { isError: boolean; noun: string }[] = [
    { isError: housekeepingEfficiencyQuery.isError, noun: 'housekeeping efficiency' },
    { isError: inspectionTrendsQuery.isError, noun: 'inspection trends' },
    { isError: repeatFailuresQuery.isError, noun: 'repeat failures' },
    { isError: downtimeRevenueQuery.isError, noun: 'downtime and revenue' },
    { isError: pmComplianceQuery.isError, noun: 'PM compliance' },
    { isError: trainingReadinessQuery.isError, noun: 'training readiness' },
    { isError: forecastQuery.isError, noun: 'the 7-day forecast' },
    { isError: guestRecoveryQuery.isError, noun: 'guest recovery' },
    { isError: maintenanceQuery.isError, noun: 'maintenance' },
  ].filter((e) => e.isError)

  const allResolved =
    housekeeping !== undefined &&
    inspections !== undefined &&
    maintenance !== undefined &&
    guestRecovery !== undefined

  const isEmpty =
    allResolved &&
    guestRecovery.total_requests === 0 &&
    inspections.total_inspections === 0 &&
    maintenance.total_work_orders === 0 &&
    housekeeping.occupied_room_days === 0

  const forecastLaborHours = forecast
    ? forecast.days.reduce((sum, d) => sum + d.projected_labor_hours, 0)
    : 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Management ROI"
        subtitle="Time saved, quality, response, and revenue protected — trends and exceptions, not totals alone"
        actions={<DateRangeSelector value={range} onChange={setRange} />}
      />

      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((e) => (
            <div
              key={e.noun}
              className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-3 text-sm text-[var(--alert)]"
            >
              Failed to load {e.noun}. Please try again.
            </div>
          ))}
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          icon={<Gauge className="w-5 h-5" />}
          title="Not enough data yet"
          body="Metrics populate as guest requests, work orders, and inspections are recorded over time."
          className="rounded-xl border border-dashed border-gray-300 py-16"
        />
      ) : (
        <>
          {/* Time Saved */}
          <Section
            title="Time Saved"
            icon={<Clock className="h-4 w-4 text-[var(--ready)]" />}
            loading={timeSavedLoading}
            statCount={4}
          >
            <Stat
              label="Minutes / Occupied Room"
              value={housekeeping?.minutes_per_occupied_room ?? '—'}
              unit="min"
              hint={housekeeping?.definition}
              icon={<Clock className="h-4 w-4 text-[var(--ready)]" />}
            />
            <Stat
              label="Occupied Room Days"
              value={housekeeping?.occupied_room_days ?? '—'}
            />
            <Stat
              label="PM Completion"
              value={pmCompliance?.completion_rate_pct ?? '—'}
              unit="%"
            />
            <Stat
              label="7-Day Labor Forecast"
              value={forecast ? Math.round(forecastLaborHours) : '—'}
              unit="hrs"
              hint={forecast ? `Next 7 days, ${forecast.lookback_weeks}-week trailing average` : undefined}
            />
          </Section>

          {/* Quality */}
          <Section
            title="Quality"
            icon={<CheckCircle2 className="h-4 w-4 text-[var(--info)]" />}
            loading={qualityLoading}
            statCount={4}
          >
            <Stat
              label="Inspection Pass Rate"
              value={inspections?.pass_rate_pct ?? '—'}
              unit="%"
            />
            <Stat
              label="Repeat Defects"
              value={inspections?.repeat_defect_count ?? '—'}
              hint="Checklist items failed on 2+ inspections"
            />
            <Stat
              label="Repeat Asset Failures"
              value={repeatFailures?.repeat_asset_count ?? '—'}
              hint={repeatFailures ? `2+ work orders in ${repeatFailures.window_days} days` : undefined}
            />
            <Stat
              label="Repeat Room Failures"
              value={repeatFailures?.repeat_room_count ?? '—'}
            />
          </Section>

          {/* Response */}
          <Section
            title="Response"
            icon={<MessageSquare className="h-4 w-4 text-[var(--caution)]" />}
            loading={responseLoading}
            statCount={4}
          >
            <Stat
              label="Verified Resolution Rate"
              value={guestRecovery?.verified_resolution_rate_pct ?? '—'}
              unit="%"
            />
            <Stat
              label="Guest SLA Met"
              value={guestRecovery?.sla_met_rate_pct ?? '—'}
              unit="%"
            />
            <Stat
              label="Avg Acknowledgement"
              value={guestRecovery?.average_acknowledgement_minutes ?? '—'}
              unit="min"
            />
            <Stat
              label="Work Order SLA / MTTR"
              value={maintenance?.sla_compliance_pct ?? '—'}
              unit="%"
              hint={maintenance ? `MTTR ${maintenance.avg_repair_hours} hrs` : undefined}
            />
          </Section>

          {/* Revenue Protected */}
          <Section
            title="Revenue Protected"
            icon={<DollarSign className="h-4 w-4 text-[var(--accent)]" />}
            loading={revenueLoading}
            statCount={3}
          >
            <Stat
              label="Room Downtime"
              value={downtimeRevenue?.downtime.total_downtime_hours ?? '—'}
              unit="hrs"
              hint={downtimeRevenue ? `${downtimeRevenue.downtime.rooms_affected} rooms affected` : undefined}
              icon={<Wrench className="h-4 w-4" />}
            />
            {downtimeRevenue?.revenue.configured ? (
              <Stat
                label="Estimated Revenue Impact"
                value={
                  <span className="text-[var(--accent)]">
                    ${((downtimeRevenue.revenue.revenue_impact_cents ?? 0) / 100).toLocaleString()}
                  </span>
                }
              />
            ) : (
              <Stat
                label="Estimated Revenue Impact"
                value="Not set"
                hint="Set an average daily rate in Settings > General to estimate this."
              />
            )}
            <Stat
              label="Training Readiness"
              value={trainingReadiness?.readiness_pct ?? '—'}
              unit="%"
              hint={trainingReadiness ? `${trainingReadiness.overdue} overdue` : undefined}
              icon={<GraduationCap className="h-4 w-4" />}
            />
          </Section>

          {/* Exceptions and trends */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card hover={false} className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Repeated PM deferrals</h3>
              {pmCompliance && pmCompliance.repeated_deferrals.length > 0 ? (
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead>
                    <tr>
                      <th className="py-2 text-left font-semibold text-gray-600">PM Schedule</th>
                      <th className="py-2 text-right font-semibold text-gray-600">Deferrals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pmCompliance.repeated_deferrals.map((d) => (
                      <tr key={d.pm_schedule_id}>
                        <td className="py-2 font-mono text-xs text-gray-900">{d.pm_schedule_id}</td>
                        <td className="py-2 text-right text-gray-900">{d.deferral_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400">No repeated PM deferrals in this period.</p>
              )}
            </Card>

            <Card hover={false} className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Rooms with the most downtime</h3>
              {downtimeRevenue && downtimeRevenue.downtime.rooms.length > 0 ? (
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead>
                    <tr>
                      <th className="py-2 text-left font-semibold text-gray-600">Room</th>
                      <th className="py-2 text-right font-semibold text-gray-600">Downtime (hrs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...downtimeRevenue.downtime.rooms]
                      .sort((a, b) => b.downtime_hours - a.downtime_hours)
                      .slice(0, 5)
                      .map((r) => (
                        <tr key={r.room_id}>
                          <td className="py-2 font-mono text-xs text-gray-900">{r.room_id}</td>
                          <td className="py-2 text-right text-gray-900">{r.downtime_hours}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400">No room downtime recorded in this period.</p>
              )}
            </Card>
          </section>

          {/* 7-day forecast strip */}
          <Card hover={false} className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">7-Day Forecast</h3>
            {forecast && forecast.days.length > 0 ? (
              <div className="grid grid-cols-7 gap-2">
                {forecast.days.map((d) => (
                  <div key={d.date} className="rounded-lg border border-line p-3 text-center">
                    <p className="font-mono text-xs text-gray-500">{d.date}</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">{d.projected_rooms}</p>
                    <p className="text-xs text-gray-400">rooms</p>
                    <p className="mt-1 text-xs text-gray-500">{d.projected_labor_hours} hrs</p>
                    <div className="mt-2 flex justify-center">
                      <Pill tone={CONFIDENCE_TONE[d.confidence] ?? 'neutral'} size="sm">
                        {d.confidence}
                      </Pill>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Forecast data is not available yet.</p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
