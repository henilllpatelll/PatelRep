'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Plus, MessageSquare, UserPlus, Sparkles, X, ChevronRight, Siren, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useRole } from '@/lib/hooks/useRole'
import { useEngineeringStore } from '@/stores/engineeringStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi, type WorkOrder } from '@/lib/api/engineering'
import { aiApi } from '@/lib/api/ai'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { notificationsApi } from '@/lib/api/notifications'
import { Avatar, Pill, Bar, SectionLabel, AILabel, Mono } from '@/components/ui/primitives'
import { Button, IconButton } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'
import { DashboardGreeting } from './DashboardGreeting'
import { RoomDetailDrawer } from '@/components/housekeeping/RoomDetailDrawer'
import { WorkOrderDetailDrawer } from '@/components/engineering/WorkOrderDetailDrawer'
import { CreateWorkOrderModal } from '@/components/engineering/CreateWorkOrderModal'
import { cn } from '@/lib/utils'

function openCopilot() {
  document.dispatchEvent(new CustomEvent('copilot:open'))
}

// ── Room status → pill/tile styling (matches CELL_MAP in SupervisorDashboard) ──

type StatKey = 'all' | 'OCCUPIED' | 'DIRTY' | 'INSPECTED'

const ROOM_PILL: Record<string, { tone: any; label: string }> = {
  INSPECTED: { tone: 'inspected', label: 'Inspected' },
  CLEAN: { tone: 'clean', label: 'Clean' },
  DIRTY: { tone: 'dirty', label: 'Dirty' },
  IN_PROGRESS: { tone: 'progress', label: 'In progress' },
  OCCUPIED: { tone: 'alert', label: 'Occupied' },
  PICKUP: { tone: 'pickup', label: 'Pickup' },
  OOO: { tone: 'blocked', label: 'OOO' },
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

function StaffPanel({
  assignmentsData,
  staffData,
  workOrders,
  canMessage,
}: {
  assignmentsData: unknown
  staffData: unknown
  workOrders: WorkOrder[]
  canMessage: boolean
}) {
  const router = useRouter()
  const hkRows: HKRow[] = (assignmentsData as any)?.data ?? []
  const staff: StaffMember[] = (staffData as any)?.data?.staff ?? (staffData as any)?.data ?? []
  const technicians = staff.filter((s) => s.role === 'engineer' || s.role === 'chief_engineer')

  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card flex flex-col">
      <div className="px-4 pt-3.5 pb-1">
        <SectionLabel hint={`${hkRows.length + technicians.length} on shift`}>Staff</SectionLabel>
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
          hkRows.map((hk, i) => {
            const name = hk.name ?? hk.housekeeper_name ?? hk.user_name ?? 'Staff'
            const done = hk.rooms_done ?? hk.rooms_completed ?? 0
            const total = hk.rooms_assigned ?? 0
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const paceTone = pct >= 100 ? 'ready' : pct >= 50 ? 'neutral' : 'caution'
            const paceLabel = pct >= 100 ? 'Finished' : pct >= 50 ? 'On pace' : 'Behind pace'
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2">
                <Avatar name={name} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-ink truncate">{name}</span>
                    <Mono className="text-[11px] text-ink3">{done}/{total}</Mono>
                    <Pill tone={paceTone} size="sm">{paceLabel}</Pill>
                  </div>
                  <Bar value={done} max={total || 1} tone={pct >= 50 ? 'ready' : 'caution'} height={3} className="mt-1.5" />
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
                    onClick={openCopilot}
                    className="hover:bg-[var(--ai-soft)] hover:text-[var(--ai)]"
                  >
                    <Sparkles size={13} />
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
          technicians.map((tech) => {
            const assigned = workOrders.filter(
              (w) => w.assigned_to === tech.user_id && (w.status === 'open' || w.status === 'in_progress' || w.status === 'escalated')
            ).length
            return (
              <div key={tech.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2">
                <Avatar name={tech.full_name} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-ink truncate">{tech.full_name}</span>
                    <Mono className="text-[11px] text-ink3">{assigned} open</Mono>
                    <Pill tone={assigned > 0 ? 'neutral' : 'ready'} size="sm">{assigned > 0 ? 'On it' : 'Available'}</Pill>
                  </div>
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
                    onClick={openCopilot}
                    className="hover:bg-[var(--ai-soft)] hover:text-[var(--ai)]"
                  >
                    <Sparkles size={13} />
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
    <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card flex flex-col">
      <div className="px-4 pt-3.5 pb-1 flex items-baseline justify-between gap-2">
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
            <Siren size={14} />
          </IconButton>
          <IconButton variant="ai" size="sm" aria-label="AI triage the queue" onClick={openCopilot}>
            <Sparkles size={13} />
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
            <div key={wo.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2">
              <span className="shrink-0 min-w-[44px] px-2 py-1.5 rounded-[var(--r-sm)] font-mono text-[12.5px] font-semibold text-ink bg-surface-2 border border-line text-center">
                {wo.rooms?.room_number ?? wo.location_text ?? '—'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-ink truncate">{wo.title}</p>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <Pill tone={PRIORITY_PILL[wo.priority] ?? 'neutral'} size="sm">{wo.priority}</Pill>
                  <span className="text-[10.5px] text-ink3">
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
                  <Siren size={14} />
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
  onClose,
  onSelectRoom,
}: {
  filter: StatKey
  rooms: any[]
  onClose: () => void
  onSelectRoom: (room: any) => void
}) {
  const visible = filter === 'all' ? rooms : rooms.filter((r) => r.status === filter)
  const title = filter === 'all' ? 'All rooms' : ROOM_PILL[filter]?.label ?? filter

  return (
    <>
      <div className="fixed inset-0 bg-black/35 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-[380px] bg-surface border-l border-line shadow-pop z-50 flex flex-col">
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
            return (
              <button
                key={room.room_id}
                onClick={() => onSelectRoom(room)}
                className="w-full flex items-center gap-3 py-2.5 border-t border-line-2 text-left hover:bg-surface-2 transition-colors"
              >
                <Mono className="text-[14px] font-semibold text-ink min-w-[42px]">
                  {room.rooms?.room_number ?? room.room_number}
                </Mono>
                <Pill tone={status.tone} size="sm">{status.label}</Pill>
                <span className="flex-1" />
                <ChevronRight size={13} className="text-ink4" />
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
  const { role } = useRole()
  const canMessage = role === 'gm' || role === 'housekeeping_supervisor' || role === 'engineer'
  const queryClient = useQueryClient()

  const [listFilter, setListFilter] = useState<StatKey | null>(null)
  const [selectedRoom, setSelectedRoom] = useState<any | null>(null)
  const [briefingDismissed, setBriefingDismissed] = useState(false)
  const [showCreateWO, setShowCreateWO] = useState(false)

  const firstName = storedFullName
    ? storedFullName.split(' ')[0]
    : (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'there'

  const todayISO = format(new Date(), 'yyyy-MM-dd')

  const { data: boardData, isLoading: boardLoading, isError: boardError, refetch: refetchBoard } = useQuery({
    queryKey: ['housekeeping-board', todayISO],
    queryFn: () => housekeepingApi.getBoard(todayISO, undefined, false),
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

  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    staleTime: 5 * 60_000,
  })

  const { data: alertsData, isError: alertsError, refetch: refetchAlerts } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 120_000,
    retry: 1,
  })

  const rooms: any[] = (boardData as any)?.data ?? []
  const workOrders: WorkOrder[] = (workOrdersData as any)?.data ?? []
  const hkRisks = alertsData?.data?.housekeeping_risks ?? []
  const urgentWOs = workOrders.filter((w) => w.priority === 'urgent' || w.priority === 'emergency')

  const totalRooms = rooms.length
  const occupied = rooms.filter((r) => r.status === 'OCCUPIED').length
  const dirty = rooms.filter((r) => r.status === 'DIRTY').length
  const inspected = rooms.filter((r) => r.status === 'INSPECTED').length

  const statTiles: { key: StatKey; label: string; value: number; dot: string }[] = [
    { key: 'all', label: 'Total rooms', value: totalRooms, dot: 'bg-white/70' },
    { key: 'OCCUPIED', label: 'Occupied', value: occupied, dot: 'bg-[var(--alert)]' },
    { key: 'DIRTY', label: 'Needs cleaning', value: dirty, dot: 'bg-[var(--alert)]' },
    { key: 'INSPECTED', label: 'Inspected', value: inspected, dot: 'bg-[var(--ready)]' },
  ]

  const handleRefresh = () => {
    refetchBoard()
    refetchAssignments()
    refetchWO()
    refetchAlerts()
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex items-end justify-between gap-6">
        <DashboardGreeting
          name={firstName}
          subtitle={
            hkRisks.length > 0
              ? `${hkRisks.length} room${hkRisks.length > 1 ? 's' : ''} flagged. ${urgentWOs.length} urgent work order${urgentWOs.length !== 1 ? 's' : ''} open.`
              : dirty > 0
              ? `${dirty} room${dirty > 1 ? 's' : ''} still need${dirty > 1 ? '' : 's'} cleaning.`
              : 'All rooms accounted for. Good start to the shift.'
          }
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
      {!briefingDismissed && (
        <section className="relative overflow-hidden rounded-[var(--r-xl)] bg-ink text-paper shadow-card">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 84% 12%, var(--accent) 0%, transparent 52%)', opacity: 0.26 }}
          />
          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
            <div className="flex flex-col gap-2.5 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <AILabel confidence={91}>Shift briefing</AILabel>
                <span className="text-[11px] font-mono text-white/50">Generated {format(new Date(), 'h:mm a')}</span>
              </div>
              {alertsError ? (
                <p className="font-display italic text-[16px] text-white/70">Briefing unavailable right now.</p>
              ) : (
                <p className="font-display italic text-[17px] leading-[1.36] tracking-[-0.2px]">
                  {hkRisks.length > 0
                    ? <>
                        <span className="not-italic font-sans font-medium bg-[#3d3214] text-[#e6c47d] px-1.5 py-px rounded">{hkRisks.length} rooms flagged</span>
                        {' '}at risk. {urgentWOs.length > 0 ? `${urgentWOs.length} urgent work order${urgentWOs.length !== 1 ? 's are' : ' is'} unassigned.` : 'Work orders are on pace.'}
                      </>
                    : dirty > 0
                    ? `${dirty} room${dirty > 1 ? 's' : ''} still need${dirty > 1 ? '' : 's'} cleaning. Everything else is on pace.`
                    : 'All boards on pace. No rooms currently flagged.'
                  }
                </p>
              )}
              <div className="flex gap-2 mt-auto flex-wrap">
                <Button variant="ai" size="sm" onClick={openCopilot} className="gap-1.5">
                  <Sparkles size={13} />
                  Ask about this
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setBriefingDismissed(true)} className="text-white/60 hover:text-white hover:bg-white/10">
                  Dismiss
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {boardLoading ? (
                Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-[var(--r-md)] bg-white/5 min-h-[74px] animate-pulse" />)
              ) : (
                statTiles.map((tile) => (
                  <button
                    key={tile.key}
                    onClick={() => setListFilter(tile.key)}
                    className={cn(
                      'flex flex-col justify-between gap-2 min-h-[74px] p-3 rounded-[var(--r-md)] text-left transition-colors',
                      'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full', tile.dot)} />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-white/60">{tile.label}</span>
                    </span>
                    <span className="font-display text-[26px] leading-none">{tile.value}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {boardError && (
        <StateBlock status="error" error={{ message: 'Could not load the room board', onRetry: () => refetchBoard() }} className="bg-surface border border-line rounded-[var(--r-lg)]" />
      )}

      {/* Staff + Work orders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 min-h-[420px]">
        <StaffPanel
          assignmentsData={assignmentsData}
          staffData={staffData}
          workOrders={workOrders}
          canMessage={canMessage}
        />
        <WorkOrdersPanel
          workOrders={workOrders}
          isError={woError}
          onRetry={() => refetchWO()}
          onNewWorkOrder={() => setShowCreateWO(true)}
        />
      </div>

      {listFilter && (
        <RoomListDrawer
          filter={listFilter}
          rooms={rooms}
          onClose={() => setListFilter(null)}
          onSelectRoom={(room) => { setSelectedRoom(room); setListFilter(null) }}
        />
      )}

      <RoomDetailDrawer room={selectedRoom} isOpen={!!selectedRoom} onClose={() => setSelectedRoom(null)} />

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
