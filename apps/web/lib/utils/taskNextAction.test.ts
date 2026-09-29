import assert from 'node:assert/strict'
import test from 'node:test'
import { getAssigneeActiveWorkload, getTaskAssignmentAction, getTaskNextAction } from './taskNextAction'
import { getTaskCapabilities } from './taskCapabilities'
import type { UnifiedTaskItem } from './unifiedTasks'

const item = (overrides: Partial<UnifiedTaskItem> = {}): UnifiedTaskItem => ({
  id: 'task-1', sourceType: 'internal', taskId: 'task-1', title: 'Replace filter', priority: 'normal',
  department: 'engineering', createdAt: '2026-09-28T12:00:00Z', taskStatus: 'open', displayStatus: 'new',
  isAiCreated: false, isOrphanGuestRequest: false, slaBreached: false,
  ...overrides,
})

test('internal next action follows assignment and work status without inventing review', () => {
  const supervisor = getTaskCapabilities('housekeeping_supervisor')
  assert.equal(getTaskNextAction(item(), supervisor)?.key, 'assign')
  assert.equal(getTaskNextAction(item({ assigneeId: 'staff-1' }), supervisor)?.key, 'start')
  assert.equal(getTaskNextAction(item({ taskStatus: 'in_progress', displayStatus: 'in_progress', assigneeId: 'staff-1' }), supervisor)?.key, 'complete')
  assert.equal(getTaskNextAction(item({ taskStatus: 'completed', displayStatus: 'done', finalOutcome: 'completed' }), supervisor), null)
})

test('internal next action does not expose status updates to roles without the capability', () => {
  const frontDesk = getTaskCapabilities('front_desk')
  assert.equal(getTaskNextAction(item({ assigneeId: 'staff-1' }), frontDesk), null)
  assert.equal(getTaskNextAction(item({ taskStatus: 'in_progress', displayStatus: 'in_progress', assigneeId: 'staff-1' }), frontDesk), null)
})

test('an unassigned housekeeping task is claimable only by a housekeeper', () => {
  const housekeeping = item({ department: 'housekeeping' })
  assert.equal(getTaskNextAction(housekeeping, getTaskCapabilities('housekeeper'), 'housekeeper')?.key, 'claim')
  assert.equal(getTaskNextAction(housekeeping, getTaskCapabilities('engineer'), 'engineer'), null)
})

test('guest request next action preserves the real lifecycle', () => {
  const capabilities = getTaskCapabilities('front_desk')
  const guest = (status: UnifiedTaskItem['guestRequestStatus']) => item({
    id: `guest-${status}`, sourceType: 'guest_request', guestRequestId: `gr-${status}`, taskId: `task-${status}`,
    guestRequestStatus: status, displayStatus: status === 'resolved' ? 'verify' : status === 'verified' ? 'done' : 'in_progress',
  })
  assert.equal(getTaskNextAction(guest('open'), capabilities)?.key, 'acknowledge')
  assert.equal(getTaskNextAction(guest('acknowledged'), capabilities)?.key, 'dispatch')
  assert.equal(getTaskNextAction(guest('dispatched'), capabilities)?.key, 'arrived')
  assert.equal(getTaskNextAction(guest('arrived'), capabilities)?.key, 'guest_contacted')
  assert.equal(getTaskNextAction(guest('guest_contacted'), capabilities)?.key, 'resolve')
  assert.equal(getTaskNextAction(guest('resolved'), capabilities)?.key, 'verify')
  assert.equal(getTaskNextAction(guest('verified'), capabilities), null)
})

test('assignment stays role-aware and only appears for items backed by a task', () => {
  const manager = getTaskCapabilities('housekeeping_supervisor')
  assert.equal(getTaskAssignmentAction(item(), manager)?.key, 'assign')
  assert.equal(getTaskAssignmentAction(item({ assigneeId: 'staff-1' }), manager)?.key, 'reassign')
  assert.equal(getTaskAssignmentAction(item({ sourceType: 'guest_request', guestRequestId: 'gr-1', taskId: undefined, isOrphanGuestRequest: true }), manager), null)
  assert.equal(getTaskAssignmentAction(item(), getTaskCapabilities('engineer')), null)
})

test('active workload counts only active, assigned work', () => {
  const workload = getAssigneeActiveWorkload([
    item({ id: 'active-one', assigneeId: 'maria' }),
    item({ id: 'active-two', assigneeId: 'maria', displayStatus: 'in_progress', taskStatus: 'in_progress' }),
    item({ id: 'done', assigneeId: 'maria', displayStatus: 'done', taskStatus: 'completed', finalOutcome: 'completed' }),
    item({ id: 'unassigned', assigneeId: undefined }),
  ])
  assert.equal(workload.get('maria'), 2)
})
