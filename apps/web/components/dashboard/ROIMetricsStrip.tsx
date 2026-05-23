'use client'
import { CheckCircle, AlertCircle, ClipboardList } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { reportsApi } from '@/lib/api/reports'
import { hotelsApi } from '@/lib/api/hotels'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useCountUp } from '@/lib/hooks/useCountUp'
import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: number
  prefix?: string
  suffix?: string
  trend?: number
  icon: LucideIcon
  danger?: boolean
}

function MetricCard({ label, value, prefix, suffix, trend, icon: Icon, danger }: MetricCardProps) {
  const animated = useCountUp(value)
  return (
    <Card className={`p-3 flex items-center gap-3${danger ? ' border-red-200 bg-red-50' : ''}`}>
      <div className="bg-amber-50 rounded-lg p-2 shrink-0">
        <Icon className="w-5 h-5 text-amber-600" />
      </div>
      <div className="flex-1 min-w-0 flex justify-between items-center">
        <p className="text-sm text-stone-500 font-medium">{label}</p>
        <div className="flex items-center gap-2">
          <p className="text-xl font-bold text-stone-900 font-mono">
            {prefix}{animated}{suffix}
          </p>
          {trend !== undefined && (
            <Badge variant={trend >= 0 ? 'low' : 'high'}>
              {trend >= 0 ? '+' : ''}{trend}%
            </Badge>
          )}
        </div>
      </div>
    </Card>
  )
}

function SkeletonCard() {
  return (
    <Card className="p-4">
      <div className="animate-pulse flex items-start gap-3">
        <div className="bg-amber-50 rounded-xl p-2.5 shrink-0">
          <div className="w-4 h-4 bg-amber-100 rounded" />
        </div>
        <div className="flex-1">
          <div className="h-2 bg-stone-200 rounded w-2/3 mb-3" />
          <div className="h-8 bg-stone-200 rounded w-1/2 mb-3" />
          <div className="h-2 bg-stone-200 rounded w-1/3" />
        </div>
      </div>
    </Card>
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

  const { data: summaryData, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ['daily-summary', hotelId],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 120_000,
    enabled: !!hotelId,
  })

  const { data: statsData, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['hotel-stats', hotelId],
    queryFn: () => hotelsApi.getStats(hotelId),
    refetchInterval: 120_000,
    enabled: !!hotelId,
  })

  const isLoading = summaryLoading || statsLoading
  const isError = summaryError || statsError

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4">
            <p className="text-sm text-stone-400">Unable to load</p>
          </Card>
        ))}
      </div>
    )
  }

  const summary = summaryData?.data
  const stats = statsData?.data

  const inspectedToday = summary?.room_status_breakdown?.INSPECTED ?? 0
  const openWorkOrders = summary?.open_work_orders ?? stats?.open_tasks ?? 0
  const tasksCompleted = summary?.tasks_completed_today ?? 0

  const totalRooms = stats?.room_count ?? 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <MetricCard
        label="Rooms Inspected Today"
        value={inspectedToday}
        suffix={totalRooms > 0 ? ` / ${totalRooms}` : ''}
        icon={CheckCircle}
      />
      <MetricCard
        label="Open Work Orders"
        value={openWorkOrders}
        icon={AlertCircle}
        danger={openWorkOrders > 5}
        trend={openWorkOrders === 0 ? 0 : undefined}
      />
      <MetricCard
        label="Tasks Completed Today"
        value={tasksCompleted}
        icon={ClipboardList}
      />
    </div>
  )
}
