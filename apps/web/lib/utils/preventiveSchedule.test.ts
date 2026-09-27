import assert from 'node:assert/strict'
import test from 'node:test'
import type { PMSchedule } from '@/lib/api/engineering'
import { getPreventiveMetrics, getScheduleState, schedulesForDay } from './preventiveSchedule'

const now = new Date('2026-09-27T12:00:00.000Z')

function schedule(id: string, next_due_at: string, last_completed_at?: string): PMSchedule {
  return {
    id,
    asset_id: `asset-${id}`,
    name: `Schedule ${id}`,
    interval_type: 'monthly',
    estimated_minutes: 30,
    next_due_at,
    last_completed_at,
    is_active: true,
  }
}

test('classifies preventive work without treating a future date as due today', () => {
  assert.equal(getScheduleState(schedule('late', '2026-09-25T09:00:00.000Z'), now), 'overdue')
  assert.equal(getScheduleState(schedule('today', '2026-09-27T18:00:00.000Z'), now), 'due_today')
  assert.equal(getScheduleState(schedule('soon', '2026-09-30T09:00:00.000Z'), now), 'due_soon')
  assert.equal(getScheduleState(schedule('later', '2026-10-12T09:00:00.000Z'), now), 'upcoming')
})

test('builds an honest operational summary from schedules already loaded', () => {
  const metrics = getPreventiveMetrics([
    schedule('late', '2026-09-25T09:00:00.000Z'),
    schedule('today', '2026-09-27T18:00:00.000Z', '2026-09-04T09:00:00.000Z'),
    schedule('soon', '2026-09-30T09:00:00.000Z', '2026-09-26T09:00:00.000Z'),
  ], now)

  assert.deepEqual(metrics, { active: 3, overdue: 1, dueThisWeek: 2, completedThisMonth: 2 })
})

test('includes overdue carryover alongside a selected day\'s scheduled PMs', () => {
  const selected = new Date('2026-09-29T12:00:00.000Z')
  const result = schedulesForDay([
    schedule('late', '2026-09-25T09:00:00.000Z'),
    schedule('selected', '2026-09-29T09:00:00.000Z'),
    schedule('other', '2026-10-01T09:00:00.000Z'),
  ], selected, now)

  assert.deepEqual(result.map((entry) => entry.id), ['late', 'selected'])
})
