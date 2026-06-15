import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPendingLateCheckoutByRoom,
  withPendingLateCheckout,
} from './lateCheckoutRequests.ts'

function request(overrides) {
  return {
    tenant_id: 'hotel-1',
    room_number: '101',
    requested_by: 'user-1',
    ...overrides,
  }
}

test('indexes the newest pending late checkout request by room', () => {
  const byRoom = getPendingLateCheckoutByRoom([
    request({
      id: 'older',
      room_id: 'room-101',
      requested_time: '1:00 PM',
      status: 'pending',
      created_at: '2026-06-15T13:00:00.000Z',
    }),
    request({
      id: 'approved',
      room_id: 'room-102',
      requested_time: '2:00 PM',
      status: 'approved',
      created_at: '2026-06-15T13:05:00.000Z',
    }),
    request({
      id: 'newer',
      room_id: 'room-101',
      requested_time: '1:30 PM',
      status: 'pending',
      created_at: '2026-06-15T13:10:00.000Z',
    }),
  ])

  assert.equal(byRoom['room-101']?.requested_time, '1:30 PM')
  assert.equal(byRoom['room-102'], undefined)
})

test('annotates rooms with the pending late checkout time for card and detail display', () => {
  const pending = request({
    id: 'pending',
    room_id: 'room-101',
    requested_time: '1:30 PM',
    status: 'pending',
    created_at: '2026-06-15T13:10:00.000Z',
  })

  const annotated = withPendingLateCheckout(
    { room_id: 'room-101', status: 'OCCUPIED' },
    { 'room-101': pending },
  )
  const cleared = withPendingLateCheckout(
    {
      room_id: 'room-102',
      status: 'OCCUPIED',
      late_checkout_request: pending,
      late_checkout_requested_time: '1:30 PM',
    },
    {},
  )

  assert.equal(annotated.late_checkout_requested_time, '1:30 PM')
  assert.equal(annotated.late_checkout_request.id, 'pending')
  assert.equal('late_checkout_requested_time' in cleared, false)
  assert.equal('late_checkout_request' in cleared, false)
})
