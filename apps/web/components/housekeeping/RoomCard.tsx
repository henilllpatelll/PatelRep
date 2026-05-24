'use client'

import { AlertTriangle, Clock, User, Wrench } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useRole } from '@/lib/hooks/useRole'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { STATUS_SHORT_LABELS } from '@/lib/utils/roomStatus'

// ── Status → card border color (white bg with colored top strip) ─────────────

const STATUS_BORDER: Record<string, string> = {
  DIRTY:          'border-[var(--alert-line)]',
  IN_PROGRESS:    'border-[var(--alert-line)]',
  CLEAN:          'border-[var(--info-line)]',
  INSPECTED:      'border-[var(--ready-line)]',
  DO_NOT_DISTURB: 'border-[var(--line)]',
  OUT_OF_ORDER:   'border-[var(--line)]',
  OOO:            'border-[var(--line)]',
  VACANT:         'border-[var(--line)]',
  BLOCKED:        'border-[var(--line)]',
  OCCUPIED:       'border-[var(--alert-line)]',
  PICKUP:         'border-[var(--caution-line)]',
}

// ── Status → top strip color ──────────────────────────────────────────────────

const STATUS_STRIP: Record<string, string> = {
  DIRTY:          'bg-[var(--alert)]',
  IN_PROGRESS:    'bg-[var(--alert)]',
  CLEAN:          'bg-[var(--info)]',
  INSPECTED:      'bg-[var(--ready)]',
  DO_NOT_DISTURB: 'bg-[var(--ink-4)]',
  OUT_OF_ORDER:   'bg-[var(--ink-4)]',
  OOO:            'bg-[var(--ink-4)]',
  VACANT:         'bg-[var(--line)]',
  BLOCKED:        'bg-[var(--line)]',
  OCCUPIED:       'bg-[var(--alert)]',
  PICKUP:         'bg-[var(--caution)]',
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
  OCCUPIED:       'in_progress',
  OOO:            'out_of_order',
  PICKUP:         'pickup',
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

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP' | 'OCCUPIED' | 'DO_NOT_DISTURB' | 'OUT_OF_ORDER'
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
    'aspect-[4/3] rounded-[var(--r-lg)] pt-4 px-3 pb-3 flex flex-col justify-between group relative transition-all duration-150 overflow-hidden',
    isDragging ? 'cursor-grabbing' : 'cursor-pointer',
  )

  const pendingRing = isPending && assignmentMode ? 'ring-2 ring-[var(--ai-line)] ring-offset-1' : ''
  const vipGlow     = vipFlag ? 'shadow-[0_0_0_2px_var(--caution-line)]' : ''
  const draggingOpacity = isDragging ? 'opacity-50' : ''
  const alreadyAssigned = assignmentMode && !!assignedToName && !isPending

  const isOccupied = status === 'IN_PROGRESS' || status === 'OCCUPIED'
  const statusBorder = isPending && assignmentMode
    ? 'border border-[var(--ai-line)]'
    : `border ${STATUS_BORDER[status] ?? 'border-[var(--line)]'}`
  const statusBg = isPending && assignmentMode ? 'bg-[var(--ai-soft)]' : 'bg-surface'
  const statusClasses = `${statusBg} ${statusBorder}`
  const stripClass = isPending && assignmentMode ? 'bg-[var(--ai)]' : (STATUS_STRIP[status] ?? 'bg-[var(--line)]')

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
      {/* Colored top strip */}
      <div className={cn('absolute top-0 left-0 right-0 h-[3px]', isOccupied ? '' : stripClass)}
        style={isOccupied ? {
          background: `repeating-linear-gradient(135deg, var(--alert) 0 5px, var(--alert-soft) 5px 10px)`,
        } : undefined}
      />

      {/* Assignment mode pending dot */}
      {assignmentMode && isPending && (
        <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--ai)]" />
      )}

      {/* Top row: room number + VIP badge */}
      <div className="flex items-start justify-between gap-1">
        <span className="font-mono font-semibold text-base leading-tight text-ink">{roomNumber}</span>
        {vipFlag && (
          <Badge variant="vip" className="text-xs px-1.5 py-0">VIP</Badge>
        )}
      </div>

      {/* Middle row: status badge + room type */}
      <div className="flex flex-col gap-0.5">
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
            <AlertTriangle className="w-3 h-3 text-[var(--caution)] shrink-0" />
          )}
        </div>
        {room.rooms?.room_types?.name && (
          <span className="text-[11px] text-ink3 font-mono leading-tight truncate">
            {room.rooms.room_types.name}
          </span>
        )}
      </div>

      {/* Bottom row: housekeeper name + eta */}
      <div className="flex items-end justify-between gap-1 min-h-[1rem]">
        {assignmentMode && pendingAssignee ? (
          <div className="flex items-center gap-0.5 min-w-0">
            <User className="w-3 h-3 text-[var(--ai)] shrink-0" />
            <span className="text-xs text-[var(--ai)] font-medium">&#10003; Assigned</span>
          </div>
        ) : !assignmentMode && assignedName ? (
          <div className="flex items-center gap-0.5 min-w-0">
            <User className="w-3 h-3 text-ink3 shrink-0" />
            <span className="text-xs text-ink2 truncate">{assignedName}</span>
          </div>
        ) : (
          <span />
        )}

        {(status === 'DIRTY' || status === 'IN_PROGRESS') && etaTime ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Clock className="w-3 h-3 text-ink3" />
            <span className="text-[11px] font-mono text-ink3">{etaTime}</span>
          </div>
        ) : status === 'INSPECTED' && checkinTime ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Clock className="w-3 h-3 text-ink3" />
            <span className="text-[11px] font-mono text-ink3">{checkinTime}</span>
          </div>
        ) : status === 'OOO' && openWorkOrder ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Wrench className="w-3 h-3 text-ink3" />
            <span className="text-[11px] font-mono text-ink3">WO-{openWorkOrder}</span>
          </div>
        ) : null}
      </div>

      {/* Action buttons (view mode only) */}
      {!assignmentMode && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {status === 'DIRTY' && isHousekeeper && (
            <button
              className="text-xs px-2 py-0.5 rounded-md bg-accent text-white font-medium hover:opacity-90 transition-opacity"
              onClick={(e) => handleStatusChange('IN_PROGRESS', e)}
            >
              Start
            </button>
          )}
          {status === 'DIRTY' && canSupervise && (
            <button
              className="text-xs px-2 py-0.5 rounded-md bg-surface border border-line text-ink2 font-medium hover:bg-surface-2 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Reassign
            </button>
          )}
          {status === 'IN_PROGRESS' && (isHousekeeper || canSupervise) && (
            <button
              className="text-xs px-2 py-0.5 rounded-md bg-ready text-white font-medium hover:opacity-90 transition-opacity"
              onClick={(e) => handleStatusChange('CLEAN', e)}
            >
              Done
            </button>
          )}
          {status === 'CLEAN' && canSupervise && (
            <button
              className="text-xs px-2 py-0.5 rounded-md bg-info text-white font-medium hover:opacity-90 transition-opacity"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Inspect
            </button>
          )}
          {status === 'INSPECTED' && (
            <button
              className="text-xs px-2 py-0.5 rounded-md bg-surface border border-line text-ink2 font-medium hover:bg-surface-2 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Details
            </button>
          )}
          {status === 'OOO' && (
            <button
              className="flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-md bg-surface border border-line text-ink2 font-medium hover:bg-surface-2 transition-colors"
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
        <p className="text-[11px] text-caution mt-1">
          Assigned: {assignedToName} · tap to reassign
        </p>
      )}
      {assignmentMode && isPending && (
        <button
          className="mt-1 text-xs px-2 py-0.5 rounded-md bg-ai-soft border border-ai-line text-ai font-medium hover:opacity-80 transition-opacity w-full"
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
