'use client'

import { Clock, User, Wrench } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useRole } from '@/lib/hooks/useRole'
import { cn } from '@/lib/utils'
import { STATUS_SHORT_LABELS } from '@/lib/utils/roomStatus'
import { Pill, StatusDot, AILabel } from '@/components/ui/primitives'

// ── Status → border color ─────────────────────────────────────────────────────
const STATUS_BORDER: Record<string, string> = {
  DIRTY:          'border-[var(--alert-line)]',
  IN_PROGRESS:    'border-[var(--progress-line)]',
  CLEAN:          'border-[var(--info-line)]',
  INSPECTED:      'border-[var(--ready-line)]',
  DO_NOT_DISTURB: 'border-line',
  OUT_OF_ORDER:   'border-[var(--accent-line)]',
  OUT_OF_SERVICE: 'border-[var(--accent-line)]',
  OOO:            'border-[var(--accent-line)]',
  VACANT:         'border-line',
  BLOCKED:        'border-line',
  OCCUPIED:       'border-[var(--alert-line)]',
  PICKUP:         'border-[var(--caution-line)]',
}

// ── Status → top strip color ──────────────────────────────────────────────────
const STATUS_STRIP_COLOR: Record<string, string> = {
  DIRTY:          'var(--alert)',
  IN_PROGRESS:    'var(--progress)',
  CLEAN:          'var(--info)',
  INSPECTED:      'var(--ready)',
  DO_NOT_DISTURB: 'var(--ink-4)',
  OUT_OF_ORDER:   'var(--accent)',
  OUT_OF_SERVICE: 'var(--accent)',
  OOO:            'var(--accent)',
  VACANT:         'var(--line)',
  BLOCKED:        'var(--line)',
  OCCUPIED:       'var(--alert)',
  PICKUP:         'var(--caution)',
}

// ── Status → Pill tone ────────────────────────────────────────────────────────
const STATUS_PILL_TONE: Record<string, 'dirty' | 'progress' | 'clean' | 'inspected' | 'pickup' | 'ooo' | 'neutral'> = {
  DIRTY:          'dirty',
  IN_PROGRESS:    'progress',
  CLEAN:          'clean',
  INSPECTED:      'inspected',
  PICKUP:         'pickup',
  OOO:            'ooo',
  DO_NOT_DISTURB: 'neutral',
  OUT_OF_ORDER:   'ooo',
  OUT_OF_SERVICE: 'ooo',
  OCCUPIED:       'dirty',
  VACANT:         'neutral',
  BLOCKED:        'neutral',
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

type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP' | 'OCCUPIED' | 'DO_NOT_DISTURB' | 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'
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
  const isHighRisk = riskLevel === 'HIGH'

  const assignedName: string | null =
    room.user_profiles?.preferred_name ?? room.user_profiles?.full_name ?? null
  const roomNumber: string = room.rooms?.room_number ?? room.room_number ?? '—'
  const vipFlag: boolean = !!room.vip_flag
  const openWorkOrder: string | null = room.open_work_order_number ?? null
  const roomTypeName: string | null = room.rooms?.room_types?.name ?? null

  const checkinTime = formatTime(prediction?.checkin_time ?? room.checkin_time)
  const etaTime = formatTime(prediction?.predicted_ready_at)

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

  // ── Derived style ──────────────────────────────────────────────────────────
  const alreadyAssigned = assignmentMode && !!assignedToName && !isPending
  const isOccupied = status === 'OCCUPIED'

  const cardBorder = isPending && assignmentMode
    ? 'border border-[var(--ai-line)]'
    : `border ${STATUS_BORDER[status] ?? 'border-line'}`

  const cardBg = isPending && assignmentMode ? 'bg-[var(--ai-soft)]' : 'bg-surface'

  const stripColor = isPending && assignmentMode
    ? 'var(--ai)'
    : (STATUS_STRIP_COLOR[status] ?? 'var(--line)')

  const pillTone = STATUS_PILL_TONE[status] ?? 'neutral'
  const statusLabel = STATUS_SHORT_LABELS[status] ?? status.replace(/_/g, ' ')

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(assignmentMode ? listeners : {})}
      {...(assignmentMode ? attributes : {})}
      className={cn(
        'relative rounded-[var(--r-lg)] px-3 pb-3 pt-4 flex flex-col gap-1.5 min-h-[116px] transition-all duration-150 overflow-hidden',
        cardBg, cardBorder,
        isPending && assignmentMode && 'ring-2 ring-[var(--ai-line)] ring-offset-1',
        vipFlag && 'shadow-[0_0_0_2px_var(--caution-line)]',
        isDragging ? 'cursor-grabbing opacity-50' : 'cursor-pointer',
        alreadyAssigned && 'opacity-60',
      )}
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
      {/* Colored top strip — striped for occupied */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[var(--r-lg)]"
        style={isOccupied
          ? { background: `repeating-linear-gradient(135deg, var(--alert) 0 5px, var(--alert-soft) 5px 10px)` }
          : { background: stripColor }
        }
      />

      {/* Top row: room number + AI risk dot + VIP */}
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="font-mono font-semibold text-[19px] leading-none text-ink">{roomNumber}</span>
        {vipFlag && (
          <Pill tone="accent" size="sm">VIP</Pill>
        )}
        {isHighRisk && (
          <span
            className="ml-auto w-4 h-4 rounded-[4px] flex items-center justify-center bg-[var(--ai-soft)] border border-[var(--ai-line)]"
            title="AI: at risk"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="var(--ai)" aria-hidden>
              <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
            </svg>
          </span>
        )}
      </div>

      {/* Room type */}
      {roomTypeName && (
        <span className="text-[11px] text-ink3 font-mono leading-none truncate">{roomTypeName}</span>
      )}

      {/* Status pill + eta */}
      <div className="mt-auto flex items-center justify-between gap-1 flex-wrap">
        <Pill tone={pillTone} size="sm" striped={isOccupied}>
          {statusLabel}
          {isOccupied && etaTime ? ` · ${etaTime}` : ''}
        </Pill>
      </div>

      {/* Assignee row */}
      {!assignmentMode && assignedName && (
        <div className="flex items-center gap-1 min-w-0">
          <User className="w-3 h-3 text-ink3 shrink-0" />
          <span className="text-[11px] text-ink2 truncate">{assignedName.split(' ')[0]}</span>
        </div>
      )}

      {/* Time info for non-occupied statuses */}
      {!isOccupied && status === 'INSPECTED' && checkinTime && (
        <div className="flex items-center gap-0.5">
          <Clock className="w-3 h-3 text-ink3" />
          <span className="text-[11px] font-mono text-ink3">{checkinTime}</span>
        </div>
      )}
      {status === 'OOO' && openWorkOrder && (
        <div className="flex items-center gap-0.5">
          <Wrench className="w-3 h-3 text-ink3" />
          <span className="text-[11px] font-mono text-ink3">WO-{openWorkOrder}</span>
        </div>
      )}

      {/* Pending assignment overlay */}
      {assignmentMode && isPending && (
        <div className="flex items-center gap-0.5 mt-0.5">
          <User className="w-3 h-3 text-[var(--ai)] shrink-0" />
          <span className="text-xs text-[var(--ai)] font-medium">Assigned</span>
        </div>
      )}

      {/* Action buttons (view mode only) */}
      {!assignmentMode && (
        <div className="flex flex-wrap gap-1 mt-0.5">
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
        <p className="text-xs text-[var(--ai)] mt-0.5">Tap to assign</p>
      )}
      {alreadyAssigned && (
        <p className="text-[11px] text-caution mt-0.5">
          {assignedToName} · tap to reassign
        </p>
      )}
      {assignmentMode && isPending && (
        <button
          className="mt-0.5 text-xs px-2 py-0.5 rounded-md bg-ai-soft border border-ai-line text-ai font-medium hover:opacity-80 transition-opacity w-full"
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
