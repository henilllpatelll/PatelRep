import { getCleanTypeCredits, isOpenHousekeepingRoom, type CleanType } from '@/lib/utils/cleanType'
import { getCapacityState, type CapacityState } from './assignmentView'
import {
  compareHousekeepingExecutionOrder,
  deriveRoomAttentionItems,
  getPrimaryRoomAttention,
  getHousekeepingExecutionBlock,
  getRoomWorkloadCredits,
  type HousekeepingAttentionCode,
  type HousekeepingOperationalRoom,
  type StaffAvailability,
} from './roomState'

const FALLBACK_DURATION_MINUTES: Record<string, number> = { DEP: 45, FULL: 35, LIGHT: 25 }
const DEFAULT_DURATION_MINUTES = 30
const TIGHT_BUFFER_MINUTES = 20
const OUT_OF_ORDER = new Set(['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'])

/** Real base_clean_minutes when the room type has one; otherwise an honest clean-type estimate (never a fabricated per-room schedule). */
export function getStopDurationMinutes(room: HousekeepingOperationalRoom): number {
  const base = room.source?.rooms?.room_types?.base_clean_minutes
  if (typeof base === 'number' && base > 0) return base
  return (room.cleanType && FALLBACK_DURATION_MINUTES[room.cleanType]) || DEFAULT_DURATION_MINUTES
}

function isRushRoom(room: HousekeepingOperationalRoom): boolean {
  return deriveRoomAttentionItems(room).some((item) => item.code === 'rush')
}

export type TeamPlanStopState = 'done' | 'active' | 'pending'

export interface TeamPlanStop {
  roomId: string
  roomNumber: string
  cleanType: CleanType | null
  status: string
  state: TeamPlanStopState
  isRush: boolean
  isVip: boolean
  isDnd: boolean
  dndRetryAt: string | null
  occupancyDiscrepancy: boolean
  serviceDeclined: boolean
  arrivalRisk: HousekeepingOperationalRoom['predictionRisk']
  arrivalTime: string | null
  building: string | null
  floor: number | null
  staged: boolean
  durationMinutes: number
  startMinute: number
  buildingChangeAfter: boolean
}

function stopStateOf(room: HousekeepingOperationalRoom): TeamPlanStopState {
  if (room.housekeepingStatus === 'IN_PROGRESS') return 'active'
  if (room.housekeepingStatus === 'DIRTY' || room.housekeepingStatus === 'PICKUP' || room.housekeepingStatus === 'OCCUPIED') return 'pending'
  return 'done' // CLEAN / INSPECTED — the active clean has already happened
}

/** Shared with My Rooms so a supervisor's Team Plan and its assignee's next stop agree. */
function comparePendingStops(a: HousekeepingOperationalRoom, b: HousekeepingOperationalRoom): number {
  return compareHousekeepingExecutionOrder(a, b)
}

function compareDoneStops(a: HousekeepingOperationalRoom, b: HousekeepingOperationalRoom): number {
  const atA = a.lastCleanedAt ? new Date(a.lastCleanedAt).getTime() : null
  const atB = b.lastCleanedAt ? new Date(b.lastCleanedAt).getTime() : null
  if (atA !== null && atB !== null && atA !== atB) return atA - atB
  const buildingA = a.building ?? ''
  const buildingB = b.building ?? ''
  if (buildingA !== buildingB) return buildingA.localeCompare(buildingB)
  const floorA = a.floor ?? 0
  const floorB = b.floor ?? 0
  if (floorA !== floorB) return floorA - floorB
  return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
}

/**
 * Sequences one housekeeper's rooms into a Team Plan lane: completed rooms first
 * (in the order they happened), then the active room, then pending rooms ordered
 * by guest-waiting / rush / arrival risk / earliest arrival, falling back to
 * building -> floor -> room number. Never claims a per-room schedule the data
 * doesn't have — stops are laid out relative to "now" using duration estimates.
 */
export function buildTeamPlanStops(params: {
  rooms: HousekeepingOperationalRoom[]
  housekeeperId: string
  pendingAssignments: Record<string, string>
  pendingAssignmentCleanTypes?: Record<string, CleanType>
  now: Date
}): TeamPlanStop[] {
  const { rooms, housekeeperId, pendingAssignments, pendingAssignmentCleanTypes = {}, now } = params
  const owned = rooms
    .filter((room) => {
      const owner = pendingAssignments[room.roomId] ?? room.assignedHousekeeperId
      return owner === housekeeperId && !OUT_OF_ORDER.has(room.housekeepingStatus)
    })
    .map((room): HousekeepingOperationalRoom => {
      const overlay = pendingAssignmentCleanTypes[room.roomId]
      return overlay ? { ...room, cleanType: overlay } : room
    })

  const done = owned.filter((r) => stopStateOf(r) === 'done').sort(compareDoneStops)
  const active = owned.filter((r) => stopStateOf(r) === 'active')
  const pending = owned.filter((r) => stopStateOf(r) === 'pending').sort(comparePendingStops)
  const ordered = [...done, ...active, ...pending]

  const nowMinute = now.getHours() * 60 + now.getMinutes()
  const doneMinutes = done.reduce((sum, r) => sum + getStopDurationMinutes(r), 0)
  let cursor = nowMinute - doneMinutes

  const stops: TeamPlanStop[] = ordered.map((room) => {
    const durationMinutes = getStopDurationMinutes(room)
    const startMinute = cursor
    cursor += durationMinutes
    return {
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      cleanType: room.cleanType,
      status: room.housekeepingStatus,
      state: stopStateOf(room),
      isRush: isRushRoom(room),
      isVip: room.isVip,
      isDnd: room.dnd,
      dndRetryAt: room.dndRetryAt,
      occupancyDiscrepancy: room.occupancyDiscrepancy,
      serviceDeclined: room.serviceDeclined,
      arrivalRisk: room.predictionRisk,
      arrivalTime: room.checkinTime,
      building: room.building,
      floor: room.floor,
      staged: Boolean(pendingAssignments[room.roomId]),
      durationMinutes,
      startMinute,
      buildingChangeAfter: false,
    }
  })

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].building
    const b = stops[i + 1].building
    stops[i].buildingChangeAfter = Boolean(a && b && a !== b)
  }

  return stops
}

export type TeamPlanPace = 'on_pace' | 'tight' | 'behind'

/**
 * Pace is only computed when the lane has a real deadline to compare against
 * (an assigned room's actual guest check-in time). There is no reliable
 * shift-end time in the data model, so with no deadline pace is omitted
 * entirely rather than guessed.
 */
export function computeLanePace(stops: TeamPlanStop[], now: Date): TeamPlanPace | null {
  const deadlineStops = stops.filter((s) => s.state !== 'done' && s.arrivalTime)
  if (deadlineStops.length === 0) return null

  let worst: TeamPlanPace = 'on_pace'
  for (const deadlineStop of deadlineStops) {
    const deadline = new Date(deadlineStop.arrivalTime as string).getTime()
    if (Number.isNaN(deadline)) continue
    const minutesUntil = (deadline - now.getTime()) / 60000
    const minutesNeeded = stops
      .filter((s) => s.state !== 'done' && s.startMinute <= deadlineStop.startMinute)
      .reduce((sum, s) => sum + s.durationMinutes, 0)
    const margin = minutesUntil - minutesNeeded
    if (margin < 0) return 'behind'
    if (margin < TIGHT_BUFFER_MINUTES) worst = 'tight'
  }
  return worst
}

export interface TeamPlanLane {
  id: string
  name: string
  availability: StaffAvailability
  onBreakSince: string | null
  currentRoomNumber: string | null
  savedCredits: number
  stagedCredits: number
  projectedCredits: number
  target: number
  capacityState: CapacityState
  floors: number[]
  stops: TeamPlanStop[]
  pace: TeamPlanPace | null
  hasWork: boolean
}

export function buildTeamPlanLanes(params: {
  staff: Array<{ id: string; name: string }>
  rooms: HousekeepingOperationalRoom[]
  pendingAssignments: Record<string, string>
  pendingAssignmentCleanTypes?: Record<string, CleanType>
  shiftInfoById: Record<string, { availability: StaffAvailability; onBreakSince: string | null }>
  cleaningRoomNumberById: Record<string, string>
  target: number
  targetsByStaff?: Record<string, number>
  creditWeights?: Partial<Record<CleanType, number>>
  now: Date
}): TeamPlanLane[] {
  const { staff, rooms, pendingAssignments, pendingAssignmentCleanTypes, shiftInfoById, cleaningRoomNumberById, target, targetsByStaff, creditWeights, now } = params

  return staff.map((member): TeamPlanLane => {
    const stops = buildTeamPlanStops({ rooms, housekeeperId: member.id, pendingAssignments, pendingAssignmentCleanTypes, now })
    let savedCredits = 0
    let stagedCredits = 0
    const floors = new Set<number>()
    for (const stop of stops) {
      if (stop.state === 'done') continue
      const credits = getCleanTypeCredits(stop.cleanType, creditWeights)
      if (stop.floor !== null) floors.add(stop.floor)
      if (stop.staged) stagedCredits += credits
      else savedCredits += credits
    }
    const projectedCredits = savedCredits + stagedCredits
    const info = shiftInfoById[member.id]

    const memberTarget = targetsByStaff?.[member.id] ?? target
    return {
      id: member.id,
      name: member.name,
      availability: info?.availability ?? 'unavailable',
      onBreakSince: info?.onBreakSince ?? null,
      currentRoomNumber: cleaningRoomNumberById[member.id] ?? null,
      savedCredits,
      stagedCredits,
      projectedCredits,
      target: memberTarget,
      capacityState: getCapacityState(projectedCredits, memberTarget),
      floors: Array.from(floors).sort((a, b) => a - b),
      stops,
      pace: computeLanePace(stops, now),
      hasWork: stops.length > 0,
    }
  })
}

/** On-shift/working lanes (or anyone still carrying work) surface up top; fully off-shift, empty lanes collapse into a secondary group. */
export function splitTeamPlanLanes(lanes: TeamPlanLane[]): { onShift: TeamPlanLane[]; offShift: TeamPlanLane[] } {
  const isCollapsible = (lane: TeamPlanLane) =>
    (lane.availability === 'off_shift' || lane.availability === 'unavailable') && !lane.hasWork
  return {
    onShift: lanes.filter((lane) => !isCollapsible(lane)),
    offShift: lanes.filter(isCollapsible),
  }
}

export interface TeamPlanTimeWindow {
  startMinute: number
  endMinute: number
  hourMarks: Array<{ minute: number; label: string }>
}

/** Shared time window across every lane so timeline columns align; 60-minute ticks only — no false minute-level precision. */
export function buildTeamPlanTimeWindow(lanes: TeamPlanLane[], now: Date): TeamPlanTimeWindow {
  const nowMinute = now.getHours() * 60 + now.getMinutes()
  let minStart = nowMinute
  let maxEnd = nowMinute
  for (const lane of lanes) {
    for (const stop of lane.stops) {
      if (stop.startMinute < minStart) minStart = stop.startMinute
      if (stop.startMinute + stop.durationMinutes > maxEnd) maxEnd = stop.startMinute + stop.durationMinutes
    }
  }
  const startMinute = Math.floor((Math.min(minStart, nowMinute) - 30) / 60) * 60
  const endMinute = Math.ceil(Math.max(maxEnd, nowMinute + 60) / 60) * 60

  const hourMarks: Array<{ minute: number; label: string }> = []
  for (let m = startMinute; m <= endMinute; m += 60) {
    const h = ((Math.floor(m / 60) % 24) + 24) % 24
    hourMarks.push({ minute: m, label: h > 12 ? `${h - 12}p` : h === 12 ? '12p' : h === 0 ? '12a' : `${h}a` })
  }
  return { startMinute, endMinute, hourMarks }
}

export interface TeamPlanPoolRoom {
  roomId: string
  roomNumber: string
  cleanType: CleanType | null
  status: string
  isRush: boolean
  isVip: boolean
  credits: number
  /** Active DND, service declined, or an unresolved occupancy discrepancy --
   * still shown (never silently dropped from workload) but not routed as
   * normal actionable work; see spec sections 31-32. */
  blocked: boolean
  dndRetryAt: string | null
  occupancyDiscrepancy: boolean
}

function isBlockedRoom(room: HousekeepingOperationalRoom): boolean {
  return getHousekeepingExecutionBlock(room) !== null
}

/** Blocked rooms sort last regardless of Rush/VIP (they can't be actioned right
 * now); otherwise Rush/VIP first, then building -> floor -> room, matching the
 * lane sequencing rule so the pool previews where a room would slot in. */
export function buildUnassignedTeamPool(
  rooms: HousekeepingOperationalRoom[],
  pendingAssignments: Record<string, string>,
): { rooms: TeamPlanPoolRoom[]; totalCredits: number } {
  const open = rooms.filter((r) => isOpenHousekeepingRoom({ status: r.housekeepingStatus }))
  const unassigned = open
    .filter((r) => !pendingAssignments[r.roomId] && !r.assignedHousekeeperId)
    .filter((r) => !(r.housekeepingStatus === 'OCCUPIED' && !r.cleanType))
    .sort((a, b) => {
      const blockedA = isBlockedRoom(a) ? 1 : 0
      const blockedB = isBlockedRoom(b) ? 1 : 0
      if (blockedA !== blockedB) return blockedA - blockedB
      const rushA = isRushRoom(a) ? 0 : 1
      const rushB = isRushRoom(b) ? 0 : 1
      if (rushA !== rushB) return rushA - rushB
      const vipA = a.isVip ? 0 : 1
      const vipB = b.isVip ? 0 : 1
      if (vipA !== vipB) return vipA - vipB
      const buildingA = a.building ?? ''
      const buildingB = b.building ?? ''
      if (buildingA !== buildingB) return buildingA.localeCompare(buildingB)
      const floorA = a.floor ?? 0
      const floorB = b.floor ?? 0
      if (floorA !== floorB) return floorA - floorB
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
    })

  return {
    rooms: unassigned.map((r) => ({
      roomId: r.roomId,
      roomNumber: r.roomNumber,
      cleanType: r.cleanType,
      status: r.housekeepingStatus,
      isRush: isRushRoom(r),
      isVip: r.isVip,
      credits: getRoomWorkloadCredits(r),
      blocked: isBlockedRoom(r),
      dndRetryAt: r.dndRetryAt,
      occupancyDiscrepancy: r.occupancyDiscrepancy,
    })),
    totalCredits: unassigned.reduce((sum, r) => sum + getRoomWorkloadCredits(r), 0),
  }
}

export type TeamPlanAttentionActionKind = 'assign' | 'rebalance' | 'open'

export interface TeamPlanAttentionItem {
  id: string
  code: HousekeepingAttentionCode | 'guest_request'
  roomId: string | null
  roomNumber: string | null
  assigneeId: string | null
  assigneeName: string | null
  at: string | null
  title: string | null
  actionKind: TeamPlanAttentionActionKind
}

const ATTENTION_SEVERITY: Record<HousekeepingAttentionCode, number> = {
  occupancy_discrepancy: 6,
  dnd_welfare_escalation: 6,
  dnd: 5,
  return_later_due: 5,
  ooo_arrival_conflict: 5,
  arrival_risk: 4,
  unassigned_priority_room: 4,
  failed_inspection: 3,
  reclean: 3,
  open_blocking_work_order: 3,
  rush: 2,
  service_declined: 1,
}

interface TeamPlanGuestRequestLike {
  id: string
  category: string
  priority: string
  title: string
  rooms?: { room_number: string } | null
}

/**
 * Team-execution exceptions only: room-level issues (via the shared attention
 * model, one explainable code per room) plus housekeeping-relevant guest
 * requests (extra towels, feather-free setup, timing, guest waiting) — generic
 * front-desk/concierge/maintenance requests stay in Tasks (see spec section 24).
 */
export function buildTeamPlanAttentionItems(params: {
  rooms: HousekeepingOperationalRoom[]
  guestRequests: TeamPlanGuestRequestLike[]
  nameById: Record<string, string>
  dndWelfarePolicy?: { thresholdHours: number } | null
}): TeamPlanAttentionItem[] {
  const { rooms, guestRequests, nameById, dndWelfarePolicy } = params
  const roomItems: TeamPlanAttentionItem[] = []

  for (const room of rooms) {
    const primary = getPrimaryRoomAttention(room, { dndWelfarePolicy })
    if (!primary) continue
    const assigneeId = room.assignedHousekeeperId
    const at = primary.code === 'dnd' || primary.code === 'return_later_due'
      ? room.dndRetryAt
      : (primary.code === 'arrival_risk' || primary.code === 'unassigned_priority_room' || primary.code === 'ooo_arrival_conflict' || primary.code === 'dnd_welfare_escalation')
        ? room.checkinTime
        : null
    roomItems.push({
      id: `${room.roomId}-${primary.code}`,
      code: primary.code,
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      assigneeId,
      assigneeName: assigneeId ? nameById[assigneeId] ?? null : null,
      at,
      title: null,
      actionKind: assigneeId ? 'rebalance' : (primary.code === 'unassigned_priority_room' ? 'assign' : 'open'),
    })
  }

  const relevantCategories = new Set(['housekeeping', 'accessibility'])
  const requestItems: TeamPlanAttentionItem[] = guestRequests
    .filter((r) => relevantCategories.has(r.category) || (r.category === 'service' && r.priority === 'urgent'))
    .slice(0, 3)
    .map((r) => ({
      id: `request-${r.id}`,
      code: 'guest_request' as const,
      roomId: null,
      roomNumber: r.rooms?.room_number ?? null,
      assigneeId: null,
      assigneeName: null,
      at: null,
      title: r.title,
      actionKind: 'open' as const,
    }))

  return [...roomItems, ...requestItems]
    .sort((a, b) => {
      const sa = a.code === 'guest_request' ? 4.5 : ATTENTION_SEVERITY[a.code as HousekeepingAttentionCode]
      const sb = b.code === 'guest_request' ? 4.5 : ATTENTION_SEVERITY[b.code as HousekeepingAttentionCode]
      return sb - sa
    })
    .slice(0, 8)
}
