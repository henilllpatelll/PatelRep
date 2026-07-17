'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X,
  AlertTriangle,
  CheckCircle,
  Star,
  Wrench,
  Circle,
  MessageSquare,
  ClipboardList,
  Package,
  ChevronDown,
  ChevronUp,
  Send,
  Clock,
  LogOut,
  RotateCcw,
  BedDouble,
  Timer,
  Camera,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi } from '@/lib/api/engineering'
import { roomsApi } from '@/lib/api/rooms'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import { tasksApi } from '@/lib/api/tasks'
import { cleanSessionsApi } from '@/lib/api/cleanSessions'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { getCleanTypeLabel } from '@/lib/utils/cleanType'
import { getRoomTypeCode } from '@/lib/utils/roomType'
import { STATUS_LABELS } from '@/lib/utils/roomStatus'
import { Button } from '@/components/ui/Button'
import { LogFoundItemModal } from '@/components/shared/LogFoundItemModal'

const WO_CATEGORIES = [
  { value: 'appliance',   label: 'Appliance' },
  { value: 'electrical',  label: 'Electrical' },
  { value: 'furniture',   label: 'Furniture' },
  { value: 'general',     label: 'General' },
  { value: 'hvac',        label: 'HVAC / A/C' },
  { value: 'plumbing',    label: 'Plumbing' },
  { value: 'safety',      label: 'Safety' },
  { value: 'structural',  label: 'Structural' },
]

interface Props {
  room: any | null
  isOpen: boolean
  onClose: () => void
  onCheckoutTimeSaved?: (checkoutTime: string) => void
}

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP' | 'OCCUPIED' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

function formatHistoryTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString)
    const timeStr = format(date, 'h:mm a')
    if (isToday(date)) return timeStr
    if (isYesterday(date)) return `Yesterday ${timeStr}`
    return `${format(date, 'MMM d')} ${timeStr}`
  } catch {
    return isoString
  }
}

function formatCheckinTime(isoString: string | null | undefined): string | null {
  if (!isoString) return null
  try {
    return format(new Date(isoString), 'h:mm a')
  } catch {
    return null
  }
}

function formatTimeInput(isoString: string | null | undefined): string {
  if (!isoString) return ''
  try {
    return format(new Date(isoString), 'HH:mm')
  } catch {
    return ''
  }
}

function buildCheckoutTimeIso(timeValue: string, existingIso?: string | null): string | undefined {
  if (!timeValue) return undefined
  const [hours, minutes] = timeValue.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined
  const date = existingIso ? new Date(existingIso) : new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function getActionLabel(status: string): string {
  switch (status) {
    case 'IN_PROGRESS': return 'Started'
    case 'CLEAN': return 'Marked clean'
    case 'INSPECTED': return 'Marked ready'
    case 'DIRTY': return 'Returned to cleaning'
    case 'OOO':
    case 'OUT_OF_ORDER':
    case 'OUT_OF_SERVICE': return 'Marked out of order'
    case 'PICKUP': return 'Marked pickup'
    default: return 'Updated'
  }
}

function getLastUpdateAt(room: any | null): string | null {
  return room?.updated_at ?? room?.last_cleaned_at ?? room?.last_inspected_at ?? null
}

function formatLastAction(entry: any | null, room: any | null, currentUserId?: string): string | null {
  const status = entry?.to_status ?? room?.status
  const timestamp = entry?.created_at ?? getLastUpdateAt(room)
  if (!status || !timestamp) return null

  const actorName = entry?.actor_name ?? entry?.user_profiles?.preferred_name ?? null
  const actor =
    entry?.changed_by && entry.changed_by === currentUserId
      ? ' by you'
      : actorName
      ? ` by ${actorName}`
      : ''

  return `${getActionLabel(status)}${actor} at ${formatHistoryTimestamp(timestamp)}`
}

const SYSTEM_NOTE_REGEXES = [
  /Guest checked out/i,
  /task_sheet_clean_type=/i,
  /^Undo \w+ back to \w+/i,
]

function stripNoteMeta(s: string): string {
  return s.replace(/\|[a-z_]+=[^|]*/gi, '').trim()
}

function getActionableNote(entry: any | null): string | null {
  const raw = entry?.notes ?? entry?.note ?? null
  const note = raw ? stripNoteMeta(raw) || null : null
  const status = entry?.to_status ?? ''
  if (!note || !['DIRTY', 'PICKUP', 'IN_PROGRESS'].includes(status)) return null
  if (SYSTEM_NOTE_REGEXES.some(r => r.test(note))) return null
  return note
}

function getStatusTopBarClass(status: string): string {
  switch (status) {
    case 'DIRTY': return 'bg-rose-400'
    case 'IN_PROGRESS': return 'bg-violet-400'
    case 'OCCUPIED': return 'bg-rose-400'
    case 'CLEAN': return 'bg-blue-400'
    case 'INSPECTED': return 'bg-teal-400'
    case 'OOO':
    case 'OUT_OF_ORDER':
    case 'OUT_OF_SERVICE': return 'bg-stone-400'
    case 'PICKUP': return 'bg-amber-400'
    default: return 'bg-stone-300'
  }
}

function getStatusChipClass(status: string): string {
  switch (status) {
    case 'DIRTY': return 'bg-rose-50 text-rose-700 border border-rose-200'
    case 'IN_PROGRESS': return 'bg-violet-50 text-violet-700 border border-violet-200'
    case 'OCCUPIED': return 'bg-rose-50 text-rose-700 border border-rose-200'
    case 'CLEAN': return 'bg-blue-50 text-blue-700 border border-blue-200'
    case 'INSPECTED': return 'bg-teal-50 text-teal-700 border border-teal-200'
    case 'OOO':
    case 'OUT_OF_ORDER':
    case 'OUT_OF_SERVICE': return 'bg-stone-100 text-stone-600 border border-stone-200'
    case 'PICKUP': return 'bg-amber-50 text-amber-700 border border-amber-200'
    default: return 'bg-stone-100 text-stone-600 border border-stone-200'
  }
}

export function RoomDetailDrawer({ room, isOpen, onClose, onCheckoutTimeSaved }: Props) {
  const { role, isSupervisor, isGM } = useRole()
  const isHousekeeper = role === 'housekeeper'
  const canSupervise = isSupervisor || isGM
  const canViewStatusHistory = canSupervise || role === 'front_desk'
  const currentUser = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  const [showStatusHistory, setShowStatusHistory] = useState(false)

  const [noteText, setNoteText] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteSuccess, setNoteSuccess] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [foundItemOpen, setFoundItemOpen] = useState(false)
  const [checkoutTimeInput, setCheckoutTimeInput] = useState('')
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutSuccess, setCheckoutSuccess] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [undoCheckoutLoading, setUndoCheckoutLoading] = useState(false)
  const [undoCheckoutError, setUndoCheckoutError] = useState<string | null>(null)
  const [stayoverLoading, setStayoverLoading] = useState(false)
  const [stayoverError, setStayoverError] = useState<string | null>(null)
  const [stayoverSuccess, setStayoverSuccess] = useState(false)
  const [saveTimeLoading, setSaveTimeLoading] = useState(false)
  const [saveTimeSuccess, setSaveTimeSuccess] = useState(false)
  const [saveTimeError, setSaveTimeError] = useState<string | null>(null)

  const [woOpen, setWoOpen] = useState(false)
  const [woTitle, setWoTitle] = useState('')
  const [woCategory, setWoCategory] = useState('')
  const [woDescription, setWoDescription] = useState('')
  const [woPriority, setWoPriority] = useState<'urgent' | 'normal' | 'low'>('normal')
  const [woLoading, setWoLoading] = useState(false)
  const [woSuccess, setWoSuccess] = useState<string | null>(null)
  const [woError, setWoError] = useState<string | null>(null)

  const roomId: string | null = room?.room_id ?? null
  const status: RoomStatus = (room?.status ?? 'DIRTY') as RoomStatus

  useEffect(() => {
    setNoteText('')
    setNoteSuccess(false)
    setNoteError(null)
    setNoteOpen(false)
    setCheckoutTimeInput(formatTimeInput(room?.checkout_time))
    setCheckoutSuccess(false)
    setCheckoutError(null)
    setUndoCheckoutError(null)
    setStayoverLoading(false)
    setStayoverError(null)
    setStayoverSuccess(false)
    setSaveTimeLoading(false)
    setSaveTimeSuccess(false)
    setSaveTimeError(null)
    setWoOpen(false)
    setWoTitle('')
    setWoCategory('')
    setWoDescription('')
    setWoPriority('normal')
    setWoSuccess(null)
    setWoError(null)
    setShowStatusHistory(false)
  }, [roomId, isOpen, room?.checkout_time])

  async function handleAddNote() {
    if (!noteText.trim() || !roomId) return
    setNoteLoading(true)
    setNoteError(null)
    try {
      await housekeepingApi.addNote(roomId, noteText.trim())
      setNoteText('')
      setNoteOpen(false)
      setNoteSuccess(true)
      setTimeout(() => setNoteSuccess(false), 4000)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
    } catch {
      setNoteError('Failed to save note. Please try again.')
    } finally {
      setNoteLoading(false)
    }
  }

  async function handleCreateWorkOrder() {
    if (!woTitle.trim() || !woCategory || !roomId) return
    setWoLoading(true)
    setWoError(null)
    try {
      await engineeringApi.createWorkOrder({
        title: woTitle.trim(),
        category: woCategory,
        description: woDescription.trim() || undefined,
        priority: woPriority,
        room_id: room?.room_id,
      })
      setWoTitle('')
      setWoDescription('')
      setWoCategory('')
      setWoPriority('normal')
      setWoOpen(false)
      const roomLabel = room?.rooms?.room_number ?? room?.room_number ?? roomId
      setWoSuccess(`Work order submitted — engineering team notified for Room ${roomLabel}`)
      setTimeout(() => setWoSuccess(null), 6000)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    } catch {
      setWoError('Failed to submit work order. Please try again.')
    } finally {
      setWoLoading(false)
    }
  }

  async function handleSaveCheckoutTime() {
    if (!roomId || !checkoutTimeInput) return
    const timeIso = buildCheckoutTimeIso(checkoutTimeInput, room?.checkout_time)
    if (!timeIso) return
    setSaveTimeLoading(true)
    setSaveTimeError(null)
    try {
      await housekeepingApi.updateCheckoutTime(roomId, timeIso)
      setSaveTimeSuccess(true)
      setTimeout(() => setSaveTimeSuccess(false), 3000)
      onCheckoutTimeSaved?.(timeIso)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    } catch {
      setSaveTimeError('Failed to save. Please try again.')
    } finally {
      setSaveTimeLoading(false)
    }
  }

  async function handleManualCheckout() {
    if (!roomId) return
    setCheckoutLoading(true)
    setCheckoutError(null)
    try {
      await housekeepingApi.markCheckedOut(roomId, {})
      setCheckoutSuccess(true)
      setTimeout(() => setCheckoutSuccess(false), 5000)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    } catch {
      setCheckoutError('Failed to mark checked out. Please try again.')
    } finally {
      setCheckoutLoading(false)
    }
  }

  async function handleUndoCheckout() {
    if (!roomId) return
    setUndoCheckoutLoading(true)
    setUndoCheckoutError(null)
    try {
      await housekeepingApi.undoCheckout(roomId)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    } catch {
      setUndoCheckoutError('Failed to undo checkout. Please try again.')
    } finally {
      setUndoCheckoutLoading(false)
    }
  }

  async function handleMarkStayover() {
    if (!roomId) return
    setStayoverLoading(true)
    setStayoverError(null)
    try {
      await roomsApi.markStayover(roomId)
      setStayoverSuccess(true)
      setTimeout(() => setStayoverSuccess(false), 5000)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['room-history-last-action', roomId] })
      queryClient.invalidateQueries({ queryKey: ['room-history', roomId] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    } catch {
      setStayoverError('Failed to mark stayover. Please try again.')
    } finally {
      setStayoverLoading(false)
    }
  }

  const prediction = room?.prediction ?? null
  const riskLevel: RiskLevel | undefined = prediction?.risk_level

  const { data: lastActionData } = useQuery({
    queryKey: ['room-history-last-action', roomId],
    queryFn: () => housekeepingApi.getRoomHistory(roomId!, 1),
    enabled: !!roomId && isOpen,
    staleTime: 15_000,
  })

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['room-history', roomId],
    queryFn: () => housekeepingApi.getRoomHistory(roomId!, 50),
    enabled: !!roomId && isOpen && canViewStatusHistory && showStatusHistory,
    staleTime: 30_000,
  })

  const { data: roomWorkOrdersData, isLoading: roomWoLoading } = useQuery({
    queryKey: ['room-work-orders', roomId],
    queryFn: () => engineeringApi.listWorkOrders({ room_id: roomId!, per_page: 50 }),
    enabled: !!roomId && isOpen && canViewStatusHistory && showStatusHistory,
    staleTime: 30_000,
  })

  const { data: roomSessionsData, isLoading: roomSessionsLoading } = useQuery({
    queryKey: ['room-clean-sessions', roomId],
    queryFn: () => cleanSessionsApi.listByRoom(roomId!, 20),
    enabled: !!roomId && isOpen && canViewStatusHistory && showStatusHistory,
    staleTime: 30_000,
  })

  const { data: roomGuestRequestsData } = useQuery({
    queryKey: ['room-guest-requests', roomId],
    queryFn: () => guestRequestsApi.listRequests({ room_id: roomId! }),
    enabled: !!roomId && isOpen,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const { data: roomTasksData } = useQuery({
    queryKey: ['room-tasks', roomId],
    queryFn: () => tasksApi.list({ room_id: roomId! }),
    enabled: !!roomId && isOpen,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const lastSessionId: string | null = room?.last_session_id ?? null
  const { data: lastSessionData } = useQuery({
    queryKey: ['clean-session', lastSessionId],
    queryFn: () => cleanSessionsApi.getSession(lastSessionId!).then((r: any) => r.data),
    enabled: !!lastSessionId && isOpen && canSupervise,
    staleTime: 120_000,
  })

  const activeGuestRequests: any[] = ((roomGuestRequestsData as any)?.data ?? []).filter(
    (r: any) => r.status === 'open' || r.status === 'in_progress',
  )
  const openTasks: any[] = ((roomTasksData as any)?.data ?? []).filter(
    (t: any) => t.status !== 'completed' && t.status !== 'cancelled',
  )

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus()
    }
  }, [isOpen])

  const roomNumber = room?.rooms?.room_number ?? room?.room_number ?? '—'
  const roomTypeName = getRoomTypeCode(room) ?? ''
  const vipFlag = !!room?.vip_flag
  const guestName: string | null = room?.guest_name ?? null
  const cleanTypeLabel = getCleanTypeLabel(room?.clean_type)
  const assignedName: string | null =
    room?.user_profiles?.preferred_name ?? room?.user_profiles?.full_name ?? null
  const openWorkOrder: string | null = room?.open_work_order_number ?? null
  const maintenanceNote: string | null = room?.maintenance_note ?? null

  const checkinTime = formatCheckinTime(prediction?.checkin_time ?? room?.checkin_time)
  const scheduledCheckoutTime = formatCheckinTime(room?.checkout_time)
  const actualCheckoutTime = formatCheckinTime(room?.actual_checkout_at)
  const lateCheckoutTime: string | null =
    room?.late_checkout_requested_time ?? room?.late_checkout_request?.requested_time ?? null
  const canMarkCheckout = (canSupervise || role === 'front_desk') && !!roomId
  const isCheckedOut = !!room?.actual_checkout_at || (room?.fo_status === 'VAC' && room?.clean_type === 'DEP')
  const canMarkStayover = canMarkCheckout && !isCheckedOut && room?.clean_type === 'DEP' && room?.fo_status === 'OCC' && !stayoverSuccess
  const etaTime = formatCheckinTime(prediction?.predicted_ready_at)
  const delayMinutes: number | null = prediction?.delay_minutes ?? null
  const riskFactors: string[] = prediction?.risk_factors ?? []

  const history: any[] = historyData?.data ?? []
  const roomWorkOrders: any[] = (roomWorkOrdersData as any)?.data ?? []
  const allGuestRequests: any[] = (roomGuestRequestsData as any)?.data ?? []
  const allTasks: any[] = (roomTasksData as any)?.data ?? []
  const roomSessions: any[] = (roomSessionsData as any)?.data ?? []
  const latestAction = lastActionData?.data?.[0] ?? null
  const lastAction = formatLastAction(latestAction, room, currentUser?.id)
  const actionNote = getActionableNote(latestAction)

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Room ${roomNumber} details`}
        className="fixed right-0 top-0 h-full w-[400px] max-w-full bg-white shadow-2xl border-l border-stone-200 z-50 flex flex-col outline-none transform transition-transform duration-300 ease-in-out"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Status accent bar */}
        <div className={`h-1.5 w-full shrink-0 ${getStatusTopBarClass(status)}`} />

        {/* Header */}
        <div className="px-5 pt-4 pb-3.5 border-b border-stone-100 shrink-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-[22px] font-black text-stone-900 tracking-tight leading-none">
                  Room {roomNumber}
                </h2>
                {roomTypeName && (
                  <span className="text-sm font-medium text-stone-400 leading-none">{roomTypeName}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${getStatusChipClass(status)}`}>
                  <Circle className="w-1.5 h-1.5 fill-current" />
                  {STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}
                </span>
                {vipFlag && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600 text-[11px] font-bold">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
                    VIP
                  </span>
                )}
                {cleanTypeLabel && (
                  <span className="text-[11px] text-stone-500 font-medium">{cleanTypeLabel}</span>
                )}
              </div>
              {(guestName || checkinTime || scheduledCheckoutTime || actualCheckoutTime || lateCheckoutTime) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-stone-400">
                  {guestName && <span>Guest: <span className="text-stone-600">{guestName}</span></span>}
                  {checkinTime && <span>In: <span className="text-stone-600">{checkinTime}</span></span>}
                  {scheduledCheckoutTime && <span>Out: <span className="text-stone-600">{scheduledCheckoutTime}</span></span>}
                  {actualCheckoutTime && (
                    <span className="text-rose-500 font-medium">Checked out: {actualCheckoutTime}</span>
                  )}
                  {lateCheckoutTime && (
                    <span className="text-rose-600 font-semibold">Late: {lateCheckoutTime}</span>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={onClose}
              className="ml-1 shrink-0 p-1.5 rounded-lg"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5 text-stone-400" />
            </Button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Status & Actions */}
          <div className="px-5 py-4 border-b border-stone-100">

            {/* Assigned / last action */}
            {(assignedName || lastAction) && (
              <div className="mb-3">
                {assignedName && (
                  <p className="text-sm text-stone-700">
                    Assigned to <span className="font-semibold">{assignedName}</span>
                  </p>
                )}
                {lastAction && (
                  <p className="text-xs text-stone-400 mt-0.5">{lastAction}</p>
                )}
              </div>
            )}

            {/* Action note */}
            {actionNote && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 leading-relaxed">
                {actionNote}
              </div>
            )}

            {/* Late checkout banner */}
            {lateCheckoutTime && (
              <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs">
                <LogOut className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                <div>
                  <p className="font-semibold text-rose-700">Late checkout requested</p>
                  <p className="mt-0.5 text-rose-500">
                    Housekeeper reported guest says {lateCheckoutTime}.
                  </p>
                </div>
              </div>
            )}

            {/* Departure checkout block */}
            {canMarkCheckout && (
              <div className="mb-4 rounded-xl border border-stone-200 bg-stone-50 p-3.5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                      <LogOut className="h-3.5 w-3.5 text-rose-500" />
                      {isCheckedOut ? 'Guest checked out' : 'Departure checkout'}
                    </div>
                    <p className="mt-0.5 text-[11px] text-stone-500">
                      {actualCheckoutTime
                        ? `Checked out at ${actualCheckoutTime}`
                        : scheduledCheckoutTime
                        ? `Scheduled for ${scheduledCheckoutTime}`
                        : 'No checkout time set'}
                    </p>
                  </div>
                  <label className="sr-only" htmlFor="room-checkout-time">Checkout time</label>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      id="room-checkout-time"
                      type="time"
                      value={checkoutTimeInput}
                      onChange={(event) => setCheckoutTimeInput(event.target.value)}
                      className="h-8 w-[86px] rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button
                      type="button"
                      onClick={handleSaveCheckoutTime}
                      disabled={saveTimeLoading || !checkoutTimeInput}
                      className="h-8 px-2.5 rounded-lg border border-stone-200 bg-white text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-40"
                    >
                      {saveTimeLoading ? '…' : saveTimeSuccess ? '✓' : 'Save'}
                    </button>
                  </div>
                </div>
                {saveTimeError && (
                  <p className="mb-2 text-[11px] text-rose-500">{saveTimeError}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {!isCheckedOut ? (
                    <button
                      type="button"
                      onClick={handleManualCheckout}
                      disabled={checkoutLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50 transition-colors"
                    >
                      {checkoutLoading ? (
                        <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      Mark Checked Out
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleUndoCheckout}
                      disabled={undoCheckoutLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50 transition-colors"
                    >
                      {undoCheckoutLoading ? (
                        <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Undo Checkout
                    </button>
                  )}
                  {checkoutSuccess && (
                    <span className="text-xs text-teal-600 font-medium">Housekeeping notified</span>
                  )}
                  {checkoutError && (
                    <span className="text-xs text-rose-500">{checkoutError}</span>
                  )}
                  {undoCheckoutError && (
                    <span className="text-xs text-rose-500">{undoCheckoutError}</span>
                  )}
                </div>
                {canMarkStayover && (
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap border-t border-stone-200 pt-2.5">
                    <button
                      type="button"
                      onClick={handleMarkStayover}
                      disabled={stayoverLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                    >
                      {stayoverLoading ? (
                        <span className="h-3 w-3 rounded-full border-2 border-blue-300 border-t-blue-700 animate-spin" />
                      ) : (
                        <BedDouble className="h-3.5 w-3.5" />
                      )}
                      Stayover
                    </button>
                    {stayoverSuccess && (
                      <span className="text-xs text-teal-600 font-medium">Marked occupied — clean cancelled</span>
                    )}
                    {stayoverError && (
                      <span className="text-xs text-rose-500">{stayoverError}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action grid */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setNoteOpen((v) => !v)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <MessageSquare className="h-4 w-4 text-blue-500" />
                <span className="text-[11px] font-semibold leading-none">Add Note</span>
              </button>
              <button
                type="button"
                onClick={() => setWoOpen((v) => !v)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Wrench className="h-4 w-4 text-orange-500" />
                <span className="text-[11px] font-semibold leading-none">Work Order</span>
              </button>
              <button
                type="button"
                onClick={() => setFoundItemOpen(true)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors"
              >
                <Package className="h-4 w-4 text-amber-500" />
                <span className="text-[11px] font-semibold leading-none">Lost &amp; Found</span>
              </button>
            </div>

            {/* OOO WO info */}
            {status === 'OOO' && (openWorkOrder || maintenanceNote) && (
              <div className="mt-3 flex items-start gap-2.5 bg-stone-50 rounded-xl p-3.5 text-xs text-stone-600 border border-stone-100">
                <Wrench className="w-3.5 h-3.5 shrink-0 mt-0.5 text-stone-400" />
                <div>
                  {openWorkOrder && <p className="font-semibold">WO-{openWorkOrder} open</p>}
                  {maintenanceNote && <p className="mt-0.5 text-stone-500">{maintenanceNote}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Success banners */}
          {(woSuccess || noteSuccess) && (
            <div className="px-5 pt-3 space-y-2">
              {woSuccess && (
                <div className="flex items-start gap-2 rounded-xl bg-teal-50 border border-teal-200 px-3.5 py-2.5 text-xs text-teal-700">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-500" />
                  <span>{woSuccess}</span>
                </div>
              )}
              {noteSuccess && (
                <div className="flex items-start gap-2 rounded-xl bg-teal-50 border border-teal-200 px-3.5 py-2.5 text-xs text-teal-700">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-teal-500" />
                  <span>Note saved</span>
                </div>
              )}
            </div>
          )}

          {/* Note form */}
          {noteOpen && (
            <div id="room-add-note-form" className="px-5 py-4 border-b border-stone-100 bg-stone-50 space-y-2.5">
              <textarea
                aria-label="Add room note"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Leave a note for your supervisor or team…"
                rows={3}
                className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none shadow-sm"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  className="text-xs px-3.5 py-2 flex items-center gap-1.5"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || noteLoading}
                >
                  {noteLoading ? (
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  {noteLoading ? 'Saving…' : 'Save Note'}
                </Button>
                <button
                  onClick={() => setNoteOpen(false)}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  Cancel
                </button>
                {noteError && (
                  <span className="text-xs text-rose-500">{noteError}</span>
                )}
              </div>
            </div>
          )}

          {/* WO form */}
          {woOpen && (
            <div id="room-report-issue-form" className="px-5 py-4 border-b border-stone-100 bg-stone-50 space-y-3">
              <div>
                <label htmlFor="room-wo-title" className="block text-xs font-semibold text-stone-500 mb-1.5">
                  Issue title <span className="text-rose-400">*</span>
                </label>
                <input
                  id="room-wo-title"
                  type="text"
                  value={woTitle}
                  onChange={(e) => setWoTitle(e.target.value)}
                  placeholder="e.g. Toilet not flushing, A/C not cooling"
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-sm"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="room-wo-category" className="block text-xs font-semibold text-stone-500 mb-1.5">
                    Category <span className="text-rose-400">*</span>
                  </label>
                  <select
                    id="room-wo-category"
                    value={woCategory}
                    onChange={(e) => setWoCategory(e.target.value)}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-sm"
                  >
                    <option value="" disabled>Select category</option>
                    {WO_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="w-28">
                  <label htmlFor="room-wo-priority" className="block text-xs font-semibold text-stone-500 mb-1.5">Priority</label>
                  <select
                    id="room-wo-priority"
                    value={woPriority}
                    onChange={(e) => setWoPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-sm"
                  >
                    <option value="urgent">Urgent</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-500 mb-1.5">Details (optional)</label>
                <textarea
                  value={woDescription}
                  onChange={(e) => setWoDescription(e.target.value)}
                  placeholder="Describe what you found…"
                  rows={2}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none shadow-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  className="text-xs px-3.5 py-2 flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600"
                  onClick={handleCreateWorkOrder}
                  disabled={!woTitle.trim() || !woCategory || woLoading}
                >
                  {woLoading ? (
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Wrench className="w-3 h-3" />
                  )}
                  {woLoading ? 'Submitting…' : 'Submit to Engineering'}
                </Button>
                <button
                  onClick={() => setWoOpen(false)}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  Cancel
                </button>
              </div>
              {woError && (
                <p className="text-xs text-rose-500">{woError}</p>
              )}
            </div>
          )}

          {/* Active guest requests */}
          {activeGuestRequests.length > 0 && (
            <div className="px-5 py-4 border-b border-stone-100">
              <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">
                Active Guest Requests
              </h3>
              <div className="space-y-2">
                {activeGuestRequests.map((req: any) => (
                  <div key={req.id} className="flex items-start gap-2.5 rounded-xl bg-stone-50 px-3.5 py-2.5 border border-stone-100">
                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-400" />
                    <div className="min-w-0">
                      <p className="text-sm text-stone-800 font-medium truncate">{req.title}</p>
                      <p className="text-[11px] text-stone-400 mt-0.5">
                        {req.status === 'in_progress' ? 'In progress' : 'Open'}
                        {req.guest_name ? ` · ${req.guest_name}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open tasks */}
          {openTasks.length > 0 && (
            <div className="px-5 py-4 border-b border-stone-100">
              <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">
                Open Tasks
              </h3>
              <div className="space-y-2">
                {openTasks.map((task: any) => (
                  <div key={task.id} className="flex items-start gap-2.5 rounded-xl bg-stone-50 px-3.5 py-2.5 border border-stone-100">
                    <ClipboardList className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                    <div className="min-w-0">
                      <p className="text-sm text-stone-800 font-medium truncate">{task.title}</p>
                      <p className="text-[11px] text-stone-400 mt-0.5">
                        {task.status.replace(/_/g, ' ')}
                        {(task.user_profiles?.preferred_name || task.user_profiles?.full_name)
                          ? ` · ${task.user_profiles?.preferred_name ?? task.user_profiles?.full_name}`
                          : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last Clean Evidence — supervisors/GMs only */}
          {canSupervise && room?.last_session_id && (
            <div className="px-5 py-4 border-b border-stone-100">
              <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">Last Clean</h3>
              <div className="flex flex-wrap gap-3 mb-3">
                {room.last_clean_minutes != null && (
                  <div className="flex items-center gap-1.5 text-xs text-stone-600">
                    <Timer className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span className="font-mono font-semibold">{room.last_clean_minutes}m</span>
                    {room.last_clean_base_minutes != null && (
                      <span className="text-stone-400">/ base {room.last_clean_base_minutes}m</span>
                    )}
                  </div>
                )}
                {room.last_clean_checklist_total > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-stone-600">
                    <CheckCircle className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span>{room.last_clean_checklist_done}/{room.last_clean_checklist_total} items</span>
                  </div>
                )}
                {room.last_clean_photo_count > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-stone-600">
                    <Camera className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span>{room.last_clean_photo_count} photo{room.last_clean_photo_count > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
              {lastSessionData?.notes && stripNoteMeta(lastSessionData.notes) && (
                <p className="text-xs text-stone-600 bg-stone-50 rounded-xl px-3.5 py-2.5 mb-3 border border-stone-100">{stripNoteMeta(lastSessionData.notes)}</p>
              )}
              {lastSessionData?.photos && lastSessionData.photos.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {lastSessionData.photos.map((photo: any) => (
                    <a
                      key={photo.id}
                      href={photo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-16 h-16 rounded-xl overflow-hidden border border-stone-200 bg-stone-100 shrink-0 hover:opacity-80 transition-opacity"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt="Clean photo" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Prediction and Status History — supervisors/GMs/front_desk only */}
          {!isHousekeeper && <>

          {/* AI Prediction Section */}
          {prediction && (
            <div className="px-5 py-4 border-b border-stone-100">
              <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">
                AI Prediction
              </h3>
              <div className={`rounded-xl p-3.5 ${
                riskLevel === 'HIGH'
                  ? 'bg-rose-50 border border-rose-200'
                  : riskLevel === 'MEDIUM'
                  ? 'bg-orange-50 border border-orange-200'
                  : 'bg-teal-50 border border-teal-200'
              }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {riskLevel === 'HIGH' || riskLevel === 'MEDIUM' ? (
                    <AlertTriangle className={`w-4 h-4 shrink-0 ${riskLevel === 'HIGH' ? 'text-rose-500' : 'text-orange-400'}`} />
                  ) : (
                    <CheckCircle className="w-4 h-4 shrink-0 text-teal-500" />
                  )}
                  <span className={`font-bold text-sm ${
                    riskLevel === 'HIGH' ? 'text-rose-700' :
                    riskLevel === 'MEDIUM' ? 'text-orange-700' :
                    'text-teal-700'
                  }`}>
                    {riskLevel ?? 'LOW'} RISK
                    {etaTime && ` — ETA ${etaTime}`}
                  </span>
                </div>
                {delayMinutes !== null && delayMinutes > 0 && checkinTime && (
                  <p className="text-xs text-stone-600 mb-1">
                    {delayMinutes} min late for check-in
                  </p>
                )}
                {riskFactors.length > 0 && (
                  <div className="text-xs text-stone-600">
                    <span className="font-medium">Risk factors: </span>
                    {riskFactors.join(', ')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Room History Section */}
          {canViewStatusHistory && (
            <div className="px-5 py-4">
              <button
                type="button"
                onClick={() => setShowStatusHistory((v) => !v)}
                aria-expanded={showStatusHistory}
                className="w-full flex items-center justify-between mb-3"
              >
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Room History</span>
                {showStatusHistory ? (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                )}
              </button>

              {showStatusHistory && (historyLoading || roomWoLoading || roomSessionsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3 animate-pulse">
                      <div className="w-2.5 h-2.5 rounded-full bg-stone-200 mt-0.5 shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 bg-stone-200 rounded-full w-24" />
                        <div className="h-3 bg-stone-200 rounded-full w-40" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (() => {
                type RoomEvent =
                  | { kind: 'note'; timestamp: string; actor: string | null; text: string }
                  | { kind: 'wo'; timestamp: string; title: string; category: string; status: string }
                  | { kind: 'gr'; timestamp: string; title: string; status: string }
                  | { kind: 'task'; timestamp: string; title: string; status: string }
                  | { kind: 'session'; timestamp: string; durationSeconds: number | null; checklistDone: number; checklistTotal: number; status: string }

                const noteEvents: RoomEvent[] = history
                  .filter((entry: any) => {
                    const raw: string | null = entry.notes ?? entry.note ?? null
                    const text = raw ? stripNoteMeta(raw) : null
                    if (!text) return false
                    return !SYSTEM_NOTE_REGEXES.some(r => r.test(text))
                  })
                  .map((entry: any): RoomEvent => {
                    const raw: string = entry.notes ?? entry.note ?? ''
                    return {
                      kind: 'note',
                      timestamp: entry.created_at ?? entry.changed_at ?? '',
                      actor: entry.actor_name ?? entry.user_profiles?.preferred_name ?? null,
                      text: stripNoteMeta(raw),
                    }
                  })

                const woEvents: RoomEvent[] = roomWorkOrders.map((wo: any): RoomEvent => ({
                  kind: 'wo',
                  timestamp: wo.created_at ?? '',
                  title: wo.title ?? 'Work order',
                  category: wo.category ?? '',
                  status: wo.status ?? '',
                }))

                const grEvents: RoomEvent[] = allGuestRequests.map((gr: any): RoomEvent => ({
                  kind: 'gr',
                  timestamp: gr.created_at ?? '',
                  title: gr.title ?? 'Guest request',
                  status: gr.status ?? '',
                }))

                const taskEvents: RoomEvent[] = allTasks.map((t: any): RoomEvent => ({
                  kind: 'task',
                  timestamp: t.created_at ?? '',
                  title: t.title ?? 'Task',
                  status: t.status ?? '',
                }))

                const sessionEvents: RoomEvent[] = roomSessions.map((s: any): RoomEvent => ({
                  kind: 'session',
                  timestamp: s.started_at ?? '',
                  durationSeconds: s.duration_seconds ?? null,
                  checklistDone: s.checklist_done ?? 0,
                  checklistTotal: s.checklist_total ?? 0,
                  status: s.status ?? '',
                }))

                const events: RoomEvent[] = [...noteEvents, ...woEvents, ...grEvents, ...taskEvents, ...sessionEvents].sort(
                  (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
                )

                if (events.length === 0) {
                  return <p className="text-sm text-stone-400 text-center py-4">No room history yet</p>
                }

                return (
                  <div className="relative">
                    <div className="absolute left-1 top-2 bottom-2 w-px bg-stone-200" />
                    <div className="space-y-4">
                      {events.map((event, index) => (
                        <div key={index} className="flex items-start gap-3 pl-1">
                          <div className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 border-2 border-white ${
                            index === 0 ? 'bg-stone-700' : 'bg-stone-300'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              {event.kind === 'wo' && <Wrench className="w-3 h-3 text-orange-400 shrink-0" />}
                              {event.kind === 'note' && <MessageSquare className="w-3 h-3 text-blue-400 shrink-0" />}
                              {event.kind === 'gr' && <MessageSquare className="w-3 h-3 text-violet-400 shrink-0" />}
                              {event.kind === 'task' && <ClipboardList className="w-3 h-3 text-amber-400 shrink-0" />}
                              {event.kind === 'session' && <CheckCircle className="w-3 h-3 text-teal-400 shrink-0" />}
                              <span className="text-xs text-stone-400 shrink-0">
                                {event.timestamp ? formatHistoryTimestamp(event.timestamp) : '—'}
                              </span>
                              {event.kind === 'note' && event.actor && (
                                <span className="text-xs text-stone-500 truncate">— {event.actor}</span>
                              )}
                            </div>
                            {event.kind === 'note' && (
                              <p className="text-xs text-stone-700 leading-snug">{event.text}</p>
                            )}
                            {event.kind === 'wo' && (
                              <>
                                <p className="text-xs font-medium text-stone-800 leading-snug">{event.title}</p>
                                <p className="text-[11px] text-stone-400 mt-0.5 capitalize">
                                  {event.category}{event.status ? ` · ${event.status.replace(/_/g, ' ')}` : ''}
                                </p>
                              </>
                            )}
                            {event.kind === 'gr' && (
                              <>
                                <p className="text-xs font-medium text-stone-800 leading-snug">{event.title}</p>
                                <p className="text-[11px] text-stone-400 mt-0.5 capitalize">{event.status.replace(/_/g, ' ')}</p>
                              </>
                            )}
                            {event.kind === 'task' && (
                              <>
                                <p className="text-xs font-medium text-stone-800 leading-snug">{event.title}</p>
                                <p className="text-[11px] text-stone-400 mt-0.5 capitalize">{event.status.replace(/_/g, ' ')}</p>
                              </>
                            )}
                            {event.kind === 'session' && (
                              <p className="text-xs text-stone-700 leading-snug">
                                Clean session
                                {event.durationSeconds != null ? ` · ${Math.round(event.durationSeconds / 60)}m` : ''}
                                {event.checklistTotal > 0 ? ` · ${event.checklistDone}/${event.checklistTotal} items` : ''}
                                {event.status === 'abandoned' ? ' · abandoned' : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })())}
            </div>
          )}
          </>}
        </div>

      </div>
      <LogFoundItemModal
        isOpen={foundItemOpen}
        roomId={roomId ?? undefined}
        roomNumber={roomNumber}
        compact
        onClose={() => setFoundItemOpen(false)}
        onCreate={() => setFoundItemOpen(false)}
      />
    </>
  )
}
