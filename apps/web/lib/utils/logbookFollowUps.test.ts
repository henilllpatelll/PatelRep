import assert from 'node:assert/strict'
import test from 'node:test'

import { isFollowUpOverdue, needsNextShift, sortLogbookFollowUps } from './logbookFollowUps'

const NOW = new Date('2026-09-29T17:00:00Z')

function entry(overrides: Partial<{ follow_up_at: string | null; priority: 'normal' | 'important'; created_at: string; status: 'informational' | 'follow_up' | 'resolved'; archived_at: string | null; id: string }>) {
  return {
    id: 'e',
    follow_up_at: null,
    priority: 'normal' as const,
    created_at: '2026-09-29T10:00:00Z',
    status: 'follow_up' as const,
    archived_at: null,
    ...overrides,
  }
}

test('overdue items sort before important, due-soon, and no-due-time items', () => {
  const overdue = entry({ id: 'overdue', follow_up_at: '2026-09-29T15:00:00Z' })
  const important = entry({ id: 'important', priority: 'important' })
  const dueSoon = entry({ id: 'due-soon', follow_up_at: '2026-09-29T20:00:00Z' })
  const noDue = entry({ id: 'no-due' })

  const sorted = sortLogbookFollowUps([noDue, dueSoon, important, overdue], NOW)
  assert.deepEqual(sorted.map((item) => item.id), ['overdue', 'important', 'due-soon', 'no-due'])
})

test('within the same bucket, earlier due times sort first', () => {
  const later = entry({ id: 'later', follow_up_at: '2026-09-29T22:00:00Z' })
  const earlier = entry({ id: 'earlier', follow_up_at: '2026-09-29T18:00:00Z' })
  assert.deepEqual(sortLogbookFollowUps([later, earlier], NOW).map((item) => item.id), ['earlier', 'later'])
})

test('ties within a bucket fall back to newest created_at first', () => {
  const older = entry({ id: 'older', created_at: '2026-09-29T09:00:00Z' })
  const newer = entry({ id: 'newer', created_at: '2026-09-29T11:00:00Z' })
  assert.deepEqual(sortLogbookFollowUps([older, newer], NOW).map((item) => item.id), ['newer', 'older'])
})

test('isFollowUpOverdue is true only for a past due follow-up entry', () => {
  assert.equal(isFollowUpOverdue({ status: 'follow_up', follow_up_at: '2026-09-29T15:00:00Z' }, NOW), true)
  assert.equal(isFollowUpOverdue({ status: 'follow_up', follow_up_at: '2026-09-29T20:00:00Z' }, NOW), false)
  assert.equal(isFollowUpOverdue({ status: 'follow_up', follow_up_at: null }, NOW), false)
  assert.equal(isFollowUpOverdue({ status: 'resolved', follow_up_at: '2026-09-29T15:00:00Z' }, NOW), false)
})

test('needsNextShift excludes resolved, informational, and archived entries', () => {
  assert.equal(needsNextShift({ status: 'follow_up', archived_at: null }), true)
  assert.equal(needsNextShift({ status: 'follow_up', archived_at: '2026-09-29T00:00:00Z' }), false)
  assert.equal(needsNextShift({ status: 'resolved', archived_at: null }), false)
  assert.equal(needsNextShift({ status: 'informational', archived_at: null }), false)
})
