'use client'

import { AlertTriangle, Clock, User, Wrench } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useRole } from '@/lib/hooks/useRole'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { STATUS_SHORT_LABELS } from '@/lib/utils/roomStatus'

// ── Status → card bg + border ────────────────────────────────────────────────

const STATUS_CARD_STYLES: Record<string, string> = {
  DIRTY:          'bg-red-50 border-2 border-red-200',
  IN_PROGRESS:    'bg-blue-50 border-2 border-blue-200',
  CLEAN:          'bg-green-50 border-2 border-green-200',
  INSPECTED:      'bg-emerald-50 border-2 border-emerald-300',
  DO_NOT_DISTURB: 'bg-stone-100 border-2 border-stone-200 opacity-75',
  OUT_OF_ORDER:   'bg-stone-200 border-2 border-stone-300',
  VACANT:         'bg-white border-2 border-stone-100',
  BLOCKED:        'bg-stone-100 border-2 border-stone-200',
  OCCUPIED:       'bg-orange-50 border-2 border-orange-200',
}

// ── Status → Badge variant ────────────────────────────────────────────────────

const STATUS_TO_BADGE_VARIANT: Record<string, string> = {
  DIRTY:          'dirty',
  IN_PROGRESS:    'in_progress',
  CLEAN:          'clean',
  INSPECTED:      'inspected',
  DO_NOT_DISTURB: 'do_not_disturb',
  OUT_OF_ORDER:   'out_of_order',
  VACANT:         'default',
  BLOCKED:        'default',
  OCCUPIED:       'default',
  OOO:            'out_of_order',
  PICKUP:         'clean',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  room: any
  assignmentMode: boolean
  onStatusChange?: (roomId: string, newStatus: string) => void
  onOpenDetail?: (room: any) => void
  onAssign?: (roomId: string) => void
  pendingAssignee?: string | null
  assignedToName?: string | null   // name of housekeeper already assigned (different from active assignee)
}

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

function formatTime(isoString: string | null | undefined): string | null {
  if (!isoString) return null
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch {
    return null
  }
}

export function RoomCard({ room, assignmentMode, onStatusChange, onOpenDetail, onAssign, pendingAssignee, assignedToName }: Props) {
  const { role, isSupervisor, isGM } = useRole()
  const isHousekeeper = role === 'housekeeper'
  const canSupervise = isSupervisor || isGM

  const status: RoomStatus = (room.status || 'DIRTY') as RoomStatus
  const prediction = room.prediction ?? null
  const riskLevel: RiskLevel | undefined = prediction?.risk_level
  const isPending = !!pendingAssignee

  const assignedName: string | null =
    room.user_profiles?.preferred_name ?? room.user_profiles?.full_name ?? null
  const roomNumber: string = room.rooms?.room_number ?? room.room_number ?? '—'
  const vipFlag: boolean = !!room.vip_flag
  const openWorkOrder: string | null = room.open_work_order_number ?? null

  const checkinTime = formatTime(prediction?.checkin_time ?? room.checkin_time)
  const etaTime = formatTime(prediction?.predicted_ready_at)
  const isHighRisk = riskLevel === 'HIGH'
  const isMediumRisk = riskLevel === 'MEDIUM'

  // ── dnd-kit draggable ──────────────────────────────────────────────────────
  const { setNodeRef, transform, listeners, attributes, isDragging } = useDraggable({
    id: room.id,
    data: { room },
  })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  // ── Event handlers ─────────────────────────────────────────────────────────
  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    if (isDragging) return
    if (assignmentMode && onAssign) {
      onAssign(room.room_id)
      return
    }
    if (onOpenDetail) onOpenDetail(room)
  }

  function handleStatusChange(newStatus: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (onStatusChange) onStatusChange(room.room_id, newStatus)
  }

  // ── Card classes ───────────────────────────────────────────────────────────
  const cardBase = cn(
    'aspect-[4/3] rounded-2xl p-3 flex flex-col justify-between group relative transition-all duration-200 overflow-hidden',
    isDragging ? 'cursor-grabbing' : 'cursor-pointer',
  )

  const pendingRing = isPending && assignmentMode
    ? 'ring-2 ring-purple-300 ring-offset-1 border-purple-500'
    : ''

  const vipGlow = vipFlag
    ? 'border-2 border-amber-400 shadow-[0_0_0_2px_rgba(251,191,36,0.3)]'
    : ''

  const draggingOpacity = isDragging ? 'opacity-50' : ''
  const alreadyAssigned = assignmentMode && !!assignedToName && !isPending

  const statusClasses = isPending && assignmentMode
    ? 'bg-violet-50 border border-purple-300'
    : (STATUS_CARD_STYLES[status] ?? 'bg-stone-100 border border-stone-300')

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(assignmentMode ? listeners : {})}
      {...(assignmentMode ? attributes : {})}
      className={cn(cardBase, statusClasses, pendingRing, vipGlow, draggingOpacity, alreadyAssigned && 'opacity-60')}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (onOpenDetail) onOpenDetail(room)
        }
      }}
    >
      {/* Assignment mode pending dot */}
      {assignmentMode && isPending && (
        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-purple-500" />
      )}

      {/* Top row: room number + VIP badge */}
      <div className="flex items-start justify-between gap-1">
        <span className="font-bold text-sm leading-tight text-gray-900">{roomNumber}</span>
        {vipFlag && (
          <Badge variant="vip" className="text-xs px-1.5 py-0">VIP</Badge>
        )}
      </div>

      {/* Middle row: status badge */}
      <div className="flex items-center gap-1">
        <Badge
          variant={(STATUS_TO_BADGE_VARIANT[status] ?? 'default') as any}
          className="text-xs px-1.5 py-0"
        >
          {STATUS_SHORT_LABELS[status] ?? status.replace(/_/g, ' ')}
        </Badge>
        {isHighRisk && (
          <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
        )}
        {isMediumRisk && !isHighRisk && (
          <AlertTriangle className="w-3 h-3 text-orange-400 shrink-0" />
        )}
      </div>

      {/* Bottom row: housekeeper name + eta */}
      <div className="flex items-end justify-between gap-1 min-h-[1rem]">
        {/* Housekeeper / pending assignee */}
        {assignmentMode && pendingAssignee ? (
          <div className="flex items-center gap-0.5 min-w-0">
            <User className="w-3 h-3 text-purple-500 shrink-0" />
            <span className="text-xs text-purple-700 font-medium">&#10003; Assigned</span>
          </div>
        ) : !assignmentMode && assignedName ? (
          <div className="flex items-center gap-0.5 min-w-0">
            <User className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="text-xs text-gray-600 truncate">{assignedName}</span>
          </div>
        ) : (
          <span />
        )}

        {/* ETA or checkin time */}
        {(status === 'DIRTY' || status === 'IN_PROGRESS') && etaTime ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Clock className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">{etaTime}</span>
          </div>
        ) : status === 'INSPECTED' && checkinTime ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Clock className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">{checkinTime}</span>
          </div>
        ) : status === 'OOO' && openWorkOrder ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Wrench className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">WO-{openWorkOrder}</span>
          </div>
        ) : null}
      </div>

      {/* Action buttons (view mode only) */}
      {!assignmentMode && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {status === 'DIRTY' && isHousekeeper && (
            <button
              className="text-xs px-1.5 py-0.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
              onClick={(e) => handleStatusChange('IN_PROGRESS', e)}
            >
              Start
            </button>
          )}
          {status === 'DIRTY' && canSupervise && (
            <button
              className="text-xs px-1.5 py-0.5 rounded bg-white/70 text-gray-700 font-medium border border-white/90 hover:bg-white/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Reassign
            </button>
          )}
          {status === 'IN_PROGRESS' && (isHousekeeper || canSupervise) && (
            <button
              className="text-xs px-1.5 py-0.5 rounded bg-green-600 text-white font-medium hover:bg-green-700 transition-colors"
              onClick={(e) => handleStatusChange('CLEAN', e)}
            >
              Done Cleaning
            </button>
          )}
          {status === 'CLEAN' && canSupervise && (
            <button
              className="text-xs px-1.5 py-0.5 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Inspect
            </button>
          )}
          {status === 'INSPECTED' && (
            <button
              className="text-xs px-1.5 py-0.5 rounded bg-white/70 text-gray-700 font-medium border border-white/90 hover:bg-white/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Details
            </button>
          )}
          {status === 'OOO' && (
            <button
              className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-white/70 text-gray-700 font-medium border border-white/90 hover:bg-white/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              <Wrench className="w-2.5 h-2.5" />
              View WO
            </button>
          )}
        </div>
      )}

      {/* Assignment mode hints */}
      {assignmentMode && !isPending && !alreadyAssigned && (
        <p className="text-xs text-purple-400 mt-1">Tap to assign</p>
      )}
      {alreadyAssigned && (
        <p className="text-xs text-amber-600 mt-1">
          Assigned: {assignedToName} · tap to reassign
        </p>
      )}
      {assignmentMode && isPending && (
        <button
          className="mt-1 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium border border-purple-300 hover:bg-purple-200 transition-colors w-full"
          onClick={(e) => {
            e.stopPropagation()
            if (onStatusChange) onStatusChange(room.room_id, '__remove_assignment')
          }}
        >
          Remove
        </button>
      )}
    </div>
  )
}
