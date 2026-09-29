import assert from 'node:assert/strict'
import test from 'node:test'
import { getTaskCapabilities } from './taskCapabilities'
import { filterTaskItems, groupTaskHistoryItems, groupTaskItemsByLane, isTaskItemOnBoard, splitTaskBoardLanes, toggleTaskQuickFilter } from './taskWorkspace'
import type { UnifiedTaskItem } from './unifiedTasks'

const item = (overrides: Partial<UnifiedTaskItem> = {}): UnifiedTaskItem => ({
  id: 'task-1', sourceType: 'internal', taskId: 'task-1', title: 'AC not cooling',
  roomNumber: '214', locationText: 'East wing', priority: 'urgent', assigneeId: 'mike',
  assigneeName: 'Mike Rodriguez', department: 'engineering', createdAt: '2026-09-20T10:00:00Z',
  displayStatus: 'new', isAiCreated: false, isOrphanGuestRequest: false, slaBreached: false,
  ...overrides,
})

test('task capabilities do not expose management actions to front desk users', () => {
  const frontDesk = getTaskCapabilities('front_desk')
  assert.equal(frontDesk.canCreate, true)
  assert.equal(frontDesk.canAssign, true)
  assert.equal(frontDesk.canEdit, false)
  assert.equal(frontDesk.canDelete, false)
})

test('Start/Complete/Cancel is limited to roles that could be doing the work, not roles that only assign it', () => {
  assert.equal(getTaskCapabilities('housekeeping_supervisor').canUpdateTaskStatus, true)
  assert.equal(getTaskCapabilities('chief_engineer').canUpdateTaskStatus, true)
  assert.equal(getTaskCapabilities('gm').canUpdateTaskStatus, false)
  assert.equal(getTaskCapabilities('front_desk').canUpdateTaskStatus, false)
})

test('task search covers title, location, room, assignee, and department', () => {
  const items = [item()]
  for (const query of ['cooling', 'east', '214', 'mike', 'engineering']) {
    assert.equal(filterTaskItems(items, { search: query }).length, 1)
  }
})

test('task search also covers description, guest name, and guest request number for guest-request items', () => {
  const guestItem = item({
    id: 'guest-1', sourceType: 'guest_request', description: 'Extra pillows requested',
    guestRequest: {
      id: 'gr-1', request_number: 42, title: 'Extra pillows', status: 'open', priority: 'normal',
      category: 'housekeeping', guest_impact: 'standard', sla_minutes: 60, created_by: 'user-1',
      created_at: '2026-09-20T10:00:00Z', guest_name: 'Jane Traveler',
    } as any,
  })
  assert.equal(filterTaskItems([guestItem], { search: 'pillows requested' }).length, 1)
  assert.equal(filterTaskItems([guestItem], { search: 'jane' }).length, 1)
  assert.equal(filterTaskItems([guestItem], { search: '#42' }).length, 1)
  assert.equal(filterTaskItems([guestItem], { search: 'nonexistent' }).length, 0)
})

test('sourceType filter isolates guest-request items, replacing the old Guest Requests/Internal tabs', () => {
  const guest = item({ id: 'guest-1', sourceType: 'guest_request' })
  const internal = item({ id: 'internal-1', sourceType: 'internal' })
  assert.deepEqual(filterTaskItems([guest, internal], { sourceType: 'guest_request' }).map((i) => i.id), ['guest-1'])
  assert.deepEqual(filterTaskItems([guest, internal], { sourceType: 'internal' }).map((i) => i.id), ['internal-1'])
  assert.equal(filterTaskItems([guest, internal], { sourceType: '' }).length, 2)
})

test('task filters apply priority, assignee, department, and overdue state together', () => {
  const match = item({ slaBreached: true })
  const hidden = item({ id: 'task-2', priority: 'low', slaBreached: true })
  const result = filterTaskItems([match, hidden], {
    priority: 'urgent', assigneeId: 'mike', department: 'engineering', overdueOnly: true,
  })
  assert.deepEqual(result.map((entry) => entry.id), ['task-1'])
})

test('Needs Verify filter isolates verification work while combining with regular filters', () => {
  const verify = item({ id: 'verify', displayStatus: 'verify', slaBreached: true })
  const newItem = item({ id: 'new', displayStatus: 'new', slaBreached: true })
  assert.deepEqual(
    filterTaskItems([verify, newItem], { displayStatus: 'verify', overdueOnly: true }).map((entry) => entry.id),
    ['verify'],
  )
})

test('quick filters toggle Mine, Unassigned, Overdue, and Needs Verify without clearing regular filters', () => {
  const initial = { assigneeId: '', overdueOnly: false, displayStatus: '' as const }
  assert.equal(toggleTaskQuickFilter(initial, 'mine', 'mike').assigneeId, 'mike')
  assert.equal(toggleTaskQuickFilter({ ...initial, assigneeId: 'mike' }, 'mine', 'mike').assigneeId, '')
  assert.equal(toggleTaskQuickFilter(initial, 'unassigned').assigneeId, '__unassigned__')
  assert.equal(toggleTaskQuickFilter({ ...initial, assigneeId: '__unassigned__' }, 'unassigned').assigneeId, '')
  assert.equal(toggleTaskQuickFilter(initial, 'overdue').overdueOnly, true)
  assert.equal(toggleTaskQuickFilter({ ...initial, overdueOnly: true }, 'overdue').overdueOnly, false)
  assert.equal(toggleTaskQuickFilter(initial, 'verify').displayStatus, 'verify')
  assert.equal(toggleTaskQuickFilter({ ...initial, displayStatus: 'verify' }, 'verify').displayStatus, '')
})

test('history groups terminal work by browser-local date and sorts each group newest first', () => {
  const now = new Date(2026, 8, 30, 12, 0, 0)
  const groups = groupTaskHistoryItems([
    item({ id: 'earlier', displayStatus: 'done', finalOutcome: 'completed', finalAt: new Date(2026, 8, 10, 12).toISOString() }),
    item({ id: 'this-week', displayStatus: 'done', finalOutcome: 'completed', finalAt: new Date(2026, 8, 28, 12).toISOString() }),
    item({ id: 'yesterday', displayStatus: 'done', finalOutcome: 'completed', finalAt: new Date(2026, 8, 29, 12).toISOString() }),
    item({ id: 'today-old', displayStatus: 'done', finalOutcome: 'completed', finalAt: new Date(2026, 8, 30, 8).toISOString() }),
    item({ id: 'today-new', displayStatus: 'done', finalOutcome: 'completed', finalAt: new Date(2026, 8, 30, 10).toISOString() }),
  ], now)
  assert.deepEqual(groups.map((group) => group.key), ['today', 'yesterday', 'this_week', 'earlier'])
  assert.deepEqual(groups[0].items.map((entry) => entry.id), ['today-new', 'today-old'])
})

test('chief_engineer can create tasks, matching the backend create_task role list', () => {
  assert.equal(getTaskCapabilities('chief_engineer').canCreate, true)
})

test('board lanes bucket new/in_progress/verify by displayStatus', () => {
  const lanes = groupTaskItemsByLane([
    item({ id: 'a', displayStatus: 'new' }),
    item({ id: 'b', displayStatus: 'in_progress' }),
    item({ id: 'c', displayStatus: 'verify' }),
  ])
  const byKey = Object.fromEntries(lanes.map((lane) => [lane.key, lane.items.map((i) => i.id)]))
  assert.deepEqual(byKey.new, ['a'])
  assert.deepEqual(byKey.in_progress, ['b'])
  assert.deepEqual(byKey.verify, ['c'])
  assert.deepEqual(byKey.done_today, [])
})

test('done_today lane only includes items completed earlier today, not older completions', () => {
  const todayIso = new Date().toISOString()
  const oldIso = '2020-01-01T10:00:00Z'
  const lanes = groupTaskItemsByLane([
    item({ id: 'today', displayStatus: 'done', completedAt: todayIso }),
    item({ id: 'old', displayStatus: 'done', completedAt: oldIso }),
  ])
  const doneToday = lanes.find((lane) => lane.key === 'done_today')!
  assert.deepEqual(doneToday.items.map((i) => i.id), ['today'])
})

test('board lane split keeps exactly three primary lanes and puts completed-today work below them', () => {
  const lanes = groupTaskItemsByLane([
    item({ id: 'new', displayStatus: 'new' }),
    item({ id: 'progress', displayStatus: 'in_progress' }),
    item({ id: 'verify', displayStatus: 'verify' }),
    item({ id: 'done', displayStatus: 'done', completedAt: new Date().toISOString() }),
  ])
  const { primary, doneToday } = splitTaskBoardLanes(lanes)
  assert.deepEqual(primary.map((lane) => lane.key), ['new', 'in_progress', 'verify'])
  assert.deepEqual(doneToday.items.map((entry) => entry.id), ['done'])
})

test('isTaskItemOnBoard matches groupTaskItemsByLane — the "active" tab count is the board\'s own contents', () => {
  const todayDone = item({ displayStatus: 'done', completedAt: new Date().toISOString() })
  const oldDone = item({ id: 'old', displayStatus: 'done', completedAt: '2020-01-01T10:00:00Z' })
  assert.equal(isTaskItemOnBoard(todayDone), true)
  assert.equal(isTaskItemOnBoard(oldDone), false)
})
