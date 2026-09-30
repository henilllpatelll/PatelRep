import { getCleanTypeCredits, isOpenHousekeepingRoom, type CleanType } from '@/lib/utils/cleanType'
import {
  normalizeStaffAvailability,
  sortHousekeepingRooms,
  type HousekeepingOperationalRoom,
  type StaffAvailability,
} from './roomState'
import type { AssignmentSuggestion } from '@/lib/api/housekeeping'
import type { ShiftRosterEntry } from '@/lib/api/shifts'

/** A room whose occupied/departure ambiguity means it needs a clean-type choice before it can be staged. */
export function roomNeedsCleanTypePrompt(room: Pick<HousekeepingOperationalRoom, 'cleanType' | 'housekeepingStatus' | 'occupancyStatus'>): boolean {
  if (room.cleanType) return false
  return room.housekeepingStatus === 'OCCUPIED' || (room.occupancyStatus === 'OCC' && (room.housekeepingStatus === 'DIRTY' || room.housekeepingStatus === 'PICKUP'))
}

export type CapacityState = 'under' | 'on' | 'at' | 'over'

/**
 * Under target / On target / At capacity / Over target — text-labeled (never
 * color-only, see spec) so the roster stays scannable without relying on hue.
 */
export function getCapacityState(credits: number, target: number): CapacityState {
  if (target <= 0) return credits > 0 ? 'over' : 'on'
  const over = credits - target
  if (over > 2) return 'over'
  if (credits >= target) return 'at'
  if (over < -2) return 'under'
  return 'on'
}

export interface StaffShiftInfo {
  availability: StaffAvailability
  onBreakSince: string | null
}

/** Combines the roster read (hk_shift_sessions) with today's schedule to decide availability. */
export function getStaffShiftInfo(
  shiftRow: ShiftRosterEntry | undefined,
  isScheduled: boolean,
): StaffShiftInfo {
  return {
    availability: normalizeStaffAvailability({ shiftSession: shiftRow ?? null, isScheduled }),
    onBreakSince: shiftRow?.on_break_since ?? null,
  }
}

const AVAILABILITY_SORT_RANK: Record<StaffAvailability, number> = {
  working: 0,
  available: 1,
  on_break: 2,
  off_shift: 3,
  unavailable: 4,
}

export interface AssignmentPoolRoom {
  roomId: string
  roomNumber: string
  floor: number | null
  building: string | null
  cleanType: CleanType | null
  assignedTo: string | null
}

export interface AssignmentStaffLoad {
  id: string
  name: string
  availability: StaffAvailability
  currentRoomNumber: string | null
  savedRooms: number
  savedCredits: number
  stagedRooms: number
  stagedCredits: number
  projectedCredits: number
  target: number
  capacityState: CapacityState
  floors: number[]
}

/**
 * One workload row per housekeeper for the Team panel — current load, what's
 * staged on top of it this session, and the resulting projected total.
 */
export function buildStaffLoads(params: {
  staff: Array<{ id: string; name: string }>
  openRooms: AssignmentPoolRoom[]
  pendingAssignments: Record<string, string>
  pendingAssignmentCleanTypes: Record<string, CleanType>
  shiftInfoById: Record<string, StaffShiftInfo>
  cleaningRoomNumberById: Record<string, string>
  target: number
  targetsByStaff?: Record<string, number>
  creditWeights?: Partial<Record<CleanType, number>>
}): AssignmentStaffLoad[] {
  const { staff, openRooms, pendingAssignments, pendingAssignmentCleanTypes, shiftInfoById, cleaningRoomNumberById, target, targetsByStaff, creditWeights } = params

  return staff.map((member): AssignmentStaffLoad => {
    let savedRooms = 0
    let savedCredits = 0
    let stagedRooms = 0
    let stagedCredits = 0
    const floors = new Set<number>()

    for (const room of openRooms) {
      const pending = pendingAssignments[room.roomId]
      const owner = pending ?? room.assignedTo
      if (owner !== member.id) continue
      const credits = getCleanTypeCredits(pendingAssignmentCleanTypes[room.roomId] ?? room.cleanType, creditWeights)
      if (room.floor !== null) floors.add(room.floor)
      if (pending) {
        stagedRooms += 1
        stagedCredits += credits
      } else {
        savedRooms += 1
        savedCredits += credits
      }
    }

    const projectedCredits = savedCredits + stagedCredits

    const memberTarget = targetsByStaff?.[member.id] ?? target
    return {
      id: member.id,
      name: member.name,
      availability: shiftInfoById[member.id]?.availability ?? 'unavailable',
      currentRoomNumber: cleaningRoomNumberById[member.id] ?? null,
      savedRooms,
      savedCredits,
      stagedRooms,
      stagedCredits,
      projectedCredits,
      target: memberTarget,
      capacityState: getCapacityState(projectedCredits, memberTarget),
      floors: Array.from(floors).sort((a, b) => a - b),
    }
  })
}

/** Working/available staff first, then break, then off-shift/unavailable; ties broken by lowest projected load. */
export function sortAssignmentStaff(loads: AssignmentStaffLoad[]): AssignmentStaffLoad[] {
  return [...loads].sort((left, right) => {
    const rankDiff = AVAILABILITY_SORT_RANK[left.availability] - AVAILABILITY_SORT_RANK[right.availability]
    if (rankDiff !== 0) return rankDiff
    if (left.projectedCredits !== right.projectedCredits) return left.projectedCredits - right.projectedCredits
    return left.name.localeCompare(right.name)
  })
}

export type AssignmentPoolTab = 'all' | 'unassigned' | 'staged'

export function getAssignmentPoolTabCounts(
  rooms: HousekeepingOperationalRoom[],
  pendingAssignments: Record<string, string>,
): Record<AssignmentPoolTab, number> {
  const open = rooms.filter((room) => isOpenHousekeepingRoom({ status: room.housekeepingStatus }))
  return {
    all: open.length,
    unassigned: open.filter((room) => !pendingAssignments[room.roomId] && !room.assignedHousekeeperId).length,
    staged: open.filter((room) => !!pendingAssignments[room.roomId]).length,
  }
}

/** Applies the pool's tab (on top of the shared board filters already run) and keeps only open rooms. */
export function filterAssignmentPoolByTab(
  rooms: HousekeepingOperationalRoom[],
  tab: AssignmentPoolTab,
  pendingAssignments: Record<string, string>,
): HousekeepingOperationalRoom[] {
  const open = rooms.filter((room) => isOpenHousekeepingRoom({ status: room.housekeepingStatus }))
  if (tab === 'unassigned') return open.filter((room) => !pendingAssignments[room.roomId] && !room.assignedHousekeeperId)
  if (tab === 'staged') return open.filter((room) => !!pendingAssignments[room.roomId])
  return open
}

export function sortAssignmentPool(rooms: HousekeepingOperationalRoom[]): HousekeepingOperationalRoom[] {
  return sortHousekeepingRooms(rooms)
}

export interface StagedChangeEntry {
  roomId: string
  roomNumber: string
  fromLabel: string
  toLabel: string
}

/** One row per staged change for the review panel, each independently undoable. */
export function getStagedChangesList(
  rooms: AssignmentPoolRoom[],
  pendingAssignments: Record<string, string>,
  nameById: Record<string, string>,
  unassignedLabel: string,
): StagedChangeEntry[] {
  return Object.entries(pendingAssignments)
    .map(([roomId, newOwnerId]) => {
      const room = rooms.find((candidate) => candidate.roomId === roomId)
      if (!room) return null
      return {
        roomId,
        roomNumber: room.roomNumber,
        fromLabel: room.assignedTo ? (nameById[room.assignedTo] ?? unassignedLabel) : unassignedLabel,
        toLabel: nameById[newOwnerId] ?? unassignedLabel,
      }
    })
    .filter((entry): entry is StagedChangeEntry => entry !== null)
    .sort((left, right) => left.roomNumber.localeCompare(right.roomNumber, undefined, { numeric: true }))
}

/** Same-floor moves cost nothing; every distinct floor a housekeeper touches beyond their first adds one. */
function estimateFloorChanges(roomsByHousekeeper: Map<string, Set<number>>): number {
  let total = 0
  for (const floors of roomsByHousekeeper.values()) {
    if (floors.size > 0) total += floors.size - 1
  }
  return total
}

export interface AutoBalanceHousekeeperPreview {
  id: string
  name: string
  currentRooms: number
  currentCredits: number
  proposedRooms: number
  proposedCredits: number
}

export interface AutoBalanceChange {
  roomId: string
  roomNumber: string
  fromLabel: string
  toLabel: string
  toId: string
}

export interface AutoBalancePreview {
  totalRooms: number
  totalCredits: number
  attendantCount: number
  perHousekeeper: AutoBalanceHousekeeperPreview[]
  floorChangesBefore: number
  floorChangesAfter: number
  changes: AutoBalanceChange[]
}

/**
 * Builds an honest before/after preview from what the CP-SAT suggester
 * actually returned — it never claims criteria (e.g. arrival deadlines) the
 * solver doesn't use; see routers/housekeeping.py's suggest_assignments.
 */
export function buildAutoBalancePreview(
  currentRooms: AssignmentPoolRoom[],
  suggestions: AssignmentSuggestion[],
  nameById: Record<string, string>,
  unassignedLabel: string,
): AutoBalancePreview {
  const currentByHousekeeper = new Map<string, Set<number>>()
  const currentCreditsById = new Map<string, { rooms: number; credits: number }>()
  for (const room of currentRooms) {
    if (!room.assignedTo) continue
    const floors = currentByHousekeeper.get(room.assignedTo) ?? new Set<number>()
    if (room.floor !== null) floors.add(room.floor)
    currentByHousekeeper.set(room.assignedTo, floors)
    const entry = currentCreditsById.get(room.assignedTo) ?? { rooms: 0, credits: 0 }
    entry.rooms += 1
    entry.credits += getCleanTypeCredits(room.cleanType)
    currentCreditsById.set(room.assignedTo, entry)
  }

  const proposedByHousekeeper = new Map<string, Set<number>>()
  const changes: AutoBalanceChange[] = []
  let totalRooms = 0
  let totalCredits = 0

  const perHousekeeper: AutoBalanceHousekeeperPreview[] = suggestions.map((suggestion) => {
    const floors = new Set<number>()
    for (const room of suggestion.rooms) {
      if (room.floor !== null && room.floor !== undefined) floors.add(room.floor)
      const previousOwner = currentRooms.find((candidate) => candidate.roomId === room.room_id)?.assignedTo ?? null
      const toName = suggestion.housekeeper.preferred_name || suggestion.housekeeper.full_name || unassignedLabel
      if (previousOwner !== suggestion.housekeeper.id) {
        changes.push({
          roomId: room.room_id,
          roomNumber: room.room_number,
          fromLabel: previousOwner ? (nameById[previousOwner] ?? unassignedLabel) : unassignedLabel,
          toLabel: toName,
          toId: suggestion.housekeeper.id,
        })
      }
    }
    proposedByHousekeeper.set(suggestion.housekeeper.id, floors)
    totalRooms += suggestion.room_count
    const proposedCredits = suggestion.rooms.reduce((sum, room) => sum + getCleanTypeCredits(inferCleanTypeFromMinutes(room.base_clean_minutes)), 0)
    totalCredits += proposedCredits
    const current = currentCreditsById.get(suggestion.housekeeper.id) ?? { rooms: 0, credits: 0 }
    return {
      id: suggestion.housekeeper.id,
      name: suggestion.housekeeper.preferred_name || suggestion.housekeeper.full_name || unassignedLabel,
      currentRooms: current.rooms,
      currentCredits: current.credits,
      proposedRooms: suggestion.room_count,
      proposedCredits,
    }
  })

  return {
    totalRooms,
    totalCredits,
    attendantCount: suggestions.length,
    perHousekeeper,
    floorChangesBefore: estimateFloorChanges(currentByHousekeeper),
    floorChangesAfter: estimateFloorChanges(proposedByHousekeeper),
    changes,
  }
}

/**
 * The suggester's SuggestedRoom shape doesn't carry clean_type — only
 * base_clean_minutes — so credits are approximated from the room type's
 * clean-length bucket rather than fabricating a clean type it never returned.
 */
function inferCleanTypeFromMinutes(minutes: number): CleanType {
  if (minutes >= 45) return 'DEP'
  if (minutes >= 25) return 'FULL'
  return 'LIGHT'
}
