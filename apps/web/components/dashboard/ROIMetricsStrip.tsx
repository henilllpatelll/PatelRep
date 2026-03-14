'use client'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { reportsApi } from '@/lib/api/reports'
import { hotelsApi } from '@/lib/api/hotels'
import { GlassCard } from '@/components/ui/GlassCard'

interface MetricCardProps {
  title: string
  value: string
  trend: 'up' | 'down' | 'neutral'
  trendLabel: string
  variant: 'success' | 'accent' | 'danger' | 'default'
}

function MetricCard({ title, value, trend, trendLabel, variant }: MetricCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-slate-400'

  return (
    <GlassCard variant={variant}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
      <p className="text-2xl font-extrabold text-slate-900 mt-1">{value}</p>
      <div className={`flex items-center gap-1 mt-1 ${trendColor}`}>
        <TrendIcon size={12} />
        <span className="text-xs text-slate-400">{trendLabel}</span>
      </div>
    </GlassCard>
  )
}

function SkeletonCard() {
  return (
    <GlassCard variant="default">
      <div className="animate-pulse">
        <div className="h-2 bg-slate-200 rounded w-2/3 mb-3" />
        <div className="h-8 bg-slate-200 rounded w-1/2 mb-3" />
        <div className="h-2 bg-slate-200 rounded w-1/3" />
      </div>
    </GlassCard>
  )
}

function getHotelIdFromSession(accessToken: string | undefined): string {
  if (!accessToken) return ''
  try {
    return JSON.parse(atob(accessToken.split('.')[1]))?.hotel_id ?? ''
  } catch {
    return ''
  }
}

export function ROIMetricsStrip() {
  const session = useAuthStore(s => s.session)
  const hotelId = getHotelIdFromSession(session?.access_token)

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 120_000,
    enabled: true,
  })

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['hotel-stats', hotelId],
    queryFn: () => hotelsApi.getStats(hotelId),
    refetchInterval: 120_000,
    enabled: !!hotelId,
  })

  const isLoading = summaryLoading || statsLoading

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  const summary = summaryData?.data
  const stats = statsData?.data

  const inspectedToday = summary?.room_status_breakdown?.INSPECTED ?? 0
  const openWorkOrders = summary?.open_work_orders ?? stats?.open_tasks ?? 0
  const tasksCompleted = summary?.tasks_completed_today ?? 0

  const totalRooms = stats?.total_rooms ?? 1
  const inspectedPct = totalRooms > 0 ? Math.round((inspectedToday / totalRooms) * 100) : 0

  return (
    <div className="grid grid-cols-3 gap-4">
      <MetricCard
        title="Rooms Inspected Today"
        value={`${inspectedToday}`}
        trend={inspectedPct >= 80 ? 'up' : inspectedPct >= 50 ? 'neutral' : 'down'}
        trendLabel={`${inspectedPct}% of ${totalRooms} rooms`}
        variant="success"
      />
      <MetricCard
        title="Open Work Orders"
        value={`${openWorkOrders}`}
        trend={openWorkOrders === 0 ? 'up' : openWorkOrders <= 5 ? 'neutral' : 'down'}
        trendLabel={openWorkOrders === 0 ? 'All clear' : openWorkOrders === 1 ? '1 pending' : `${openWorkOrders} pending`}
        variant={openWorkOrders > 5 ? 'danger' : openWorkOrders > 0 ? 'accent' : 'success'}
      />
      <MetricCard
        title="Tasks Completed Today"
        value={`${tasksCompleted}`}
        trend={tasksCompleted > 0 ? 'up' : 'neutral'}
        trendLabel={tasksCompleted === 1 ? '1 task done' : `${tasksCompleted} tasks done`}
        variant="accent"
      />
    </div>
  )
}
