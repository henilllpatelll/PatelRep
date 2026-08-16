'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Package, Bed, CheckCircle2, Clock, Check, X, ShieldAlert } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { hotelsApi } from '@/lib/api/hotels'
import { lateCheckoutApi, type LateCheckoutRequest } from '@/lib/api/lateCheckout'
import { Stat, Pill, SectionLabel, Mono } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting'
import { Button, IconButton } from '@/components/ui/Button'

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
  acknowledged: 'caution',
  dispatched: 'caution',
  arrived: 'caution',
  guest_contacted: 'caution',
  resolved: 'ready',
  verified: 'ready',
  escalated: 'alert',
}

function LateCheckoutRow({ req, onApprove, onDeny, resolving }: {
  req: LateCheckoutRequest
  onApprove: (id: string, confirmedTime: string) => void
  onDeny: (id: string) => void
  resolving: boolean
}) {
  const [mode, setMode] = useState<'idle' | 'approving' | 'denying'>('idle')
  const [confirmedTime, setConfirmedTime] = useState(req.requested_time)

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-t border-line-2">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0">
          <Clock className="w-3.5 h-3.5 text-ink3" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-ink">
            Room <Mono className="bg-surface-2 border border-line rounded px-1 py-0.5 text-[10.5px]">{req.room_number}</Mono>
          </p>
          <p className="text-[11.5px] text-ink3 mt-0.5">Guest says <span className="font-medium text-ink2">{req.requested_time}</span></p>
        </div>
        {mode === 'idle' && (
          <div className="flex gap-1.5 shrink-0">
            <Button variant="secondary" size="sm" onClick={() => setMode('approving')} className="border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)] hover:bg-[var(--ready)] hover:text-white">
              Approve
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMode('denying')} className="bg-surface-2 border border-line text-ink3 hover:bg-[var(--alert-soft)] hover:text-[var(--alert)] hover:border-[var(--alert-line)]">
              Deny
            </Button>
          </div>
        )}
      </div>

      {mode === 'approving' && (
        <div className="flex items-center gap-2 ml-10 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg px-3 py-2">
          <span className="text-[11.5px] text-[var(--ready)] font-medium shrink-0">Confirm time:</span>
          <input
            value={confirmedTime}
            onChange={(e) => setConfirmedTime(e.target.value)}
            placeholder="e.g. 1:00 PM"
            className="flex-1 text-[12px] bg-transparent border-none outline-none text-ink font-medium"
          />
          <Button variant="primary" size="sm" loading={resolving} disabled={!confirmedTime.trim()} onClick={() => onApprove(req.id, confirmedTime)} className="gap-1 bg-[var(--ready)]">
            <Check size={11} />
            Confirm
          </Button>
          <IconButton variant="ghost" size="sm" onClick={() => setMode('idle')} aria-label="Cancel" className="text-ink3 hover:text-ink2"><X size={14} /></IconButton>
        </div>
      )}

      {mode === 'denying' && (
        <div className="flex items-center gap-2 ml-10 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
          <span className="text-[11.5px] text-[var(--alert)] font-medium">Deny late checkout for room {req.room_number}?</span>
          <Button variant="primary" size="sm" loading={resolving} onClick={() => onDeny(req.id)} className="ml-auto gap-1 bg-[var(--alert)] shrink-0">
            <X size={11} />
            Deny
          </Button>
          <IconButton variant="ghost" size="sm" onClick={() => setMode('idle')} aria-label="Cancel" className="text-ink3 hover:text-ink2 shrink-0"><X size={14} /></IconButton>
        </div>
      )}
    </div>
  )
}

function SkeletonRow({ v2 }: { v2?: boolean } = {}) {
  const radius = v2 ? 'rounded-[var(--r-md)]' : 'rounded-lg'
  return (
    <div className="animate-pulse flex items-center gap-3 px-4 py-3 border-t border-line-2">
      <div className={`w-8 h-8 ${radius} bg-surface-3 shrink-0`} />
      <div className="flex-1">
        <div className={`h-3 bg-surface-3 ${v2 ? 'rounded-[var(--r-sm)]' : 'rounded'} w-3/4 mb-1.5`} />
        <div className={`h-2 bg-surface-3 ${v2 ? 'rounded-[var(--r-sm)]' : 'rounded'} w-1/2`} />
      </div>
      <div className={`h-5 bg-surface-3 ${v2 ? 'rounded-full' : 'rounded'} w-14`} />
    </div>
  )
}

function GuestRequestRow({ req }: { req: GuestRequest }) {
  const tone = REQUEST_STATUS_TONE[req.status] ?? 'neutral'
  const statusLabel = ['acknowledged', 'dispatched', 'arrived', 'guest_contacted'].includes(req.status) ? 'Active' : req.status
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
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { user, session, fullName: storedFullName } = useAuthStore()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('dashboard', hotel)
  const hotelId = getHotelIdFromSession(session?.access_token)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [actionRoomId, setActionRoomId] = useState<string | null>(null)

  const firstName = storedFullName
    ? storedFullName.split(' ')[0] || 'Front Desk'
    : (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'Front Desk'

  const today = format(new Date(), 'yyyy-MM-dd')
  const { data: boardData, isLoading: summaryLoading, isError: boardIsError, refetch: refetchBoard } = useQuery({
    queryKey: ['housekeeping-board-frontdesk', today],
    queryFn: () => housekeepingApi.getBoard(today, undefined, false),
    refetchInterval: 60_000,
  })

  const { data: statsData, isError: statsIsError, refetch: refetchStats } = useQuery({
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
    queryFn: async () => {
      const response = await guestRequestsApi.listRequests({ per_page: 100 })
      return {
        ...response,
        data: response.data.filter((request) => ['acknowledged', 'dispatched', 'arrived', 'guest_contacted'].includes(request.status)).slice(0, 8),
      }
    },
    refetchInterval: 60_000,
  })

  const { data: lateCheckoutsData, isLoading: lateCheckoutsLoading } = useQuery({
    queryKey: ['late-checkout-requests-pending'],
    queryFn: () => lateCheckoutApi.list({ status: 'pending' }),
    refetchInterval: 30_000,
  })

  const { mutate: resolveRequest } = useMutation({
    mutationFn: ({ id, status, confirmed_time }: { id: string; status: 'approved' | 'denied'; confirmed_time?: string }) =>
      lateCheckoutApi.resolve(id, { status, confirmed_time }),
    onMutate: ({ id }) => setResolvingId(id),
    onSettled: () => {
      setResolvingId(null)
      queryClient.invalidateQueries({ queryKey: ['late-checkout-requests-pending'] })
    },
  })

  const { mutate: checkOut } = useMutation({
    mutationFn: (roomId: string) => housekeepingApi.markCheckedOut(roomId),
    onMutate: (roomId) => setActionRoomId(roomId),
    onSettled: () => {
      setActionRoomId(null)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board-frontdesk'] })
    },
  })

  const { mutate: checkIn } = useMutation({
    mutationFn: (roomId: string) => housekeepingApi.markCheckIn(roomId),
    onMutate: (roomId) => setActionRoomId(roomId),
    onSettled: () => {
      setActionRoomId(null)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board-frontdesk'] })
    },
  })

  const { mutate: welfareCheck } = useMutation({
    mutationFn: (roomId: string) => housekeepingApi.requestWelfareCheck(roomId),
    onMutate: (roomId) => setActionRoomId(roomId),
    onSettled: () => {
      setActionRoomId(null)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board-frontdesk'] })
    },
  })

  const pendingLateCheckouts: LateCheckoutRequest[] = (lateCheckoutsData as any)?.data ?? []
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
  const dndRooms = allRooms.filter((r: any) => r.dnd_flag === true)

  const arrivalsReady = allRooms
    .filter((r: any) => r.status === 'INSPECTED')
    .sort((a: any, b: any) => {
      const af = a.rooms?.floor ?? a.floor ?? 99
      const bf = b.rooms?.floor ?? b.floor ?? 99
      if (af !== bf) return af - bf
      return String(a.rooms?.room_number ?? a.room_number ?? '').localeCompare(
        String(b.rooms?.room_number ?? b.room_number ?? '')
      )
    })
  const departingRooms = allRooms.filter((r: any) =>
    r.clean_type === 'DEP' && (r.status === 'OCCUPIED' || r.status === 'IN_PROGRESS' || r.status === 'DIRTY')
  )

  if (v2) {
    return (
      <div className="flex flex-col gap-5">
        <DashboardGreeting
          name={firstName}
          subtitle={
            openRequests.length > 0
              ? `${openRequests.length} open guest ${openRequests.length === 1 ? 'request' : 'requests'} — ${readyPct}% of rooms ready.`
              : `${readyPct}% of rooms ready. No open guest requests.`
          }
        />

        {/* Stat strip */}
        {boardIsError || statsIsError ? (
          <div className="bg-surface border border-line rounded-[var(--r-lg)] shadow-card">
            <StateBlock
              status="error"
              error={{ message: t('common.error'), onRetry: () => { refetchBoard(); refetchStats() } }}
            />
          </div>
        ) : summaryLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-surface border border-line rounded-[var(--r-lg)] p-[14px_16px] min-h-[96px] animate-pulse flex flex-col gap-3">
                <div className="h-2.5 bg-surface-3 rounded-[var(--r-sm)] w-1/2" />
                <div className="h-7 bg-surface-3 rounded-[var(--r-sm)] w-1/3" />
                <div className="h-4 bg-surface-3 rounded-full w-1/4 mt-auto" />
              </div>
            ))}
          </div>
        ) : (
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
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Room status breakdown */}
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <div className="px-4 pt-3.5">
              <SectionLabel
                hint={`${allRooms.length} total`}
                action={
                  <Link
                    href="/housekeeping"
                    className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
                  >
                    View board
                  </Link>
                }
              >
                Room status
              </SectionLabel>
            </div>
            {summaryLoading ? (
              <div className="px-4 pb-3 animate-pulse space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-7 bg-surface-3 rounded-[var(--r-md)]" />)}
              </div>
            ) : boardIsError ? (
              <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchBoard() }} />
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

        {/* Late Checkout Requests */}
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel hint={pendingLateCheckouts.length > 0 ? `${pendingLateCheckouts.length} pending` : undefined}>
              Late checkouts
            </SectionLabel>
          </div>
          {lateCheckoutsLoading ? (
            [...Array(2)].map((_, i) => <SkeletonRow key={i} />)
          ) : pendingLateCheckouts.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-[var(--ready-line)]" />
              <p className="text-[13px] text-ink3">No pending late checkouts</p>
            </div>
          ) : (
            pendingLateCheckouts.map(req => (
              <LateCheckoutRow
                key={req.id}
                req={req}
                resolving={resolvingId === req.id}
                onApprove={(id, confirmedTime) => resolveRequest({ id, status: 'approved', confirmed_time: confirmedTime })}
                onDeny={(id) => resolveRequest({ id, status: 'denied' })}
              />
            ))
          )}
        </div>

        {/* Arrivals — Ready rooms & Departures */}
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5 pb-3 flex items-center justify-between">
            <SectionLabel hint={`${arrivalsReady.length} ready · ${departingRooms.length} departures`}>
              Arrivals &amp; departures
            </SectionLabel>
            <Link
              href="/housekeeping"
              className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
            >
              View board
            </Link>
          </div>
          {boardIsError ? (
            <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchBoard() }} />
          ) : summaryLoading ? (
            <div>
              <SkeletonRow v2 />
              <SkeletonRow v2 />
            </div>
          ) : arrivalsReady.length === 0 && departingRooms.length === 0 ? (
            <StateBlock status="empty" empty={{ title: t('dashboard.empty.frontDeskNoArrivals') }} />
          ) : (
            <>
              {departingRooms.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3 bg-surface-2 border-t border-line-2">
                    Checking out today ({departingRooms.length})
                  </p>
                  {departingRooms.slice(0, 6).map((r: any) => {
                    const rid = r.room_id ?? r.id
                    const room = r.rooms?.room_number ?? r.room_number ?? '—'
                    const isOccupied = r.status === 'OCCUPIED'
                    const statusTone = r.status === 'DIRTY' ? 'alert' : r.status === 'IN_PROGRESS' ? 'progress' : 'pickup'
                    const statusLabel = r.status === 'DIRTY' ? 'Checked out' : r.status === 'IN_PROGRESS' ? 'Cleaning' : 'Occupied'
                    return (
                      <div key={rid} className="flex items-center gap-3 px-4 py-2 border-t border-line-2">
                        <Mono className="bg-surface-2 border border-line rounded px-1.5 py-0.5 text-[11px]">
                          {room}
                        </Mono>
                        <span className="text-[12.5px] text-ink2 flex-1">Floor {r.rooms?.floor ?? r.floor ?? '—'}</span>
                        {isOccupied ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={actionRoomId === rid}
                            onClick={() => checkOut(rid)}
                            className="gap-1 border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)] hover:bg-[var(--alert)] hover:text-white duration-base ease-standard"
                          >
                            <Check size={10} />
                            Mark Departed
                          </Button>
                        ) : (
                          <Pill tone={statusTone} size="sm">{statusLabel}</Pill>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {arrivalsReady.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3 bg-surface-2 border-t border-line-2">
                    Ready for occupancy ({arrivalsReady.length})
                  </p>
                  <div className="divide-y divide-line-2">
                    {arrivalsReady.map((r: any) => {
                      const rid = r.room_id ?? r.id
                      const room = r.rooms?.room_number ?? r.room_number ?? '—'
                      const code = r.rooms?.room_types?.code ?? r.room_type_code ?? ''
                      return (
                        <div key={rid} className="flex items-center gap-3 px-4 py-2">
                          <Mono className="bg-surface-2 border border-line rounded px-1.5 py-0.5 text-[11px]">{room}</Mono>
                          {code && <span className="text-[11.5px] text-ink3 font-mono">{code}</span>}
                          <span className="text-[12px] text-ink3 flex-1">Floor {r.rooms?.floor ?? r.floor ?? '—'}</span>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={actionRoomId === rid}
                            onClick={() => checkIn(rid)}
                            className="gap-1 border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)] hover:bg-[var(--ready)] hover:text-white duration-base ease-standard"
                          >
                            <Check size={10} />
                            Mark Occupied
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* DND Welfare Check */}
        {dndRooms.length > 0 && (
          <div className="bg-surface border border-[var(--caution-line)] rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <div className="px-4 pt-3.5">
              <SectionLabel hint={`${dndRooms.length} room${dndRooms.length !== 1 ? 's' : ''} with DND`}>
                DND welfare check
              </SectionLabel>
            </div>
            <div className="divide-y divide-line-2">
              {dndRooms.map((r: any) => {
                const rid = r.room_id ?? r.id
                const room = r.rooms?.room_number ?? r.room_number ?? '—'
                return (
                  <div key={rid} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[var(--caution-soft)] border border-[var(--caution-line)] flex items-center justify-center shrink-0">
                      <ShieldAlert className="w-3.5 h-3.5 text-[var(--caution)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink">
                        Room <Mono className="bg-surface-2 border border-line rounded px-1 py-0.5 text-[10.5px]">{room}</Mono>
                      </p>
                      <p className="text-[11.5px] text-ink3 mt-0.5">DND flag active</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={actionRoomId === rid}
                      onClick={() => welfareCheck(rid)}
                      className="gap-1 border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)] hover:bg-[var(--caution)] hover:text-white shrink-0 duration-base ease-standard"
                    >
                      <ShieldAlert size={10} />
                      Welfare check
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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

  return (
    <div className="flex flex-col gap-5">
      <DashboardGreeting
        name={firstName}
        subtitle={
          openRequests.length > 0
            ? `${openRequests.length} open guest ${openRequests.length === 1 ? 'request' : 'requests'} — ${readyPct}% of rooms ready.`
            : `${readyPct}% of rooms ready. No open guest requests.`
        }
      />

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

      {/* Late Checkout Requests */}
      <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
        <div className="px-4 pt-3.5">
          <SectionLabel hint={pendingLateCheckouts.length > 0 ? `${pendingLateCheckouts.length} pending` : undefined}>
            Late checkouts
          </SectionLabel>
        </div>
        {lateCheckoutsLoading ? (
          [...Array(2)].map((_, i) => <SkeletonRow key={i} />)
        ) : pendingLateCheckouts.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-[var(--ready-line)]" />
            <p className="text-[13px] text-ink3">No pending late checkouts</p>
          </div>
        ) : (
          pendingLateCheckouts.map(req => (
            <LateCheckoutRow
              key={req.id}
              req={req}
              resolving={resolvingId === req.id}
              onApprove={(id, confirmedTime) => resolveRequest({ id, status: 'approved', confirmed_time: confirmedTime })}
              onDeny={(id) => resolveRequest({ id, status: 'denied' })}
            />
          ))
        )}
      </div>

      {/* Arrivals — Ready rooms & Departures */}
      {allRooms.length > 0 && (() => {
        const readyRoomsList = allRooms
          .filter((r: any) => r.status === 'INSPECTED')
          .sort((a: any, b: any) => {
            const af = a.rooms?.floor ?? a.floor ?? 99
            const bf = b.rooms?.floor ?? b.floor ?? 99
            if (af !== bf) return af - bf
            return String(a.rooms?.room_number ?? a.room_number ?? '').localeCompare(
              String(b.rooms?.room_number ?? b.room_number ?? '')
            )
          })
        const depRooms = allRooms.filter((r: any) =>
          r.clean_type === 'DEP' && (r.status === 'OCCUPIED' || r.status === 'IN_PROGRESS' || r.status === 'DIRTY')
        )
        if (readyRoomsList.length === 0 && depRooms.length === 0) return null
        return (
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <div className="px-4 pt-3.5 pb-3 flex items-center justify-between">
              <SectionLabel hint={`${readyRoomsList.length} ready · ${depRooms.length} departures`}>
                Arrivals &amp; departures
              </SectionLabel>
              <Link href="/housekeeping" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">View board</Link>
            </div>
            {depRooms.length > 0 && (
              <div>
                <p className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3 bg-surface-2 border-t border-line-2">
                  Checking out today ({depRooms.length})
                </p>
                {depRooms.slice(0, 6).map((r: any) => {
                  const rid = r.room_id ?? r.id
                  const room = r.rooms?.room_number ?? r.room_number ?? '—'
                  const isOccupied = r.status === 'OCCUPIED'
                  const statusTone = r.status === 'DIRTY' ? 'alert' : r.status === 'IN_PROGRESS' ? 'progress' : 'pickup'
                  const statusLabel = r.status === 'DIRTY' ? 'Checked out' : r.status === 'IN_PROGRESS' ? 'Cleaning' : 'Occupied'
                  return (
                    <div key={rid} className="flex items-center gap-3 px-4 py-2 border-t border-line-2">
                      <Mono className="bg-surface-2 border border-line rounded px-1.5 py-0.5 text-[11px]">
                        {room}
                      </Mono>
                      <span className="text-[12.5px] text-ink2 flex-1">Floor {r.rooms?.floor ?? r.floor ?? '—'}</span>
                      {isOccupied ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={actionRoomId === rid}
                          onClick={() => checkOut(rid)}
                          className="gap-1 border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)] hover:bg-[var(--alert)] hover:text-white"
                        >
                          <Check size={10} />
                          Mark Departed
                        </Button>
                      ) : (
                        <Pill tone={statusTone} size="sm">{statusLabel}</Pill>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {readyRoomsList.length > 0 && (
              <div>
                <p className="px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3 bg-surface-2 border-t border-line-2">
                  Ready for occupancy ({readyRoomsList.length})
                </p>
                <div className="divide-y divide-line-2">
                  {readyRoomsList.map((r: any) => {
                    const rid = r.room_id ?? r.id
                    const room = r.rooms?.room_number ?? r.room_number ?? '—'
                    const code = r.rooms?.room_types?.code ?? r.room_type_code ?? ''
                    return (
                      <div key={rid} className="flex items-center gap-3 px-4 py-2">
                        <Mono className="bg-surface-2 border border-line rounded px-1.5 py-0.5 text-[11px]">{room}</Mono>
                        {code && <span className="text-[11.5px] text-ink3 font-mono">{code}</span>}
                        <span className="text-[12px] text-ink3 flex-1">Floor {r.rooms?.floor ?? r.floor ?? '—'}</span>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={actionRoomId === rid}
                          onClick={() => checkIn(rid)}
                          className="gap-1 border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)] hover:bg-[var(--ready)] hover:text-white"
                        >
                          <Check size={10} />
                          Mark Occupied
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* DND Welfare Check */}
      {dndRooms.length > 0 && (
        <div className="bg-surface border border-[var(--caution-line)] rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel hint={`${dndRooms.length} room${dndRooms.length !== 1 ? 's' : ''} with DND`}>
              DND welfare check
            </SectionLabel>
          </div>
          <div className="divide-y divide-line-2">
            {dndRooms.map((r: any) => {
              const rid = r.room_id ?? r.id
              const room = r.rooms?.room_number ?? r.room_number ?? '—'
              return (
                <div key={rid} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-7 h-7 rounded-lg bg-[var(--caution-soft)] border border-[var(--caution-line)] flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-3.5 h-3.5 text-[var(--caution)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      Room <Mono className="bg-surface-2 border border-line rounded px-1 py-0.5 text-[10.5px]">{room}</Mono>
                    </p>
                    <p className="text-[11.5px] text-ink3 mt-0.5">DND flag active</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionRoomId === rid}
                    onClick={() => welfareCheck(rid)}
                    className="gap-1 border-[var(--caution-line)] bg-[var(--caution-soft)] text-[var(--caution)] hover:bg-[var(--caution)] hover:text-white shrink-0"
                  >
                    <ShieldAlert size={10} />
                    Welfare check
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
