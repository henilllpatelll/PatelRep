'use client'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { reportsApi } from '@/lib/api/reports'
import { format, subDays } from 'date-fns'
import { Card } from '@/components/ui/Card'
import { useAuthStore } from '@/stores/authStore'

function getHotelIdFromSession(accessToken: string | undefined): string {
  if (!accessToken) return ''
  try {
    return JSON.parse(atob(accessToken.split('.')[1]))?.hotel_id ?? ''
  } catch {
    return ''
  }
}

function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function thirtyDaysAgo(): string {
  return format(subDays(new Date(), 30), 'yyyy-MM-dd')
}

function SkeletonChart() {
  return (
    <Card>
      <div className="animate-pulse">
        <div className="h-3 bg-surface-3 rounded w-1/2 mb-4" />
        <div className="h-40 bg-surface-3 rounded" />
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
          <span className="text-2xl font-bold text-ink">{pct}%</span>
        </div>
      </div>
      <p className="text-xs font-medium" style={{ color }}>{label}</p>
    </div>
  )
}

export function TrendChartsRow() {
  const start = thirtyDaysAgo()
  const end = today()
  const session = useAuthStore(s => s.session)
  const hotelId = getHotelIdFromSession(session?.access_token)

  const { data: maintenanceData, isLoading: maintLoading, isError: maintError } = useQuery({
    queryKey: ['maintenance-report', start, end, hotelId],
    queryFn: () => reportsApi.getMaintenance({ start_date: start, end_date: end }),
    refetchInterval: 120_000,
    enabled: !!hotelId,
  })

  const { data: staffData, isLoading: staffLoading, isError: staffError } = useQuery({
    queryKey: ['staff-performance', start, end, hotelId],
    queryFn: () => reportsApi.getStaffPerformance({ start_date: start, end_date: end }),
    refetchInterval: 120_000,
    enabled: !!hotelId,
  })

  if (maintLoading || staffLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SkeletonChart />
        <SkeletonChart />
      </div>
    )
  }

  if (maintError || staffError) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5">
          <p className="text-sm text-ink3">Unable to load</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-ink3">Unable to load</p>
        </Card>
      </div>
    )
  }

  const maint = maintenanceData?.data
  const staff = staffData?.data

  const completionPct = maint?.completion_rate_pct ?? 0
  
  // Calculate SLA directly if backend returns confusing numbers when volume is low
  const total = maint?.total_work_orders ?? 0
  const breaches = maint?.active_sla_breaches ?? 0
  const slaPct = total > 0 ? Math.max(0, ((total - breaches) / total) * 100) : 100

  // Top 5 staff by tasks_completed, only showing those with > 0 tasks
  const topStaff = (staff?.metrics ?? [])
    .filter(s => s.tasks_completed > 0)
    .sort((a, b) => b.tasks_completed - a.tasks_completed)
    .slice(0, 5)

  const amberShades = ['#FBBF24', '#F59E0B', '#D97706', '#B45309', '#92400E']

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* Chart 1: SLA Compliance KPI */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink2 mb-4">SLA Compliance (30 days)</h3>
        {maint ? (
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
            <SLAGauge pct={Math.round(slaPct)} />
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-xs text-ink3">WO Completion</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 h-2 bg-surface-3 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: `${Math.min(completionPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-ink2 w-10 text-right">
                    {Math.round(completionPct)}%
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-surface-3 rounded-lg p-2">
                  <p className="text-ink3">Total WOs</p>
                  <p className="font-semibold text-ink">{maint.total_work_orders}</p>
                </div>
                <div className="bg-surface-3 rounded-lg p-2">
                  <p className="text-ink3">Completed</p>
                  <p className="font-semibold text-ink">{maint.completed}</p>
                </div>
                <div className="bg-surface-3 rounded-lg p-2">
                  <p className="text-ink3">Avg Resolution</p>
                  <p className="font-semibold text-ink">{maint.avg_resolution_hours.toFixed(1)}h</p>
                </div>
                <div className="bg-surface-3 rounded-lg p-2">
                  <p className="text-ink3">SLA Breaches</p>
                  <p className={`font-semibold ${maint.active_sla_breaches > 0 ? 'text-[var(--alert)]' : 'text-ink'}`}>
                    {maint.active_sla_breaches}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-40 text-ink3 text-sm">
            No maintenance data available
          </div>
        )}
      </Card>

      {/* Chart 2: Top Staff Performers */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink2 mb-4">Top Staff Performers (30 days)</h3>
        {topStaff.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={topStaff.map(s => ({ name: s.name.split(' ')[0], tasks: s.tasks_completed }))}
              layout="vertical"
              margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E7E5E4" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={64} />
              <Tooltip
                formatter={(value: number) => [`${value} tasks`, 'Completed']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="tasks" radius={[0, 4, 4, 0]}>
                {topStaff.map((_, i) => (
                  <Cell key={i} fill={amberShades[i % amberShades.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-40 text-ink3">
            <svg className="w-10 h-10 mb-2 text-ink4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm font-medium">Keep up the good work!</p>
            <p className="text-xs">Data will appear here soon.</p>
          </div>
        )}
      </Card>
    </div>
  )
}
