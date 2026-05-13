'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Wrench, Zap, Calendar, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { engineeringApi, type WorkOrder, type PMSchedule, type FailurePrediction } from '@/lib/api/engineering'
import { reportsApi } from '@/lib/api/reports'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { format, subDays } from 'date-fns'

function SLAGaugeSmall({ pct }: { pct: number }) {
  const color = pct >= 90 ? '#22c55e' : pct >= 75 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-14 h-14 shrink-0">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="14" />
          <circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="14"
            strokeDasharray={`${(pct / 100) * 314} 314`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-stone-900">{pct}%</span>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-stone-800">SLA Compliance</p>
        <p className="text-xs text-stone-400">Last 30 days</p>
      </div>
    </div>
  )
}

export function ChiefEngineerDashboard() {
  const user = useAuthStore(s => s.user)
  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Chief Engineer'

  const { data: woData, isLoading: woLoading } = useQuery({
    queryKey: ['all-work-orders'],
    queryFn: () => engineeringApi.listWorkOrders({ per_page: 100 }),
    refetchInterval: 60_000,
  })

  const { data: pmData, isLoading: pmLoading } = useQuery({
    queryKey: ['pm-schedules'],
    queryFn: () => engineeringApi.listPMSchedules(),
    refetchInterval: 120_000,
  })

  const { data: predictionsData, isLoading: predictionsLoading } = useQuery({
    queryKey: ['failure-predictions'],
    queryFn: () => engineeringApi.getFailurePredictions(),
    refetchInterval: 120_000,
  })

  const { data: maintData } = useQuery({
    queryKey: ['maintenance-report', format(subDays(new Date(), 30), 'yyyy-MM-dd'), format(new Date(), 'yyyy-MM-dd')],
    queryFn: () => reportsApi.getMaintenance({
      start_date: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
      end_date: format(new Date(), 'yyyy-MM-dd'),
    }),
    refetchInterval: 120_000,
  })

  const allWOs: WorkOrder[] = (woData as { data?: WorkOrder[] })?.data ?? []
  const openWOs = allWOs.filter(wo => wo.status === 'open' || wo.status === 'in_progress')
  const urgentWOs = openWOs.filter(wo => wo.priority === 'urgent')
  const unassignedWOs = openWOs.filter(wo => !wo.assigned_to)

  const pmSchedules: PMSchedule[] = (pmData as { data?: PMSchedule[] })?.data ?? []
  const now = new Date()
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const pmDueSoon = pmSchedules.filter(pm => pm.is_active && new Date(pm.next_due_at) <= sevenDays)

  const predictions: FailurePrediction[] = (predictionsData as { data?: FailurePrediction[] })?.data ?? []
  const highRiskAssets = predictions.filter(p => !p.is_acknowledged && p.risk_score >= 70)

  const maint = maintData?.data
  const slaPct = maint ? Math.round(maint.sla_compliance_pct) : null

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div>
        <h1 className="text-[28px] font-bold text-[#1C1208] tracking-[-0.02em] leading-tight">
          Good morning, {fullName}!
        </h1>
        <p className="text-xs font-semibold text-amber-500 mt-1.5 uppercase tracking-[0.12em]">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Fleet health strip */}
      <div className="grid grid-cols-4 gap-3">
        <Card className={`p-3 sm:p-4 flex flex-col items-center justify-center text-center ${urgentWOs.length > 0 ? 'bg-red-50/50 border-red-200' : ''}`}>
          <p className={`text-2xl sm:text-3xl font-bold ${urgentWOs.length > 0 ? 'text-red-600' : 'text-stone-900'}`}>
            {urgentWOs.length}
          </p>
          <p className={`text-[10px] sm:text-xs font-semibold mt-1 uppercase tracking-wider ${urgentWOs.length > 0 ? 'text-red-500' : 'text-stone-500'}`}>Urgent WOs</p>
        </Card>
        <Card className="p-3 sm:p-4 flex flex-col items-center justify-center text-center">
          <p className="text-2xl sm:text-3xl font-bold text-stone-900">{openWOs.length}</p>
          <p className="text-[10px] sm:text-xs font-semibold text-stone-500 mt-1 uppercase tracking-wider">Open WOs</p>
        </Card>
        <Card className={`p-3 sm:p-4 flex flex-col items-center justify-center text-center ${unassignedWOs.length > 0 ? 'bg-amber-50/50 border-amber-200' : ''}`}>
          <p className={`text-2xl sm:text-3xl font-bold ${unassignedWOs.length > 0 ? 'text-amber-700' : 'text-stone-900'}`}>
            {unassignedWOs.length}
          </p>
          <p className={`text-[10px] sm:text-xs font-semibold mt-1 uppercase tracking-wider ${unassignedWOs.length > 0 ? 'text-amber-600' : 'text-stone-500'}`}>Unassigned</p>
        </Card>
        <Card className={`p-3 sm:p-4 flex flex-col items-center justify-center text-center ${highRiskAssets.length > 0 ? 'bg-orange-50/50 border-orange-200' : ''}`}>
          <p className={`text-2xl sm:text-3xl font-bold ${highRiskAssets.length > 0 ? 'text-orange-600' : 'text-stone-900'}`}>
            {highRiskAssets.length}
          </p>
          <p className={`text-[10px] sm:text-xs font-semibold mt-1 uppercase tracking-wider ${highRiskAssets.length > 0 ? 'text-orange-600' : 'text-stone-500'}`}>At-Risk</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SLA + WO summary */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-amber-500" />
              Work Order Queue
            </h2>
            <Link href="/engineering" prefetch={false} className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              Manage <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {slaPct !== null && (
            <div className="mb-4 pb-3 border-b border-stone-100">
              <SLAGaugeSmall pct={slaPct} />
            </div>
          )}
          {woLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-6 bg-stone-100 rounded" />)}
            </div>
          ) : openWOs.length === 0 ? (
            <div className="py-3 text-center">
              <CheckCircle2 className="w-6 h-6 text-green-300 mx-auto mb-1" />
              <p className="text-xs text-stone-400">All work orders closed</p>
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              {[
                { label: 'Urgent', count: urgentWOs.length, color: 'text-red-600' },
                { label: 'In Progress', count: openWOs.filter(wo => wo.status === 'in_progress').length, color: 'text-amber-600' },
                { label: 'Open / Queued', count: openWOs.filter(wo => wo.status === 'open').length, color: 'text-stone-700' },
                { label: 'Unassigned', count: unassignedWOs.length, color: 'text-orange-500' },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center py-0.5">
                  <span className="text-stone-500">{row.label}</span>
                  <span className={`font-semibold ${row.color}`}>{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* PM due soon */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-500" />
              PM Due in 7 Days
            </h2>
            <Link href="/engineering/pm-schedules" prefetch={false} className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              All PM <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {pmLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-stone-100 rounded-lg" />)}
            </div>
          ) : pmDueSoon.length === 0 ? (
            <div className="py-3 text-center">
              <CheckCircle2 className="w-6 h-6 text-green-300 mx-auto mb-1" />
              <p className="text-xs text-stone-400">No PM tasks due in the next 7 days</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pmDueSoon.slice(0, 5).map(pm => {
                const dueDate = new Date(pm.next_due_at)
                const isOverdue = dueDate < now
                return (
                  <Link key={pm.id} href="/engineering/pm-schedules" className="flex items-start gap-3 py-2 px-2 -mx-2 hover:bg-stone-50 rounded-xl transition-colors group">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isOverdue ? 'bg-red-50 group-hover:bg-red-100' : 'bg-stone-100 group-hover:bg-amber-100'}`}>
                      <Calendar className={`w-4 h-4 transition-colors ${isOverdue ? 'text-red-500' : 'text-stone-500 group-hover:text-amber-600'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-stone-800 truncate group-hover:text-amber-700 transition-colors">{pm.name}</p>
                      <p className="text-xs font-medium text-stone-500">{pm.assets?.name ?? '—'}</p>
                    </div>
                    <Badge variant={isOverdue ? 'high' : 'medium'}>
                      {isOverdue ? 'Overdue' : format(dueDate, 'MMM d')}
                    </Badge>
                  </Link>
                )
              })}
              {pmDueSoon.length > 5 && (
                <p className="text-xs text-stone-400 pt-1">+{pmDueSoon.length - 5} more</p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* High-risk asset alerts */}
      {(predictionsLoading || highRiskAssets.length > 0) && (
        <Card className={highRiskAssets.length > 0 ? 'border-orange-200 bg-orange-50' : undefined}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-500" />
              High-Risk Assets
              {highRiskAssets.length > 0 && (
                <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs font-semibold rounded-full">
                  {highRiskAssets.length}
                </span>
              )}
            </h2>
            <Link href="/engineering/predictions" prefetch={false} className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              All predictions <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {predictionsLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(2)].map((_, i) => <div key={i} className="h-10 bg-orange-100 rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {highRiskAssets.slice(0, 4).map(p => (
                <Link key={p.id} href="/engineering/predictions" className="flex items-center justify-between bg-white rounded-xl px-3 py-3 border border-orange-100 hover:border-orange-300 hover:shadow-sm transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center shrink-0 group-hover:bg-orange-100 transition-colors">
                      <Zap className="w-4 h-4 text-orange-500 group-hover:text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-stone-900 group-hover:text-orange-700 transition-colors">{p.assets?.name ?? 'Unknown Asset'}</p>
                      <p className="text-xs font-medium text-stone-500">{p.assets?.asset_categories?.name}</p>
                    </div>
                  </div>
                  <Badge variant="high" className="shrink-0">{p.risk_score}% Risk</Badge>
                </Link>
              ))}
              {highRiskAssets.length > 4 && (
                <p className="text-xs text-stone-400 pt-1">+{highRiskAssets.length - 4} more assets</p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
