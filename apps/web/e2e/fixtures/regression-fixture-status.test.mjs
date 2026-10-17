import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRegressionFixtureRoomStatus } from './regression-fixture-status.mjs'

test('the in-progress room has a fixed, stale timestamp for the strict drawer baseline', () => {
  const status = buildRegressionFixtureRoomStatus({
    roomId: 'room-104',
    tenantId: 'fixture-tenant',
    room: { room_number: '104', status: 'IN_PROGRESS', vip: false },
  })

  assert.equal(status.updated_at, '2020-01-01T12:58:00.000Z')
  assert.equal(status.status, 'IN_PROGRESS')
})

test('other fixture rooms retain database-managed update timestamps', () => {
  const status = buildRegressionFixtureRoomStatus({
    roomId: 'room-101',
    tenantId: 'fixture-tenant',
    room: { room_number: '101', status: 'DIRTY', vip: false },
  })

  assert.equal('updated_at' in status, false)
  assert.equal(status.status, 'DIRTY')
})
