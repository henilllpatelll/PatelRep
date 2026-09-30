import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPrimaryRoomAttention,
  getRoomCardPresentation,
  normalizeHousekeepingRoom,
} from './roomState'

test('selects one operational exception with a stable supervisor-first priority', () => {
  const room = normalizeHousekeepingRoom({
    room_id: '312',
    status: 'DIRTY',
    priority: 1,
    dnd_flag: true,
    prediction: { risk_level: 'HIGH' },
    open_work_order_priority: 'urgent',
    rooms: { room_number: '312' },
  })

  assert.equal(getPrimaryRoomAttention(room)?.code, 'arrival_risk')
})

test('builds a compact dirty departure card without inventing missing signals', () => {
  const presentation = getRoomCardPresentation(normalizeHousekeepingRoom({
    room_id: '312',
    status: 'DIRTY',
    clean_type: 'DEP',
    priority: 1,
    vip_flag: true,
    checkout_time: '2026-09-30T16:00:00.000Z',
    prediction: { risk_level: 'HIGH', checkin_time: '2026-09-30T17:30:00.000Z' },
    rooms: { room_number: '312', room_types: { code: 'KS' } },
  }))

  assert.equal(presentation.statusKey, 'vacantDirty')
  assert.equal(presentation.contextKey, 'departure')
  assert.equal(presentation.timing?.key, 'arrival')
  assert.equal(presentation.isRush, true)
  assert.equal(presentation.isVip, true)
  assert.equal(presentation.assigneeKey, 'unassigned')
  assert.equal(presentation.primaryAttention?.code, 'arrival_risk')
})

test('maps cleaning, inspection, ready, DND, re-clean, and OOO states to scan-friendly card states', () => {
  const cases = [
    [{ status: 'IN_PROGRESS', current_cleaning_duration_minutes: 18 }, 'cleaning', 'cleaningDuration'],
    [{ status: 'CLEAN', last_cleaned_at: '2026-09-30T16:00:00.000Z' }, 'inspect', 'cleanedAt'],
    [{ status: 'INSPECTED', checkin_time: '2026-09-30T17:00:00.000Z' }, 'ready', 'arrival'],
    [{ status: 'DIRTY', dnd_flag: true, dnd_retry_at: '2026-09-30T18:00:00.000Z' }, 'dnd', 'retryAt'],
    [{ status: 'CLEAN', reclean_required: true, inspection_status: 'failed' }, 'reclean', null],
    [{ status: 'OOO', checkin_time: '2026-09-30T17:00:00.000Z' }, 'outOfOrder', 'arrival'],
  ] as const

  for (const [raw, statusKey, timingKey] of cases) {
    const presentation = getRoomCardPresentation(normalizeHousekeepingRoom({
      room_id: statusKey,
      rooms: { room_number: statusKey },
      ...raw,
    }))
    assert.equal(presentation.statusKey, statusKey)
    assert.equal(presentation.timing?.key ?? null, timingKey)
  }
})

test('keeps secondary signal counts compact and keeps them out of primary attention', () => {
  const room = normalizeHousekeepingRoom({ room_id: '108', status: 'IN_PROGRESS', rooms: { room_number: '108' } })
  const presentation = getRoomCardPresentation(room, { workOrderCount: 1, guestRequestCount: 2, taskCount: 3 })

  assert.deepEqual(presentation.secondarySignals, [
    { kind: 'workOrder', count: 1 },
    { kind: 'guestRequest', count: 2 },
    { kind: 'task', count: 3 },
  ])
  assert.equal(presentation.primaryAttention, null)
})
