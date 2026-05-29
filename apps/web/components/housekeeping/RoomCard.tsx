'use client'

import { Clock, LogOut, MessageSquare, User, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCleanTypeShortLabel } from '@/lib/utils/cleanType'
import { STATUS_SHORT_LABELS } from '@/lib/utils/roomStatus'
import { Pill } from '@/components/ui/primitives'

// ── Status → border color ─────────────────────────────────────────────────────
const STATUS_BORDER: Record<string, string> = {
  DIRTY:          'border-[var(--alert-line)]',
  IN_PROGRESS:    'border-[var(--progress-line)]',
  CLEAN:          'border-[var(--info-line)]',
  INSPECTED:      'border-[var(--ready-line)]',
  DO_NOT_DISTURB: 'border-line',
  OUT_OF_ORDER:   'border-[var(--blocked-line)]',
  OUT_OF_SERVICE: 'border-[var(--blocked-line)]',
  OOO:            'border-[var(--blocked-line)]',
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
  OUT_OF_ORDER:   'var(--blocked)',
  OUT_OF_SERVICE: 'var(--blocked)',
  OOO:            'var(--blocked)',
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

// ── Clean type → text color ───────────────────────────────────────────────────
const CLEAN_TYPE_TEXT_COLOR: Record<string, string> = {
  DEP:   'text-[var(--alert)]',
  FULL:  'text-[var(--caution)]',
  LIGHT: 'text-[var(--caution)]',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  room: any
  assignmentMode: boolean
  onStatusChange?: (roomId: string, newStatus: string) => void
  onOpenDetail?: (room: any) => void
  onAssign?: (roomId: string) => void
  pendingAssignee?: string | null
  assignedToName?: string | null
  assignedToActive?: boolean
  savedAssignmentId?: string | null
  onRemoveSavedAssignment?: (assignmentId: string) => void
  isRemovingAssignment?: boolean
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

export function RoomCard({
  room,
  assignmentMode,
  onStatusChange,
  onOpenDetail,
  onAssign,
  pendingAssignee,
  assignedToName,
  assignedToActive,
  savedAssignmentId,
  onRemoveSavedAssignment,
  isRemovingAssignment,
}: Props) {
  const status: RoomStatus = (room.status || 'DIRTY') as RoomStatus
  const prediction = room.prediction ?? null
  const riskLevel: RiskLevel | undefined = prediction?.risk_level
  const isPending = !!pendingAssignee
  const isSavedAssignedToActive = assignmentMode && !!assignedToActive && !!savedAssignmentId && !isPending
  const isAssignmentSelected = assignmentMode && (isPending || isSavedAssignedToActive)
  const isHighRisk = riskLevel === 'HIGH'

  const assignedName: string | null =
    room.user_profiles?.preferred_name ?? room.user_profiles?.full_name ?? null
  const roomNumber: string = room.rooms?.room_number ?? room.room_number ?? '—'
  const vipFlag: boolean = !!room.vip_flag
  const openWorkOrder: string | number | null = room.open_work_order_number ?? null
  const openWorkOrderTitle: string | null = room.open_work_order_title ?? null
  const latestNote: string | null = room.latest_note ?? null
  const roomTypeName: string | null = room.rooms?.room_types?.name ?? null
  const cleanTypeLabel = getCleanTypeShortLabel(room.clean_type)
  const workOrderLabel = openWorkOrder
    ? `WO-${openWorkOrder}${openWorkOrderTitle ? `: ${openWorkOrderTitle}` : ''}`
    : openWorkOrderTitle

  const checkinTime = formatTime(prediction?.checkin_time ?? room.checkin_time)
  const checkoutTime = formatTime(room.actual_checkout_at ?? room.checkout_time)
  const checkoutLabel = room.actual_checkout_at ? 'Out' : 'Due'
  const etaTime = formatTime(prediction?.predicted_ready_at)

  // ── Event handlers ─────────────────────────────────────────────────────────
  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    if (isSavedAssignedToActive) return
    if (assignmentMode && onAssign) {
      onAssign(room.room_id)
      return
    }
    if (onOpenDetail) onOpenDetail(room)
  }

  // ── Derived style ──────────────────────────────────────────────────────────
  const alreadyAssigned = assignmentMode && !!assignedToName && !isAssignmentSelected
  const isOccupied = status === 'OCCUPIED'

  const cardBorder = isAssignmentSelected
    ? 'border border-[var(--ai-line)]'
    : `border ${STATUS_BORDER[status] ?? 'border-line'}`

  const cardBg = isAssignmentSelected ? 'bg-[var(--ai-soft)]' : 'bg-surface'

  const stripColor = isAssignmentSelected
    ? 'var(--ai)'
    : (STATUS_STRIP_COLOR[status] ?? 'var(--line)')

  const pillTone = STATUS_PILL_TONE[status] ?? 'neutral'
  const statusLabel = STATUS_SHORT_LABELS[status] ?? status.replace(/_/g, ' ')

  return (
    <div
      className={cn(
        'relative rounded-[var(--r-lg)] px-3 pb-3 pt-4 flex flex-col gap-1.5 min-h-[116px] transition-all duration-150 overflow-hidden cursor-pointer',
        cardBg, cardBorder,
        isAssignmentSelected && 'ring-2 ring-[var(--ai-line)] ring-offset-1',
        vipFlag && 'shadow-[0_0_0_2px_var(--caution-line)]',
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
      {/* Colored top strip */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[var(--r-lg)]"
        style={isOccupied
          ? { background: `repeating-linear-gradient(135deg, var(--alert) 0 5px, var(--alert-soft) 5px 10px)` }
          : { background: stripColor }
        }
      />

      {/* Room number + AI risk dot + VIP */}
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

      {/* Room type + clean type */}
      {roomTypeName && (
        <span className="text-[11px] text-ink3 font-mono leading-none truncate">{roomTypeName}</span>
      )}
      {/* Status pill + clean type side label */}
      <div className="mt-auto flex items-center gap-1.5 flex-wrap">
        <Pill tone={pillTone} size="sm" striped={isOccupied}>
          {statusLabel}
          {isOccupied && etaTime ? ` · ${etaTime}` : ''}
        </Pill>
        {status !== 'INSPECTED' && (room.clean_type === 'FULL' || room.clean_type === 'LIGHT') ? (
          <span className={cn('text-[10px] font-semibold', CLEAN_TYPE_TEXT_COLOR[room.clean_type])}>
            {cleanTypeLabel}
          </span>
        ) : status === 'INSPECTED' && (room.clean_type === 'FULL' || room.clean_type === 'LIGHT') ? (
          <span className="text-[10px] font-semibold text-[var(--ready)]">
            {room.clean_type === 'FULL' ? 'Full Done' : 'Light Done'}
          </span>
        ) : room.clean_type === 'DEP' && cleanTypeLabel ? (
          <span className={cn('text-[10px] font-semibold flex items-center gap-0.5', CLEAN_TYPE_TEXT_COLOR['DEP'])}>
            <LogOut className="w-2.5 h-2.5" />
            {cleanTypeLabel}
          </span>
        ) : null}
      </div>

      {/* Assignee row */}
      {!assignmentMode && assignedName && (
        <div className="flex items-center gap-1 min-w-0">
          <User className="w-3 h-3 text-ink3 shrink-0" />
          <span className="text-[11px] text-ink2 truncate">{assignedName.split(' ')[0]}</span>
        </div>
      )}

      {/* Time info */}
      {!isOccupied && status === 'INSPECTED' && checkinTime && (
        <div className="flex items-center gap-0.5">
          <Clock className="w-3 h-3 text-ink3" />
          <span className="text-[11px] font-mono text-ink3">{checkinTime}</span>
        </div>
      )}
      {checkoutTime && (
        <div className="flex items-center gap-0.5">
          <Clock className="w-3 h-3 text-ink3" />
          <span className="text-[11px] font-mono text-ink3">{checkoutLabel} {checkoutTime}</span>
        </div>
      )}
      {(workOrderLabel || latestNote) && (
        <div className="mt-0.5 space-y-0.5">
          {workOrderLabel && (
            <div className="flex items-center gap-1 min-w-0 text-[11px] text-orange-700">
              <Wrench className="w-3 h-3 shrink-0" />
              <span className="truncate">{workOrderLabel}</span>
            </div>
          )}
          {latestNote && (
            <div className="flex items-center gap-1 min-w-0 text-[11px] text-ink3">
              <MessageSquare className="w-3 h-3 shrink-0" />
              <span className="truncate">{latestNote}</span>
            </div>
          )}
        </div>
      )}

      {/* Assignment mode overlays */}
      {assignmentMode && !isAssignmentSelected && !alreadyAssigned && (
        <p className="text-xs text-[var(--ai)] mt-0.5">Tap to assign</p>
      )}
      {alreadyAssigned && (
        <p className="text-[11px] text-caution mt-0.5">
          {assignedToName} · tap to reassign
        </p>
      )}
      {isAssignmentSelected && (
        <>
          <div className="flex items-center gap-0.5 mt-0.5">
            <User className="w-3 h-3 text-[var(--ai)] shrink-0" />
            <span className="text-xs text-[var(--ai)] font-medium">Assigned</span>
          </div>
          <button
            className="mt-0.5 text-xs px-2 py-0.5 rounded-md bg-ai-soft border border-ai-line text-ai font-medium hover:opacity-80 transition-opacity w-full"
            disabled={isRemovingAssignment}
            onClick={(e) => {
              e.stopPropagation()
              if (isPending) {
                if (onStatusChange) onStatusChange(room.room_id, '__remove_assignment')
                return
              }
              if (savedAssignmentId && onRemoveSavedAssignment) {
                onRemoveSavedAssignment(savedAssignmentId)
              }
            }}
          >
            {isRemovingAssignment ? 'Removing...' : 'Remove'}
          </button>
        </>
      )}

    </div>
  )
}
