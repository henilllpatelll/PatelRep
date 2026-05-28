'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Bell, Package, Bed, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { hotelsApi } from '@/lib/api/hotels'
import { Stat, Pill, SectionLabel, Mono } from '@/components/ui/primitives'

function getHotelIdFromSession(accessToken: string | undefined): string {
  if (!accessToken) return ''
  try {
    return JSON.parse(atob(accessToken.split('.')[1]))?.hotel_id ?? ''
  } catch {
    return ''
  }
}

type StatusKey = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'

const ROOM_STATUS_CONFIG: Record<StatusKey, { label: string; tone: 'dirty' | 'progress' | 'clean' | 'ready' | 'ooo' | 'pickup' }> = {
  DIRTY:       { label: 'Vacant Dirty', tone: 'dirty' },
  IN_PROGRESS: { label: 'In Progress',  tone: 'progress' },
  CLEAN:       { label: 'Clean ready for inspection', tone: 'clean' },
  INSPECTED:   { label: 'Inspected Vacant', tone: 'ready' },
  OOO:         { label: 'Out of Order / Out of Service', tone: 'ooo' },
  PICKUP:      { label: 'Pickup',       tone: 'pickup' },
}

const STATUS_ORDER: StatusKey[] = ['INSPECTED', 'CLEAN', 'IN_PROGRESS', 'DIRTY', 'PICKUP', 'OOO']

const REQUEST_STATUS_TONE: Record<string, 'alert' | 'caution' | 'ready' | 'neutral'> = {
  open: 'alert',
  in_progress: 'caution',
  resolved: 'ready',
  escalated: 'alert',
}

function SkeletonRow() {
  return (
    <div className="animate-pulse flex items-center gap-3 px-4 py-3 border-t border-line-2">
      <div className="w-8 h-8 rounded-lg bg-surface-3 shrink-0" />
      <div className="flex-1">
        <div className="h-3 bg-surface-3 rounded w-3/4 mb-1.5" />
        <div className="h-2 bg-surface-3 rounded w-1/2" />
      </div>
      <div className="h-5 bg-surface-3 rounded w-14" />
    </div>
  )
}

function GuestRequestRow({ req }: { req: GuestRequest }) {
  const tone = REQUEST_STATUS_TONE[req.status] ?? 'neutral'
  const statusLabel = req.status === 'in_progress' ? 'Active' : req.status
  return (
    <Link
      href="/guest-requests"
      className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors"
    >
      <div className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0">
        <Bell className="w-3.5 h-3.5 text-ink3" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-ink truncate">{req.title}</p>
        <p className="text-[11.5px] text-ink3 mt-0.5">
          {req.rooms?.room_number
            ? <Mono className="bg-surface-2 border border-line rounded px-1 py-0.5 text-[10.5px]">R-{req.rooms.room_number}</Mono>
            : req.guest_name ?? 'No room'}
          {' '}
          <span className="font-mono">
            {new Date(req.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </p>
      </div>
      <Pill tone={tone} size="sm">{statusLabel}</Pill>
    </Link>
  )
}

export function FrontDeskDashboard() {
  const { user, session } = useAuthStore()
  const hotelId = getHotelIdFromSession(session?.access_token)
  const [greeting, setGreeting] = useState('Good morning')
  useEffect(() => {
    const h = new Date().getHours()
    if (h < 12) setGreeting('Good morning')
    else if (h < 18) setGreeting('Good afternoon')
    else setGreeting('Good evening')
  }, [])

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Front Desk'
  const firstName = fullName.includes('@') ? fullName.split('@')[0] : fullName.split(' ')[0] || fullName

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
  const readyRooms = inspected + (breakdown['CLEAN'] ?? 0)
  const readyPct = totalRooms > 0 ? Math.round((readyRooms / totalRooms) * 100) : 0

  const openRequests: GuestRequest[] = (requestsData as { data?: GuestRequest[] })?.data ?? []
  const activeRequests: GuestRequest[] = (activeRequestsData as { data?: GuestRequest[] })?.data ?? []
  const allRequests = [...activeRequests, ...openRequests].slice(0, 8)

  const dirtyRooms = breakdown['DIRTY'] ?? 0
  const inProgressRooms = breakdown['IN_PROGRESS'] ?? 0

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink3" suppressHydrationWarning>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="font-display italic text-[34px] leading-[1.1] tracking-[-0.5px] text-ink mt-1">
          {greeting}, {firstName}.
        </h1>
        <p className="mt-2 text-[14px] text-ink2 leading-relaxed">
          {openRequests.length > 0
            ? `${openRequests.length} open guest ${openRequests.length === 1 ? 'request' : 'requests'} — ${readyPct}% of rooms ready.`
            : `${readyPct}% of rooms ready. No open guest requests.`}
        </p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Rooms Ready"
          value={`${readyPct}%`}
          hint={`${readyRooms} of ${totalRooms}`}
          deltaTone={readyPct >= 80 ? 'ready' : 'caution'}
        />
        <Stat
          label="Open Requests"
          value={openRequests.length}
          delta={activeRequests.length > 0 ? `${activeRequests.length} active` : undefined}
          deltaTone={openRequests.length > 0 ? 'alert' : 'ready'}
        />
        <Stat
          label="In Progress"
          value={inProgressRooms}
          hint="rooms"
          deltaTone="caution"
        />
        <Stat
          label="Needs Cleaning"
          value={dirtyRooms}
          deltaTone={dirtyRooms > 0 ? 'alert' : 'ready'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Room status breakdown */}
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel
              hint={`${allRooms.length} total`}
              action={
                <Link href="/housekeeping" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
                  View board
                </Link>
              }
            >
              Room status
            </SectionLabel>
          </div>
          {summaryLoading ? (
            <div className="px-4 pb-3 animate-pulse space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-7 bg-surface-3 rounded" />)}
            </div>
          ) : (
            <div>
              {STATUS_ORDER.map(s => {
                const count = breakdown[s] ?? 0
                if (count === 0) return null
                const cfg = ROOM_STATUS_CONFIG[s]
                return (
                  <div key={s} className="flex items-center gap-3 px-4 py-2 border-t border-line-2">
                    <span className="text-[13px] text-ink3 flex-1">{cfg.label}</span>
                    <Pill tone={cfg.tone} size="sm">{count}</Pill>
                  </div>
                )
              })}
              {allRooms.length === 0 && (
                <p className="text-[12px] text-ink3 px-4 py-3">No room data yet</p>
              )}
            </div>
          )}
        </div>

        {/* Guest requests */}
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel
              hint={allRequests.length > 0 ? `${allRequests.length} open` : undefined}
              action={
                <Link href="/guest-requests" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
                  All requests
                </Link>
              }
            >
              Guest requests
            </SectionLabel>
          </div>
          {requestsLoading ? (
            [...Array(3)].map((_, i) => <SkeletonRow key={i} />)
          ) : allRequests.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-[var(--ready-line)]" />
              <p className="text-[13px] text-ink3">No open guest requests</p>
            </div>
          ) : (
            allRequests.map(r => <GuestRequestRow key={r.id} req={r} />)
          )}
        </div>
      </div>

      {/* Quick action — Lost & Found */}
      <Link href="/lost-found" prefetch={false}>
        <div className="bg-surface border border-line rounded-[var(--r-lg)] shadow-card p-4 hover:border-[var(--caution-line)] transition-colors cursor-pointer flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0">
            <Package className="w-4 h-4 text-ink3" />
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-ink">Lost &amp; Found</p>
            <p className="text-[11.5px] text-ink3">Log or look up guest items</p>
          </div>
          <Bed className="w-4 h-4 text-ink4 shrink-0" />
        </div>
      </Link>
    </div>
  )
}
