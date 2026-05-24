'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  TriangleAlert,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { engineeringApi } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { STATUS_LABELS } from '@/lib/utils/roomStatus'
import { InspectionModal } from '@/components/housekeeping/InspectionModal'
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
  onStatusChange: (roomId: string, newStatus: string) => void
  cleanQueue?: any[]
  onNextRoom?: (room: any) => void
}

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

// Valid status transitions
const STATUS_TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  DIRTY: ['IN_PROGRESS', 'OOO'],
  IN_PROGRESS: ['CLEAN', 'DIRTY'],
  CLEAN: ['INSPECTED', 'DIRTY'],
  INSPECTED: ['DIRTY'],
  OOO: ['DIRTY'],
  PICKUP: ['DIRTY', 'CLEAN'],
}

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

function getStatusDotClass(status: string): string {
  switch (status) {
    case 'DIRTY': return 'text-[var(--alert)]'
    case 'IN_PROGRESS': return 'text-blue-500'
    case 'CLEAN': return 'text-yellow-500'
    case 'INSPECTED': return 'text-green-500'
    case 'OOO': return 'text-gray-400'
    case 'PICKUP': return 'text-purple-500'
    default: return 'text-gray-400'
  }
}

function getStatusTextClass(status: string): string {
  switch (status) {
    case 'DIRTY': return 'text-[var(--alert)]'
    case 'IN_PROGRESS': return 'text-[var(--info)]'
    case 'CLEAN': return 'text-yellow-700'
    case 'INSPECTED': return 'text-[var(--ready)]'
    case 'OOO': return 'text-gray-600'
    case 'PICKUP': return 'text-[var(--ai)]'
    default: return 'text-gray-600'
  }
}

function TransitionButton({
  targetStatus,
  onStatusChange,
  roomId,
}: {
  targetStatus: RoomStatus
  onStatusChange: (roomId: string, newStatus: string) => void
  roomId: string
}) {
  const labels: Record<RoomStatus, string> = {
    DIRTY: 'Mark Dirty',
    IN_PROGRESS: 'Mark In Progress',
    CLEAN: 'Mark Ready for Inspection',
    INSPECTED: 'Mark Clean',
    OOO: 'Mark Out of Order',
    PICKUP: 'Mark Pickup',
  }

  const variants: Record<RoomStatus, 'primary' | 'secondary' | 'destructive' | 'ghost'> = {
    DIRTY: 'destructive',
    IN_PROGRESS: 'primary',
    CLEAN: 'secondary',
    INSPECTED: 'primary',
    OOO: 'ghost',
    PICKUP: 'secondary',
  }

  return (
    <Button
      variant={variants[targetStatus]}
      className="text-sm px-3 py-1.5"
      onClick={() => onStatusChange(roomId, targetStatus)}
    >
      {labels[targetStatus]}
    </Button>
  )
}

export function RoomDetailDrawer({ room, isOpen, onClose, onStatusChange, cleanQueue, onNextRoom }: Props) {
  const { role, isSupervisor, isGM } = useRole()
  const isHousekeeper = role === 'housekeeper'
  const canSupervise = isSupervisor || isGM
  const queryClient = useQueryClient()
  const drawerRef = useRef<HTMLDivElement>(null)
  const [showInspectionModal, setShowInspectionModal] = useState(false)
  const [showNextBanner, setShowNextBanner] = useState(false)

  // â”€â”€ Note state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [noteText, setNoteText] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteSuccess, setNoteSuccess] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

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
    setWoOpen(false)
    setWoTitle('')
    setWoCategory('general')
    setWoDescription('')
    setWoPriority('normal')
    setWoSuccess(null)
    setWoError(null)
    setShowNextBanner(false)
  }, [roomId, isOpen])

  const nextCleanRoom = useMemo(() => {
    if (!cleanQueue?.length || !room) return null
    const others = cleanQueue.filter((r) => r.room_id !== room.room_id)
    return others[0] ?? null
  }, [cleanQueue, room])

  const remainingCount = useMemo(() => {
    if (!cleanQueue || !room) return 0
    return cleanQueue.filter((r) => r.room_id !== room.room_id).length
  }, [cleanQueue, room])

  async function handleAddNote() {
    if (!noteText.trim() || !roomId) return
    setNoteLoading(true)
    setNoteError(null)
    try {
      await housekeepingApi.addNote(roomId, noteText.trim())
      setNoteText('')
      setNoteSuccess(true)
      setTimeout(() => setNoteSuccess(false), 4000)
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
    } catch {
      setWoError('Failed to submit work order. Please try again.')
    } finally {
      setWoLoading(false)
    }
  }
  const prediction = room?.prediction ?? null
  const riskLevel: RiskLevel | undefined = prediction?.risk_level

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['room-history', roomId],
    queryFn: () => housekeepingApi.getRoomHistory(roomId!),
    enabled: !!roomId && isOpen,
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

  // Available transitions based on role
  const allTransitions = STATUS_TRANSITIONS[status] ?? []
  const availableTransitions = allTransitions.filter((t) => {
    if (isHousekeeper) {
      // Housekeepers can only move DIRTYâ†’IN_PROGRESS and IN_PROGRESSâ†’CLEAN
      return (
        (status === 'DIRTY' && t === 'IN_PROGRESS') ||
        (status === 'IN_PROGRESS' && t === 'CLEAN')
      )
    }
    // Supervisors and GMs can do all transitions
    if (canSupervise) return true
    return false
  })

  const roomNumber = room?.rooms?.room_number ?? room?.room_number ?? 'â€”'
  const roomTypeName = room?.rooms?.room_types?.name ?? room?.room_type_name ?? ''
  const vipFlag = !!room?.vip_flag
  const guestName: string | null = room?.guest_name ?? null
  const assignedName: string | null =
    room?.user_profiles?.preferred_name ?? room?.user_profiles?.full_name ?? null
  const openWorkOrder: string | null = room?.open_work_order_number ?? null
  const maintenanceNote: string | null = room?.maintenance_note ?? null

  const checkinTime = formatCheckinTime(prediction?.checkin_time ?? room?.checkin_time)
  const etaTime = formatCheckinTime(prediction?.predicted_ready_at)
  const delayMinutes: number | null = prediction?.delay_minutes ?? null
  const riskFactors: string[] = prediction?.risk_factors ?? []

  const history: any[] = historyData?.data ?? []

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
              <span className={`font-semibold text-sm ${getStatusTextClass(status)}`}>
                {STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}
              </span>
              {assignedName && (
                <span className="text-sm text-gray-500">â€” Assigned to {assignedName}</span>
              )}
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

            {(availableTransitions.length > 0 || (status === 'CLEAN' && canSupervise)) && (
              <div className="flex flex-wrap gap-2">
                {status === 'CLEAN' && canSupervise && (
                  <Button
                    variant="primary"
                    className="text-sm px-3 py-1.5"
                    onClick={() => setShowInspectionModal(true)}
                  >
                    Inspect &amp; Mark Clean
                  </Button>
                )}
                {availableTransitions.map((t) => (
                  <TransitionButton
                    key={t}
                    targetStatus={t}
                    onStatusChange={(id, s) => { onStatusChange(id, s); }}
                    roomId={room.room_id}
                  />
                ))}
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

          {/* Add Note Section */}
          <div className="p-4 border-b border-white/60">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              Add Note
            </h3>
            <div className="space-y-2">
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
                {noteSuccess && (
                  <span className="text-xs text-[var(--ready)] font-medium flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> Note saved
                  </span>
                )}
                {noteError && (
                  <span className="text-xs text-[var(--alert)]">{noteError}</span>
                )}
              </div>
            </div>
          </div>

          {/* Report Issue (Work Order) Section */}
          <div className="p-4 border-b border-white/60">
            <button
              onClick={() => setWoOpen((v) => !v)}
              aria-expanded={woOpen}
              aria-controls="room-report-issue-form"
              className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wide"
            >
              <span className="flex items-center gap-1.5">
                <TriangleAlert className="w-3.5 h-3.5 text-orange-400" />
                Report Issue
              </span>
              {woOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>

            {woOpen && (
              <div id="room-report-issue-form" className="mt-3 space-y-2.5">
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
          </div>

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
          <div className="p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Status History
            </h3>

            {historyLoading ? (
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
            )}
          </div>
        </div>

        {/* Inspect queue banner â€” shown after a successful inspection when more CLEAN rooms exist */}
        {showNextBanner && nextCleanRoom && (
          <div className="shrink-0 border-t border-[var(--ready-line)] bg-[var(--ready-soft)] px-4 py-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[var(--ready)] shrink-0" />
            <span className="text-sm text-green-800 flex-1 leading-tight">
              Inspected Â· <strong>{remainingCount}</strong> room{remainingCount !== 1 ? 's' : ''} left
            </span>
            <button
              onClick={() => { setShowNextBanner(false); onNextRoom!(nextCleanRoom) }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors shrink-0"
            >
              Next â†’
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-green-300 text-[var(--ready)] hover:bg-green-100 transition-colors shrink-0"
            >
              Done
            </button>
          </div>
        )}
      </div>

      <InspectionModal
        roomId={room?.room_id ?? ''}
        roomNumber={roomNumber}
        isOpen={showInspectionModal}
        onClose={() => setShowInspectionModal(false)}
        onSuccess={() => {
          setShowInspectionModal(false)
          if (nextCleanRoom && onNextRoom) {
            setShowNextBanner(true)
          } else {
            onClose()
          }
        }}
      />
    </>
  )
}
