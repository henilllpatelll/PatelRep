import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoomUnavailabilityPeriod } from '@/lib/api/rooms'
import { formatDowntime, orderRoomDownPeriods } from './roomDownQueue'

const now = new Date('2026-09-26T18:00:00.000Z')

function period(overrides: Partial<RoomUnavailabilityPeriod>): RoomUnavailabilityPeriod {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    room_id: overrides.room_id ?? 'room-1',
    status: 'ACTIVE',
    type: 'OUT_OF_ORDER',
    reason_code: 'HVAC',
    reason_label: 'HVAC',
    started_at: '2026-09-26T16:00:00.000Z',
    is_past_eta: false,
    ...overrides,
  }
}

test('orders active rooms by deterministic operational urgency', () => {
  const ordered = orderRoomDownPeriods([
    period({ id: 'ordinary', expected_return_at: '2026-09-26T19:00:00.000Z' }),
    period({ id: 'no-eta' }),
    period({ id: 'emergency', work_orders: { id: 'wo-1', work_order_number: 10, title: 'Leak', priority: 'emergency', status: 'open', assigned_to: null, created_at: now.toISOString() } }),
    period({ id: 'past-eta', is_past_eta: true, expected_return_at: '2026-09-26T17:00:00.000Z' }),
    period({ id: 'unassigned', expected_return_at: '2026-09-26T18:30:00.000Z', work_orders: { id: 'wo-2', work_order_number: 11, title: 'Lock', priority: 'normal', status: 'open', assigned_to: null, created_at: now.toISOString() } }),
  ], now)

  assert.deepEqual(ordered.map((item) => item.id), ['past-eta', 'emergency', 'no-eta', 'unassigned', 'ordinary'])
})

test('formats downtime without persisting a derived duration', () => {
  assert.equal(formatDowntime('2026-09-25T10:00:00.000Z', now), '1d 8h')
  assert.equal(formatDowntime('2026-09-26T16:42:00.000Z', now), '1h 18m')
})
