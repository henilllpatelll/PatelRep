import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterHousekeepingBoardRooms,
  getHousekeepingBoardFilterCounts,
  normalizeHousekeepingBoardRoom,
} from './housekeepingBoardFilters'
import { getCleanAwareStatusLabel } from './cleanType'

const rooms = [
  { room_id: 'dep-occ', status: 'OCCUPIED', clean_type: 'DEP' },
  { room_id: 'dep-vac', status: 'DIRTY', clean_type: 'DEP' },
  { room_id: 'full', status: 'PICKUP', clean_type: 'FULL' },
  { room_id: 'light', status: 'PICKUP', clean_type: 'LIGHT' },
  { room_id: 'clean', status: 'INSPECTED', clean_type: null },
]

test('departure filter finds both occupied and vacant departure rooms', () => {
  const filtered = filterHousekeepingBoardRooms(rooms, {
    statusFilter: null,
    cleanTypeFilter: ['DEP'],
    showRiskOnly: false,
    predictions: {},
  })

  assert.deepEqual(filtered.map((room) => room.room_id), ['dep-occ', 'dep-vac'])
})

test('pickup filter can distinguish full service from light service', () => {
  const fullPickup = filterHousekeepingBoardRooms(rooms, {
    statusFilter: 'PICKUP',
    cleanTypeFilter: ['FULL'],
    showRiskOnly: false,
    predictions: {},
  })
  const lightPickup = filterHousekeepingBoardRooms(rooms, {
    statusFilter: 'PICKUP',
    cleanTypeFilter: ['LIGHT'],
    showRiskOnly: false,
    predictions: {},
  })

  assert.deepEqual(fullPickup.map((room) => room.room_id), ['full'])
  assert.deepEqual(lightPickup.map((room) => room.room_id), ['light'])
})

test('multi-select clean type filter returns rooms matching any selected type', () => {
  const filtered = filterHousekeepingBoardRooms(rooms, {
    statusFilter: null,
    cleanTypeFilter: ['DEP', 'FULL'],
    showRiskOnly: false,
    predictions: {},
  })

  assert.deepEqual(filtered.map((room) => room.room_id), ['dep-occ', 'dep-vac', 'full'])
})

test('empty clean type filter returns all rooms', () => {
  const filtered = filterHousekeepingBoardRooms(rooms, {
    statusFilter: null,
    cleanTypeFilter: [],
    showRiskOnly: false,
    predictions: {},
  })

  assert.equal(filtered.length, rooms.length)
})

test('filter counts include departure full and light clean types', () => {
  assert.deepEqual(getHousekeepingBoardFilterCounts(rooms).cleanTypeCounts, {
    DEP: 2,
    FULL: 1,
    LIGHT: 1,
  })
})

test('normalizes imported clean types for room card display', () => {
  assert.deepEqual(
    normalizeHousekeepingBoardRoom({ room_id: 'dep', status: 'DIRTY', fo_status: 'OCC', clean_type: 'DEP' }),
    { room_id: 'dep', status: 'OCCUPIED', fo_status: 'OCC', clean_type: 'DEP' },
  )
  assert.deepEqual(
    normalizeHousekeepingBoardRoom({ room_id: 'full', status: 'DIRTY', fo_status: 'OCC', clean_type: 'FULL' }),
    { room_id: 'full', status: 'PICKUP', fo_status: 'OCC', clean_type: 'FULL' },
  )
})

test('infers occupied departure display for older local room status rows', () => {
  assert.deepEqual(
    normalizeHousekeepingBoardRoom({ room_id: 'legacy-dep', status: 'DIRTY', fo_status: 'OCC' }),
    { room_id: 'legacy-dep', status: 'OCCUPIED', fo_status: 'OCC', clean_type: 'DEP' },
  )
})

test('adds clean type to primary room card status labels', () => {
  assert.equal(getCleanAwareStatusLabel('Pickup', 'FULL', 'PICKUP'), 'Pickup - Full')
  assert.equal(getCleanAwareStatusLabel('Pickup', 'LIGHT', 'PICKUP'), 'Pickup - Light')
  assert.equal(getCleanAwareStatusLabel('Occupied', 'DEP', 'OCCUPIED'), 'Occupied')
  assert.equal(getCleanAwareStatusLabel('Pickup', null, 'PICKUP'), 'Pickup')
})
