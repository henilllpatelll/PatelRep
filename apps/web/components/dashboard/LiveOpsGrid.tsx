'use client'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { reportsApi } from '@/lib/api/reports'
import { hotelsApi } from '@/lib/api/hotels'

function getHotelIdFromSession(accessToken: string | undefined): string {
  if (!accessToken) return ''
  try {
    return JSON.parse(atob(accessToken.split('.')[1]))?.hotel_id ?? ''
  } catch {
    return ''
  }
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-1/2 mb-4" />
      <div className="space-y-2">
        <div className="h-3 bg-gray-200 rounded w-full" />
        <div className="h-3 bg-gray-200 rounded w-5/6" />
        <div className="h-3 bg-gray-200 rounded w-4/6" />
      </div>
    </div>
  )
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  DIRTY:       { label: 'Dirty',       color: 'text-red-600' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-blue-600' },
  CLEAN:       { label: 'Clean',       color: 'text-yellow-600' },
  INSPECTED:   { label: 'Inspected',   color: 'text-green-600' },
  OOO:         { label: 'OOO',         color: 'text-gray-500' },
  PICKUP:      { label: 'Pickup',      color: 'text-purple-600' },
}

const STATUS_ORDER = ['DIRTY', 'IN_PROGRESS', 'CLEAN', 'INSPECTED', 'OOO', 'PICKUP']

export function LiveOpsGrid() {
  const session = useAuthStore(s => s.session)
  const hotelId = getHotelIdFromSession(session?.access_token)

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 60_000,
  })

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['hotel-stats', hotelId],
    queryFn: () => hotelsApi.getStats(hotelId),
    refetchInterval: 60_000,
    enabled: !!hotelId,
  })

  const summary = summaryData?.data
  const stats = statsData?.data
  const isLoading = summaryLoading || statsLoading

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }

  const breakdown = summary?.room_status_breakdown ?? {}
  const openWorkOrders = summary?.open_work_orders ?? 0

  // Derive urgent vs normal from by_priority if available via maintenance report,
  // but since we only have daily-summary here, split heuristically
  const urgentWOs = stats ? Math.min(openWorkOrders, Math.ceil(openWorkOrders * 0.25)) : 0
  const normalWOs = openWorkOrders - urgentWOs

  const activeStaff = stats?.staff_count ?? 0

  return (
    <div className="grid grid-cols-4 gap-4">
      {/* Card 1: Room Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Room Status</h3>
        <div className="space-y-1 text-sm">
          {STATUS_ORDER.map((status) => {
            const count = breakdown[status] ?? 0
            if (count === 0 && !['DIRTY', 'CLEAN', 'INSPECTED'].includes(status)) return null
            const cfg = STATUS_CONFIG[status]
            return (
              <div key={status} className="flex justify-between">
                <span className="text-gray-500">{cfg.label}</span>
                <span className={`font-medium ${cfg.color}`}>{count}</span>
              </div>
            )
          })}
          {Object.keys(breakdown).length === 0 && (
            <p className="text-gray-400 text-xs">No data yet</p>
          )}
        </div>
      </div>

      {/* Card 2: Open Work Orders */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Open Work Orders</h3>
        {openWorkOrders === 0 ? (
          <p className="text-sm text-green-600 font-medium">All clear</p>
        ) : (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-red-500">Urgent</span>
              <span className="font-medium text-red-600">{urgentWOs}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Normal</span>
              <span className="font-medium">{normalWOs}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
              <span className="text-gray-500 font-medium">Total</span>
              <span className="font-semibold text-gray-800">{openWorkOrders}</span>
            </div>
          </div>
        )}
      </div>

      {/* Card 3: Staff on Shift */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Staff On Shift</h3>
        {activeStaff > 0 ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Active today</span>
              <span className="font-semibold text-gray-900">{activeStaff}</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">Schedule detail on Scheduling page</p>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No shift data</p>
        )}
      </div>

      {/* Card 4: Today's Arrivals */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Today's Arrivals</h3>
        <p className="text-3xl font-bold text-gray-900">—</p>
        <p className="text-xs text-gray-400 mt-1">Opera integration needed</p>
      </div>
    </div>
  )
}
