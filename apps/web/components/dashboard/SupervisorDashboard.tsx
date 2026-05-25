'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { reportsApi } from '@/lib/api/reports'
import { aiApi } from '@/lib/api/ai'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { getSupervisorHousekeepingMetrics } from '@/lib/utils/housekeepingDashboardMetrics'
import { LiveOpsGrid } from './LiveOpsGrid'
import {
  Pill, Bar, Stat, SectionLabel, AILabel, Mono, StatusDot,
} from '@/components/ui/primitives'

// ── helpers ──────────────────────────────────────────────────────────────────

function avatarColor(name: string): string {
  const colors = [
    'bg-[var(--accent-soft)] text-[var(--accent)]',
    'bg-[var(--ready-soft)] text-[var(--ready)]',
    'bg-[var(--ai-soft)] text-[var(--ai)]',
    'bg-[var(--caution-soft)] text-[var(--caution)]',
    'bg-[var(--info-soft)] text-[var(--info)]',
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return colors[h % colors.length]
}

function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold shrink-0 ${avatarColor(name)}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </span>
  )
}

// ── StaffProgress ─────────────────────────────────────────────────────────────

interface HKRow {
  housekeeper_name?: string
  user_name?: string
  rooms_assigned?: number
  rooms_completed?: number
  avg_clean_minutes?: number
  risk?: boolean
}

function StaffProgress({ assignmentsData }: { assignmentsData: unknown }) {
  const rows: HKRow[] = (assignmentsData as any)?.data ?? []

  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
      <div className="px-4 pt-3.5">
        <SectionLabel
          hint={`${rows.length} on shift`}
          action={
            <Link href="/staff" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
              All staff
            </Link>
          }
        >
          Floor team
        </SectionLabel>
      </div>
      <div className="pb-2">
        {rows.length === 0 ? (
          <p className="text-[12px] text-ink3 px-4 py-3">No assignments today</p>
        ) : (
          rows.map((hk, i) => {
            const name = hk.housekeeper_name ?? hk.user_name ?? 'Staff'
            const done = hk.rooms_completed ?? 0
            const total = hk.rooms_assigned ?? 0
            const mins = hk.avg_clean_minutes
            const pace = total > 0 ? done / total : 0
            const isRisk = hk.risk || (pace < 0.4 && total > 0)
            return (
              <div
                key={i}
                className={`flex items-center gap-3 px-2.5 mx-1.5 rounded-lg py-2.5 ${i % 2 === 1 ? 'bg-surface-2' : ''}`}
              >
                <Avatar name={name} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink truncate">{name}</span>
                    {isRisk && <Pill tone="caution" size="sm">running over</Pill>}
                  </div>
                  {mins != null && (
                    <div className="text-[11px] text-ink3 mt-0.5">
                      <Mono>{mins}m avg</Mono>
                    </div>
                  )}
                </div>
                <div className="w-[110px] shrink-0">
                  <div className="flex justify-between text-[11px] text-ink3 mb-1">
                    <Mono>{done}/{total}</Mono>
                    <span>{total > 0 ? Math.round(pace * 100) : 0}%</span>
                  </div>
                  <Bar value={done} max={total || 1} tone={isRisk ? 'caution' : 'ready'} height={3} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── PredictionsWidget ─────────────────────────────────────────────────────────

type PillTone = 'caution' | 'alert' | 'pickup' | 'info' | 'ready' | 'accent' | 'ai' | 'neutral' | 'dirty' | 'progress' | 'clean' | 'inspected' | 'ooo'

function PredictionsWidget({ risks }: { risks: any[] }) {
  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
      <div className="px-4 pt-3.5">
        <SectionLabel
          hint="Next 24h"
          action={<AILabel>Predictions</AILabel>}
        >
          What needs attention
        </SectionLabel>
      </div>
      {risks.length === 0 ? (
        <p className="text-[12px] text-ink3 px-4 pb-4">No risk flags right now</p>
      ) : (
        risks.slice(0, 5).map((r: any, i: number) => {
          const room = r.rooms?.room_number ?? r.room_number ?? '—'
          const level = r.risk_level ?? r.risk_type ?? 'risk'
          const score = r.risk_score ?? r.confidence
          const tone: PillTone = level === 'high' || level === 'urgent' ? 'alert' : level === 'medium' ? 'caution' : 'pickup'
          return (
            <div
              key={i}
              className="flex gap-3 items-center px-4 py-3 border-t border-line-2"
            >
              <div className="w-11 h-11 rounded-[10px] bg-surface-2 border border-line-2 flex flex-col items-center justify-center shrink-0">
                <Mono className="text-[14px] font-semibold text-ink">{room}</Mono>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink capitalize">{level} risk</span>
                  {score != null && <Pill tone={tone} size="sm">{score}%</Pill>}
                </div>
                {r.detail && (
                  <div className="text-[12px] text-ink3 mt-0.5 truncate">{r.detail}</div>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── RoomGridMini ──────────────────────────────────────────────────────────────

const CELL_MAP: Record<string, { bg: string; border: string; striped?: boolean; glyph?: string }> = {
  INSPECTED:   { bg: 'var(--ready-soft)',   border: 'var(--ready-line)' },
  CLEAN:       { bg: 'var(--info-soft)',    border: 'var(--info-line)' },
  DIRTY:       { bg: 'var(--alert-soft)',   border: 'var(--alert-line)' },
  IN_PROGRESS: { bg: 'var(--progress-soft)', border: 'var(--progress-line)' },
  OCCUPIED:    { bg: 'var(--alert-soft)',   border: 'var(--alert-line)', striped: true },
  PICKUP:      { bg: 'var(--caution-soft)', border: 'var(--caution-line)' },
  OOO:         { bg: 'var(--accent-soft)',  border: 'var(--accent-line)', glyph: '×' },
}

const STATUS_LABEL_MAP: Record<string, string> = {
  INSPECTED: 'Ready', CLEAN: 'Clean ready for inspection', DIRTY: 'Vacant Dirty',
  IN_PROGRESS: 'In Progress', OCCUPIED: 'Occupied', PICKUP: 'Pickup', OOO: 'Out of order / out of service',
}

function RoomGridMini({ boardData }: { boardData: unknown }) {
  const rooms: any[] = (boardData as any)?.data ?? []

  const floors = Array.from(new Set(rooms.map((r: any) => r.floor ?? r.rooms?.floor ?? 1))).sort()

  if (rooms.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-[var(--r-lg)] p-4 shadow-card">
        <SectionLabel hint="—">Room map</SectionLabel>
        <p className="text-[12px] text-ink3 py-2">No room data loaded</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
      <div className="px-4 pt-3.5">
        <SectionLabel
          hint={`${rooms.length} rooms`}
          action={
            <Link href="/housekeeping" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
              Open board
            </Link>
          }
        >
          Room map
        </SectionLabel>
      </div>
      <div className="px-4 pb-4 flex flex-col gap-3.5">
        {floors.map(f => {
          const floorRooms = rooms.filter((r: any) => (r.floor ?? r.rooms?.floor ?? 1) === f)
          return (
            <div key={f}>
              <div className="flex items-center gap-2 text-[10.5px] text-ink3 font-semibold uppercase tracking-[0.08em] mb-1.5">
                <span>Floor {f}</span>
                <span className="flex-1 border-t border-dashed border-line-2" />
                <Mono>{floorRooms.length} rooms</Mono>
              </div>
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(28px, 1fr))' }}
              >
                {floorRooms.map((r: any) => {
                  const status: string = r.status ?? 'INSPECTED'
                  const cell = CELL_MAP[status] ?? CELL_MAP.INSPECTED
                  const roomNum = r.room_number ?? r.rooms?.room_number ?? '?'
                  const shortNum = String(roomNum).replace(/^\d{1,2}0*/, '')
                  return (
                    <div
                      key={r.room_id ?? r.id ?? roomNum}
                      title={`${roomNum} · ${STATUS_LABEL_MAP[status] ?? status}`}
                      className="h-[22px] rounded-[4px] flex items-center justify-center text-[9px] font-mono leading-none"
                      style={{
                        background: cell.striped
                          ? 'repeating-linear-gradient(135deg, var(--alert-soft) 0 4px, color-mix(in srgb, var(--alert) 25%, var(--surface)) 4px 8px)'
                          : cell.bg,
                        border: `1px solid ${cell.border}`,
                        color: 'var(--ink-3)',
                      }}
                    >
                      {cell.glyph ?? shortNum}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-line-2 flex flex-wrap gap-3 text-[11px] text-ink3">
        {[
          { l: 'Ready',        bg: 'var(--ready-soft)',   bd: 'var(--ready-line)' },
          { l: 'Clean inspect', bg: 'var(--info-soft)',   bd: 'var(--info-line)' },
          { l: 'Vacant Dirty', bg: 'var(--alert-soft)',   bd: 'var(--alert-line)' },
          { l: 'In Progress',  bg: 'var(--progress-soft)', bd: 'var(--progress-line)' },
          { l: 'Occupied',     striped: true,              bd: 'var(--alert-line)' },
          { l: 'Pickup',       bg: 'var(--caution-soft)', bd: 'var(--caution-line)' },
          { l: 'OOO/OOS',      bg: 'var(--accent-soft)',  bd: 'var(--accent-line)', glyph: '×' },
        ].map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span
              className="w-3.5 h-3.5 rounded-[3px] inline-flex items-center justify-center text-[8px] font-mono shrink-0"
              style={{
                background: (it as any).striped
                  ? 'repeating-linear-gradient(135deg, var(--alert-soft) 0 3px, color-mix(in srgb, var(--alert) 25%, var(--surface)) 3px 6px)'
                  : (it as any).bg,
                border: `1px solid ${it.bd}`,
                color: 'var(--ink-4)',
              }}
            >
              {(it as any).glyph}
            </span>
            {it.l}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── ActivityFeed ──────────────────────────────────────────────────────────────

function ActivityFeed({ requests, tasks, risks }: { requests: GuestRequest[]; tasks: Task[]; risks: any[] }) {
  type FeedTone = 'ready' | 'ai' | 'accent' | 'alert' | 'neutral'
  interface FeedItem { t: string; who: string; what: string; tgt: string; tone: FeedTone }

  const items: FeedItem[] = []

  for (const r of requests.slice(0, 3)) {
    const time = format(new Date(r.created_at), 'HH:mm')
    const room = (r as any).rooms?.room_number ? ` · ${(r as any).rooms.room_number}` : ''
    items.push({ t: time, who: 'Front desk', what: 'requested', tgt: `${r.title}${room}`, tone: 'accent' })
  }
  for (const t of tasks.slice(0, 2)) {
    const time = t.created_at ? format(new Date(t.created_at), 'HH:mm') : '--:--'
    items.push({ t: time, who: t.title, what: 'task open', tgt: t.priority, tone: t.priority === 'urgent' ? 'alert' : 'neutral' })
  }
  for (const r of risks.slice(0, 2)) {
    const room = r.rooms?.room_number ?? '—'
    items.push({ t: '—', who: 'AI', what: 'flagged', tgt: `Room ${room} — ${r.risk_level ?? 'risk'}`, tone: 'ai' })
  }

  const sorted = items.sort((a, b) => (b.t > a.t ? 1 : -1)).slice(0, 6)

  const toneClasses: Record<FeedTone, { bg: string; fg: string }> = {
    ready:   { bg: 'bg-[var(--ready-soft)]',   fg: 'text-[var(--ready)]' },
    ai:      { bg: 'bg-[var(--ai-soft)]',       fg: 'text-[var(--ai)]' },
    accent:  { bg: 'bg-[var(--accent-soft)]',   fg: 'text-[var(--accent)]' },
    alert:   { bg: 'bg-[var(--alert-soft)]',    fg: 'text-[var(--alert)]' },
    neutral: { bg: 'bg-surface-3',              fg: 'text-ink3' },
  }

  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
      <div className="px-4 pt-3.5 pb-3">
        <SectionLabel
          hint="Last hour"
          action={
            <Link href="/logbook" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
              View all
            </Link>
          }
        >
          Activity
        </SectionLabel>
      </div>
      <div className="px-4 pb-3.5">
        {sorted.length === 0 ? (
          <p className="text-[12px] text-ink3 py-2">No recent activity</p>
        ) : (
          sorted.map((e, i) => {
            const tc = toneClasses[e.tone]
            return (
              <div
                key={i}
                className={`flex gap-2.5 items-start py-3 ${i < sorted.length - 1 ? 'border-b border-dashed border-line-2' : ''}`}
              >
                <Mono className="text-[10.5px] text-ink3 min-w-[38px] mt-0.5">{e.t}</Mono>
                <span className={`w-[22px] h-[22px] rounded-[6px] shrink-0 flex items-center justify-center text-[10px] ${tc.bg} ${tc.fg}`}>
                  {e.tone === 'ai' ? '✦' : e.tone === 'accent' ? '○' : e.tone === 'alert' ? '!' : '✓'}
                </span>
                <p className="text-[12.5px] text-ink2 leading-[1.4] flex-1">
                  <strong className="text-ink">{e.who}</strong>{' '}{e.what}{' '}
                  <span className="text-ink">{e.tgt}</span>
                </p>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── SupervisorDashboard ───────────────────────────────────────────────────────

export function SupervisorDashboard() {
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
    'Supervisor'
  const firstName = fullName.includes('@') ? fullName.split('@')[0] : fullName.split(' ')[0] || fullName

  const { data: summaryData } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 60_000,
  })

  const { data: alertsData } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 120_000,
  })

  const { data: requestsData } = useQuery({
    queryKey: ['guest-requests-open'],
    queryFn: () => guestRequestsApi.listRequests({ status: 'open', per_page: 6 }),
    refetchInterval: 60_000,
  })

  const { data: tasksData } = useQuery({
    queryKey: ['tasks', { status: 'open' }],
    queryFn: () => tasksApi.list({ status: 'open', per_page: 6 }),
    refetchInterval: 60_000,
  })

  const todayISO = format(new Date(), 'yyyy-MM-dd')

  const { data: assignmentsData } = useQuery({
    queryKey: ['hk-assignments-today', todayISO],
    queryFn: () => housekeepingApi.getAssignments(todayISO),
    staleTime: 0,
    refetchInterval: 10_000,
  })

  const { data: boardData } = useQuery({
    queryKey: ['housekeeping-board', todayISO],
    queryFn: () => housekeepingApi.getBoard(todayISO, undefined, false),
    staleTime: 0,
    refetchInterval: 10_000,
  })

  const summary = summaryData?.data
  const breakdown = summary?.room_status_breakdown ?? {}
  const alerts = alertsData?.data
  const hkRisks = alerts?.housekeeping_risks ?? []
  const openRequests: GuestRequest[] = (requestsData as { data?: GuestRequest[] })?.data ?? []
  const openTasks: Task[] = (tasksData as { data?: Task[] })?.data ?? []

  const {
    totalRooms,
    assignedTotal,
    cleanPending,
    inspectedPct,
  } = getSupervisorHousekeepingMetrics(boardData, breakdown)

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3" suppressHydrationWarning>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
          <h1 className="font-display text-[34px] font-normal tracking-[-0.5px] leading-[1.05] text-ink mt-2">
            {greeting}, <em className="italic">{firstName}</em>.
          </h1>
          <p className="mt-2.5 text-[14px] text-ink2 max-w-[580px] leading-relaxed">
            {hkRisks.length > 0
              ? `${hkRisks.length} room${hkRisks.length > 1 ? 's' : ''} flagged. ${cleanPending > 0 ? `${cleanPending} ready for inspection.` : 'Inspections up to date.'}`
              : cleanPending > 0
              ? `${cleanPending} room${cleanPending > 1 ? 's' : ''} ready for inspection. Housekeeping on track.`
              : 'All rooms accounted for. Good start to the shift.'
            }
          </p>
        </div>
        <div className="flex gap-2 pb-1 shrink-0">
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-ink text-paper text-[12px] font-semibold rounded-[var(--r-md)] hover:opacity-90 transition-opacity"
          >
            New task
          </Link>
        </div>
      </div>

      {/* Morning briefing */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] overflow-hidden bg-surface border border-line rounded-[var(--r-xl)] min-h-[200px] shadow-card">
          <div className="p-6 flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              <AILabel confidence={91}>Morning briefing</AILabel>
              <span className="text-[11px] font-mono text-ink3">
                Generated {format(new Date(), 'h:mm a')} · Sonnet 3.5
              </span>
            </div>
            <p className="font-display italic text-[20px] leading-[1.35] text-ink tracking-[-0.2px] flex-1">
              {hkRisks.length > 0
                ? <>
                    <span className="not-italic font-sans font-medium bg-[var(--caution-soft)] px-1.5 py-px rounded">{hkRisks.length} rooms flagged</span>
                    {' '}at risk. {cleanPending > 0 ? `${cleanPending} rooms clean and waiting for inspection.` : 'Inspections up to date.'}
                  </>
                : cleanPending > 0
                ? `${cleanPending} room${cleanPending > 1 ? 's' : ''} ready for inspection. Housekeeping on track.`
                : 'All rooms accounted for. Good start to the shift.'
              }
            </p>
            <div className="flex items-center gap-2 mt-auto">
              <Link
                href="/housekeeping"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-accent text-white text-[12px] font-semibold rounded-[var(--r-md)] hover:opacity-90 transition-opacity"
              >
                View board
              </Link>
            </div>
          </div>
          <div className="bg-ink text-paper p-6 flex flex-col gap-2.5 relative overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(circle at 80% 20%, var(--accent) 0%, transparent 50%)', opacity: 0.25 }}
            />
            <p className="text-[10px] uppercase tracking-[1.4px] opacity-60 relative">Right now</p>
            <div className="flex flex-col gap-2.5 relative">
              {[
                { label: 'Total rooms', value: totalRooms },
                { label: 'Assigned',    value: assignedTotal },
                { label: 'To inspect',  value: cleanPending },
                { label: 'Ready',       value: `${inspectedPct}%` },
              ].map(({ label, value }, i) => (
                <div key={label} className={`flex items-baseline gap-2.5 ${i < 3 ? 'border-b border-white/10 pb-2.5' : ''}`}>
                  <span className="text-[11px] opacity-60 flex-1 uppercase tracking-[0.5px]">{label}</span>
                  <span className="font-mono text-[17px] font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total Rooms" value={totalRooms} />
        <Stat label="Assigned" value={assignedTotal} deltaTone={assignedTotal > 0 ? 'caution' : 'ready'} />
        <Stat label="To Inspect" value={cleanPending} deltaTone={cleanPending > 0 ? 'info' : 'ready'} />
        <Stat label="Ready" value={`${inspectedPct}%`} deltaTone="ready" />
      </div>

      {/* Live ops strip */}
      <LiveOpsGrid />

      {/* Staff progress + Predictions */}
      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-5">
        <StaffProgress assignmentsData={assignmentsData} />
        <PredictionsWidget risks={hkRisks} />
      </div>

      {/* Room grid + Activity feed */}
      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-5">
        <RoomGridMini boardData={boardData} />
        <ActivityFeed requests={openRequests} tasks={openTasks} risks={hkRisks} />
      </div>
    </div>
  )
}
