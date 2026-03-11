'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  AlertTriangle,
  CheckCircle,
  Clock,
  Star,
  User,
  Wrench,
  Circle,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { useRole } from '@/lib/hooks/useRole'
import { InspectionModal } from '@/components/housekeeping/InspectionModal'

interface Props {
  room: any | null
  isOpen: boolean
  onClose: () => void
  onStatusChange: (roomId: string, newStatus: string) => void
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
    case 'DIRTY': return 'text-red-500'
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
    case 'DIRTY': return 'text-red-700'
    case 'IN_PROGRESS': return 'text-blue-700'
    case 'CLEAN': return 'text-yellow-700'
    case 'INSPECTED': return 'text-green-700'
    case 'OOO': return 'text-gray-600'
    case 'PICKUP': return 'text-purple-700'
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
    CLEAN: 'Mark Clean',
    INSPECTED: 'Mark Inspected',
    OOO: 'Mark Out of Order',
    PICKUP: 'Mark Pickup',
  }

  const styles: Record<RoomStatus, string> = {
    DIRTY: 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200',
    IN_PROGRESS: 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
    CLEAN: 'bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200',
    INSPECTED: 'bg-green-600 text-white border-green-600 hover:bg-green-700',
    OOO: 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200',
    PICKUP: 'bg-purple-100 text-purple-700 border-purple-300 hover:bg-purple-200',
  }

  return (
    <button
      className={`text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors ${styles[targetStatus]}`}
      onClick={() => onStatusChange(roomId, targetStatus)}
    >
      {labels[targetStatus]}
    </button>
  )
}

export function RoomDetailDrawer({ room, isOpen, onClose, onStatusChange }: Props) {
  const { role, isSupervisor, isGM } = useRole()
  const isHousekeeper = role === 'housekeeper'
  const canSupervise = isSupervisor || isGM
  const drawerRef = useRef<HTMLDivElement>(null)
  const [showInspectionModal, setShowInspectionModal] = useState(false)

  const roomId: string | null = room?.room_id ?? null
  const status: RoomStatus = (room?.status ?? 'DIRTY') as RoomStatus
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
      // Housekeepers can only move DIRTY→IN_PROGRESS and IN_PROGRESS→CLEAN
      return (
        (status === 'DIRTY' && t === 'IN_PROGRESS') ||
        (status === 'IN_PROGRESS' && t === 'CLEAN')
      )
    }
    // Supervisors and GMs can do all transitions
    if (canSupervise) return true
    return false
  })

  const roomNumber = room?.rooms?.room_number ?? room?.room_number ?? '—'
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

  const history: any[] = historyData?.data?.history ?? historyData?.history ?? []

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
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
        className="fixed right-0 top-0 h-full w-[400px] max-w-full bg-white shadow-2xl z-50 flex flex-col outline-none
          transform transition-transform duration-300 ease-in-out"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 leading-tight">
              Room {roomNumber}
              {roomTypeName && (
                <span className="font-normal text-gray-500"> — {roomTypeName}</span>
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              {vipFlag && (
                <div className="flex items-center gap-0.5">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-400" />
                  <span className="text-xs font-semibold text-yellow-600">VIP</span>
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
          <button
            onClick={onClose}
            className="ml-2 shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Current Status Section */}
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Current Status
            </h3>
            <div className="flex items-center gap-2 mb-3">
              <Circle className={`w-4 h-4 fill-current ${getStatusDotClass(status)}`} />
              <span className={`font-semibold text-sm ${getStatusTextClass(status)}`}>
                {status.replace(/_/g, ' ')}
              </span>
              {assignedName && (
                <span className="text-sm text-gray-500">— Assigned to {assignedName}</span>
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
                  <button
                    onClick={() => setShowInspectionModal(true)}
                    className="text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors bg-green-600 text-white border-green-600 hover:bg-green-700"
                  >
                    Inspect Room
                  </button>
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

          {/* AI Prediction Section */}
          {prediction && (
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                AI Prediction
              </h3>

              <div className={`rounded-lg p-3 ${
                riskLevel === 'HIGH'
                  ? 'bg-red-50 border border-red-200'
                  : riskLevel === 'MEDIUM'
                  ? 'bg-orange-50 border border-orange-200'
                  : 'bg-green-50 border border-green-200'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  {riskLevel === 'HIGH' || riskLevel === 'MEDIUM' ? (
                    <AlertTriangle className={`w-4 h-4 shrink-0 ${riskLevel === 'HIGH' ? 'text-red-500' : 'text-orange-400'}`} />
                  ) : (
                    <CheckCircle className="w-4 h-4 shrink-0 text-green-500" />
                  )}
                  <span className={`font-semibold text-sm ${
                    riskLevel === 'HIGH' ? 'text-red-700' :
                    riskLevel === 'MEDIUM' ? 'text-orange-700' :
                    'text-green-700'
                  }`}>
                    {riskLevel ?? 'LOW'} RISK
                    {etaTime && ` — ETA ${etaTime}`}
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
                    const entryStatus: string = entry.status ?? entry.new_status ?? ''
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
                              {timestamp ? formatHistoryTimestamp(timestamp) : '—'}
                            </span>
                            <span className={`text-xs font-semibold ${getStatusTextClass(entryStatus)}`}>
                              {entryStatus.replace(/_/g, ' ')}
                            </span>
                            {actor && (
                              <span className="text-xs text-gray-500 truncate">
                                — {actor}
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
      </div>

      <InspectionModal
        roomId={room?.room_id ?? ''}
        roomNumber={roomNumber}
        isOpen={showInspectionModal}
        onClose={() => setShowInspectionModal(false)}
        onSuccess={() => {
          setShowInspectionModal(false)
          onStatusChange(room?.room_id ?? '', 'INSPECTED')
          onClose()
        }}
      />
    </>
  )
}
