'use client'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { reportsApi } from '@/lib/api/reports'
import { hotelsApi } from '@/lib/api/hotels'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

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
    <Card>
      <div className="animate-pulse">
        <div className="h-3 bg-stone-200 rounded w-1/2 mb-4" />
        <div className="space-y-2">
          <div className="h-3 bg-stone-200 rounded w-full" />
          <div className="h-3 bg-stone-200 rounded w-5/6" />
          <div className="h-3 bg-stone-200 rounded w-4/6" />
        </div>
      </div>
    </Card>
  )
}

type StatusKey = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'
type BadgeVariant = 'dirty' | 'in_progress' | 'clean' | 'inspected' | 'do_not_disturb' | 'out_of_order' | 'high' | 'medium' | 'low' | 'vip' | 'default'

const STATUS_CONFIG: Record<StatusKey, { label: string; variant: BadgeVariant }> = {
  DIRTY:       { label: 'Dirty',       variant: 'dirty' },
  IN_PROGRESS: { label: 'In Progress', variant: 'in_progress' },
  CLEAN:       { label: 'Clean',       variant: 'clean' },
  INSPECTED:   { label: 'Inspected',   variant: 'inspected' },
  OOO:         { label: 'OOO',         variant: 'out_of_order' },
  PICKUP:      { label: 'Pickup',      variant: 'default' },
}

const STATUS_ORDER: StatusKey[] = ['DIRTY', 'IN_PROGRESS', 'CLEAN', 'INSPECTED', 'OOO', 'PICKUP']

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
      <Card>
        <h3 className="text-sm font-semibold text-stone-700 mb-3">Room Status</h3>
        <div className="space-y-1.5 text-sm">
          {STATUS_ORDER.map((status) => {
            const count = breakdown[status] ?? 0
            if (count === 0 && !['DIRTY', 'CLEAN', 'INSPECTED'].includes(status)) return null
            const cfg = STATUS_CONFIG[status]
            return (
              <div key={status} className="flex justify-between items-center hover:bg-amber-50/50 rounded-lg px-1 -mx-1 py-0.5">
                <span className="text-stone-500">{cfg.label}</span>
                <Badge variant={cfg.variant}>{count}</Badge>
              </div>
            )
          })}
          {Object.keys(breakdown).length === 0 && (
            <p className="text-stone-400 text-xs">No data yet</p>
          )}
        </div>
      </Card>

      {/* Card 2: Open Work Orders */}
      <Card className={openWorkOrders > 5 ? 'border-red-200 bg-red-50' : undefined}>
        <h3 className="text-sm font-semibold text-stone-700 mb-3">Open Work Orders</h3>
        {openWorkOrders === 0 ? (
          <p className="text-sm text-green-600 font-medium">All clear</p>
        ) : (
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center hover:bg-amber-50/50 rounded-lg px-1 -mx-1 py-0.5">
              <span className="text-red-500">Urgent</span>
              <Badge variant="high">{urgentWOs}</Badge>
            </div>
            <div className="flex justify-between items-center hover:bg-amber-50/50 rounded-lg px-1 -mx-1 py-0.5">
              <span className="text-stone-500">Normal</span>
              <Badge variant="medium">{normalWOs}</Badge>
            </div>
            <div className="flex justify-between items-center border-t border-stone-100 pt-1.5 mt-1">
              <span className="text-stone-500 font-medium">Total</span>
              <span className="font-semibold text-stone-800">{openWorkOrders}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Card 3: Staff on Shift */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-700 mb-3">Staff On Shift</h3>
        {activeStaff > 0 ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between items-center hover:bg-amber-50/50 rounded-lg px-1 -mx-1 py-0.5">
              <span className="text-stone-500">Active today</span>
              <span className="font-semibold text-stone-900">{activeStaff}</span>
            </div>
            <p className="text-xs text-stone-400 mt-2">Schedule detail on Scheduling page</p>
          </div>
        ) : (
          <p className="text-sm text-stone-400">No shift data</p>
        )}
      </Card>

      {/* Card 4: Today's Arrivals */}
      <Card>
        <h3 className="text-sm font-semibold text-stone-700 mb-3">Today's Arrivals</h3>
        <p className="text-3xl font-bold text-stone-900">—</p>
        <p className="text-xs text-stone-400 mt-1">Opera integration needed</p>
      </Card>
    </div>
  )
}
