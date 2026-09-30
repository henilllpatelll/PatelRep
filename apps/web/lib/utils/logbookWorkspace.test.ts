import assert from 'node:assert/strict'
import test from 'node:test'

import type { Shift } from '@/lib/api/scheduling'
import { getNextShift, getRelevantShift } from './logbookWorkspace'

const shifts: Shift[] = [
  { id: 'night', tenant_id: 'hotel', name: 'Night', department_id: 'all', start_time: '23:00:00', end_time: '07:00:00', is_active: true, created_at: '' },
  { id: 'morning', tenant_id: 'hotel', name: 'Morning', department_id: 'all', start_time: '07:00:00', end_time: '15:00:00', is_active: true, created_at: '' },
  { id: 'evening', tenant_id: 'hotel', name: 'Evening', department_id: 'all', start_time: '15:00:00', end_time: '23:00:00', is_active: true, created_at: '' },
]

test('selects the currently active configured shift, including overnight shifts', () => {
  assert.equal(getRelevantShift(shifts, new Date(2000, 0, 1, 2, 30))?.id, 'night')
  assert.equal(getRelevantShift(shifts, new Date(2000, 0, 1, 16, 30))?.id, 'evening')
})

test('wraps a handoff from the final configured shift to the first', () => {
  assert.equal(getNextShift(shifts, 'night')?.id, 'morning')
  assert.equal(getNextShift(shifts, 'evening')?.id, 'night')
  assert.equal(getNextShift(shifts, null), null)
})
