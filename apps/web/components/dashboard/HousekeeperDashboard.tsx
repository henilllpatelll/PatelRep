'use client'
import { format } from 'date-fns'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { tasksApi } from '@/lib/api/tasks'
import { aiApi } from '@/lib/api/ai'
import {
  getHousekeeperDashboardMetrics,
  getHousekeeperDashboardRooms,
} from '@/lib/utils/housekeepingDashboardMetrics'
import { Stat, Pill, StatusDot, SectionLabel, Mono, AILabel } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting'

const STATUS_TONE: Record<string, string> = {
  DIRTY: 'dirty', IN_PROGRESS: 'progress', CLEAN: 'clean',
  INSPECTED: 'inspected', OOO: 'ooo', PICKUP: 'pickup',
}

const STATUS_LABEL: Record<string, string> = {
  DIRTY: 'Vacant Dirty', IN_PROGRESS: 'In Progress',
  CLEAN: 'Clean ready for inspection', INSPECTED: 'Inspected', OOO: 'OOO/OOS', PICKUP: 'Pickup',
}

type PillTone = 'dirty' | 'progress' | 'clean' | 'inspected' | 'ooo' | 'pickup' | 'accent' | 'alert' | 'caution' | 'info' | 'ready' | 'ai' | 'neutral'

export function HousekeeperDashboard() {
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const hotel = useHotelStore(s => s.hotel)
  const v2 = isSectionRedesigned('dashboard', hotel)
  const today = format(new Date(), 'yyyy-MM-dd')

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'there'
  const firstName = fullName.includes('@') ? fullName.split('@')[0] : fullName.split(' ')[0] || fullName

  const { data: myRoomsData, isLoading: myRoomsLoading, isError: myRoomsError, refetch: refetchMyRooms } = useQuery({
    queryKey: ['my-rooms', user?.id, today],
    queryFn: () => housekeepingApi.getMyRooms(today),
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 10_000,
    retry: 1,
  })

  const { data: boardData, isLoading: roomsLoading, isError: boardError, refetch: refetchBoard } = useQuery({
    queryKey: ['housekeeping-board-housekeeper-dashboard', user?.id, today],
    queryFn: () => housekeepingApi.getBoard(today, undefined, false),
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 10_000,
  })

  const { data: tasksData, isError: tasksError, refetch: refetchTasks } = useQuery({
    queryKey: ['my-tasks', user?.id],
    queryFn: () => tasksApi.list({ assigned_to: user?.id, status: 'open', per_page: 5 }),
    enabled: !!user?.id,
    refetchInterval: 60_000,
  })

  const { data: alertsData } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 120_000,
  })

  const rooms = getHousekeeperDashboardRooms(myRoomsData, boardData, user?.id)
  const tasks = (tasksData as { data?: { id: string; title: string; priority: string; due_at?: string }[] })?.data ?? []
  const hkRisks = (alertsData?.data?.housekeeping_risks ?? []).slice(0, 3)

  const { totalRooms, done, remaining, inspectNow } = getHousekeeperDashboardMetrics(rooms)
  const isLoadingRooms = myRoomsLoading || (rooms.length === 0 && roomsLoading)
  const isRoomsError = (myRoomsError || boardError) && !isLoadingRooms && rooms.length === 0

  if (v2) {
    return (
      <div className="flex flex-col gap-5">
        <DashboardGreeting
          name={firstName}
          subtitle={
            rooms.length > 0
              ? `${rooms.length} rooms today, ${remaining} left.${done > 0 ? ` ${done} done.` : ''}`
              : 'No rooms assigned yet today.'
          }
        />

        {/* Stat strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Rooms today" value={totalRooms} delta={remaining > 0 ? `${remaining} left` : 'all done'} deltaTone={remaining > 0 ? 'info' : 'ready'} />
          <Stat label="Done" value={done} delta={done > 0 ? `+${done}` : '—'} deltaTone="ready" />
          <Stat label="Avg time" value="—" deltaTone="info" />
          <Stat label="Inspect now" value={inspectNow} delta={inspectNow > 0 ? 'pending' : 'none'} deltaTone={inspectNow > 0 ? 'caution' : 'ready'} />
        </div>

        {/* Queue + Predictions */}
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-5">
          {/* Room queue */}
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <div className="px-4 pt-3.5">
              <SectionLabel
                hint="Today"
                action={
                  <Link
                    href="/housekeeping"
                    className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
                  >
                    Full board
                  </Link>
                }
              >
                <span data-i18n-skip="true">{t('dashboard.section.myQueue')}</span>
              </SectionLabel>
            </div>
            {isLoadingRooms ? (
              <div className="px-4 pb-4 space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-[58px] bg-surface-2 rounded-[10px] animate-pulse" />
                ))}
              </div>
            ) : isRoomsError ? (
              <StateBlock
                status="error"
                error={{ message: t('common.error'), onRetry: () => { refetchMyRooms(); refetchBoard() } }}
              />
            ) : rooms.length === 0 ? (
              <div data-i18n-skip="true">
                <StateBlock status="empty" empty={{ title: t('dashboard.empty.housekeeperNoRooms') }} />
              </div>
            ) : (
              <div>
                {rooms.map((room: any, i: number) => {
                  const roomNumber = room.rooms?.room_number ?? room.room_number ?? '—'
                  const floor = room.rooms?.floor ?? room.floor
                  const roomType = room.rooms?.room_types?.code ?? null
                  const tone = STATUS_TONE[room.status] ?? 'neutral'
                  const label = STATUS_LABEL[room.status] ?? room.status
                  const isActive = i === 0
                  const pillTone: PillTone = (tone as PillTone) ?? 'neutral'
                  return (
                    <Link
                      key={room.room_id}
                      href="/housekeeping"
                      className="flex items-start gap-3 px-4 py-3 border-t border-line-2 hover:bg-surface-2 transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                      style={isActive ? { background: 'var(--brand-soft)' } : undefined}
                    >
                      <div className="w-11 h-11 rounded-[10px] bg-surface border border-line-2 flex flex-col items-center justify-center relative shrink-0">
                        <Mono className="text-[14px] font-semibold text-ink">{roomNumber}</Mono>
                        <StatusDot tone={tone} size={6} />
                        {isActive && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand text-white text-[9px] font-bold flex items-center justify-center border-2 border-paper">1</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13.5px] font-medium text-ink">
                            {roomType ?? `Room ${roomNumber}`}
                            {floor ? ` · Floor ${floor}` : ''}
                          </span>
                          <Pill tone={pillTone} size="sm">{label}</Pill>
                          <span className="ml-auto font-mono text-[11px] text-ink3">
                            {isActive ? 'now' : i === 1 ? 'next up' : 'flex'}
                          </span>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* AI predictions sidebar */}
          <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
            <div className="px-4 pt-3.5">
              <SectionLabel hint="Next 24h" action={<AILabel>Predictions</AILabel>}>
                <span data-i18n-skip="true">{t('dashboard.section.headsUp')}</span>
              </SectionLabel>
            </div>
            {hkRisks.length === 0 ? (
              <div className="px-4 pb-4">
                <p className="text-[12px] text-ink3">No risk flags right now</p>
              </div>
            ) : (
              hkRisks.map((r: any, i: number) => {
                const room = r.rooms?.room_number ?? '—'
                const level = r.risk_level ?? 'risk'
                return (
                  <div key={i} className="flex gap-3 items-center px-4 py-3 border-t border-line-2">
                    <div className="w-10 h-10 rounded-[10px] bg-surface-2 border border-line-2 flex items-center justify-center shrink-0">
                      <Mono className="text-[13px] font-semibold text-ink">{room}</Mono>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-ink capitalize">{level} risk</span>
                    </div>
                  </div>
                )
              })
            )}
            <div className="px-4 pt-3 border-t border-line-2">
              <SectionLabel><span data-i18n-skip="true">{t('dashboard.section.myTasks')}</span></SectionLabel>
            </div>
            {tasksError ? (
              <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchTasks() }} />
            ) : tasks.length === 0 ? (
              <div data-i18n-skip="true">
                <StateBlock status="empty" empty={{ title: t('dashboard.empty.housekeeperNoTasks') }} />
              </div>
            ) : (
              tasks.map(t2 => (
                <Link
                  key={t2.id}
                  href="/tasks"
                  className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t2.priority === 'urgent' ? 'bg-[var(--alert)]' : 'bg-[var(--caution)]'}`} />
                  <p className="text-[13px] text-ink truncate flex-1">{t2.title}</p>
                  <Pill tone={t2.priority === 'urgent' ? 'alert' : 'caution'} size="sm">{t2.priority}</Pill>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <DashboardGreeting
        name={firstName}
        subtitle={
          rooms.length > 0
            ? `${rooms.length} rooms today, ${remaining} left.${done > 0 ? ` ${done} done.` : ''}`
            : 'No rooms assigned yet today.'
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Rooms today" value={totalRooms} delta={remaining > 0 ? `${remaining} left` : 'all done'} deltaTone={remaining > 0 ? 'info' : 'ready'} />
        <Stat label="Done" value={done} delta={done > 0 ? `+${done}` : '—'} deltaTone="ready" />
        <Stat label="Avg time" value="—" deltaTone="info" />
        <Stat label="Inspect now" value={inspectNow} delta={inspectNow > 0 ? 'pending' : 'none'} deltaTone={inspectNow > 0 ? 'caution' : 'ready'} />
      </div>

      {/* Queue + Predictions */}
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-5">
        {/* Room queue */}
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel
              hint="Today"
              action={
                <Link href="/housekeeping" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
                  Full board
                </Link>
              }
            >
              My queue
            </SectionLabel>
          </div>
          {isLoadingRooms ? (
            <div className="px-4 pb-4 space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-[58px] bg-surface-2 rounded-[10px] animate-pulse" />
              ))}
            </div>
          ) : rooms.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-[var(--ready-line)]" />
              <p className="text-[13px] text-ink3">No rooms assigned for today</p>
            </div>
          ) : (
            <div>
              {rooms.map((room: any, i: number) => {
                const roomNumber = room.rooms?.room_number ?? room.room_number ?? '—'
                const floor = room.rooms?.floor ?? room.floor
                const roomType = room.rooms?.room_types?.code ?? null
                const tone = STATUS_TONE[room.status] ?? 'neutral'
                const label = STATUS_LABEL[room.status] ?? room.status
                const isActive = i === 0
                const pillTone: PillTone = (tone as PillTone) ?? 'neutral'
                return (
                  <Link
                    key={room.room_id}
                    href="/housekeeping"
                    className={`flex items-start gap-3 px-4 py-3 border-t border-line-2 hover:bg-surface-2 transition-colors ${isActive ? 'bg-[var(--accent-soft)]' : ''}`}
                  >
                    <div className="w-11 h-11 rounded-[10px] bg-surface border border-line-2 flex flex-col items-center justify-center relative shrink-0">
                      <Mono className="text-[14px] font-semibold text-ink">{roomNumber}</Mono>
                      <StatusDot tone={tone} size={6} />
                      {isActive && (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center border-2 border-paper">1</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-medium text-ink">
                          {roomType ?? `Room ${roomNumber}`}
                          {floor ? ` · Floor ${floor}` : ''}
                        </span>
                        <Pill tone={pillTone} size="sm">{label}</Pill>
                        <span className="ml-auto font-mono text-[11px] text-ink3">
                          {isActive ? 'now' : i === 1 ? 'next up' : 'flex'}
                        </span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* AI predictions sidebar */}
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel hint="Next 24h" action={<AILabel>Predictions</AILabel>}>
              Heads up
            </SectionLabel>
          </div>
          {hkRisks.length === 0 ? (
            <div className="px-4 pb-4">
              <p className="text-[12px] text-ink3">No risk flags right now</p>
            </div>
          ) : (
            hkRisks.map((r: any, i: number) => {
              const room = r.rooms?.room_number ?? '—'
              const level = r.risk_level ?? 'risk'
              return (
                <div key={i} className="flex gap-3 items-center px-4 py-3 border-t border-line-2">
                  <div className="w-10 h-10 rounded-[10px] bg-surface-2 border border-line-2 flex items-center justify-center shrink-0">
                    <Mono className="text-[13px] font-semibold text-ink">{room}</Mono>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-ink capitalize">{level} risk</span>
                  </div>
                </div>
              )
            })
          )}
          {tasks.length > 0 && (
            <>
              <div className="px-4 pt-3 border-t border-line-2">
                <SectionLabel>My tasks</SectionLabel>
              </div>
              {tasks.map(t => (
                <Link key={t.id} href="/tasks" className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === 'urgent' ? 'bg-[var(--alert)]' : 'bg-[var(--caution)]'}`} />
                  <p className="text-[13px] text-ink truncate flex-1">{t.title}</p>
                  <Pill tone={t.priority === 'urgent' ? 'alert' : 'caution'} size="sm">{t.priority}</Pill>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
