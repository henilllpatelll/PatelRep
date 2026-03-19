'use client'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { reportsApi } from '@/lib/api/reports'
import { format, subDays } from 'date-fns'
import { Card } from '@/components/ui/Card'

function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function thirtyDaysAgo(): string {
  return format(subDays(new Date(), 30), 'yyyy-MM-dd')
}

function SkeletonChart() {
  return (
    <Card variant="default">
      <div className="animate-pulse">
        <div className="h-3 bg-slate-200 rounded w-1/2 mb-4" />
        <div className="h-40 bg-slate-100 rounded" />
      </div>
    </Card>
  )
}

function SLAGauge({ pct }: { pct: number }) {
  const color = pct >= 90 ? '#22c55e' : pct >= 75 ? '#f59e0b' : '#ef4444'
  const label = pct >= 90 ? 'Excellent' : pct >= 75 ? 'Good' : 'Needs Attention'
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div className="relative w-32 h-32">
        {/* Background circle */}
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="12" />
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeDasharray={`${(pct / 100) * 314} 314`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-slate-900">{pct}%</span>
        </div>
      </div>
      <p className="text-xs font-medium" style={{ color }}>{label}</p>
    </div>
  )
}

export function TrendChartsRow() {
  const start = thirtyDaysAgo()
  const end = today()

  const { data: maintenanceData, isLoading: maintLoading } = useQuery({
    queryKey: ['maintenance-report', start, end],
    queryFn: () => reportsApi.getMaintenance({ start_date: start, end_date: end }),
    refetchInterval: 120_000,
  })

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['staff-performance', start, end],
    queryFn: () => reportsApi.getStaffPerformance({ start_date: start, end_date: end }),
    refetchInterval: 120_000,
  })

  if (maintLoading || staffLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <SkeletonChart />
        <SkeletonChart />
      </div>
    )
  }

  const maint = maintenanceData?.data
  const staff = staffData?.data

  const slaPct = maint?.sla_compliance_pct ?? 0
  const completionPct = maint?.completion_rate_pct ?? 0

  // Top 5 staff by tasks_completed
  const topStaff = (staff?.metrics ?? [])
    .slice()
    .sort((a, b) => b.tasks_completed - a.tasks_completed)
    .slice(0, 5)

  const barColors = ['#3b82f6', '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd']

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Chart 1: SLA Compliance KPI */}
      <Card variant="default" className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">SLA Compliance (30 days)</h3>
        {maint ? (
          <div className="flex items-center gap-8">
            <SLAGauge pct={Math.round(slaPct)} />
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-xs text-slate-500">WO Completion</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${Math.min(completionPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-10 text-right">
                    {Math.round(completionPct)}%
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 rounded-lg p-2">
                  <p className="text-slate-500">Total WOs</p>
                  <p className="font-semibold text-slate-900">{maint.total_work_orders}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2">
                  <p className="text-slate-500">Completed</p>
                  <p className="font-semibold text-slate-900">{maint.completed}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2">
                  <p className="text-slate-500">Avg Resolution</p>
                  <p className="font-semibold text-slate-900">{maint.avg_resolution_hours.toFixed(1)}h</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2">
                  <p className="text-slate-500">SLA Breaches</p>
                  <p className={`font-semibold ${maint.active_sla_breaches > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                    {maint.active_sla_breaches}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
            No maintenance data available
          </div>
        )}
      </Card>

      {/* Chart 2: Top Staff Performers */}
      <Card variant="default" className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Top Staff Performers (30 days)</h3>
        {topStaff.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={topStaff.map(s => ({ name: s.name.split(' ')[0], tasks: s.tasks_completed }))}
              layout="vertical"
              margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={64} />
              <Tooltip
                formatter={(value: number) => [`${value} tasks`, 'Completed']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="tasks" radius={[0, 4, 4, 0]}>
                {topStaff.map((_, i) => (
                  <Cell key={i} fill={barColors[i % barColors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
            No staff performance data yet
          </div>
        )}
      </Card>
    </div>
  )
}
