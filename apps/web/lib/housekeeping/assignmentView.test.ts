import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAutoBalancePreview,
  buildStaffLoads,
  getAssignmentPoolTabCounts,
  getCapacityState,
  getStagedChangesList,
  getStaffShiftInfo,
  sortAssignmentStaff,
  type AssignmentPoolRoom,
} from './assignmentView'
import { normalizeHousekeepingRoom } from './roomState'
import type { AssignmentSuggestion } from '@/lib/api/housekeeping'

test('getCapacityState labels under/on/at/over relative to target', () => {
  assert.equal(getCapacityState(10, 16), 'under')
  assert.equal(getCapacityState(15, 16), 'on')
  assert.equal(getCapacityState(16, 16), 'at')
  assert.equal(getCapacityState(17, 16), 'at')
  assert.equal(getCapacityState(19, 16), 'over')
})

test('getStaffShiftInfo prefers the live shift session over the schedule', () => {
  assert.equal(getStaffShiftInfo({ user_id: 'hk-1', status: 'on_break', started_at: '', on_break_since: '2026-01-01T00:00:00Z', break_seconds: 0 }, true).availability, 'on_break')
  assert.equal(getStaffShiftInfo(undefined, true).availability, 'available')
  assert.equal(getStaffShiftInfo(undefined, false).availability, 'unavailable')
})

const rooms: AssignmentPoolRoom[] = [
  { roomId: '101', roomNumber: '101', floor: 1, building: 'A', cleanType: 'DEP', assignedTo: 'maria' },
  { roomId: '102', roomNumber: '102', floor: 1, building: 'A', cleanType: 'LIGHT', assignedTo: null },
  { roomId: '201', roomNumber: '201', floor: 2, building: 'A', cleanType: 'FULL', assignedTo: 'maria' },
]

test('buildStaffLoads sums saved vs staged credits and projects the total', () => {
  const loads = buildStaffLoads({
    staff: [{ id: 'maria', name: 'Maria Santos' }],
    openRooms: rooms,
    pendingAssignments: { '102': 'maria' },
    pendingAssignmentCleanTypes: {},
    shiftInfoById: { maria: { availability: 'working', onBreakSince: null } },
    cleaningRoomNumberById: {},
    target: 16,
  })
  const maria = loads[0]
  assert.equal(maria.savedRooms, 2)
  assert.equal(maria.savedCredits, getCredits('DEP') + getCredits('FULL'))
  assert.equal(maria.stagedRooms, 1)
  assert.equal(maria.stagedCredits, getCredits('LIGHT'))
  assert.equal(maria.projectedCredits, maria.savedCredits + maria.stagedCredits)
  assert.equal(maria.floors.length, 2)
})

test('buildStaffLoads subtracts a room staged away from its current owner', () => {
  const loads = buildStaffLoads({
    staff: [{ id: 'maria', name: 'Maria Santos' }, { id: 'jordan', name: 'Jordan Lee' }],
    openRooms: rooms,
    pendingAssignments: { '201': 'jordan' },
    pendingAssignmentCleanTypes: {},
    shiftInfoById: {},
    cleaningRoomNumberById: {},
    target: 16,
  })
  const maria = loads.find((l) => l.id === 'maria')!
  assert.equal(maria.savedRooms, 1, 'keeps the untouched 101 assignment')
  assert.equal(maria.savedCredits, getCredits('DEP'))
  const jordan = loads.find((l) => l.id === 'jordan')!
  assert.equal(jordan.stagedRooms, 1)
  assert.equal(jordan.stagedCredits, getCredits('FULL'))
})

function getCredits(cleanType: 'DEP' | 'FULL' | 'LIGHT'): number {
  return { DEP: 3, FULL: 2, LIGHT: 1 }[cleanType]
}

test('sortAssignmentStaff ranks working/available before break before off-shift/unavailable', () => {
  const sorted = sortAssignmentStaff([
    { id: 'a', name: 'A', availability: 'unavailable', currentRoomNumber: null, savedRooms: 0, savedCredits: 0, stagedRooms: 0, stagedCredits: 0, projectedCredits: 0, target: 16, capacityState: 'under', floors: [] },
    { id: 'b', name: 'B', availability: 'working', currentRoomNumber: null, savedRooms: 0, savedCredits: 10, stagedRooms: 0, stagedCredits: 0, projectedCredits: 10, target: 16, capacityState: 'under', floors: [] },
    { id: 'c', name: 'C', availability: 'on_break', currentRoomNumber: null, savedRooms: 0, savedCredits: 0, stagedRooms: 0, stagedCredits: 0, projectedCredits: 0, target: 16, capacityState: 'under', floors: [] },
  ])
  assert.deepEqual(sorted.map((s) => s.id), ['b', 'c', 'a'])
})

test('getAssignmentPoolTabCounts counts only open rooms', () => {
  const operational = [
    normalizeHousekeepingRoom({ room_id: '1', status: 'DIRTY', assigned_to: null }),
    normalizeHousekeepingRoom({ room_id: '2', status: 'DIRTY', assigned_to: 'maria' }),
    normalizeHousekeepingRoom({ room_id: '3', status: 'INSPECTED', assigned_to: 'maria' }),
  ]
  const counts = getAssignmentPoolTabCounts(operational, { })
  assert.equal(counts.all, 2)
  assert.equal(counts.unassigned, 1)
  assert.equal(counts.staged, 0)
})

test('getStagedChangesList reports from/to names for each staged room', () => {
  const list = getStagedChangesList(rooms, { '102': 'maria', '101': 'jordan' }, { maria: 'Maria Santos', jordan: 'Jordan Lee' }, 'Unassigned')
  assert.equal(list.length, 2)
  const entry101 = list.find((e) => e.roomId === '101')!
  assert.equal(entry101.fromLabel, 'Maria Santos')
  assert.equal(entry101.toLabel, 'Jordan Lee')
  const entry102 = list.find((e) => e.roomId === '102')!
  assert.equal(entry102.fromLabel, 'Unassigned')
})

test('buildAutoBalancePreview computes before/after credits and a changes diff', () => {
  const suggestions: AssignmentSuggestion[] = [
    {
      housekeeper: { id: 'jordan', full_name: 'Jordan Lee', preferred_name: '', building_affinity: null },
      rooms: [
        { room_id: '101', room_number: '101', floor: 1, building: 'A', status: 'DIRTY', room_type: 'K', base_clean_minutes: 45, is_vip: false, sequence: 1 },
        { room_id: '102', room_number: '102', floor: 1, building: 'A', status: 'DIRTY', room_type: 'K', base_clean_minutes: 20, is_vip: false, sequence: 2 },
      ],
      room_count: 2,
      total_minutes: 65,
    },
  ]
  const preview = buildAutoBalancePreview(rooms, suggestions, { maria: 'Maria Santos' }, 'Unassigned')
  assert.equal(preview.attendantCount, 1)
  assert.equal(preview.totalRooms, 2)
  const jordan = preview.perHousekeeper[0]
  assert.equal(jordan.currentRooms, 0)
  assert.equal(jordan.proposedRooms, 2)
  // 101 moves from maria, 102 moves from unassigned
  assert.equal(preview.changes.length, 2)
  const change101 = preview.changes.find((c) => c.roomId === '101')!
  assert.equal(change101.fromLabel, 'Maria Santos')
  assert.equal(change101.toLabel, 'Jordan Lee')
})
