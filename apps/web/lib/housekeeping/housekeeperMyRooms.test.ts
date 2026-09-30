import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHousekeeperMyRoomsView } from './housekeeperMyRooms'
import { normalizeHousekeepingRoom } from './roomState'

const room = (room_id: string, status: string, extra: Record<string, unknown> = {}) =>
  normalizeHousekeepingRoom({
    room_id,
    status,
    assigned_to: 'housekeeper-1',
    rooms: { room_number: room_id, floor: 1 },
    ...extra,
  })

test('puts the current room first and uses the shared operational priority for the next room', () => {
  const view = buildHousekeeperMyRoomsView([
    room('104', 'DIRTY'),
    room('103', 'DIRTY', { reclean_required: true, inspection_status: 'failed' }),
    room('102', 'DIRTY', { priority: 1 }),
    room('101', 'IN_PROGRESS'),
  ], new Date('2026-09-30T11:00:00.000Z'))

  assert.deepEqual(view.active.map((item) => item.roomId), ['101'])
  assert.equal(view.upNext?.roomId, '102')
  assert.deepEqual(view.reclean.map((item) => item.roomId), ['103'])
  assert.deepEqual(view.toDo.map((item) => item.roomId), ['104'])
})

test('keeps blocked and completed work out of actionable progress counts', () => {
  const view = buildHousekeeperMyRoomsView([
    room('201', 'DIRTY', { dnd_flag: true, dnd_retry_at: '2026-09-30T13:00:00.000Z' }),
    room('202', 'DIRTY', { do_not_service: true }),
    room('203', 'CLEAN', { inspection_required: true }),
    room('204', 'INSPECTED'),
    room('205', 'DIRTY'),
  ], new Date('2026-09-30T11:00:00.000Z'))

  assert.equal(view.upNext?.roomId, '205')
  assert.deepEqual(view.blocked.map((item) => item.roomId), ['201', '202'])
  assert.deepEqual(view.done.map((item) => item.roomId), ['203', '204'])
  assert.deepEqual(view.counts, { toDo: 1, cleaning: 0, done: 2, reclean: 0 })
})
