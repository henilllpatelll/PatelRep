'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Bell, Package, Bed, ArrowRight, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
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

type StatusKey = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'

const ROOM_STATUS_CONFIG: Record<StatusKey, { label: string; color: string }> = {
  DIRTY:       { label: 'Dirty',       color: 'text-red-600' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-600' },
  CLEAN:       { label: 'Clean',       color: 'text-green-600' },
  INSPECTED:   { label: 'Inspected ✓', color: 'text-emerald-600' },
  OOO:         { label: 'Out of Order',color: 'text-stone-400' },
  PICKUP:      { label: 'Pickup',      color: 'text-purple-600' },
}

const STATUS_ORDER: StatusKey[] = ['INSPECTED', 'CLEAN', 'IN_PROGRESS', 'DIRTY', 'PICKUP', 'OOO']

const REQUEST_STATUS_VARIANT = {
  open: 'high',
  in_progress: 'medium',
  resolved: 'low',
  escalated: 'high',
} as const

function GuestRequestRow({ req }: { req: GuestRequest }) {
  return (
    <Link href="/guest-requests" className="flex items-center gap-3 py-3 px-2 border-b border-stone-100 last:border-0 hover:bg-stone-50 rounded-xl -mx-2 transition-colors group">
      <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors border border-stone-100">
        <Bell className="w-4 h-4 text-stone-500 group-hover:text-amber-600 transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-stone-900 group-hover:text-amber-700 truncate transition-colors">{req.title}</p>
        <p className="text-xs font-medium text-stone-500 mt-0.5">
          {req.rooms?.room_number ? `Room ${req.rooms.room_number}` : req.guest_name ?? 'No room'}
          {' · '}
          {new Date(req.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <Badge variant={REQUEST_STATUS_VARIANT[req.status] ?? 'default'}>
        {req.status === 'in_progress' ? 'Active' : req.status}
      </Badge>
    </Link>
  )
}

export function FrontDeskDashboard() {
  const { user, session } = useAuthStore()
  const hotelId = getHotelIdFromSession(session?.access_token)
  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Front Desk'

  const today = format(new Date(), 'yyyy-MM-dd')
  const { data: boardData, isLoading: summaryLoading } = useQuery({
    queryKey: ['housekeeping-board-frontdesk', today],
    queryFn: () => housekeepingApi.getBoard(today, undefined, false),
    refetchInterval: 60_000,
  })

  const { data: statsData } = useQuery({
    queryKey: ['hotel-stats', hotelId],
    queryFn: () => hotelsApi.getStats(hotelId),
    enabled: !!hotelId,
    refetchInterval: 60_000,
  })

  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ['guest-requests-open'],
    queryFn: () => guestRequestsApi.listRequests({ status: 'open', per_page: 8 }),
    refetchInterval: 60_000,
  })

  const { data: activeRequestsData } = useQuery({
    queryKey: ['guest-requests-active'],
    queryFn: () => guestRequestsApi.listRequests({ status: 'in_progress', per_page: 8 }),
    refetchInterval: 60_000,
  })

  const allRooms: any[] = (boardData as any)?.data ?? []
  const breakdown: Record<string, number> = {}
  for (const r of allRooms) {
    const s: string = r.status ?? 'UNKNOWN'
    breakdown[s] = (breakdown[s] ?? 0) + 1
  }
  const totalRooms = statsData?.data?.room_count ?? 0
  const inspected = breakdown['INSPECTED'] ?? 0
  const inspectedPct = totalRooms > 0 ? Math.round((inspected / totalRooms) * 100) : 0

  const openRequests: GuestRequest[] = (requestsData as { data?: GuestRequest[] })?.data ?? []
  const activeRequests: GuestRequest[] = (activeRequestsData as { data?: GuestRequest[] })?.data ?? []
  const allRequests = [...activeRequests, ...openRequests].slice(0, 8)

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

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 sm:p-4 flex flex-col items-center justify-center text-center bg-emerald-50/50 border-emerald-100">
          <p className="text-2xl sm:text-3xl font-bold text-emerald-600">{inspectedPct}%</p>
          <p className="text-[10px] sm:text-xs font-semibold text-emerald-600 mt-1 uppercase tracking-wider">Rooms Ready</p>
        </Card>
        <Card className={`p-3 sm:p-4 flex flex-col items-center justify-center text-center ${openRequests.length > 0 ? 'bg-amber-50/50 border-amber-200' : ''}`}>
          <p className={`text-2xl sm:text-3xl font-bold ${openRequests.length > 0 ? 'text-amber-600' : 'text-stone-900'}`}>
            {openRequests.length}
          </p>
          <p className={`text-[10px] sm:text-xs font-semibold mt-1 uppercase tracking-wider ${openRequests.length > 0 ? 'text-amber-600' : 'text-stone-500'}`}>Requests</p>
        </Card>
        <Card className="p-3 sm:p-4 flex flex-col items-center justify-center text-center">
          <p className="text-2xl sm:text-3xl font-bold text-stone-900">—</p>
          <p className="text-[10px] sm:text-xs font-semibold text-stone-500 mt-1 uppercase tracking-wider">Arrivals</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Room status */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <Bed className="w-4 h-4 text-amber-500" />
              Room Status
            </h2>
            <Link href="/housekeeping" prefetch={false} className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              Board <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {summaryLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-7 bg-stone-100 rounded" />)}
            </div>
          ) : (
            <div className="space-y-1.5">
              {STATUS_ORDER.map(s => {
                const count = breakdown[s] ?? 0
                if (count === 0) return null
                const cfg = ROOM_STATUS_CONFIG[s]
                return (
                  <div key={s} className="flex justify-between items-center py-1">
                    <span className="text-sm text-stone-500">{cfg.label}</span>
                    <span className={`text-sm font-semibold ${cfg.color}`}>{count}</span>
                  </div>
                )
              })}
              {Object.values(breakdown).every(v => v === 0) && (
                <p className="text-xs text-stone-400 py-2">No room data yet</p>
              )}
            </div>
          )}
        </Card>

        {/* Guest requests */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-500" />
              Guest Requests
            </h2>
            <Link href="/guest-requests" prefetch={false} className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {requestsLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-stone-100 rounded-lg" />)}
            </div>
          ) : allRequests.length === 0 ? (
            <div className="py-4 text-center">
              <CheckCircle2 className="w-7 h-7 text-green-300 mx-auto mb-1.5" />
              <p className="text-sm text-stone-400">No open guest requests</p>
            </div>
          ) : (
            <div>{allRequests.map(r => <GuestRequestRow key={r.id} req={r} />)}</div>
          )}
        </Card>
      </div>

      {/* Quick action */}
      <Link href="/lost-found" prefetch={false}>
        <Card className="p-4 hover:border-amber-300 transition-colors cursor-pointer flex items-center gap-3">
          <Package className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-stone-700">Lost & Found</p>
            <p className="text-xs text-stone-400">Log or look up guest items</p>
          </div>
          <ArrowRight className="w-4 h-4 text-stone-300" />
        </Card>
      </Link>
    </div>
  )
}
