import assert from 'node:assert/strict'
import test from 'node:test'
import { getHousekeepingSubNavItems } from './housekeepingNavigation'

test('shows no redundant housekeeping sub-navigation for managers', () => {
  for (const role of ['gm', 'housekeeping_supervisor'] as const) {
    assert.deepEqual(
      getHousekeepingSubNavItems(role).map((item) => item.label),
      [],
    )
  }
})

test('shows no redundant housekeeping sub-navigation for front desk', () => {
  assert.deepEqual(
    getHousekeepingSubNavItems('front_desk').map((item) => item.label),
    [],
  )
})

test('does not show supervisor tabs to housekeepers', () => {
  assert.deepEqual(getHousekeepingSubNavItems('housekeeper'), [])
})
