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
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { getCleanTypeLabel } from '@/lib/utils/cleanType'
import { STATUS_LABELS } from '@/lib/utils/roomStatus'
import { Button } from '@/components/ui/Button'

const WO_CATEGORIES = [
  { value: 'plumbing',    label: 'Plumbing' },
  { value: 'electrical',  label: 'Electrical' },
  { value: 'hvac',        label: 'HVAC / A/C' },
  { value: 'furniture',   label: 'Furniture' },
  { value: 'appliance',   label: 'Appliance' },
  { value: 'structural',  label: 'Structural' },
  { value: 'safety',      label: 'Safety' },
  { value: 'general',     label: 'General' },
]

interface Props {
  room: any | null
  isOpen: boolean
  onClose: () => void
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

function getActionableNote(entry: any | null): string | null {
  const note = entry?.notes ?? entry?.note ?? null
  const status = entry?.to_status ?? ''
  if (!note || !['DIRTY', 'PICKUP', 'IN_PROGRESS'].includes(status)) return null
  return note
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case 'DIRTY': return 'text-[var(--alert)]'
    case 'IN_PROGRESS': return 'text-[var(--progress)]'
    case 'OCCUPIED': return 'text-[var(--alert)]'
    case 'CLEAN': return 'text-[var(--info)]'
    case 'INSPECTED': return 'text-[var(--ready)]'
    case 'OOO': return 'text-[var(--accent)]'
    case 'OUT_OF_ORDER': return 'text-[var(--accent)]'
    case 'OUT_OF_SERVICE': return 'text-[var(--accent)]'
    case 'PICKUP': return 'text-[var(--caution)]'
    default: return 'text-gray-400'
  }
}

function getStatusTextClass(status: string): string {
  switch (status) {
    case 'DIRTY': return 'text-[var(--alert)]'
    case 'IN_PROGRESS': return 'text-[var(--progress)]'
    case 'OCCUPIED': return 'text-[var(--alert)]'
    case 'CLEAN': return 'text-[var(--info)]'
    case 'INSPECTED': return 'text-[var(--ready)]'
    case 'OOO': return 'text-[var(--accent)]'
    case 'OUT_OF_ORDER': return 'text-[var(--accent)]'
    case 'OUT_OF_SERVICE': return 'text-[var(--accent)]'
    case 'PICKUP': return 'text-[var(--caution)]'
    default: return 'text-gray-600'
  }
}

export function RoomDetailDrawer({ room, isOpen, onClose }: Props) {
  const { role, isSupervisor, isGM } = useRole()
  const isHousekeeper = role === 'housekeeper'
  const canSupervise = isSupervisor || isGM
  const canViewStatusHistory = canSupervise || role === 'front_desk'
  const currentUser = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  const [showStatusHistory, setShowStatusHistory] = useState(false)

  // â”€â”€ Note state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [noteText, setNoteText] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteSuccess, setNoteSuccess] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  // â”€â”€ Work order state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [woOpen, setWoOpen] = useState(false)
  const [woTitle, setWoTitle] = useState('')
  const [woCategory, setWoCategory] = useState('general')
  const [woDescription, setWoDescription] = useState('')
  const [woPriority, setWoPriority] = useState<'urgent' | 'normal' | 'low'>('normal')
  const [woLoading, setWoLoading] = useState(false)
  const [woSuccess, setWoSuccess] = useState<string | null>(null)
  const [woError, setWoError] = useState<string | null>(null)

  const roomId: string | null = room?.room_id ?? null
  const status: RoomStatus = (room?.status ?? 'DIRTY') as RoomStatus

  // Reset note/WO forms when room changes or drawer closes (covers reopening same room)
  useEffect(() => {
    setNoteText('')
    setNoteSuccess(false)
    setNoteError(null)
    setNoteOpen(false)
    setWoOpen(false)
    setWoTitle('')
    setWoCategory('general')
    setWoDescription('')
    setWoPriority('normal')
    setWoSuccess(null)
    setWoError(null)
    setShowStatusHistory(false)
  }, [roomId, isOpen])

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
    if (!woTitle.trim() || !roomId) return
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
      setWoCategory('general')
      setWoPriority('normal')
      setWoOpen(false)
      const roomLabel = room?.rooms?.room_number ?? room?.room_number ?? roomId
      setWoSuccess(`Work order submitted â€” engineering team notified for Room ${roomLabel}`)
      setTimeout(() => setWoSuccess(null), 6000)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    } catch {
      setWoError('Failed to submit work order. Please try again.')
    } finally {
      setWoLoading(false)
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

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Trap focus inside drawer
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus()
    }
  }, [isOpen])

  const roomNumber = room?.rooms?.room_number ?? room?.room_number ?? 'â€”'
  const roomTypeName = room?.rooms?.room_types?.name ?? room?.room_type_name ?? ''
  const vipFlag = !!room?.vip_flag
  const guestName: string | null = room?.guest_name ?? null
  const cleanTypeLabel = getCleanTypeLabel(room?.clean_type)
  const assignedName: string | null =
    room?.user_profiles?.preferred_name ?? room?.user_profiles?.full_name ?? null
  const openWorkOrder: string | null = room?.open_work_order_number ?? null
  const maintenanceNote: string | null = room?.maintenance_note ?? null

  const checkinTime = formatCheckinTime(prediction?.checkin_time ?? room?.checkin_time)
  const etaTime = formatCheckinTime(prediction?.predicted_ready_at)
  const delayMinutes: number | null = prediction?.delay_minutes ?? null
  const riskFactors: string[] = prediction?.risk_factors ?? []

  const history: any[] = historyData?.data ?? []
  const latestAction = lastActionData?.data?.[0] ?? null
  const lastAction = formatLastAction(latestAction, room, currentUser?.id)
  const actionNote = getActionableNote(latestAction)

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-40 transition-opacity"
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
        className="fixed right-0 top-0 h-full w-[400px] max-w-full bg-surface/[0.88] backdrop-blur-2xl border-l border-white/[0.95] z-50 flex flex-col outline-none
          transform transition-transform duration-300 ease-in-out"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-white/60 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 leading-tight">
              Room {roomNumber}
              {roomTypeName && (
                <span className="font-normal text-gray-500"> â€” {roomTypeName}</span>
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              {vipFlag && (
                <div className="flex items-center gap-0.5">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-400" />
                  <span className="text-xs font-semibold text-[var(--caution)]">VIP</span>
                </div>
              )}
              {guestName && (
                <span className="text-xs text-gray-500">Guest: {guestName}</span>
              )}
              {checkinTime && (
                <span className="text-xs text-gray-500">
                  Check-in: {checkinTime} Today
                </span>
              )}
              {cleanTypeLabel && (
                <span className="text-xs text-gray-500">
                  Service: {cleanTypeLabel}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={onClose}
            className="ml-2 shrink-0 p-1.5 rounded-lg"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Current Status Section */}
          <div className="p-4 border-b border-white/60">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Current Status
            </h3>
            <div className="flex items-center gap-2 mb-3">
              <Circle className={`w-4 h-4 fill-current ${getStatusDotClass(status)}`} />
              <span className={`font-semibold text-base ${getStatusTextClass(status)}`}>
                {STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}
              </span>
              {assignedName && (
                <span className="text-sm text-gray-500">â€” Assigned to {assignedName}</span>
              )}
            </div>
            {lastAction && (
              <p className="text-xs text-gray-500 mb-3">
                Last action: {lastAction}
              </p>
            )}
            {actionNote && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 mb-3">
                {actionNote}
              </div>
            )}
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Add Note
              </button>
              <button
                type="button"
                onClick={() => setWoOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100"
              >
                <Wrench className="h-3.5 w-3.5" />
                Submit Work Order
              </button>
            </div>

            {status === 'OOO' && (openWorkOrder || maintenanceNote) && (
              <div className="flex items-start gap-2 bg-gray-50 rounded-lg p-2 mb-3 text-xs text-gray-600">
                <Wrench className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                <div>
                  {openWorkOrder && <p className="font-medium">WO-{openWorkOrder} open</p>}
                  {maintenanceNote && <p className="mt-0.5">{maintenanceNote}</p>}
                </div>
              </div>
            )}
          </div>

          {/* WO success / error banners */}
          {woSuccess && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-[var(--ready-soft)] border border-[var(--ready-line)] px-3 py-2 text-xs text-[var(--ready)]">
              <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-green-500" />
              <span>{woSuccess}</span>
            </div>
          )}
          {noteSuccess && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-[var(--ready-soft)] border border-[var(--ready-line)] px-3 py-2 text-xs text-[var(--ready)]">
              <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-green-500" />
              <span>Note saved</span>
            </div>
          )}

          {noteOpen && (
          <div id="room-add-note-form" className="p-4 border-b border-white/60 space-y-2">
              <textarea
                aria-label="Add room note"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Leave a note for your supervisor or teamâ€¦"
                rows={2}
                className="w-full rounded-lg border border-gray-200 bg-surface/70 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  className="text-xs px-3 py-1.5 flex items-center gap-1.5"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || noteLoading}
                >
                  {noteLoading ? (
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  {noteLoading ? 'Savingâ€¦' : 'Save Note'}
                </Button>
                {noteError && (
                  <span className="text-xs text-[var(--alert)]">{noteError}</span>
                )}
                <button
                  onClick={() => setNoteOpen(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {woOpen && (
          <div id="room-report-issue-form" className="p-4 border-b border-white/60 space-y-2.5">
                <div>
                  <label htmlFor="room-wo-title" className="block text-xs text-gray-500 mb-1">Issue title <span className="text-[var(--alert)]">*</span></label>
                  <input
                    id="room-wo-title"
                    type="text"
                    value={woTitle}
                    onChange={(e) => setWoTitle(e.target.value)}
                    placeholder="e.g. Toilet not flushing, A/C not cooling"
                    className="w-full rounded-lg border border-gray-200 bg-surface/70 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label htmlFor="room-wo-category" className="block text-xs text-gray-500 mb-1">Category</label>
                    <select
                      id="room-wo-category"
                      value={woCategory}
                      onChange={(e) => setWoCategory(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-surface/70 px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      {WO_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label htmlFor="room-wo-priority" className="block text-xs text-gray-500 mb-1">Priority</label>
                    <select
                      id="room-wo-priority"
                      value={woPriority}
                      onChange={(e) => setWoPriority(e.target.value as 'urgent' | 'normal' | 'low')}
                      className="w-full rounded-lg border border-gray-200 bg-surface/70 px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value="urgent">Urgent</option>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">Details (optional)</label>
                  <textarea
                    value={woDescription}
                    onChange={(e) => setWoDescription(e.target.value)}
                    placeholder="Describe what you foundâ€¦"
                    rows={2}
                    className="w-full rounded-lg border border-gray-200 bg-surface/70 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    className="text-xs px-3 py-1.5 flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600"
                    onClick={handleCreateWorkOrder}
                    disabled={!woTitle.trim() || woLoading}
                  >
                    {woLoading ? (
                      <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Wrench className="w-3 h-3" />
                    )}
                    {woLoading ? 'Submittingâ€¦' : 'Submit to Engineering'}
                  </Button>
                  <button
                    onClick={() => setWoOpen(false)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cancel
                  </button>
                </div>
                {woError && (
                  <p className="text-xs text-[var(--alert)]">{woError}</p>
                )}
              </div>
          )}

          {/* AI Prediction and Status History — supervisors/GMs/front_desk only */}
          {!isHousekeeper && <>

          {/* AI Prediction Section */}
          {prediction && (
            <div className="p-4 border-b border-white/60">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                AI Prediction
              </h3>

              <div className={`rounded-lg p-3 ${
                riskLevel === 'HIGH'
                  ? 'bg-[var(--alert-soft)] border border-[var(--alert-line)]'
                  : riskLevel === 'MEDIUM'
                  ? 'bg-orange-50 border border-orange-200'
                  : 'bg-[var(--ready-soft)] border border-[var(--ready-line)]'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  {riskLevel === 'HIGH' || riskLevel === 'MEDIUM' ? (
                    <AlertTriangle className={`w-4 h-4 shrink-0 ${riskLevel === 'HIGH' ? 'text-[var(--alert)]' : 'text-orange-400'}`} />
                  ) : (
                    <CheckCircle className="w-4 h-4 shrink-0 text-green-500" />
                  )}
                  <span className={`font-semibold text-sm ${
                    riskLevel === 'HIGH' ? 'text-[var(--alert)]' :
                    riskLevel === 'MEDIUM' ? 'text-orange-700' :
                    'text-[var(--ready)]'
                  }`}>
                    {riskLevel ?? 'LOW'} RISK
                    {etaTime && ` â€” ETA ${etaTime}`}
                  </span>
                </div>

                {delayMinutes !== null && delayMinutes > 0 && checkinTime && (
                  <p className="text-xs text-gray-600 mb-1">
                    {delayMinutes} min late for check-in
                  </p>
                )}

                {riskFactors.length > 0 && (
                  <div className="text-xs text-gray-600">
                    <span className="font-medium">Risk factors: </span>
                    {riskFactors.join(', ')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status History Section */}
          {canViewStatusHistory && (
          <div className="p-4">
            <button
              type="button"
              onClick={() => setShowStatusHistory((value) => !value)}
              aria-expanded={showStatusHistory}
              className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3"
            >
              <span>Status History</span>
              {showStatusHistory ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>

            {showStatusHistory && (historyLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-3 animate-pulse">
                    <div className="w-2 h-2 rounded-full bg-gray-200 mt-1.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 bg-gray-200 rounded w-24" />
                      <div className="h-3 bg-gray-200 rounded w-40" />
                    </div>
                  </div>
                ))}
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-400">No history available</p>
            ) : (
              <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-1 top-2 bottom-2 w-px bg-gray-200" />

                <div className="space-y-4">
                  {history.map((entry: any, index: number) => {
                    const entryStatus: string = entry.to_status ?? entry.status ?? entry.new_status ?? ''
                    const fromStatus: string | null = entry.from_status ?? null
                    const timestamp: string = entry.created_at ?? entry.changed_at ?? ''
                    const actor: string | null =
                      entry.actor_name ?? entry.user_profiles?.preferred_name ?? null
                    const note: string | null = entry.notes ?? entry.note ?? null

                    return (
                      <div key={index} className="flex items-start gap-3 pl-1">
                        {/* Timeline dot */}
                        <div className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 border-2 border-white ${
                          index === 0 ? 'bg-gray-700' : 'bg-gray-300'
                        }`} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-1.5 flex-wrap">
                            <span className="text-xs text-gray-400 shrink-0">
                              {timestamp ? formatHistoryTimestamp(timestamp) : 'â€”'}
                            </span>
                            {fromStatus ? (
                              <>
                                <span className={`text-xs font-semibold ${getStatusTextClass(fromStatus)}`}>
                                  {STATUS_LABELS[fromStatus] ?? fromStatus.replace(/_/g, ' ')}
                                </span>
                                <span className="text-xs text-gray-400">â†’</span>
                                <span className={`text-xs font-semibold ${getStatusTextClass(entryStatus)}`}>
                                  {STATUS_LABELS[entryStatus] ?? entryStatus.replace(/_/g, ' ')}
                                </span>
                              </>
                            ) : (
                              <span className={`text-xs font-semibold ${getStatusTextClass(entryStatus)}`}>
                                {STATUS_LABELS[entryStatus] ?? entryStatus.replace(/_/g, ' ')}
                              </span>
                            )}
                            {actor && (
                              <span className="text-xs text-gray-500 truncate">
                                â€” {actor}
                              </span>
                            )}
                          </div>
                          {note && (
                            <p className="text-xs text-gray-500 mt-0.5 leading-snug">{note}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          )}
          </>}
        </div>

      </div>
    </>
  )
}
