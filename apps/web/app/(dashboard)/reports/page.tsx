'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart2,
  Users,
  Wrench,
  Zap,
  Calendar,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react'
import { reportsApi } from '@/lib/api/reports'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { STATUS_LABELS } from '@/lib/utils/roomStatus'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'daily' | 'staff' | 'maintenance' | 'ai'
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

function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function slaColor(pct: number): string {
  if (pct >= 95) return 'text-[var(--ready)]'
  if (pct >= 80) return 'text-[var(--caution)]'
  return 'text-[var(--alert)]'
}

function completionRateColor(pct: number): string {
  if (pct >= 80) return 'text-[var(--ready)]'
  if (pct >= 60) return 'text-[var(--caution)]'
  return 'text-[var(--alert)]'
}

function maintenanceSlaColor(pct: number): string {
  if (pct >= 90) return 'text-[var(--ready)]'
  if (pct >= 70) return 'text-[var(--caution)]'
  return 'text-[var(--alert)]'
}

// ── Status color map ──────────────────────────────────────────────────────────

const STATUS_BG: Record<string, string> = {
  DIRTY: 'bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)]',
  IN_PROGRESS: 'bg-[var(--progress-soft)] text-[var(--progress)] border border-[var(--progress-line)]',
  CLEAN: 'bg-[var(--info-soft)] text-[var(--info)] border border-[var(--info-line)]',
  INSPECTED: 'bg-[var(--ready-soft)] text-[var(--ready)] border border-[var(--ready-line)]',
  OOO: 'bg-[var(--blocked-soft)] text-[var(--blocked)] border border-[var(--blocked-line)]',
  PICKUP: 'bg-[var(--caution-soft)] text-[var(--caution)] border border-[var(--caution-line)]',
}

// ── DateRangeSelector ─────────────────────────────────────────────────────────

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

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  colorClass = 'text-gray-900',
  icon,
}: {
  label: string
  value: string | number
  colorClass?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <p className={`mt-2 text-3xl font-bold ${colorClass}`}>{value}</p>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-100 ${className}`} />
}

// ── Tab: Daily Summary ────────────────────────────────────────────────────────

function DailySummaryTab() {
  const [selectedDate, setSelectedDate] = useState<string>(
    toLocalDateStr(new Date())
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'daily', selectedDate],
    queryFn: () => reportsApi.getDailySummary(selectedDate),
  })

  const summary = data?.data

  return (
    <div className="space-y-6">
      {/* Date picker */}
      <div className="flex items-center gap-3">
        <Calendar className="h-4 w-4 text-gray-400" />
        <label className="text-sm font-medium text-gray-600">Report date:</label>
        <input
          type="date"
          value={selectedDate}
          max={toLocalDateStr(new Date())}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border border-line px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      {isError && (
        <div className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-3 text-sm text-[var(--alert)]">
          Failed to load daily summary. Please try again.
        </div>
      )}

      {/* Room status breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Room Status Breakdown
        </h3>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-20" />
            ))}
          </div>
        ) : summary && Object.keys(summary.room_status_breakdown).length > 0 ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {Object.entries(summary.room_status_breakdown).map(([status, count]) => (
              <div
                key={status}
                className={`rounded-lg px-4 py-3 text-center ${STATUS_BG[status] || 'bg-gray-50 text-gray-700 border border-line'}`}
              >
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs font-medium mt-0.5">{STATUS_LABELS[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No room data available.</p>
        )}
      </div>

      {/* Housekeeping summary note */}
      <p className="text-sm text-ink3 mt-2">Staff performance and maintenance data populate as tasks are completed and work orders are closed.</p>

      {/* Task + WO stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {isLoading ? (
          <>
            <SkeletonBlock className="h-28" />
            <SkeletonBlock className="h-28" />
          </>
        ) : summary ? (
          <>
            <div className="flex flex-col items-center justify-center bg-surface border border-line rounded-[var(--r-lg)] p-6">
              <CheckCircle className="mb-2 h-8 w-8 text-green-500" />
              <p className="text-4xl font-bold text-gray-900">{summary.tasks_completed_today}</p>
              <p className="mt-1 text-sm text-gray-500">tasks completed today</p>
            </div>
            <div
              className={`flex flex-col items-center justify-center rounded-[var(--r-lg)] border p-6 ${
                summary.open_work_orders > 0
                  ? 'border-orange-200/60 bg-orange-50/70'
                  : 'border-line bg-surface'
              }`}
            >
              <Wrench
                className={`mb-2 h-8 w-8 ${
                  summary.open_work_orders > 0 ? 'text-orange-500' : 'text-gray-400'
                }`}
              />
              <p
                className={`text-4xl font-bold ${
                  summary.open_work_orders > 0 ? 'text-orange-700' : 'text-gray-900'
                }`}
              >
                {summary.open_work_orders}
              </p>
              <p
                className={`mt-1 text-sm ${
                  summary.open_work_orders > 0 ? 'text-orange-600' : 'text-gray-500'
                }`}
              >
                open work orders
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

// ── Tab: Staff Performance ────────────────────────────────────────────────────

function StaffPerformanceTab() {
  const [range, setRange] = useState<DateRange>('30d')
  const params = getDateRange(range)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'staff', range],
    queryFn: () => reportsApi.getStaffPerformance(params),
  })

  const report = data?.data

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Staff Performance</h3>
          {report && (
            <p className="text-xs text-gray-400 mt-0.5">
              {report.period.start} — {report.period.end} · {report.total_staff} staff members
            </p>
          )}
        </div>
        <DateRangeSelector value={range} onChange={setRange} />
      </div>

      {isError && (
        <div className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-3 text-sm text-[var(--alert)]">
          Failed to load staff performance data.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-12" />
          ))}
        </div>
      ) : report && report.metrics.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Role</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Tasks Done</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">WOs Done</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">SLA %</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Labor Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-surface">
              {report.metrics.map((m) => (
                <tr key={m.user_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-3 text-gray-500">{formatRole(m.role)}</td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    {m.tasks_completed}
                    <span className="text-gray-400">/{m.tasks_total}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    {m.wo_completed}
                    <span className="text-gray-400">/{m.wo_total}</span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${slaColor(m.sla_compliance_pct)}`}>
                    {m.sla_compliance_pct}%
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    {m.total_labor_hours > 0 ? `${m.total_labor_hours} hrs` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !isLoading && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm font-medium text-gray-600">No staff performance data yet</p>
            <p className="mt-1 text-sm text-gray-400">Assign tasks and mark them complete to generate staff performance data.</p>
          </div>
        )
      )}
    </div>
  )
}

// ── Tab: Maintenance ──────────────────────────────────────────────────────────

function MaintenanceTab() {
  const [range, setRange] = useState<DateRange>('30d')
  const params = getDateRange(range)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'maintenance', range],
    queryFn: () => reportsApi.getMaintenance(params),
  })

  const report = data?.data

  const maxCatCount = report
    ? Math.max(...Object.values(report.by_category), 1)
    : 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Maintenance Report</h3>
          {report && (
            <p className="text-xs text-gray-400 mt-0.5">
              {report.period.start} — {report.period.end}
            </p>
          )}
        </div>
        <DateRangeSelector value={range} onChange={setRange} />
      </div>

      {isError && (
        <div className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-3 text-sm text-[var(--alert)]">
          Failed to load maintenance data.
        </div>
      )}

      {/* KPI Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-28" />
          ))}
        </div>
      ) : report ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <KpiCard
            label="Total Work Orders"
            value={report.total_work_orders}
            colorClass="text-[var(--info)]"
            icon={<Wrench className="h-5 w-5" />}
          />
          <KpiCard
            label="Completed"
            value={report.completed}
            colorClass="text-[var(--ready)]"
            icon={<CheckCircle className="h-5 w-5" />}
          />
          <KpiCard
            label="Completion Rate"
            value={`${report.completion_rate_pct}%`}
            colorClass={completionRateColor(report.completion_rate_pct)}
            icon={<TrendingUp className="h-5 w-5" />}
          />
          <KpiCard
            label="SLA Compliance"
            value={`${report.sla_compliance_pct}%`}
            colorClass={maintenanceSlaColor(report.sla_compliance_pct)}
          />
          <KpiCard
            label="Avg Resolution Time"
            value={`${report.avg_resolution_hours} hrs`}
          />
          <KpiCard
            label="Active SLA Breaches"
            value={report.active_sla_breaches}
            colorClass={report.active_sla_breaches > 0 ? 'text-[var(--alert)]' : 'text-gray-900'}
            icon={
              report.active_sla_breaches > 0 ? (
                <AlertTriangle className="h-5 w-5 text-[var(--alert)]" />
              ) : undefined
            }
          />
          <KpiCard
            label="Avg Response Time"
            value={report.avg_response_hours > 0 ? `${report.avg_response_hours} hrs` : '—'}
            colorClass="text-[var(--info)]"
          />
          <KpiCard
            label="Avg Repair Time"
            value={report.avg_repair_hours > 0 ? `${report.avg_repair_hours} hrs` : '—'}
            colorClass="text-[var(--caution)]"
          />
          <KpiCard
            label="Guest Reported"
            value={report.guest_reported_count}
            colorClass="text-[var(--alert)]"
          />
        </div>
      ) : null}

      {/* Breakdowns */}
      {report && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* By Category */}
          <div className="bg-surface border border-line rounded-[var(--r-lg)] p-5">
            <h4 className="mb-4 text-sm font-semibold text-gray-700">By Category</h4>
            {Object.keys(report.by_category).length === 0 ? (
              <p className="text-sm text-gray-400">No data.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(report.by_category)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm capitalize text-gray-700">{cat}</span>
                        <span className="text-sm font-semibold text-gray-900">{count}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-[var(--info)]"
                          style={{ width: `${(count / maxCatCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* By Priority */}
          <div className="bg-surface border border-line rounded-[var(--r-lg)] p-5">
            <h4 className="mb-4 text-sm font-semibold text-gray-700">By Priority</h4>
            <div className="space-y-3">
              {[
                { key: 'urgent', label: 'Urgent', badge: 'bg-[var(--alert-soft)] text-[var(--alert)]' },
                { key: 'normal', label: 'Normal', badge: 'bg-blue-100 text-[var(--info)]' },
                { key: 'low', label: 'Low', badge: 'bg-gray-100 text-gray-600' },
              ].map(({ key, label, badge }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge}`}>
                    {label}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {report.by_priority[key] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: AI Usage ─────────────────────────────────────────────────────────────

function AIUsageTab() {
  const [range, setRange] = useState<DateRange>('30d')
  const params = getDateRange(range)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'ai', range],
    queryFn: () => reportsApi.getAIUsage(params),
  })

  const report = data?.data
  const totalCredits = report?.total_credits_used ?? 0
  const estimatedCost = (totalCredits * 0.02).toFixed(2)

  const sortedBreakdown = report
    ? Object.entries(report.breakdown_by_type).sort(([, a], [, b]) => b - a)
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">AI Usage Report</h3>
          {report && (
            <p className="text-xs text-gray-400 mt-0.5">
              {report.period.start} — {report.period.end}
            </p>
          )}
        </div>
        <DateRangeSelector value={range} onChange={setRange} />
      </div>

      {isError && (
        <div className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-4 py-3 text-sm text-[var(--alert)]">
          Failed to load AI usage data.
        </div>
      )}

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-28" />
          ))}
        </div>
      ) : report ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard
            label="Total Credits Used"
            value={totalCredits.toLocaleString()}
            colorClass="text-violet-600"
            icon={<Zap className="h-5 w-5" />}
          />
          <KpiCard
            label="Total Interactions"
            value={report.total_interactions.toLocaleString()}
            colorClass="text-gray-900"
            icon={<BarChart2 className="h-5 w-5" />}
          />
          <KpiCard
            label="Estimated Cost"
            value={`$${estimatedCost}`}
            colorClass="text-gray-900"
            icon={<TrendingUp className="h-5 w-5" />}
          />
        </div>
      ) : null}

      {/* Breakdown table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-10" />
          ))}
        </div>
      ) : report && sortedBreakdown.length > 0 ? (
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">
                  Interaction Type
                </th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Credits</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-surface">
              {sortedBreakdown.map(([type, credits]) => {
                const pct =
                  totalCredits > 0 ? ((credits / totalCredits) * 100).toFixed(1) : '0.0'
                return (
                  <tr key={type} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-900">{formatType(type)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-700">
                      {credits.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{pct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !isLoading && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center">
            <Zap className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm font-medium text-gray-600">No AI usage data yet</p>
            <p className="mt-1 text-sm text-gray-400">Use the AI Copilot to create tasks or query SOPs — usage will appear here.</p>
          </div>
        )
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { role, isGM, isSupervisor } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)
  const [activeTab, setActiveTab] = useState<TabId>('daily')

  // Build visible tabs based on role
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = []

  // Daily Summary: gm, housekeeping_supervisor, chief_engineer
  if (isGM || isSupervisor) {
    tabs.push({ id: 'daily', label: 'Daily Summary', icon: <Calendar className="h-4 w-4" /> })
  }
  // Staff Performance: gm, housekeeping_supervisor, chief_engineer
  if (isGM || isSupervisor) {
    tabs.push({
      id: 'staff',
      label: 'Staff Performance',
      icon: <Users className="h-4 w-4" />,
    })
  }
  // Maintenance: gm, chief_engineer
  if (isGM || role === 'chief_engineer') {
    tabs.push({ id: 'maintenance', label: 'Maintenance', icon: <Wrench className="h-4 w-4" /> })
  }
  // AI Usage: gm only
  if (isGM) {
    tabs.push({ id: 'ai', label: 'AI Usage', icon: <Zap className="h-4 w-4" /> })
  }

  // If the active tab is no longer visible (role changed), pick first
  const visibleTabIds = tabs.map((t) => t.id)
  const currentTab = visibleTabIds.includes(activeTab) ? activeTab : (tabs[0]?.id ?? 'daily')

  if (isAuthLoading || !role) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">You do not have access to reports.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--caution-soft)] text-[var(--caution)]">
          <BarChart2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-normal text-ink tracking-tight">Reports</h1>
          <p className="text-sm text-gray-500">Operational analytics and performance metrics</p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="-mb-px flex gap-1 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                currentTab === tab.id
                  ? 'border-amber-500 text-[var(--caution)]'
                  : 'border-transparent text-ink3 hover:border-line hover:text-ink2'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {currentTab === 'daily' && <DailySummaryTab />}
        {currentTab === 'staff' && <StaffPerformanceTab />}
        {currentTab === 'maintenance' && <MaintenanceTab />}
        {currentTab === 'ai' && <AIUsageTab />}
      </div>
    </div>
  )
}
