import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterHousekeepingBoardView,
  getAttentionSummary,
  getBoardKpis,
  isLiveBoardDate,
} from './boardView'
import { normalizeHousekeepingRoom } from './roomState'

const rooms = [
  normalizeHousekeepingRoom({ room_id: '101', status: 'DIRTY', clean_type: 'DEP', vip_flag: true, assigned_to: null, dnd_flag: true, prediction: { risk_level: 'HIGH' }, rooms: { room_number: '101', building: 'North', floor: 1 } }),
  normalizeHousekeepingRoom({ room_id: '102', status: 'IN_PROGRESS', clean_type: 'FULL', assigned_to: 'maria', rooms: { room_number: '102', building: 'North', floor: 1 } }),
  normalizeHousekeepingRoom({ room_id: '201', status: 'CLEAN', clean_type: 'LIGHT', priority: 1, rooms: { room_number: '201', building: 'South', floor: 2 } }),
  normalizeHousekeepingRoom({ room_id: '202', status: 'INSPECTED', assigned_to: 'maria', rooms: { room_number: '202', building: 'South', floor: 2 } }),
  normalizeHousekeepingRoom({ room_id: '203', status: 'OOO', checkin_time: '2026-10-01T15:00:00.000Z', rooms: { room_number: '203', building: 'South', floor: 2 } }),
]

test('only treats the current operational date as live', () => {
  assert.equal(isLiveBoardDate('2026-09-30', '2026-09-30'), true)
  assert.equal(isLiveBoardDate('2026-09-29', '2026-09-30'), false)
  assert.equal(isLiveBoardDate('2026-10-01', '2026-09-30'), false)
})

test('derives compact room-board KPIs from the Phase 1 operational selectors', () => {
  assert.deepEqual(getBoardKpis(rooms), {
    needsCleaning: 1,
    needsCleaningCredits: 3,
    inProgress: 1,
    inspection: 1,
    inspectionPriority: 1,
    ready: 1,
    outOfOrder: 1,
    outOfOrderArrivalConflict: 1,
  })
})

test('uses one composable filter model for KPI, status, search, and structured filters', () => {
  const result = filterHousekeepingBoardView(rooms, {
    status: 'needs_action',
    building: 'North',
    floor: 1,
    assigneeId: null,
    cleanTypes: ['DEP'],
    search: '101',
    attention: null,
    unassignedOnly: true,
  })

  assert.deepEqual(result.map((room) => room.roomId), ['101'])
})

test('keeps supervisor attention separate from the dirty-work quick filter', () => {
  assert.deepEqual(
    filterHousekeepingBoardView(rooms, { status: 'needs_action', building: null, floor: null, assigneeId: null, cleanTypes: [], search: '', attention: null, unassignedOnly: false })
      .map((room) => room.roomId),
    ['101', '201', '203'],
  )
  assert.deepEqual(
    filterHousekeepingBoardView(rooms, { status: 'dirty', building: null, floor: null, assigneeId: null, cleanTypes: [], search: '', attention: null, unassignedOnly: false })
      .map((room) => room.roomId),
    ['101'],
  )
})

test('search matches a partial room number and an available local assignee name', () => {
  assert.deepEqual(
    filterHousekeepingBoardView(rooms, { status: null, building: null, floor: null, assigneeId: null, cleanTypes: [], search: '02', attention: null, unassignedOnly: false })
      .map((room) => room.roomId),
    ['102', '202'],
  )
  assert.deepEqual(
    filterHousekeepingBoardView(rooms, { status: null, building: null, floor: null, assigneeId: null, cleanTypes: [], search: 'maria', attention: null, unassignedOnly: false }, { maria: 'Maria Cruz' })
      .map((room) => room.roomId),
    ['102', '202'],
  )
})

test('summarizes only actual attention categories and has an explicit empty result', () => {
  const attention = getAttentionSummary(rooms)
  assert.deepEqual(attention.map((item) => [item.code, item.count]), [
    ['dnd', 1],
    ['rush', 1],
    ['arrival_risk', 1],
    ['ooo_arrival_conflict', 1],
    ['unassigned_priority_room', 1],
  ])
  assert.deepEqual(getAttentionSummary([rooms[1], rooms[3]]), [])
})
