import assert from 'node:assert/strict'
import test from 'node:test'
import type { LostFoundItem } from '@/lib/api/lost_found'
import {
  canDispositionItem,
  canReleaseItem,
  formatItemAge,
  formatTimeUntil,
  itemFinderName,
  itemFoundLocation,
} from './lostFoundInventory'

const item: LostFoundItem = {
  id: 'lf-1',
  description: 'Silver ring',
  status: 'unclaimed',
  found_by: 'staff-1',
  created_at: '2026-09-29T10:00:00.000Z',
  rooms: { room_number: '214' },
  user_profiles: { preferred_name: 'Maria' },
}

test('inventory presentation uses finder, room, and concise age data', () => {
  assert.equal(itemFinderName(item), 'Maria')
  assert.equal(itemFoundLocation(item), 'Room 214')
  assert.equal(formatItemAge(item.created_at, new Date('2026-09-30T04:00:00.000Z')), '18h')
  assert.equal(formatTimeUntil('2026-12-28T10:00:00.000Z', new Date('2026-09-30T10:00:00.000Z')), '89d remaining')
})

test('terminal items never expose release or disposition actions', () => {
  assert.equal(canReleaseItem(item, true), true)
  assert.equal(canDispositionItem(item, true), true)
  for (const status of ['claimed', 'donated', 'discarded'] as const) {
    assert.equal(canReleaseItem({ ...item, status }, true), false)
    assert.equal(canDispositionItem({ ...item, status }, true), false)
  }
  assert.equal(canReleaseItem(item, false), false)
})

test('matched or actively-returning items never expose the ad-hoc quick release/disposition shortcuts', () => {
  // Phase 4: once a guest claim is confirmed or a return is in progress, release/disposition
  // must go through the Returns/Disposition workflows instead of the item drawer's quick actions.
  assert.equal(canReleaseItem({ ...item, has_confirmed_match: true }, true), false)
  assert.equal(canReleaseItem({ ...item, has_active_return: true }, true), false)
  assert.equal(canDispositionItem({ ...item, has_confirmed_match: true }, true), false)
  assert.equal(canDispositionItem({ ...item, has_active_return: true }, true), false)
})
