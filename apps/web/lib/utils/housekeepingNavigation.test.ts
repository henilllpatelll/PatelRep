import assert from 'node:assert/strict'
import test from 'node:test'
import { getHousekeepingSubNavItems } from './housekeepingNavigation'

test('shows full housekeeping tabs for gm and housekeeping supervisor roles', () => {
  for (const role of ['gm', 'housekeeping_supervisor'] as const) {
    assert.deepEqual(
      getHousekeepingSubNavItems(role).map((item) => item.label),
      ['Room Board', 'Assignments', 'Inspections', 'All Rooms'],
    )
  }
})

test('shows only front-desk-safe housekeeping tabs for front desk', () => {
  assert.deepEqual(
    getHousekeepingSubNavItems('front_desk').map((item) => item.label),
    ['Room Board', 'All Rooms'],
  )
})

test('does not show supervisor tabs to housekeepers', () => {
  assert.deepEqual(getHousekeepingSubNavItems('housekeeper'), [])
})
