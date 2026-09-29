import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bulkPriorityOptions,
  canBulkAssign,
  canBulkCancel,
  canBulkSetPriority,
  splitByEligibility,
  summarizeBulkResults,
} from './taskBulkActions'
import type { UnifiedTaskItem } from './unifiedTasks'

const item = (overrides: Partial<UnifiedTaskItem> = {}): UnifiedTaskItem => ({
  id: 'task-1', sourceType: 'internal', taskId: 'task-1', title: 'AC not cooling',
  priority: 'normal', createdAt: '2026-09-20T10:00:00Z', displayStatus: 'new',
  isAiCreated: false, isOrphanGuestRequest: false, slaBreached: false,
  ...overrides,
})

test('an orphan guest request (no linked task) cannot be bulk-assigned', () => {
  const orphan = item({ sourceType: 'guest_request', taskId: undefined, guestRequestId: 'gr-1', isOrphanGuestRequest: true })
  const linked = item({ sourceType: 'guest_request', taskId: 'task-2', guestRequestId: 'gr-2' })
  assert.equal(canBulkAssign(orphan), false)
  assert.equal(canBulkAssign(linked), true)
})

test('a terminal item (already completed/cancelled) is never bulk-assignable', () => {
  const done = item({ finalOutcome: 'completed' })
  assert.equal(canBulkAssign(done), false)
})

test('internal tasks can be bulk-cancelled unless already terminal', () => {
  assert.equal(canBulkCancel(item()), true)
  assert.equal(canBulkCancel(item({ finalOutcome: 'completed' })), false)
})

test('guest requests can only be bulk-cancelled while still in flight, matching the backend state machine', () => {
  const inFlight = item({ sourceType: 'guest_request', guestRequestId: 'gr-1', guestRequestStatus: 'dispatched' })
  const resolved = item({ sourceType: 'guest_request', guestRequestId: 'gr-2', guestRequestStatus: 'resolved' })
  const verified = item({ sourceType: 'guest_request', guestRequestId: 'gr-3', guestRequestStatus: 'verified', finalOutcome: 'verified' })
  assert.equal(canBulkCancel(inFlight), true)
  assert.equal(canBulkCancel(resolved), false)
  assert.equal(canBulkCancel(verified), false)
})

test('an orphan guest request (no taskId) can still be bulk-cancelled — cancel only needs guestRequestId', () => {
  const orphan = item({ sourceType: 'guest_request', taskId: undefined, guestRequestId: 'gr-4', guestRequestStatus: 'open', isOrphanGuestRequest: true })
  assert.equal(canBulkCancel(orphan), true)
})

test('bulk priority options drop Low as soon as any selected item is a guest request', () => {
  const allInternal = [item(), item({ id: 'task-2' })]
  const mixed = [item(), item({ id: 'guest-1', sourceType: 'guest_request' })]
  assert.deepEqual(bulkPriorityOptions(allInternal), ['urgent', 'normal', 'low'])
  assert.deepEqual(bulkPriorityOptions(mixed), ['urgent', 'normal'])
})

test('canBulkSetPriority never lets a guest request accept Low, even if the caller offers it', () => {
  const guest = item({ sourceType: 'guest_request' })
  assert.equal(canBulkSetPriority(guest, 'low'), false)
  assert.equal(canBulkSetPriority(guest, 'urgent'), true)
  assert.equal(canBulkSetPriority(item(), 'low'), true)
})

test('splitByEligibility partitions without silently dropping any item', () => {
  const items = [item({ id: 'a' }), item({ id: 'b', finalOutcome: 'completed' })]
  const { eligible, ineligible } = splitByEligibility(items, canBulkAssign)
  assert.deepEqual(eligible.map((i) => i.id), ['a'])
  assert.deepEqual(ineligible.map((i) => i.id), ['b'])
})

test('summarizeBulkResults counts fulfilled vs rejected without assuming every call succeeded', () => {
  const results: PromiseSettledResult<unknown>[] = [
    { status: 'fulfilled', value: undefined },
    { status: 'fulfilled', value: undefined },
    { status: 'rejected', reason: new Error('409') },
  ]
  assert.deepEqual(summarizeBulkResults(results), { succeeded: 2, failed: 1 })
})
