'use client'
import { CheckCircle, AlertCircle, ClipboardList } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { reportsApi } from '@/lib/api/reports'
import { hotelsApi } from '@/lib/api/hotels'
import { Stat } from '@/components/ui/primitives'

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
    queryKey: ['daily-summary', hotelId],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 120_000,
    enabled: !!hotelId,
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
        ))}
      </div>
    )
  }

  const summary = summaryData?.data
  const stats = statsData?.data

  const breakdown = summary?.room_status_breakdown ?? {}
  const inspectedToday = breakdown.INSPECTED ?? 0
  const totalRooms = stats?.room_count ?? 0
  const openWorkOrders = summary?.open_work_orders ?? stats?.open_tasks ?? 0
  const tasksCompleted = summary?.tasks_completed_today ?? 0

  const occupiedRooms = (breakdown.OCCUPIED ?? 0) + (breakdown.PICKUP ?? 0) + (breakdown.IN_PROGRESS ?? 0)
  const occPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <Stat
        label="Occupancy"
        value={`${occPct}%`}
        hint={`${occupiedRooms} of ${totalRooms}`}
        deltaTone={occPct >= 70 ? 'ready' : occPct >= 40 ? 'caution' : 'alert'}
      />
      <Stat
        label="Rooms Inspected"
        value={inspectedToday}
        unit={totalRooms > 0 ? `/ ${totalRooms}` : undefined}
        icon={<CheckCircle size={14} />}
        deltaTone="ready"
      />
      <Stat
        label="Open Work Orders"
        value={openWorkOrders}
        icon={<AlertCircle size={14} />}
        deltaTone={openWorkOrders > 5 ? 'alert' : 'ready'}
      />
      <Stat
        label="Tasks Completed"
        value={tasksCompleted}
        icon={<ClipboardList size={14} />}
        deltaTone="ready"
      />
    </div>
  )
}
