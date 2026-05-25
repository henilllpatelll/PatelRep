'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { tasksApi } from '@/lib/api/tasks'
import { aiApi } from '@/lib/api/ai'
import { Stat, Pill, StatusDot, SectionLabel, Mono, AILabel } from '@/components/ui/primitives'

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'

interface MyRoom {
  room_id: string
  room_number: string
  floor?: number
  status: string
  room_type?: string
  notes?: string
}

const STATUS_TONE: Record<string, string> = {
  DIRTY: 'dirty', IN_PROGRESS: 'progress', CLEAN: 'clean',
  INSPECTED: 'inspected', OOO: 'ooo', PICKUP: 'pickup',
}

const STATUS_LABEL: Record<string, string> = {
  DIRTY: 'Vacant Dirty', IN_PROGRESS: 'In Progress',
  CLEAN: 'Clean ready for inspection', INSPECTED: 'Ready', OOO: 'OOO/OOS', PICKUP: 'Pickup',
}

type PillTone = 'dirty' | 'progress' | 'clean' | 'inspected' | 'ooo' | 'pickup' | 'accent' | 'alert' | 'caution' | 'info' | 'ready' | 'ai' | 'neutral'

export function HousekeeperDashboard() {
  const user = useAuthStore(s => s.user)
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
    'there'
  const firstName = fullName.includes('@') ? fullName.split('@')[0] : fullName.split(' ')[0] || fullName

  const { data: myRoomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['my-rooms', user?.id],
    queryFn: () => housekeepingApi.getMyRooms(),
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 10_000,
  })

  const { data: tasksData } = useQuery({
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

  const rooms: MyRoom[] = (myRoomsData as { data?: MyRoom[] })?.data ?? []
  const tasks = (tasksData as { data?: { id: string; title: string; priority: string; due_at?: string }[] })?.data ?? []
  const hkRisks = (alertsData?.data?.housekeeping_risks ?? []).slice(0, 3)

  const done = rooms.filter(r => r.status === 'INSPECTED').length
  const remaining = rooms.filter(r => r.status === 'DIRTY' || r.status === 'IN_PROGRESS').length
  const inspectNow = rooms.filter(r => r.status === 'CLEAN').length

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3" suppressHydrationWarning>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="font-display text-[34px] font-normal tracking-[-0.5px] leading-[1.05] text-ink mt-2">
          {greeting}, <em className="italic">{firstName}</em>.
        </h1>
        <p className="mt-2 text-[14px] text-ink2 leading-relaxed">
          {rooms.length > 0
            ? `${rooms.length} rooms today, ${remaining} left.${done > 0 ? ` ${done} done.` : ''}`
            : 'No rooms assigned yet today.'}
        </p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Rooms today" value={rooms.length} delta={remaining > 0 ? `${remaining} left` : 'all done'} deltaTone={remaining > 0 ? 'info' : 'ready'} />
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
          {roomsLoading ? (
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
              {rooms.map((room, i) => {
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
                      <Mono className="text-[14px] font-semibold text-ink">{room.room_number}</Mono>
                      <StatusDot tone={tone} size={6} />
                      {isActive && (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center border-2 border-paper">1</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-medium text-ink">
                          {room.room_type ?? `Room ${room.room_number}`}
                          {room.floor ? ` · Floor ${room.floor}` : ''}
                        </span>
                        <Pill tone={pillTone} size="sm">{label}</Pill>
                        <span className="ml-auto font-mono text-[11px] text-ink3">
                          {isActive ? 'now' : i === 1 ? 'next up' : 'flex'}
                        </span>
                      </div>
                      {room.notes && (
                        <p className="text-[12px] text-ink2 mt-1">{room.notes}</p>
                      )}
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
