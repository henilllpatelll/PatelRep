'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Send, X, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { reportsApi } from '@/lib/api/reports'
import { aiApi } from '@/lib/api/ai'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { notificationsApi } from '@/lib/api/notifications'
import { getSupervisorHousekeepingMetrics } from '@/lib/utils/housekeepingDashboardMetrics'
import { LiveOpsGrid } from './LiveOpsGrid'
import {
  Pill, Bar, Stat, SectionLabel, AILabel, Mono, StatusDot,
} from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { DashboardGreeting } from './DashboardGreeting'
import { Button, IconButton } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

// ── BroadcastModal ────────────────────────────────────────────────────────────

const QUICK_MESSAGES = [
  'Prioritize departures first — VIP arrivals this afternoon.',
  'All rooms Floor 3 are priority — VIP check-in at 2 PM.',
  'Team meeting at the front desk in 15 minutes.',
  'Please report any maintenance issues to the supervisor.',
]

function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const { mutate, isPending } = useMutation({
    mutationFn: (msg: string) => notificationsApi.broadcast(msg),
    onSuccess: () => setSent(true),
  })

  function handleSend(msg: string) {
    const trimmed = msg.trim()
    if (!trimmed) return
    mutate(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-surface border border-line rounded-[var(--r-xl)] shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center">
              <Megaphone className="w-4 h-4 text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-ink">Team broadcast</p>
              <p className="text-[11px] text-ink3">All housekeeping staff on shift</p>
            </div>
          </div>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="text-ink3 hover:text-ink"><X size={16} /></IconButton>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-3 py-10 px-5">
            <div className="w-10 h-10 rounded-full bg-[var(--ready-soft)] flex items-center justify-center">
              <Check className="w-5 h-5 text-[var(--ready)]" />
            </div>
            <p className="text-[14px] font-semibold text-ink">Message sent</p>
            <p className="text-[12px] text-ink3 text-center">Your team will see this in their notifications.</p>
            <Button variant="outline" onClick={onClose} className="mt-2">
              Close
            </Button>
          </div>
        ) : (
          <div className="px-5 pb-5 flex flex-col gap-3">
            {/* Quick messages */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium text-ink3 uppercase tracking-[0.08em]">Quick messages</p>
              {QUICK_MESSAGES.map((m, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(m)}
                  disabled={isPending}
                  className="text-left px-3 py-2.5 bg-surface-2 border border-line rounded-lg text-[12.5px] text-ink2 hover:border-[var(--accent-line)] hover:text-ink hover:bg-[var(--accent-soft)] transition-colors disabled:opacity-50"
                >
                  {m}
                </button>
              ))}
            </div>
            {/* Free text */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium text-ink3 uppercase tracking-[0.08em]">Custom message</p>
              <div className="flex gap-2">
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Type a message to all housekeeping staff…"
                  rows={2}
                  className="flex-1 resize-none px-3 py-2.5 border border-line rounded-lg text-[13px] bg-surface text-ink placeholder:text-ink4 focus:outline-none focus:border-[var(--accent-line)] transition-colors"
                />
                <Button
                  variant="primary"
                  loading={isPending}
                  disabled={!text.trim()}
                  onClick={() => handleSend(text)}
                  className="self-end gap-1.5"
                >
                  <Send size={13} />
                  Send
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

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
  housekeeper_id?: string
  name?: string
  housekeeper_name?: string
  user_name?: string
  rooms_assigned?: number
  rooms_done?: number
  rooms_completed?: number
  in_progress?: number
  avg_clean_minutes?: number
  risk?: boolean
}

function StaffProgress({ assignmentsData, v2 }: { assignmentsData: unknown; v2?: boolean }) {
  const { t } = useTranslation()
  const rows: HKRow[] = (assignmentsData as any)?.data ?? []
  const [shiftPct, setShiftPct] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const compute = () => {
      const now = new Date()
      const elapsed = Math.max(0, now.getHours() - 8 + now.getMinutes() / 60)
      setShiftPct(Math.min(1, elapsed / 8))
    }
    compute()
    intervalRef.current = setInterval(compute, 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return (
    <div className={cn('bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card', v2 && 'transition-shadow duration-base ease-standard')}>
      <div className="px-4 pt-3.5" data-i18n-skip={v2 ? 'true' : undefined}>
        <SectionLabel
          hint={`${rows.length} on shift`}
          action={
            <Link
              href="/staff"
              className={cn(
                'text-[11px] font-medium text-ink3 hover:text-ink transition-colors',
                v2 && 'duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm'
              )}
            >
              All staff
            </Link>
          }
        >
          {v2 ? t('dashboard.section.teamOverview') : 'Floor team'}
        </SectionLabel>
      </div>
      <div className="pb-2">
        {rows.length === 0 ? (
          <p className="text-[12px] text-ink3 px-4 py-3">No assignments today</p>
        ) : (
          rows.map((hk, i) => {
            const name = hk.name ?? hk.housekeeper_name ?? hk.user_name ?? 'Staff'
            const done = hk.rooms_done ?? hk.rooms_completed ?? 0
            const inProgress = hk.in_progress ?? 0
            const total = hk.rooms_assigned ?? 0
            const pace = total > 0 ? done / total : 0
            const paceGap = pace - shiftPct
            const isBehind = shiftPct > 0.25 && paceGap < -0.12 && total > 0
            const isAhead = paceGap > 0.12 && total > 0
            return (
              <div
                key={i}
                className={`flex items-center gap-3 px-2.5 mx-1.5 rounded-lg py-2.5 ${i % 2 === 1 ? 'bg-surface-2' : ''}`}
              >
                <Avatar name={name} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium text-ink truncate">{name}</span>
                    {inProgress > 0 && <Pill tone="progress" size="sm">cleaning now</Pill>}
                    {isBehind && <Pill tone="caution" size="sm">behind</Pill>}
                    {isAhead && <Pill tone="ready" size="sm">ahead</Pill>}
                  </div>
                </div>
                <div className="w-[110px] shrink-0">
                  <div className="flex justify-between text-[11px] text-ink3 mb-1">
                    <Mono>{done}/{total}</Mono>
                    <span>{total > 0 ? Math.round(pace * 100) : 0}%</span>
                  </div>
                  <Bar value={done} max={total || 1} tone={isBehind ? 'caution' : 'ready'} height={3} />
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

function PredictionsWidget({ risks, v2, isError, onRetry }: { risks: any[]; v2?: boolean; isError?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className={cn('bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card', v2 && 'transition-shadow duration-base ease-standard')}>
      <div className="px-4 pt-3.5" data-i18n-skip={v2 ? 'true' : undefined}>
        <SectionLabel
          hint="Next 24h"
          action={<AILabel>Predictions</AILabel>}
        >
          {v2 ? t('dashboard.section.atRiskRooms') : 'What needs attention'}
        </SectionLabel>
      </div>
      {v2 && isError ? (
        <StateBlock status="error" error={{ message: t('common.error'), onRetry }} className="pb-4" />
      ) : risks.length === 0 ? (
        v2 ? (
          <div data-i18n-skip="true">
            <StateBlock status="empty" empty={{ title: t('dashboard.empty.supervisorNoAlerts') }} className="pb-4" />
          </div>
        ) : (
          <p className="text-[12px] text-ink3 px-4 pb-4">No risk flags right now</p>
        )
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
  OOO:         { bg: 'var(--blocked-soft)', border: 'var(--blocked-line)', glyph: '×' },
}

const STATUS_LABEL_MAP: Record<string, string> = {
  INSPECTED: 'Inspected', CLEAN: 'Clean ready for inspection', DIRTY: 'Vacant Dirty',
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
          { l: 'Inspected',    bg: 'var(--ready-soft)',   bd: 'var(--ready-line)' },
          { l: 'Clean inspect', bg: 'var(--info-soft)',   bd: 'var(--info-line)' },
          { l: 'Vacant Dirty', bg: 'var(--alert-soft)',   bd: 'var(--alert-line)' },
          { l: 'In Progress',  bg: 'var(--progress-soft)', bd: 'var(--progress-line)' },
          { l: 'Occupied',     striped: true,              bd: 'var(--alert-line)' },
          { l: 'Pickup',       bg: 'var(--caution-soft)', bd: 'var(--caution-line)' },
          { l: 'OOO/OOS',      bg: 'var(--blocked-soft)', bd: 'var(--blocked-line)', glyph: '×' },
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

function ActivityFeed({ requests, tasks, risks, v2, isError, onRetry }: { requests: GuestRequest[]; tasks: Task[]; risks: any[]; v2?: boolean; isError?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation()
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
    <div className={cn('bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card', v2 && 'transition-shadow duration-base ease-standard')}>
      <div className="px-4 pt-3.5 pb-3">
        <SectionLabel
          hint="Last hour"
          action={
            <Link
              href="/logbook"
              className={cn(
                'text-[11px] font-medium text-ink3 hover:text-ink transition-colors',
                v2 && 'duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm'
              )}
            >
              View all
            </Link>
          }
        >
          Activity
        </SectionLabel>
      </div>
      <div className="px-4 pb-3.5">
        {v2 && isError ? (
          <StateBlock status="error" error={{ message: t('common.error'), onRetry }} />
        ) : sorted.length === 0 ? (
          v2 ? (
            <div data-i18n-skip="true">
              <StateBlock status="empty" empty={{ title: t('dashboard.empty.supervisorNoRequests') }} />
            </div>
          ) : (
            <p className="text-[12px] text-ink3 py-2">No recent activity</p>
          )
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
  const { t } = useTranslation()
  const hotel = useHotelStore(s => s.hotel)
  const v2 = isSectionRedesigned('dashboard', hotel)
  const storedFullName = useAuthStore(s => s.fullName)
  const user = useAuthStore(s => s.user)
  const [broadcastOpen, setBroadcastOpen] = useState(false)

  const firstName = storedFullName
    ? storedFullName.split(' ')[0] || 'Supervisor'
    : (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'Supervisor'

  const { data: summaryData, isError: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 60_000,
  })

  const { data: alertsData, isError: alertsError, refetch: refetchAlerts } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 120_000,
  })

  const { data: requestsData, isError: requestsError, refetch: refetchRequests } = useQuery({
    queryKey: ['guest-requests-open'],
    queryFn: () => guestRequestsApi.listRequests({ status: 'open', per_page: 6 }),
    refetchInterval: 60_000,
  })

  const { data: tasksData, isError: tasksError, refetch: refetchTasks } = useQuery({
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

  const { data: boardData, isLoading: boardLoading, isError: boardError, refetch: refetchBoard } = useQuery({
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

  if (!v2) {
  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex items-end justify-between gap-6">
        <div>
          <DashboardGreeting
            name={firstName}
            subtitle={
              hkRisks.length > 0
                ? `${hkRisks.length} room${hkRisks.length > 1 ? 's' : ''} flagged. ${cleanPending > 0 ? `${cleanPending} ready for inspection.` : 'Inspections up to date.'}`
                : cleanPending > 0
                ? `${cleanPending} room${cleanPending > 1 ? 's' : ''} ready for inspection. Housekeeping on track.`
                : 'All rooms accounted for. Good start to the shift.'
            }
          />
        </div>
        <div className="flex gap-2 pb-1 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setBroadcastOpen(true)} className="gap-1.5">
            <Megaphone size={13} />
            Broadcast
          </Button>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-ink text-paper text-[12px] font-semibold rounded-[var(--r-md)] hover:opacity-90 transition-opacity"
          >
            New task
          </Link>
        </div>
      </div>
      {broadcastOpen && <BroadcastModal onClose={() => setBroadcastOpen(false)} />}

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
                { label: 'Inspected',   value: `${inspectedPct}%` },
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
        {boardLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-3 rounded-[var(--r-lg)] animate-pulse" />
          ))
        ) : (
          <>
            <Stat label="Total Rooms" value={totalRooms} />
            <Stat label="Assigned" value={assignedTotal} deltaTone={assignedTotal > 0 ? 'caution' : 'ready'} />
            <Stat label="To Inspect" value={cleanPending} deltaTone={cleanPending > 0 ? 'info' : 'ready'} />
            <Stat label="Inspected" value={`${inspectedPct}%`} deltaTone="ready" />
          </>
        )}
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

  // ── v2 branch ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex items-end justify-between gap-6">
        <div>
          <DashboardGreeting
            name={firstName}
            subtitle={
              hkRisks.length > 0
                ? `${hkRisks.length} room${hkRisks.length > 1 ? 's' : ''} flagged. ${cleanPending > 0 ? `${cleanPending} ready for inspection.` : 'Inspections up to date.'}`
                : cleanPending > 0
                ? `${cleanPending} room${cleanPending > 1 ? 's' : ''} ready for inspection. Housekeeping on track.`
                : 'All rooms accounted for. Good start to the shift.'
            }
          />
        </div>
        <div className="flex gap-2 pb-1 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBroadcastOpen(true)}
            className="gap-1.5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <Megaphone size={13} />
            Broadcast
          </Button>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand text-brand-ink text-[12px] font-semibold rounded-[var(--r-md)] transition-colors duration-fast ease-standard hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            New task
          </Link>
        </div>
      </div>
      {broadcastOpen && <BroadcastModal onClose={() => setBroadcastOpen(false)} />}

      {/* Morning briefing */}
      {summaryError ? (
        <div className="bg-surface border border-line rounded-[var(--r-xl)] shadow-card">
          <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchSummary() }} />
        </div>
      ) : summary && (
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] overflow-hidden bg-surface border border-line rounded-[var(--r-xl)] min-h-[200px] shadow-card transition-shadow duration-base ease-standard">
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand text-brand-ink text-[12px] font-semibold rounded-[var(--r-md)] transition-colors duration-fast ease-standard hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                View board
              </Link>
            </div>
          </div>
          <div className="bg-ink text-paper p-6 flex flex-col gap-2.5 relative overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(circle at 80% 20%, var(--brand) 0%, transparent 50%)', opacity: 0.25 }}
            />
            <p className="text-[10px] uppercase tracking-[1.4px] opacity-60 relative">Right now</p>
            <div className="flex flex-col gap-2.5 relative">
              {[
                { label: 'Total rooms', value: totalRooms },
                { label: 'Assigned',    value: assignedTotal },
                { label: 'To inspect',  value: cleanPending },
                { label: 'Inspected',   value: `${inspectedPct}%` },
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
      {boardError ? (
        <StateBlock
          status="error"
          error={{ message: t('common.error'), onRetry: () => refetchBoard() }}
          className="bg-surface border border-line rounded-[var(--r-lg)]"
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {boardLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface border border-line rounded-[var(--r-lg)] p-[14px_16px] flex flex-col gap-2 min-h-[96px] animate-pulse"
              >
                <div className="h-2.5 w-16 bg-surface-3 rounded" />
                <div className="h-6 w-10 bg-surface-3 rounded mt-1" />
                <div className="h-3 w-12 bg-surface-3 rounded mt-auto" />
              </div>
            ))
          ) : (
            <>
              <Stat label="Total Rooms" value={totalRooms} />
              <Stat label="Assigned" value={assignedTotal} deltaTone={assignedTotal > 0 ? 'caution' : 'ready'} />
              <Stat label="To Inspect" value={cleanPending} deltaTone={cleanPending > 0 ? 'info' : 'ready'} />
              <Stat label="Inspected" value={`${inspectedPct}%`} deltaTone="ready" />
            </>
          )}
        </div>
      )}

      {/* Live ops strip */}
      <LiveOpsGrid />

      {/* Staff progress + Predictions */}
      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-5">
        <StaffProgress assignmentsData={assignmentsData} v2 />
        <PredictionsWidget risks={hkRisks} v2 isError={alertsError} onRetry={() => refetchAlerts()} />
      </div>

      {/* Room grid + Activity feed */}
      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-5">
        <RoomGridMini boardData={boardData} />
        <ActivityFeed
          requests={openRequests}
          tasks={openTasks}
          risks={hkRisks}
          v2
          isError={requestsError || tasksError}
          onRetry={() => { refetchRequests(); refetchTasks() }}
        />
      </div>
    </div>
  )
}
