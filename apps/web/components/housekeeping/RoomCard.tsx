'use client'

import { AlertTriangle, Star, User, Clock, Wrench } from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { STATUS_BG, STATUS_TEXT } from '@/lib/utils/roomStatus'

interface Props {
  room: any
  assignmentMode: boolean
  onStatusChange?: (roomId: string, newStatus: string) => void
  onOpenDetail?: (room: any) => void
  pendingAssignee?: string | null
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

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

export function RoomCard({ room, assignmentMode, onStatusChange, onOpenDetail, pendingAssignee }: Props) {
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
  const roomTypeName: string = room.rooms?.room_types?.name ?? room.room_type_name ?? ''
  const vipFlag: boolean = !!room.vip_flag
  const openWorkOrder: string | null = room.open_work_order_number ?? null

  const checkinTime = formatTime(prediction?.checkin_time ?? room.checkin_time)
  const etaTime = formatTime(prediction?.predicted_ready_at)
  const isHighRisk = riskLevel === 'HIGH'
  const isMediumRisk = riskLevel === 'MEDIUM'

  function handleCardClick(e: React.MouseEvent) {
    // Don't open detail if a button was clicked
    if ((e.target as HTMLElement).closest('button')) return
    if (onOpenDetail) onOpenDetail(room)
  }

  function handleStatusChange(newStatus: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (onStatusChange) onStatusChange(room.room_id, newStatus)
  }

  // Determine card wrapper classes
  const pendingClasses = isPending && assignmentMode
    ? 'ring-2 ring-purple-300 ring-offset-1 border-purple-500'
    : 'border-white/60'

  return (
    <div
      className={`rounded-xl border backdrop-blur-sm shadow-sm cursor-pointer hover:scale-[1.02] transition-transform duration-200 relative p-3 ${pendingClasses}`}
      style={
        isPending && assignmentMode
          ? { backgroundColor: '#F5F3FF' }
          : { backgroundColor: STATUS_BG[status] ?? '#E2E8F0', color: STATUS_TEXT[status] ?? '#1E293B' }
      }
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (onOpenDetail) onOpenDetail(room) } }}
    >

      {/* Assignment mode pending indicator */}
      {assignmentMode && isPending && (
        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-purple-500" />
      )}

      {/* Top row: room number + status badge */}
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <span className="font-bold text-sm leading-tight">{roomNumber}</span>
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{ backgroundColor: STATUS_BG[status] ?? '#E2E8F0', color: STATUS_TEXT[status] ?? '#1E293B', opacity: 0.85 }}
        >
          {formatStatusLabel(status)}
        </span>
      </div>

      {/* Room type */}
      {roomTypeName && (
        <p className="text-xs truncate leading-tight opacity-80">{roomTypeName}</p>
      )}

      {/* VIP badge */}
      {vipFlag && (
        <div className="flex items-center gap-0.5 mt-1">
          <Star className="w-3 h-3 text-yellow-500 fill-yellow-400" />
          <span className="text-xs font-semibold text-yellow-600">VIP</span>
        </div>
      )}

      {/* Pending assignee (assignment mode) */}
      {assignmentMode && pendingAssignee && (
        <div className="flex items-center gap-1 mt-1">
          <User className="w-3 h-3 text-purple-500 shrink-0" />
          <span className="text-xs text-purple-700 font-medium truncate">{pendingAssignee}</span>
        </div>
      )}

      {/* Assigned housekeeper (not in assignment mode) */}
      {!assignmentMode && assignedName && (
        <div className="flex items-center gap-1 mt-1">
          <User className="w-3 h-3 opacity-60 shrink-0" />
          <span className="text-xs truncate opacity-80">{assignedName}</span>
        </div>
      )}

      {/* OOO: maintenance note */}
      {status === 'OOO' && openWorkOrder && (
        <p className="text-xs mt-1 truncate opacity-70">WO-{openWorkOrder} open</p>
      )}

      {/* INSPECTED: ready message + checkin */}
      {status === 'INSPECTED' && (
        <p className="text-xs mt-1 opacity-80">Ready for guest</p>
      )}
      {status === 'INSPECTED' && checkinTime && (
        <div className="flex items-center gap-1 mt-0.5">
          <Clock className="w-3 h-3 opacity-60 shrink-0" />
          <span className="text-xs opacity-70">Arrives: {checkinTime}</span>
        </div>
      )}

      {/* CLEAN: awaiting inspection */}
      {status === 'CLEAN' && (
        <p className="text-xs mt-1 opacity-80">Awaiting inspect</p>
      )}

      {/* ETA for IN_PROGRESS or DIRTY */}
      {(status === 'DIRTY' || status === 'IN_PROGRESS') && etaTime && (
        <div className="flex items-center gap-1 mt-1">
          <Clock className="w-3 h-3 opacity-60 shrink-0" />
          <span className="text-xs opacity-80">ETA: {etaTime}</span>
          {(isHighRisk || isMediumRisk) && (
            <AlertTriangle className={`w-3 h-3 shrink-0 ${isHighRisk ? 'text-red-500' : 'text-orange-400'}`} />
          )}
        </div>
      )}

      {/* Risk warning */}
      {isHighRisk && (
        <div className="flex items-center gap-1 mt-1">
          <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
          <span className="text-xs text-red-600 font-semibold">At risk</span>
        </div>
      )}

      {/* Action buttons */}
      {!assignmentMode && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {/* DIRTY actions */}
          {status === 'DIRTY' && isHousekeeper && (
            <button
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
              onClick={(e) => handleStatusChange('IN_PROGRESS', e)}
            >
              Start Cleaning
            </button>
          )}
          {status === 'DIRTY' && canSupervise && (
            <button
              className="text-xs px-2 py-1 rounded bg-white/70 text-gray-700 font-medium border border-white/90 hover:bg-white/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Reassign
            </button>
          )}

          {/* IN_PROGRESS actions */}
          {status === 'IN_PROGRESS' && (isHousekeeper || canSupervise) && (
            <button
              className="text-xs px-2 py-1 rounded bg-yellow-500 text-white font-medium hover:bg-yellow-600 transition-colors"
              onClick={(e) => handleStatusChange('CLEAN', e)}
            >
              Mark Done
            </button>
          )}

          {/* CLEAN actions */}
          {status === 'CLEAN' && canSupervise && (
            <button
              className="text-xs px-2 py-1 rounded bg-green-600 text-white font-medium hover:bg-green-700 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              Inspect
            </button>
          )}

          {/* INSPECTED actions */}
          {status === 'INSPECTED' && (
            <button
              className="text-xs px-2 py-1 rounded bg-white/70 text-gray-700 font-medium border border-white/90 hover:bg-white/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              View Details
            </button>
          )}

          {/* OOO actions */}
          {status === 'OOO' && (
            <button
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/70 text-gray-700 font-medium border border-white/90 hover:bg-white/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); if (onOpenDetail) onOpenDetail(room) }}
            >
              <Wrench className="w-3 h-3" />
              View WO
            </button>
          )}
        </div>
      )}

      {/* Assignment mode: click hint */}
      {assignmentMode && !isPending && (
        <p className="text-xs text-purple-500 mt-2">Click to assign</p>
      )}
      {assignmentMode && isPending && (
        <button
          className="mt-2 text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 font-medium border border-purple-300 hover:bg-purple-200 transition-colors w-full"
          onClick={(e) => { e.stopPropagation(); if (onStatusChange) onStatusChange(room.room_id, '__remove_assignment') }}
        >
          Remove
        </button>
      )}
    </div>
  )
}
