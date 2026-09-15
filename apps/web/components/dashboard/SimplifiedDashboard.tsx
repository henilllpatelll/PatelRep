'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Plus, MessageSquare, UserPlus, X, ChevronRight, AlertTriangle, CheckCircle2, ArrowUpDown } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { useEngineeringStore } from '@/stores/engineeringStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi, type WorkOrder } from '@/lib/api/engineering'
import { aiApi } from '@/lib/api/ai'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { notificationsApi } from '@/lib/api/notifications'
import { getCleanTypeShortLabel } from '@/lib/utils/cleanType'
import { Avatar, Pill, Bar, SectionLabel, AILabel, Mono, SparkIcon } from '@/components/ui/primitives'
import { Button, IconButton } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'
import { DashboardGreeting } from './DashboardGreeting'
import { BriefingChat } from './BriefingChat'
import type { BriefingBoardStats } from '@/lib/ai/briefingFastPath'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { WorkOrderDetailDrawer } from '@/components/engineering/WorkOrderDetailDrawer'
import { CreateWorkOrderModal } from '@/components/engineering/CreateWorkOrderModal'
import { cn } from '@/lib/utils'

// ── Room status → pill/tile styling (matches STATUS_LABEL_MAP in the housekeeping board) ──

type StatKey = 'all' | 'OCCUPIED' | 'DEPARTURE' | 'VACANT'

const ROOM_PILL: Record<string, { tone: any; label: string }> = {
  INSPECTED: { tone: 'inspected', label: 'Inspected' },
  CLEAN: { tone: 'clean', label: 'Clean ready for inspection' },
  DIRTY: { tone: 'dirty', label: 'Vacant Dirty' },
  IN_PROGRESS: { tone: 'progress', label: 'In progress' },
  OCCUPIED: { tone: 'alert', label: 'Occupied' },
  PICKUP: { tone: 'pickup', label: 'Pickup' },
  OOO: { tone: 'blocked', label: 'OOO' },
}

// Thin status-bar color per room-status tone for the "pick a room" list — the
// same hash-frozen room-status CSS vars used everywhere else (never a new hue).
const ROOM_BAR_COLOR: Record<string, string> = {
  inspected: 'var(--ready)',
  clean: 'var(--info)',
  dirty: 'var(--alert)',
  progress: 'var(--progress)',
  alert: 'var(--alert)',
  pickup: 'var(--caution)',
  blocked: 'var(--blocked)',
  neutral: 'var(--line-2)',
}

const OCCUPANCY_TILE_LABEL: Record<StatKey, string> = {
  all: 'All rooms',
  OCCUPIED: 'Occupied',
  DEPARTURE: 'Departure',
  VACANT: 'Vacant',
}

/**
 * Front-desk occupancy bucket for a housekeeping board row. `clean_type === 'DEP'`
 * is the real proxy for "checking out" — assigned specifically to departure rooms
 * regardless of whether the guest has physically left yet (see cleanType.ts).
 * PICKUP status means a stayover clean (Full/Light) is queued while the guest
 * is still in the room, so it counts as occupied too — Vacant must only ever
 * mean nobody is in the room.
 */
function classifyOccupancy(room: any): 'OCCUPIED' | 'DEPARTURE' | 'VACANT' {
  if (room.clean_type === 'DEP') return 'DEPARTURE'
  if (room.status === 'OCCUPIED' || room.status === 'PICKUP') return 'OCCUPIED'
  return 'VACANT'
}

/**
 * Human-readable coverage label for a set of floor numbers — "Floor 3",
 * "Floors 1–2" (contiguous), or "Floors 1, 3" (gapped). Powers the per-staff
 * area line, derived from the floors of the rooms/work orders on their plate.
 */
function summarizeFloors(floors: number[]): string {
  const uniq = Array.from(new Set(floors.filter((f) => f != null))).sort((a, b) => a - b)
  if (uniq.length === 0) return ''
  if (uniq.length === 1) return `Floor ${uniq[0]}`
  const contiguous = uniq.every((f, i) => i === 0 || f === uniq[i - 1] + 1)
  return contiguous ? `Floors ${uniq[0]}–${uniq[uniq.length - 1]}` : `Floors ${uniq.join(', ')}`
}

const PRIORITY_PILL: Record<string, any> = {
  emergency: 'alert',
  urgent: 'alert',
  normal: 'caution',
  low: 'neutral',
}

// ── Message composer (real backend: POST /notifications/direct) ───────────────

function MessageButton({ recipientId, recipientName }: { recipientId?: string | null; recipientName: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const toast = useToast()
  const { mutate, isPending } = useMutation({
    mutationFn: () => notificationsApi.sendDirect(recipientId as string, text.trim()),
    onSuccess: () => {
      toast.success(`Message sent to ${recipientName}`)
      setOpen(false)
      setText('')
    },
    onError: () => toast.error('Could not send message'),
  })

  if (!recipientId) return null

  return (
    <div className="relative">
      <IconButton
        variant="ghost"
        size="sm"
        aria-label={`Message ${recipientName}`}
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-[var(--info-soft)] hover:text-[var(--info)]"
      >
        <MessageSquare size={14} />
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-64 bg-surface border border-line rounded-[var(--r-md)] shadow-pop p-2.5 flex flex-col gap-2">
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Message ${recipientName}…`}
              rows={2}
              className="w-full resize-none text-[12.5px] px-2.5 py-2 border border-line rounded-[var(--r-sm)] bg-surface-2 text-ink placeholder:text-ink4 focus:outline-none focus:border-[var(--accent-line)]"
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={isPending} disabled={!text.trim()} onClick={() => mutate()}>
                Send
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Staff panel (housekeeping + maintenance) ───────────────────────────────────

interface HKRow {
  housekeeper_id?: string
  name?: string
  housekeeper_name?: string
  user_name?: string
  rooms_assigned?: number
  rooms_done?: number
  rooms_completed?: number
  in_progress?: number
}

function paceBarTone(pct: number): 'ready' | 'caution' | 'alert' {
  return pct >= 80 ? 'ready' : pct >= 50 ? 'caution' : 'alert'
}

function StaffPanel({
  assignmentsData,
  staffData,
  workOrders,
  completedWorkOrders,
  rooms,
  canMessage,
}: {
  assignmentsData: unknown
  staffData: unknown
  workOrders: WorkOrder[]
  completedWorkOrders: WorkOrder[]
  rooms: any[]
  canMessage: boolean
}) {
  const router = useRouter()
  const hkRows: HKRow[] = (assignmentsData as any)?.data ?? []
  const staff: StaffMember[] = (staffData as any)?.data?.staff ?? (staffData as any)?.data ?? []
  const technicians = staff.filter((s) => s.role === 'engineer' || s.role === 'chief_engineer')

  // ── Per-housekeeper coverage area — the distinct floors of their board today ──
  const floorsByHk: Record<string, number[]> = {}
  for (const room of rooms) {
    const hkId = room.housekeeper_id
    const floor = room.rooms?.floor
    if (hkId == null || floor == null) continue
    ;(floorsByHk[hkId] ??= []).push(floor)
  }

  // ── Per-technician work-order pace — completed today vs. everything still on their plate ──
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const techStats = (tech: StaffMember) => {
    const open = workOrders.filter(
      (w) => w.assigned_to === tech.user_id && (w.status === 'open' || w.status === 'in_progress' || w.status === 'escalated')
    )
    const done = completedWorkOrders.filter(
      (w) => w.assigned_to === tech.user_id && w.completed_at != null && new Date(w.completed_at) >= startOfToday
    )
    const assigned = open.length + done.length
    const floors = [...open, ...done]
      .map((w) => w.rooms?.floor)
      .filter((f): f is number => f != null)
    const pct = assigned > 0 ? Math.round((done.length / assigned) * 100) : 0
    return { done: done.length, assigned, pct, area: summarizeFloors(floors) }
  }

  const [sortByPace, setSortByPace] = useState(false)
  const sortedHkRows = sortByPace
    ? [...hkRows].sort((a, b) => {
        const pa = (a.rooms_assigned ?? 0) > 0 ? (a.rooms_done ?? a.rooms_completed ?? 0) / (a.rooms_assigned ?? 1) : 0
        const pb = (b.rooms_assigned ?? 0) > 0 ? (b.rooms_done ?? b.rooms_completed ?? 0) / (b.rooms_assigned ?? 1) : 0
        return pb - pa
      })
    : hkRows
  const sortedTechnicians = sortByPace
    ? [...technicians].sort((a, b) => techStats(b).pct - techStats(a).pct)
    : technicians

  return (
    <div className="h-full bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card flex flex-col">
      <div className="px-4 pt-[14px] pb-2 flex items-baseline justify-between gap-2">
        <SectionLabel hint={`${hkRows.length + technicians.length} on shift`}>Staff</SectionLabel>
        <div className="flex gap-1 pb-2.5">
          <IconButton
            variant="outline"
            size="sm"
            aria-label="Assign work"
            onClick={() => router.push('/housekeeping?assign=1')}
          >
            <Plus size={14} />
          </IconButton>
          <IconButton
            variant={sortByPace ? 'dark' : 'outline'}
            size="sm"
            aria-label="Sort by pace"
            onClick={() => setSortByPace((v) => !v)}
          >
            <ArrowUpDown size={14} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 px-4 pt-1 pb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ready)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Housekeeping</span>
          <Mono className="text-[11px] text-ink4">{hkRows.length}</Mono>
        </div>
        {hkRows.length === 0 ? (
          <p className="text-[12px] text-ink3 px-4 py-3">No assignments today</p>
        ) : (
          sortedHkRows.map((hk, i) => {
            const name = hk.name ?? hk.housekeeper_name ?? hk.user_name ?? 'Staff'
            const done = hk.rooms_done ?? hk.rooms_completed ?? 0
            const total = hk.rooms_assigned ?? 0
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const paceTone = pct >= 100 ? 'ready' : pct >= 50 ? 'neutral' : 'caution'
            const paceLabel = pct >= 100 ? 'Finished' : pct >= 50 ? 'On pace' : 'Behind pace'
            const area = hk.housekeeper_id ? summarizeFloors(floorsByHk[hk.housekeeper_id] ?? []) : ''
            return (
              <div key={i} className="flex items-center gap-[11px] px-4 py-[11px] border-t border-line-2">
                <Avatar name={name} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-ink truncate">{name}</span>
                    <Mono className="text-[11px] text-ink3">{done}/{total}</Mono>
                    <Pill tone={paceTone} size="sm">{paceLabel}</Pill>
                  </div>
                  <Bar value={done} max={total || 1} tone={paceBarTone(pct)} height={4} className="mt-[5px]" />
                  {area && <p className="text-[10.5px] text-ink3 mt-[5px]">{area}</p>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {canMessage && <MessageButton recipientId={hk.housekeeper_id} recipientName={name} />}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Assign a room to ${name}`}
                    onClick={() => router.push('/housekeeping?assign=1')}
                    className="hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                  >
                    <UserPlus size={14} />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Ask AI to rebalance ${name}`}
                    onClick={() => router.push("/ai")}
                    className="hover:bg-[var(--ai-soft)] hover:text-[var(--ai)]"
                  >
                    <SparkIcon size={13} />
                  </IconButton>
                </div>
              </div>
            )
          })
        )}

        <div className="flex items-center gap-2 px-4 pt-3 pb-1 border-t border-line-2 mt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--info)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Maintenance</span>
          <Mono className="text-[11px] text-ink4">{technicians.length}</Mono>
        </div>
        {technicians.length === 0 ? (
          <p className="text-[12px] text-ink3 px-4 py-3">No technicians on shift</p>
        ) : (
          sortedTechnicians.map((tech) => {
            const { done, assigned, pct, area } = techStats(tech)
            const paceTone = assigned === 0 ? 'ready' : pct >= 100 ? 'ready' : pct >= 50 ? 'neutral' : 'caution'
            const paceLabel = assigned === 0 ? 'Available' : pct >= 100 ? 'Clear' : pct >= 50 ? 'On pace' : 'Behind pace'
            return (
              <div key={tech.id} className="flex items-center gap-[11px] px-4 py-[11px] border-t border-line-2">
                <Avatar name={tech.full_name} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-ink truncate">{tech.full_name}</span>
                    {assigned > 0 && <Mono className="text-[11px] text-ink3">{done}/{assigned}</Mono>}
                    <Pill tone={paceTone} size="sm">{paceLabel}</Pill>
                  </div>
                  {assigned > 0 && <Bar value={done} max={assigned} tone={paceBarTone(pct)} height={4} className="mt-[5px]" />}
                  {area && <p className="text-[10.5px] text-ink3 mt-[5px]">{area}</p>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {canMessage && <MessageButton recipientId={tech.user_id} recipientName={tech.full_name} />}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Assign a work order to ${tech.full_name}`}
                    onClick={() => router.push('/engineering')}
                    className="hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                  >
                    <UserPlus size={14} />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Ask AI to rebalance ${tech.full_name}`}
                    onClick={() => router.push("/ai")}
                    className="hover:bg-[var(--ai-soft)] hover:text-[var(--ai)]"
                  >
                    <SparkIcon size={13} />
                  </IconButton>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Work orders panel ───────────────────────────────────────────────────────────

function WorkOrdersPanel({
  workOrders,
  isError,
  onRetry,
  onNewWorkOrder,
}: {
  workOrders: WorkOrder[]
  isError: boolean
  onRetry: () => void
  onNewWorkOrder: () => void
}) {
  const router = useRouter()
  const [urgentOnly, setUrgentOnly] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const openDrawer = useEngineeringStore((s) => s.openDrawer)

  const resolveMutation = useMutation({
    mutationFn: (id: string) => engineeringApi.transitionWorkOrder(id, { status: 'completed' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      toast.success('Work order resolved')
    },
    onError: () => toast.error('Could not resolve work order'),
  })

  const escalateMutation = useMutation({
    mutationFn: (id: string) => engineeringApi.transitionWorkOrder(id, { status: 'escalated' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      toast.success('Work order escalated')
    },
    onError: () => toast.error('Could not escalate work order'),
  })

  const visible = urgentOnly ? workOrders.filter((w) => w.priority === 'urgent' || w.priority === 'emergency') : workOrders

  return (
    <div className="h-full bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card flex flex-col">
      <div className="px-4 pt-[14px] pb-2 flex items-baseline justify-between gap-2">
        <SectionLabel hint={`${workOrders.length} open`}>Work orders</SectionLabel>
        <div className="flex gap-1 pb-2.5">
          <IconButton variant="outline" size="sm" aria-label="New work order" onClick={onNewWorkOrder}>
            <Plus size={14} />
          </IconButton>
          <IconButton
            variant={urgentOnly ? 'destructive' : 'outline'}
            size="sm"
            aria-label="Urgent only"
            onClick={() => setUrgentOnly((v) => !v)}
          >
            <AlertTriangle size={14} />
          </IconButton>
          <IconButton variant="ai" size="sm" aria-label="AI triage the queue" onClick={() => router.push("/ai")}>
            <SparkIcon size={13} />
          </IconButton>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <StateBlock status="error" error={{ message: 'Could not load work orders', onRetry }} className="pb-4" />
        ) : visible.length === 0 ? (
          <p className="text-[12px] text-ink3 px-4 pb-4">No open work orders</p>
        ) : (
          visible.map((wo) => (
            <div key={wo.id} className="flex items-center gap-[11px] px-4 py-[11px] border-t border-line-2">
              <span className="shrink-0 min-w-[44px] px-2 py-[6px] rounded-[var(--r-sm)] font-mono text-[12.5px] font-semibold text-ink bg-surface-2 border border-line text-center">
                {wo.rooms?.room_number ?? wo.location_text ?? '—'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-ink truncate">{wo.title}</p>
                <div className="flex items-center gap-[7px] flex-wrap mt-1">
                  <Pill tone={PRIORITY_PILL[wo.priority] ?? 'neutral'} size="sm">{wo.priority}</Pill>
                  <span className="text-[11px] text-ink3">
                    Opened {formatDistanceToNow(new Date(wo.created_at))} ago{wo.assigned_to ? '' : ' · unassigned'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label="Assign technician"
                  onClick={() => openDrawer(wo)}
                  className="hover:bg-[var(--info-soft)] hover:text-[var(--info)]"
                >
                  <UserPlus size={14} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label="Mark resolved"
                  loading={resolveMutation.isPending && resolveMutation.variables === wo.id}
                  onClick={() => resolveMutation.mutate(wo.id)}
                  className="hover:bg-[var(--ready-soft)] hover:text-[var(--ready)]"
                >
                  <CheckCircle2 size={14} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label="Escalate"
                  loading={escalateMutation.isPending && escalateMutation.variables === wo.id}
                  onClick={() => escalateMutation.mutate(wo.id)}
                  className="hover:bg-[var(--alert-soft)] hover:text-[var(--alert)]"
                >
                  <AlertTriangle size={14} />
                </IconButton>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Room list drawer (opened from a hero stat tile) ────────────────────────────

function RoomListDrawer({
  filter,
  rooms,
  hkNameById,
  onClose,
  onSelectRoom,
}: {
  filter: StatKey
  rooms: any[]
  hkNameById: Record<string, string>
  onClose: () => void
  onSelectRoom: (room: any) => void
}) {
  const visible = filter === 'all' ? rooms : rooms.filter((r) => classifyOccupancy(r) === filter)
  const title = OCCUPANCY_TILE_LABEL[filter]

  return (
    <>
      <div className="fixed inset-0 bg-black/35 z-drawer" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-[380px] bg-surface border-l border-line shadow-pop z-drawer flex flex-col">
        <div className="px-5 pt-5 pb-3.5 flex items-start gap-3 border-b border-line-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{visible.length} rooms</p>
            <p className="font-display text-[26px] leading-tight text-ink">{title}</p>
          </div>
          <IconButton variant="outline" size="sm" aria-label="Close" onClick={onClose}><X size={15} /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-1">
          {visible.map((room) => {
            const status = ROOM_PILL[room.status] ?? { tone: 'neutral', label: room.status }
            const hkId = room.assigned_to ?? room.housekeeper_id
            const hkName = hkId ? hkNameById[hkId] : undefined
            // Fold the clean-type scope into the state label for pickups
            // ("Pickup · Full" / "Pickup · Light") so the picker shows how much
            // work each room needs — the app's existing clean-aware convention.
            const cleanShort = getCleanTypeShortLabel(room.clean_type)
            const stateLabel =
              cleanShort && room.status === 'PICKUP' && (room.clean_type === 'FULL' || room.clean_type === 'LIGHT')
                ? `${status.label} · ${cleanShort}`
                : status.label
            // Occupied/stayover reads as striped red, matching the drawer header.
            const isOccupied = room.status === 'OCCUPIED'
            return (
              <button
                key={room.room_id}
                onClick={() => onSelectRoom(room)}
                className="w-full flex items-center gap-3 px-1 py-3 border-t border-line-2 text-left hover:bg-surface-2 transition-colors"
              >
                <span
                  className="shrink-0"
                  style={
                    isOccupied
                      ? { width: 4, height: 26, borderRadius: 2, backgroundImage: 'repeating-linear-gradient(135deg, var(--alert) 0 4px, rgba(255,255,255,0.55) 4px 8px)' }
                      : { width: 4, height: 26, borderRadius: 2, background: ROOM_BAR_COLOR[status.tone] ?? 'var(--line-2)' }
                  }
                />
                <Mono className="text-[14px] font-semibold text-ink min-w-[38px]">
                  {room.rooms?.room_number ?? room.room_number}
                </Mono>
                <span className="flex-1 min-w-0 truncate text-[12px] text-ink3">
                  {stateLabel}{hkName ? ` · ${hkName}` : ''}
                </span>
                <ChevronRight size={13} className="text-ink4 shrink-0" />
              </button>
            )
          })}
        </div>
      </aside>
    </>
  )
}

// ── SimplifiedDashboard ──────────────────────────────────────────────────────────

export function SimplifiedDashboard() {
  const router = useRouter()
  const storedFullName = useAuthStore((s) => s.fullName)
  const user = useAuthStore((s) => s.user)
  const hotel = useHotelStore((s) => s.hotel)
  const { role } = useRole()
  const canMessage = role === 'gm' || role === 'housekeeping_supervisor' || role === 'engineer'
  const queryClient = useQueryClient()
  const toast = useToast()

  const [listFilter, setListFilter] = useState<StatKey | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)
  const [showCreateWO, setShowCreateWO] = useState(false)

  // Briefing ↔ chat cross-fade. Both states stay mounted during a swap: the
  // incoming one (`briefingView`) rises in slowly while the outgoing one
  // (`leavingView`) fades up and out quickly, then unmounts after 320ms.
  type BriefingView = 'briefing' | 'chat'
  const [briefingView, setBriefingView] = useState<BriefingView>('briefing')
  const [leavingView, setLeavingView] = useState<BriefingView | null>(null)
  const swapBriefingView = (next: BriefingView) => {
    if (next === briefingView) return
    setLeavingView(briefingView)
    setBriefingView(next)
  }
  useEffect(() => {
    if (!leavingView) return
    // Keep the outgoing cell mounted until its fade-out (.swap-out) finishes.
    const t = setTimeout(() => setLeavingView(null), 320)
    return () => clearTimeout(t)
  }, [leavingView])

  const firstName = storedFullName
    ? storedFullName.split(' ')[0]
    : (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'there'

  const todayISO = format(new Date(), 'yyyy-MM-dd')

  const { data: boardData, isLoading: boardLoading, isError: boardError, refetch: refetchBoard, dataUpdatedAt: boardUpdatedAt } = useQuery({
    queryKey: ['housekeeping-board', todayISO],
    queryFn: () => housekeepingApi.getBoard(todayISO, undefined, true),
    staleTime: 0,
    refetchInterval: 15_000,
  })

  const { data: assignmentsData, refetch: refetchAssignments } = useQuery({
    queryKey: ['hk-assignments-today', todayISO],
    queryFn: () => housekeepingApi.getAssignments(todayISO),
    staleTime: 0,
    refetchInterval: 15_000,
  })

  const { data: workOrdersData, isError: woError, refetch: refetchWO } = useQuery({
    queryKey: ['work-orders', 'open'],
    queryFn: () => engineeringApi.listWorkOrders({ status: 'open' }),
    refetchInterval: 15_000,
  })

  // Completed work orders feed the maintenance pace bars (done-today ÷ on-plate).
  const { data: completedWorkOrdersData } = useQuery({
    queryKey: ['work-orders', 'completed'],
    queryFn: () => engineeringApi.listWorkOrders({ status: 'completed', per_page: 100 }),
    refetchInterval: 60_000,
  })

  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    staleTime: 5 * 60_000,
  })

  const { data: cleanTimeData } = useQuery({
    queryKey: ['hotel-avg-clean-time'],
    queryFn: () => housekeepingApi.getHotelAvgCleanTime(),
    refetchInterval: 120_000,
    retry: 1,
  })

  const { data: alertsData, isError: alertsError, refetch: refetchAlerts } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 120_000,
    retry: 1,
  })

  const rooms: any[] = (boardData as any)?.data ?? []
  // Bind the open detail drawer to LIVE board data (checkout time, status,
  // assignment, …) so a mutation shows the instant the board refetches — the
  // click-time snapshot alone was stale and forced a close/reopen to see edits.
  const drawerRoom = selectedRoom
    ? { ...selectedRoom, ...(rooms.find((r) => r.room_id === selectedRoom.room_id) ?? {}) }
    : null
  const workOrders: WorkOrder[] = (workOrdersData as any)?.data ?? []
  const completedWorkOrders: WorkOrder[] = (completedWorkOrdersData as any)?.data ?? []
  const cleanTime = cleanTimeData?.data
  const hkRisks = alertsData?.data?.housekeeping_risks ?? []
  const urgentWOs = workOrders.filter((w) => w.priority === 'urgent' || w.priority === 'emergency')

  // housekeeper_id → display name, for the room-list drawer. Assignments carry the
  // name directly; the staff roster fills in anyone the board shows but isn't assigned.
  const hkNameById = useMemo(() => {
    const map: Record<string, string> = {}
    const rows: HKRow[] = (assignmentsData as any)?.data ?? []
    for (const hk of rows) {
      if (hk.housekeeper_id) map[hk.housekeeper_id] = hk.name ?? hk.housekeeper_name ?? hk.user_name ?? 'Staff'
    }
    const staff: StaffMember[] = (staffData as any)?.data?.staff ?? (staffData as any)?.data ?? []
    for (const s of staff) {
      if (s.user_id && !map[s.user_id]) map[s.user_id] = s.full_name
    }
    return map
  }, [assignmentsData, staffData])

  const totalRooms = rooms.length
  const occupied = rooms.filter((r) => classifyOccupancy(r) === 'OCCUPIED').length
  const departure = rooms.filter((r) => classifyOccupancy(r) === 'DEPARTURE').length
  const vacant = rooms.filter((r) => classifyOccupancy(r) === 'VACANT').length
  // Vacant rooms currently mid-clean — the only hint the Vacant tile shows.
  const vacantInProgress = rooms.filter((r) => classifyOccupancy(r) === 'VACANT' && r.status === 'IN_PROGRESS').length
  const pct = (n: number) => (totalRooms > 0 ? `${Math.round((n / totalRooms) * 100)}%` : '—')

  const statTiles: { key: StatKey; label: string; value: number; hint: string; dot: string }[] = [
    { key: 'all', label: 'Total rooms', value: totalRooms, hint: '', dot: 'bg-white/70' },
    { key: 'OCCUPIED', label: 'Occupied · stayover', value: occupied, hint: pct(occupied), dot: 'bg-[var(--alert)]' },
    { key: 'DEPARTURE', label: 'Departures', value: departure, hint: '', dot: 'bg-[var(--alert)]' },
    { key: 'VACANT', label: 'Vacant', value: vacant, hint: vacantInProgress > 0 ? `${vacantInProgress} in progress` : '', dot: 'bg-[var(--ready)]' },
  ]

  const now = new Date()
  const shiftLabel = now.getHours() < 15 ? 'Day shift' : now.getHours() < 23 ? 'Evening shift' : 'Night shift'

  // Grounds "Ask about this" answers in exactly what's on screen right now.
  const briefingStats: BriefingBoardStats = {
    hkStats: ((assignmentsData as any)?.data ?? []).map((hk: HKRow) => ({
      name: hk.name ?? hk.housekeeper_name ?? hk.user_name ?? 'Staff',
      assigned: hk.rooms_assigned ?? 0,
      done: hk.rooms_done ?? hk.rooms_completed ?? 0,
    })),
    departure,
    vacant,
    risks: hkRisks.map((r) => ({ room_number: r.rooms?.room_number })),
    urgentWorkOrders: urgentWOs.map((w) => ({ title: w.title, location: w.rooms?.room_number ?? w.location_text ?? undefined })),
    cleanTime: cleanTime?.today_avg_minutes != null
      ? { todayAvgMinutes: cleanTime.today_avg_minutes, deltaMinutes: cleanTime.delta_minutes }
      : null,
  }

  const handleRefresh = () => {
    refetchBoard()
    refetchAssignments()
    refetchWO()
    refetchAlerts()
  }

  const renderBriefingBody = () => (
    <>
      <div className="flex items-center gap-2.5 flex-wrap">
        <AILabel confidence={91}>Shift briefing</AILabel>
        <span className="text-[11px] font-mono text-white/50">Generated {format(new Date(), 'h:mm a')}</span>
      </div>
      {alertsError ? (
        <p className="font-display italic text-[16px] text-white/70">Briefing unavailable right now.</p>
      ) : (
        <>
          <p className="font-display italic text-[20px] leading-[1.45] tracking-[-0.2px]">
            {hkRisks.length > 0
              ? <>
                  <span className="not-italic font-sans font-medium bg-[#3d3214] text-[#e6c47d] px-1.5 py-px rounded">{hkRisks.length} rooms flagged</span>
                  {' '}at risk. {urgentWOs.length > 0 ? `${urgentWOs.length} urgent work order${urgentWOs.length !== 1 ? 's are' : ' is'} unassigned.` : 'Work orders are on pace.'}
                </>
              : departure > 0
              ? `${departure} room${departure > 1 ? 's are' : ' is'} on departure today. Everything else is on pace.`
              : 'All boards on pace. No rooms currently flagged.'
            }
          </p>
          <div className="flex gap-2.5 mt-auto flex-wrap items-center">
            {hkRisks.length > 0 && (
              <Button variant="primary" size="md" onClick={() => router.push('/ai')} className="gap-1.5">
                <CheckCircle2 size={14} />
                Apply {hkRisks.length} suggestion{hkRisks.length !== 1 ? 's' : ''}
              </Button>
            )}
            <Button
              variant="ai"
              size="md"
              onClick={() => swapBriefingView('chat')}
              className="gap-1.5"
            >
              <SparkIcon size={14} />
              Ask about this
            </Button>
          </div>
        </>
      )}
    </>
  )

  const renderChatBody = () => (
    <BriefingChat
      stats={briefingStats}
      onClose={() => swapBriefingView('briefing')}
      onOpenRoomFilter={(filter) => setListFilter(filter)}
    />
  )

  // One keyed cell. Both the leaving and the incoming cell share grid-area 1/1
  // (set in globals.css) so they overlap and cross-fade. The whole left column
  // (eyebrow + body + buttons) animates as one block — never the inner elements.
  const renderBriefingCell = (view: BriefingView, phase: 'in' | 'out') => (
    <div
      key={`${view}-${phase}`}
      className={cn(
        'min-w-0 h-full',
        phase === 'in' ? 'swap-in' : 'swap-out',
        view === 'briefing' && 'flex flex-col gap-3'
      )}
      aria-hidden={phase === 'out' || undefined}
    >
      {view === 'chat' ? renderChatBody() : renderBriefingBody()}
    </div>
  )

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Greeting */}
      <div className="shrink-0 flex items-end justify-between gap-6">
        <DashboardGreeting
          name={firstName}
          meta={hotel?.name ? `${shiftLabel} · ${hotel.name}` : shiftLabel}
        />
        <div className="flex gap-2 pb-1 shrink-0">
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
            <RefreshCw size={13} />
            Refresh
          </Button>
          <Button variant="dark" size="sm" onClick={() => router.push('/tasks')} className="gap-1.5">
            <Plus size={13} />
            New task
          </Button>
        </div>
      </div>

      {/* AI briefing hero */}
      <section className="shrink-0 relative overflow-hidden rounded-[var(--r-xl)] bg-ink text-paper shadow-card">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 84% 12%, var(--accent) 0%, transparent 52%)', opacity: 0.26 }}
          />
          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 p-7">
            {/* Cross-fade: while `leavingView` is set both cells are mounted and
                overlap in one grid cell — the old one fades up and out (320ms),
                the new one rises in (620ms). See renderBriefingCell above. */}
            <div className="briefing-left">
              {leavingView && renderBriefingCell(leavingView, 'out')}
              {renderBriefingCell(briefingView, 'in')}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {boardLoading ? (
                Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-xl bg-white/5 min-h-[100px] animate-pulse" />)
              ) : (
                statTiles.map((tile) => (
                  <button
                    key={tile.key}
                    onClick={() => setListFilter(listFilter === tile.key ? null : tile.key)}
                    className={cn(
                      'flex flex-col justify-between gap-2.5 min-h-[100px] px-4 py-3.5 rounded-xl text-left transition-colors',
                      listFilter === tile.key
                        ? 'bg-white/[.11] border border-white/30'
                        : 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('w-2 h-2 rounded-full', tile.dot)} />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/60">{tile.label}</span>
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-display text-[32px] leading-none">{tile.value}</span>
                      {tile.hint && <span className="text-[11px] font-mono text-white/50">{tile.hint}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="relative border-t border-white/10 px-7 py-2 flex items-center justify-between gap-3 flex-wrap text-[11px] text-white/50">
            {cleanTime && cleanTime.today_avg_minutes != null ? (
              <button
                onClick={() => router.push('/reports')}
                className="inline-flex items-baseline gap-2 hover:opacity-75 transition-opacity"
                title="How today's clean times compare to the 7-day average"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-white/55">Avg clean time</span>
                <span className="font-mono text-[13px] font-medium text-white/90">{cleanTime.today_avg_minutes}m</span>
                {cleanTime.delta_minutes != null && cleanTime.delta_minutes !== 0 && (
                  <span className={cn('text-[10.5px]', cleanTime.delta_minutes < 0 ? 'text-[#7cd6c5]' : 'text-[#e0a3a3]')}>
                    {cleanTime.delta_minutes > 0 ? '+' : ''}{cleanTime.delta_minutes}m vs 7-day
                  </span>
                )}
              </button>
            ) : (
              <span />
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4ab8a8] animate-pulse" />
              <span className="font-mono">
                Live · {boardUpdatedAt ? format(new Date(boardUpdatedAt), 'h:mm a') : '—'}
              </span>
            </span>
          </div>
        </section>

      {boardError && (
        <StateBlock status="error" error={{ message: 'Could not load the room board', onRetry: () => refetchBoard() }} className="shrink-0 bg-surface border border-line rounded-[var(--r-lg)]" />
      )}

      {/* Staff + Work orders — each panel scrolls internally so the page itself never scrolls */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-5">
        <div className="flex-1 min-h-0 min-w-0 md:basis-1/2">
          <StaffPanel
            assignmentsData={assignmentsData}
            staffData={staffData}
            workOrders={workOrders}
            completedWorkOrders={completedWorkOrders}
            rooms={rooms}
            canMessage={canMessage}
          />
        </div>
        <div className="flex-1 min-h-0 min-w-0 md:basis-1/2">
          <WorkOrdersPanel
            workOrders={workOrders}
            isError={woError}
            onRetry={() => refetchWO()}
            onNewWorkOrder={() => setShowCreateWO(true)}
          />
        </div>
      </div>

      {listFilter && (
        <RoomListDrawer
          filter={listFilter}
          rooms={rooms}
          hkNameById={hkNameById}
          onClose={() => setListFilter(null)}
          onSelectRoom={(room) => { setSelectedRoom(room); setListFilter(null) }}
        />
      )}

      <RoomDetailDrawer
        room={drawerRoom}
        isOpen={!!selectedRoom}
        onClose={() => setSelectedRoom(null)}
        onCheckoutTimeSaved={(time) => setSelectedRoom((prev: any) => (prev ? { ...prev, checkout_time: time } : prev))}
      />

      <WorkOrderDetailDrawerHost onUpdate={() => queryClient.invalidateQueries({ queryKey: ['work-orders'] })} />

      {showCreateWO && (
        <CreateWorkOrderModal
          isOpen={showCreateWO}
          onClose={() => setShowCreateWO(false)}
          onCreate={() => {
            queryClient.invalidateQueries({ queryKey: ['work-orders'] })
            setShowCreateWO(false)
          }}
        />
      )}
    </div>
  )
}

// Thin host so WorkOrderDetailDrawer (opened via useEngineeringStore from WorkOrdersPanel)
// re-renders when the store's selected work order changes, without lifting store reads
// into the top-level component on every render.
function WorkOrderDetailDrawerHost({ onUpdate }: { onUpdate: () => void }) {
  const selectedWO = useEngineeringStore((s) => s.selectedWO)
  const isDrawerOpen = useEngineeringStore((s) => s.isDrawerOpen)
  const closeDrawer = useEngineeringStore((s) => s.closeDrawer)
  return (
    <WorkOrderDetailDrawer
      wo={selectedWO}
      isOpen={isDrawerOpen}
      onClose={closeDrawer}
      onUpdate={onUpdate}
      startInEditMode
    />
  )
}
