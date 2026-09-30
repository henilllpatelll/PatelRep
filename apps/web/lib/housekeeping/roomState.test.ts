import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveRoomAttentionItems,
  getDndWelfareStatus,
  getHousekeepingExecutionBlock,
  getHousekeepingRoomMetrics,
  getDefaultWorkloadTarget,
  getRoomCardPresentation,
  getRoomWorkloadCredits,
  normalizeHousekeepingRoom,
  normalizeStaffAvailability,
  sortHousekeepingRooms,
} from './roomState'

const priorityRoom = {
  room_id: '101',
  status: 'DIRTY',
  clean_type: 'DEP',
  assigned_to: null,
  vip_flag: true,
  priority: 1,
  dnd_flag: true,
  checkin_time: '2026-09-30T15:00:00.000Z',
  prediction: { risk_level: 'HIGH', predicted_ready_at: '2026-09-30T15:30:00.000Z' },
  open_work_order_priority: 'urgent',
  open_work_order_status: 'open',
  rooms: { room_number: '101', building: 'Tower A', floor: 1, room_types: { code: 'KNG' } },
}

test('normalizes existing board fields into a reusable operational room model', () => {
  const room = normalizeHousekeepingRoom(priorityRoom)

  assert.equal(room.roomNumber, '101')
  assert.equal(room.roomType, 'KNG')
  assert.equal(room.building, 'Tower A')
  assert.equal(room.assignedHousekeeperId, null)
  assert.equal(room.predictionRisk, 'HIGH')
  assert.equal(room.hasOpenBlockingWorkOrder, true)
})

test('derives room attention from current, real board fields without fabricating missing data', () => {
  const items = deriveRoomAttentionItems(normalizeHousekeepingRoom(priorityRoom))

  assert.deepEqual(items.map((item) => item.code), [
    'dnd',
    'rush',
    'arrival_risk',
    'unassigned_priority_room',
    'open_blocking_work_order',
  ])
})

test('calculates stable board metrics across operational statuses and exceptions', () => {
  const rooms = [
    normalizeHousekeepingRoom(priorityRoom),
    normalizeHousekeepingRoom({ room_id: '102', status: 'IN_PROGRESS', assigned_to: 'hk-1', rooms: { room_number: '102' } }),
    normalizeHousekeepingRoom({ room_id: '103', status: 'CLEAN', inspection_required: true, rooms: { room_number: '103' } }),
    normalizeHousekeepingRoom({ room_id: '104', status: 'INSPECTED', rooms: { room_number: '104' } }),
    normalizeHousekeepingRoom({ room_id: '105', status: 'OOO', rooms: { room_number: '105' } }),
    normalizeHousekeepingRoom({ room_id: '106', status: 'DIRTY', do_not_service: true, rooms: { room_number: '106' } }),
  ]

  assert.deepEqual(getHousekeepingRoomMetrics(rooms), {
    total: 6,
    needsCleaning: 3,
    inProgress: 1,
    awaitingInspection: 1,
    ready: 1,
    outOfOrder: 1,
    atRisk: 1,
    unassigned: 2,
    rush: 1,
    dndOrServiceDeclined: 2,
    failedInspection: 0,
    discrepancy: 0,
  })
})

test('counts only sampled clean rooms as awaiting inspection', () => {
  const rooms = [
    normalizeHousekeepingRoom({ room_id: 'sampled', status: 'CLEAN', inspection_required: true, rooms: { room_number: '101' } }),
    normalizeHousekeepingRoom({ room_id: 'not-sampled', status: 'CLEAN', inspection_required: false, rooms: { room_number: '102' } }),
  ]

  assert.equal(getHousekeepingRoomMetrics(rooms).awaitingInspection, 1)
})

test('uses configurable workload targets when supplied and preserves the existing 16-credit fallback', () => {
  assert.equal(getDefaultWorkloadTarget(), 16)
  assert.equal(getDefaultWorkloadTarget({ housekeeping_target_credits: 20 }), 20)
  assert.equal(getDefaultWorkloadTarget({ housekeeping_target_credits: 0 }), 16)
  assert.equal(getRoomWorkloadCredits(normalizeHousekeepingRoom(priorityRoom)), 3)
})

test('normalizes availability from existing shift-session state without inferring location', () => {
  assert.equal(normalizeStaffAvailability({ shiftSession: { status: 'active' } }), 'working')
  assert.equal(normalizeStaffAvailability({ shiftSession: { status: 'on_break' } }), 'on_break')
  assert.equal(normalizeStaffAvailability({ shiftSession: { status: 'ended' } }), 'off_shift')
  assert.equal(normalizeStaffAvailability({ isScheduled: true }), 'available')
  assert.equal(normalizeStaffAvailability({}), 'unavailable')
})

test('Phase 8: normalizes Rush/DND-attempt/service-declined/discrepancy fields from the board payload', () => {
  const room = normalizeHousekeepingRoom({
    room_id: '201',
    status: 'DIRTY',
    priority_reason: 'guest_waiting',
    priority_needed_by: '2026-09-30T18:30:00.000Z',
    priority_note: 'Guest in lobby',
    dnd_flag: true,
    dnd_started_at: '2026-09-30T10:00:00.000Z',
    dnd_retry_at: '2026-09-30T13:00:00.000Z',
    dnd_attempt_count: 2,
    dnd_last_attempt_at: '2026-09-30T11:18:00.000Z',
    service_declined_reason: 'privacy_request',
    service_declined_note: 'Do not enter',
    occupancy_discrepancy_id: 'disc-1',
    occupancy_discrepancy_type: 'occupied',
    occupancy_discrepancy_reported_at: '2026-09-30T09:00:00.000Z',
    rooms: { room_number: '201' },
  })

  assert.equal(room.priorityReason, 'guest_waiting')
  assert.equal(room.priorityNeededBy, '2026-09-30T18:30:00.000Z')
  assert.equal(room.dndStartedAt, '2026-09-30T10:00:00.000Z')
  assert.equal(room.dndAttemptCount, 2)
  assert.equal(room.dndLastAttemptAt, '2026-09-30T11:18:00.000Z')
  assert.equal(room.serviceDeclinedReason, 'privacy_request')
  assert.equal(room.occupancyDiscrepancyId, 'disc-1')
  assert.equal(room.occupancyDiscrepancyType, 'occupied')
  assert.equal(room.occupancyDiscrepancy, true)
})

test('Phase 8: getDndWelfareStatus is null without an active DND, a start time, or a policy', () => {
  const now = new Date('2026-09-30T14:00:00.000Z')
  const notDnd = normalizeHousekeepingRoom({ room_id: '1', status: 'DIRTY', dnd_flag: false, rooms: { room_number: '1' } })
  const dndNoStart = normalizeHousekeepingRoom({ room_id: '2', status: 'DIRTY', dnd_flag: true, rooms: { room_number: '2' } })
  const dndWithStart = normalizeHousekeepingRoom({ room_id: '3', status: 'DIRTY', dnd_flag: true, dnd_started_at: '2026-09-30T10:00:00.000Z', rooms: { room_number: '3' } })

  assert.equal(getDndWelfareStatus(notDnd, { thresholdHours: 8 }, now), null)
  assert.equal(getDndWelfareStatus(dndNoStart, { thresholdHours: 8 }, now), null)
  assert.equal(getDndWelfareStatus(dndWithStart, null, now), null)
  assert.notEqual(getDndWelfareStatus(dndWithStart, { thresholdHours: 8 }, now), null)
})

test('Phase 8: getDndWelfareStatus flags overdue once the configured threshold has passed', () => {
  const room = normalizeHousekeepingRoom({ room_id: '3', status: 'DIRTY', dnd_flag: true, dnd_started_at: '2026-09-30T10:00:00.000Z', rooms: { room_number: '3' } })

  const beforeThreshold = getDndWelfareStatus(room, { thresholdHours: 8 }, new Date('2026-09-30T14:00:00.000Z'))
  assert.equal(beforeThreshold?.overdue, false)
  assert.equal(beforeThreshold?.remainingMinutes, 240)

  const afterThreshold = getDndWelfareStatus(room, { thresholdHours: 8 }, new Date('2026-09-30T18:30:00.000Z'))
  assert.equal(afterThreshold?.overdue, true)
})

test('Phase 8: welfare escalation and return-later-due surface as attention items', () => {
  const now = new Date('2026-09-30T18:30:00.000Z')
  const welfareRoom = normalizeHousekeepingRoom({ room_id: '1', status: 'DIRTY', dnd_flag: true, dnd_started_at: '2026-09-30T10:00:00.000Z', rooms: { room_number: '1' } })
  const welfareItems = deriveRoomAttentionItems(welfareRoom, { now, dndWelfarePolicy: { thresholdHours: 8 } })
  assert.ok(welfareItems.some((item) => item.code === 'dnd_welfare_escalation' && item.severity === 'critical'))

  const returnLaterRoom = normalizeHousekeepingRoom({ room_id: '2', status: 'DIRTY', dnd_flag: false, dnd_retry_at: '2026-09-30T13:00:00.000Z', rooms: { room_number: '2' } })
  const returnItems = deriveRoomAttentionItems(returnLaterRoom, { now })
  assert.ok(returnItems.some((item) => item.code === 'return_later_due'))

  const notYetDueRoom = normalizeHousekeepingRoom({ room_id: '3', status: 'DIRTY', dnd_retry_at: '2026-09-30T20:00:00.000Z', rooms: { room_number: '3' } })
  const notDueItems = deriveRoomAttentionItems(notYetDueRoom, { now })
  assert.ok(!notDueItems.some((item) => item.code === 'return_later_due'))
})

test('uses one execution-block model for deferred, cancelled, and unavailable rooms', () => {
  const now = new Date('2026-09-30T12:00:00.000Z')
  assert.equal(getHousekeepingExecutionBlock(normalizeHousekeepingRoom({ room_id: 'dnd', status: 'DIRTY', dnd_flag: true })), 'dnd')
  assert.equal(getHousekeepingExecutionBlock(normalizeHousekeepingRoom({ room_id: 'retry', status: 'DIRTY', dnd_retry_at: '2026-09-30T13:00:00.000Z' }), now), 'return_later')
  assert.equal(getHousekeepingExecutionBlock(normalizeHousekeepingRoom({ room_id: 'declined', status: 'DIRTY', do_not_service: true })), 'service_declined')
  assert.equal(getHousekeepingExecutionBlock(normalizeHousekeepingRoom({ room_id: 'disc', status: 'DIRTY', occupancy_discrepancy_id: 'x' })), 'occupancy_discrepancy')
  assert.equal(getHousekeepingExecutionBlock(normalizeHousekeepingRoom({ room_id: 'ooo', status: 'OOO' })), 'out_of_order')
  assert.equal(getHousekeepingExecutionBlock(normalizeHousekeepingRoom({ room_id: 'open', status: 'DIRTY' })), null)
})

test('Phase 8: room card shows the retry/return time even after DND clears to a return-later state', () => {
  const room = normalizeHousekeepingRoom({
    room_id: '1', status: 'DIRTY', dnd_flag: false, dnd_retry_at: '2026-09-30T13:00:00.000Z', rooms: { room_number: '1' },
  })
  const presentation = getRoomCardPresentation(room)
  assert.deepEqual(presentation.timing, { key: 'retryAt', at: '2026-09-30T13:00:00.000Z' })
  assert.notEqual(presentation.statusKey, 'dnd') // dnd flag is false; only the retry time carries over
})

test('sorts urgent attention before regular rooms, then by floor and room number', () => {
  const rooms = [
    normalizeHousekeepingRoom({ room_id: '301', status: 'DIRTY', rooms: { room_number: '301', floor: 3 } }),
    normalizeHousekeepingRoom(priorityRoom),
    normalizeHousekeepingRoom({ room_id: '201', status: 'DIRTY', rooms: { room_number: '201', floor: 2 } }),
  ]

  assert.deepEqual(sortHousekeepingRooms(rooms).map((room) => room.roomId), ['101', '201', '301'])
})
