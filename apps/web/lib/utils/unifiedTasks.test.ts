import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUnifiedTaskItems, sortUnifiedItems } from './unifiedTasks'
import type { Task } from '@/lib/api/tasks'
import type { GuestRequest } from '@/lib/api/guest_requests'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Fix light',
    task_type: 'general',
    priority: 'normal',
    status: 'open',
    created_by: 'user-1',
    is_ai_created: false,
    sla_minutes: 240,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function makeGuestRequest(overrides: Partial<GuestRequest> = {}): GuestRequest {
  return {
    id: 'gr-1',
    request_number: 1,
    title: 'Extra towels',
    status: 'open',
    priority: 'normal',
    category: 'housekeeping',
    guest_impact: 'standard',
    sla_minutes: 60,
    created_by: 'user-1',
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

test('a regular internal task with no guest request link renders exactly once', () => {
  const items = buildUnifiedTaskItems([makeTask()], [])
  assert.equal(items.length, 1)
  assert.equal(items[0].sourceType, 'internal')
  assert.equal(items[0].taskId, 'task-1')
})

test('a guest request with a matching linked task collapses into ONE item, not two', () => {
  const task = makeTask({ id: 'task-2', task_type: 'guest_request' })
  const gr = makeGuestRequest({ id: 'gr-2', task_id: 'task-2' })
  const items = buildUnifiedTaskItems([task], [gr])
  assert.equal(items.length, 1)
  assert.equal(items[0].sourceType, 'guest_request')
  assert.equal(items[0].taskId, 'task-2')
  assert.equal(items[0].guestRequestId, 'gr-2')
  assert.equal(items[0].isOrphanGuestRequest, false)
})

test('an orphan guest request (task creation failed, task_id is null) still renders — from the guest_request record alone', () => {
  const gr = makeGuestRequest({ id: 'gr-3', task_id: undefined })
  const items = buildUnifiedTaskItems([], [gr])
  assert.equal(items.length, 1)
  assert.equal(items[0].sourceType, 'guest_request')
  assert.equal(items[0].isOrphanGuestRequest, true)
  assert.equal(items[0].taskId, undefined)
})

test('a guest request pointing at a task_id that is not in the fetched task list still renders as an orphan (stale/deleted link)', () => {
  const gr = makeGuestRequest({ id: 'gr-4', task_id: 'does-not-exist' })
  const items = buildUnifiedTaskItems([], [gr])
  assert.equal(items.length, 1)
  assert.equal(items[0].isOrphanGuestRequest, true)
})

test('a guest_request-type task whose guest_request record is missing falls back to an internal item instead of vanishing', () => {
  const task = makeTask({ id: 'task-5', task_type: 'guest_request' })
  const items = buildUnifiedTaskItems([task], [])
  assert.equal(items.length, 1)
  assert.equal(items[0].sourceType, 'internal')
  assert.equal(items[0].taskId, 'task-5')
})

test('a resolved (not yet verified) guest request maps to displayStatus "verify"', () => {
  const gr = makeGuestRequest({ status: 'resolved' })
  const items = buildUnifiedTaskItems([], [gr])
  assert.equal(items[0].displayStatus, 'verify')
})

test('a verified guest request and a completed task both map to displayStatus "done" — the shared History bucket', () => {
  const grItems = buildUnifiedTaskItems([], [makeGuestRequest({ status: 'verified' })])
  const taskItems = buildUnifiedTaskItems([makeTask({ status: 'completed' })], [])
  assert.equal(grItems[0].displayStatus, 'done')
  assert.equal(taskItems[0].displayStatus, 'done')
})

test('a mix of one regular task, one linked guest request, and one orphan guest request produces exactly 3 items with correct sourceType', () => {
  const linkedTask = makeTask({ id: 'task-linked', task_type: 'guest_request' })
  const internalTask = makeTask({ id: 'task-internal' })
  const linkedGr = makeGuestRequest({ id: 'gr-linked', task_id: 'task-linked' })
  const orphanGr = makeGuestRequest({ id: 'gr-orphan', task_id: undefined })

  const items = buildUnifiedTaskItems([linkedTask, internalTask], [linkedGr, orphanGr])
  assert.equal(items.length, 3)

  const bySource = { guest_request: 0, internal: 0 }
  for (const item of items) bySource[item.sourceType]++
  assert.deepEqual(bySource, { guest_request: 2, internal: 1 })
})

test('sortUnifiedItems puts overdue/urgent work first and done work last', () => {
  const now = Date.now()
  const overdue = makeTask({ id: 'overdue', priority: 'low', due_at: new Date(now - 60_000).toISOString() })
  const urgent = makeTask({ id: 'urgent', priority: 'urgent' })
  const done = makeTask({ id: 'done', status: 'completed' })
  const items = buildUnifiedTaskItems([overdue, urgent, done], [])
  const sorted = sortUnifiedItems(items)
  assert.equal(sorted[sorted.length - 1].taskId, 'done')
  assert.equal(sorted[0].taskId, 'overdue')
})

test('internal task items carry startedAt/completedAt through for the board\'s done_today lane', () => {
  const task = makeTask({ id: 'wo-1', status: 'completed', started_at: '2026-09-01T10:00:00Z', completed_at: '2026-09-01T11:00:00Z' })
  const [item] = buildUnifiedTaskItems([task], [])
  assert.equal(item.startedAt, '2026-09-01T10:00:00Z')
  assert.equal(item.completedAt, '2026-09-01T11:00:00Z')
})

test('guest request items derive startedAt/completedAt from their own status timestamps', () => {
  const gr = makeGuestRequest({ id: 'gr-done', status: 'verified', dispatched_at: '2026-09-01T09:00:00Z', verified_at: '2026-09-01T12:00:00Z' })
  const [item] = buildUnifiedTaskItems([], [gr])
  assert.equal(item.startedAt, '2026-09-01T09:00:00Z')
  assert.equal(item.completedAt, '2026-09-01T12:00:00Z')
})
