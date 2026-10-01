import assert from 'node:assert/strict'
import test from 'node:test'
import { isFeatureEnabled } from './featureFlag'
import type { Hotel } from '../../stores/hotelStore'

function hotel(overrides: Partial<Hotel>): Hotel {
  return { id: 'h1', name: 'Test Hotel', timezone: 'America/Chicago', room_count: 50, ...overrides }
}

test('empty enabled_features falls back to disabled', () => {
  assert.equal(isFeatureEnabled('lost_found_guest_claims', hotel({ enabled_features: [] })), false)
})

test('missing enabled_features falls back to disabled', () => {
  assert.equal(isFeatureEnabled('lost_found_guest_claims', hotel({})), false)
})

test('matching feature key resolves to enabled', () => {
  assert.equal(isFeatureEnabled('lost_found_guest_claims', hotel({ enabled_features: ['lost_found_guest_claims'] })), true)
})

test('unrelated feature key resolves to disabled', () => {
  assert.equal(isFeatureEnabled('engineering_predictive_insights', hotel({ enabled_features: ['lost_found_guest_claims'] })), false)
})

test('null/undefined hotel falls back to disabled', () => {
  assert.equal(isFeatureEnabled('lost_found_guest_claims', null), false)
  assert.equal(isFeatureEnabled('lost_found_guest_claims', undefined), false)
})

test('switching from one hotel to another does not leak the previous enabled_features', () => {
  const hotelA = hotel({ enabled_features: ['lost_found_guest_claims'] })
  const hotelB = hotel({ enabled_features: [] })
  assert.equal(isFeatureEnabled('lost_found_guest_claims', hotelA), true)
  // isFeatureEnabled is pure and stateless — re-evaluating with a different
  // hotel object must never see hotel A's state, since there is no
  // module-level cache or memoization to leak across tenant switches.
  assert.equal(isFeatureEnabled('lost_found_guest_claims', hotelB), false)
})
