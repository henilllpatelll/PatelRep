import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeHousekeepingRoom } from './roomState'
import {
  buildTeamPlanAttentionItems,
  buildTeamPlanLanes,
  buildTeamPlanStops,
  buildUnassignedTeamPool,
  computeLanePace,
  splitTeamPlanLanes,
} from './teamPlanView'

const NOW = new Date('2026-09-30T15:00:00.000Z') // 15:00 UTC

function room(overrides: Record<string, any>) {
  return normalizeHousekeepingRoom({
    room_id: overrides.room_id,
    status: overrides.status ?? 'DIRTY',
    clean_type: 'clean_type' in overrides ? overrides.clean_type : 'FULL',
    assigned_to: overrides.assigned_to ?? null,
    checkin_time: overrides.checkin_time,
    prediction: overrides.risk_level ? { risk_level: overrides.risk_level } : undefined,
    priority: overrides.priority,
    vip_flag: overrides.vip_flag,
    dnd_flag: overrides.dnd_flag,
    dnd_retry_at: overrides.dnd_retry_at,
    do_not_service: overrides.do_not_service,
    occupancy_discrepancy: overrides.occupancy_discrepancy,
    guest_request_count: overrides.guest_request_count,
    last_cleaned_at: overrides.last_cleaned_at,
    rooms: {
      room_number: overrides.room_number ?? overrides.room_id,
      building: overrides.building ?? 'A',
      floor: overrides.floor ?? 1,
      room_types: overrides.base_clean_minutes ? { base_clean_minutes: overrides.base_clean_minutes } : undefined,
    },
  })
}

test('sequences done, active, then priority-ordered pending stops', () => {
  const rooms = [
    room({ room_id: '1', room_number: '101', status: 'INSPECTED', assigned_to: 'hk-1' }),
    room({ room_id: '2', room_number: '108', status: 'IN_PROGRESS', assigned_to: 'hk-1' }),
    room({ room_id: '3', room_number: '112', status: 'DIRTY', assigned_to: 'hk-1' }),
    room({ room_id: '4', room_number: '110', status: 'DIRTY', assigned_to: 'hk-1', priority: 1 }), // rush
  ]

  const stops = buildTeamPlanStops({ rooms, housekeeperId: 'hk-1', pendingAssignments: {}, now: NOW })

  assert.deepEqual(stops.map((s) => s.roomNumber), ['101', '108', '110', '112'])
  assert.deepEqual(stops.map((s) => s.state), ['done', 'active', 'pending', 'pending'])
  // Rush pending room (110) sorts before the non-rush pending room (112) despite the room-number order.
  const pendingOrder = stops.filter((s) => s.state === 'pending').map((s) => s.roomNumber)
  assert.deepEqual(pendingOrder, ['110', '112'])
})

test('orders pending stops by guest-waiting, rush, arrival risk, then earliest arrival', () => {
  const rooms = [
    room({ room_id: '1', room_number: '201', status: 'DIRTY', assigned_to: 'hk-1' }),
    room({ room_id: '2', room_number: '202', status: 'DIRTY', assigned_to: 'hk-1', risk_level: 'HIGH' }),
    room({ room_id: '3', room_number: '203', status: 'DIRTY', assigned_to: 'hk-1', guest_request_count: 1 }),
    room({ room_id: '4', room_number: '204', status: 'DIRTY', assigned_to: 'hk-1', checkin_time: '2026-09-30T16:00:00.000Z' }),
  ]

  const stops = buildTeamPlanStops({ rooms, housekeeperId: 'hk-1', pendingAssignments: {}, now: NOW })

  assert.deepEqual(stops.map((s) => s.roomNumber), ['203', '202', '204', '201'])
})

test('flags a staged (not yet published) assignment and marks the building change between stops', () => {
  const rooms = [
    room({ room_id: '1', room_number: '101', status: 'DIRTY', building: 'A', floor: 1 }),
    room({ room_id: '2', room_number: '201', status: 'DIRTY', building: 'B', floor: 2 }),
  ]

  const stops = buildTeamPlanStops({
    rooms,
    housekeeperId: 'hk-1',
    pendingAssignments: { '1': 'hk-1', '2': 'hk-1' },
    now: NOW,
  })

  assert.equal(stops[0].staged, true)
  assert.equal(stops[0].buildingChangeAfter, true)
  assert.equal(stops[1].buildingChangeAfter, false)
})

test('excludes out-of-order rooms from a lane even if nominally owned', () => {
  const rooms = [room({ room_id: '1', room_number: '101', status: 'OOO', assigned_to: 'hk-1' })]
  const stops = buildTeamPlanStops({ rooms, housekeeperId: 'hk-1', pendingAssignments: {}, now: NOW })
  assert.equal(stops.length, 0)
})

test('computes pace only when a real arrival deadline exists, and omits it otherwise', () => {
  const noDeadline = buildTeamPlanStops({
    rooms: [room({ room_id: '1', room_number: '101', status: 'DIRTY', assigned_to: 'hk-1', base_clean_minutes: 30 })],
    housekeeperId: 'hk-1',
    pendingAssignments: {},
    now: NOW,
  })
  assert.equal(computeLanePace(noDeadline, NOW), null)

  const comfortable = buildTeamPlanStops({
    rooms: [room({
      room_id: '1', room_number: '101', status: 'DIRTY', assigned_to: 'hk-1', base_clean_minutes: 30,
      checkin_time: '2026-09-30T16:00:00.000Z', // 60 min away, 30 min needed -> comfortably on pace
    })],
    housekeeperId: 'hk-1',
    pendingAssignments: {},
    now: NOW,
  })
  assert.equal(computeLanePace(comfortable, NOW), 'on_pace')

  const behind = buildTeamPlanStops({
    rooms: [room({
      room_id: '1', room_number: '101', status: 'DIRTY', assigned_to: 'hk-1', base_clean_minutes: 90,
      checkin_time: '2026-09-30T15:30:00.000Z', // 30 min away, 90 min needed -> behind
    })],
    housekeeperId: 'hk-1',
    pendingAssignments: {},
    now: NOW,
  })
  assert.equal(computeLanePace(behind, NOW), 'behind')
})

test('builds one lane per staff member with credits, capacity, and floors derived from their stops', () => {
  const rooms = [
    room({ room_id: '1', room_number: '101', status: 'DIRTY', assigned_to: 'hk-1', clean_type: 'DEP', floor: 1 }),
    room({ room_id: '2', room_number: '201', status: 'DIRTY', assigned_to: 'hk-1', clean_type: 'FULL', floor: 2 }),
  ]

  const lanes = buildTeamPlanLanes({
    staff: [{ id: 'hk-1', name: 'Maria Santos' }],
    rooms,
    pendingAssignments: {},
    shiftInfoById: { 'hk-1': { availability: 'working', onBreakSince: null } },
    cleaningRoomNumberById: {},
    target: 16,
    now: NOW,
  })

  assert.equal(lanes.length, 1)
  assert.equal(lanes[0].savedCredits, 5) // DEP(3) + FULL(2)
  assert.equal(lanes[0].projectedCredits, 5)
  assert.deepEqual(lanes[0].floors, [1, 2])
  assert.equal(lanes[0].hasWork, true)
})

test('splits lanes into on-shift and collapsible off-shift groups', () => {
  const lanes = buildTeamPlanLanes({
    staff: [
      { id: 'hk-1', name: 'Working' },
      { id: 'hk-2', name: 'Idle off-shift' },
    ],
    rooms: [],
    pendingAssignments: {},
    shiftInfoById: {
      'hk-1': { availability: 'working', onBreakSince: null },
      'hk-2': { availability: 'off_shift', onBreakSince: null },
    },
    cleaningRoomNumberById: {},
    target: 16,
    now: NOW,
  })

  const { onShift, offShift } = splitTeamPlanLanes(lanes)
  assert.deepEqual(onShift.map((l) => l.id), ['hk-1'])
  assert.deepEqual(offShift.map((l) => l.id), ['hk-2'])
})

test('unassigned pool sorts rush/VIP first and totals credits honestly', () => {
  const rooms = [
    room({ room_id: '1', room_number: '412', status: 'DIRTY', clean_type: 'DEP' }),
    room({ room_id: '2', room_number: '414', status: 'DIRTY', clean_type: 'FULL', priority: 1 }),
    room({ room_id: '3', room_number: '999', status: 'OCCUPIED', clean_type: null }), // no clean type -> no task yet
  ]

  const pool = buildUnassignedTeamPool(rooms, {})

  assert.deepEqual(pool.rooms.map((r) => r.roomNumber), ['414', '412'])
  assert.equal(pool.totalCredits, 5) // FULL(2) + DEP(3)
})

test('Phase 8: unassigned pool sorts a blocked room last even when it is Rush, but never drops it', () => {
  const rooms = [
    room({ room_id: '1', room_number: '410', status: 'DIRTY', clean_type: 'LIGHT' }),
    room({ room_id: '2', room_number: '412', status: 'DIRTY', clean_type: 'FULL', priority: 1, dnd_flag: true }), // rush AND blocked
    room({ room_id: '3', room_number: '414', status: 'DIRTY', clean_type: 'FULL', do_not_service: true }), // blocked, not rush
  ]

  const pool = buildUnassignedTeamPool(rooms, {})

  assert.deepEqual(pool.rooms.map((r) => r.roomNumber), ['410', '412', '414'])
  assert.equal(pool.rooms.find((r) => r.roomNumber === '412')?.blocked, true)
  assert.equal(pool.rooms.find((r) => r.roomNumber === '410')?.blocked, false)
  // Blocked rooms still count toward workload -- never silently dropped (spec section 31).
  assert.equal(pool.rooms.length, 3)
})

test('Phase 8: Team Plan lane stop carries dnd retry time and occupancy discrepancy through for the block/lane UI', () => {
  const rooms = [
    room({ room_id: '1', room_number: '205', status: 'DIRTY', assigned_to: 'hk-1', dnd_flag: false, dnd_retry_at: '2026-09-30T13:00:00.000Z' }),
    room({ room_id: '2', room_number: '417', status: 'DIRTY', assigned_to: 'hk-1', occupancy_discrepancy: true }),
  ]

  const stops = buildTeamPlanStops({ rooms, housekeeperId: 'hk-1', pendingAssignments: {}, now: new Date('2026-09-30T09:00:00.000Z') })

  const dndStop = stops.find((s) => s.roomNumber === '205')
  assert.equal(dndStop?.dndRetryAt, '2026-09-30T13:00:00.000Z')
  const discrepancyStop = stops.find((s) => s.roomNumber === '417')
  assert.equal(discrepancyStop?.occupancyDiscrepancy, true)
})

test('attention surfaces one explainable item per room plus housekeeping-relevant guest requests, most severe first', () => {
  const rooms = [
    room({ room_id: '1', room_number: '101', status: 'DIRTY', dnd_flag: true, dnd_retry_at: '2026-09-30T18:00:00.000Z' }),
    room({ room_id: '2', room_number: '102', status: 'DIRTY', assigned_to: 'hk-1', risk_level: 'HIGH', checkin_time: '2026-09-30T16:00:00.000Z' }),
  ]

  const items = buildTeamPlanAttentionItems({
    rooms,
    guestRequests: [
      { id: 'g1', category: 'housekeeping', priority: 'normal', title: 'Extra towels' },
      { id: 'g2', category: 'maintenance', priority: 'urgent', title: 'Unrelated maintenance ticket' },
    ],
    nameById: { 'hk-1': 'Maria Santos' },
  })

  assert.equal(items.some((i) => i.code === 'dnd' && i.roomNumber === '101'), true)
  assert.equal(items.some((i) => i.code === 'arrival_risk' && i.assigneeName === 'Maria Santos'), true)
  assert.equal(items.some((i) => i.code === 'guest_request' && i.title === 'Extra towels'), true)
  assert.equal(items.some((i) => i.title === 'Unrelated maintenance ticket'), false)
  // dnd (severity 5) ranks ahead of arrival_risk (severity 4)
  assert.equal(items[0].code, 'dnd')
})
