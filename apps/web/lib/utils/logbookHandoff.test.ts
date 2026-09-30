import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAddHandoffPayload, computeFollowUpDueAt, shiftHandoffSourceHref, temporaryNoteHours } from './logbookHandoff'

test('buildAddHandoffPayload sends informational status and omits follow-up fields when follow-up is off', () => {
  const payload = buildAddHandoffPayload({
    departmentId: 'dept-1',
    content: '  Room 412 has a plumbing leak.  ',
    category: 'maintenance',
    priority: 'important',
    needsFollowUp: false,
    assignedTo: 'user-1',
    followUpAt: '2026-09-30T17:00:00.000Z',
    temporaryNoteEnabled: false,
  })

  assert.equal(payload.content, 'Room 412 has a plumbing leak.')
  assert.equal(payload.status, 'informational')
  assert.equal(payload.follow_up_at, undefined)
  assert.equal(payload.assigned_to, undefined)
  assert.equal(payload.expires_hours, undefined)
})

test('buildAddHandoffPayload sends follow_up status with owner/due when follow-up is on, owner optional', () => {
  const withOwner = buildAddHandoffPayload({
    departmentId: 'dept-1',
    content: 'Valve is on order.',
    category: 'maintenance',
    priority: 'normal',
    needsFollowUp: true,
    assignedTo: 'user-1',
    followUpAt: '2026-09-30T17:00:00.000Z',
    temporaryNoteEnabled: false,
  })
  assert.equal(withOwner.status, 'follow_up')
  assert.equal(withOwner.assigned_to, 'user-1')
  assert.equal(withOwner.follow_up_at, '2026-09-30T17:00:00.000Z')

  const withoutOwnerOrDue = buildAddHandoffPayload({
    departmentId: 'dept-1',
    content: 'Needs follow-up',
    category: 'general',
    priority: 'normal',
    needsFollowUp: true,
    temporaryNoteEnabled: false,
  })
  assert.equal(withoutOwnerOrDue.status, 'follow_up')
  assert.equal(withoutOwnerOrDue.assigned_to, undefined)
  assert.equal(withoutOwnerOrDue.follow_up_at, undefined)
})

test('buildAddHandoffPayload only sends a related item when a type is selected', () => {
  const linked = buildAddHandoffPayload({
    departmentId: 'dept-1', content: 'x', category: 'general', priority: 'normal',
    needsFollowUp: false, relatedType: 'work_order', relatedId: 'wo-1', temporaryNoteEnabled: false,
  })
  assert.equal(linked.related_type, 'work_order')
  assert.equal(linked.related_id, 'wo-1')

  const unlinked = buildAddHandoffPayload({
    departmentId: 'dept-1', content: 'x', category: 'general', priority: 'normal',
    needsFollowUp: false, temporaryNoteEnabled: false,
  })
  assert.equal(unlinked.related_type, undefined)
  assert.equal(unlinked.related_id, undefined)
})

test('buildAddHandoffPayload only sends expires_hours when the temporary note toggle is on', () => {
  const temporary = buildAddHandoffPayload({
    departmentId: 'dept-1', content: 'x', category: 'general', priority: 'normal',
    needsFollowUp: false, temporaryNoteEnabled: true, expiresHours: 4,
  })
  assert.equal(temporary.expires_hours, 4)

  const permanent = buildAddHandoffPayload({
    departmentId: 'dept-1', content: 'x', category: 'general', priority: 'normal',
    needsFollowUp: false, temporaryNoteEnabled: false, expiresHours: 4,
  })
  assert.equal(permanent.expires_hours, undefined)
})

test('computeFollowUpDueAt never fabricates an end-of-shift time when none is known', () => {
  assert.equal(computeFollowUpDueAt('end_of_shift', { endOfShiftAt: null }), undefined)
  const now = new Date('2026-09-29T12:00:00.000Z')
  assert.equal(computeFollowUpDueAt('1h', { now }), new Date('2026-09-29T13:00:00.000Z').toISOString())
  assert.equal(computeFollowUpDueAt('tomorrow', { now }), new Date('2026-09-30T12:00:00.000Z').toISOString())
  assert.equal(computeFollowUpDueAt('custom', { customIso: undefined }), undefined)
})

test('temporaryNoteHours maps presets and requires a positive custom value', () => {
  assert.equal(temporaryNoteHours('1h'), 1)
  assert.equal(temporaryNoteHours('4h'), 4)
  assert.equal(temporaryNoteHours('8h'), 8)
  assert.equal(temporaryNoteHours('custom', 2), 2)
  assert.equal(temporaryNoteHours('custom', 0), undefined)
  assert.equal(temporaryNoteHours('custom', undefined), undefined)
})

test('shift handoff records route into established operational workspaces', () => {
  assert.equal(shiftHandoffSourceHref('work_order', 'wo 1'), '/engineering?tab=work-orders&focus=wo%201')
  assert.equal(shiftHandoffSourceHref('task', 'task-1'), '/tasks?focus=task-1')
  assert.equal(shiftHandoffSourceHref('guest_request', 'guest-1'), '/tasks?type=guest_request&focus=guest-1')
  assert.equal(shiftHandoffSourceHref('room', 'room-1'), '/housekeeping')
  assert.equal(shiftHandoffSourceHref('part', 'part-1'), '/engineering?tab=parts&focus=part-1')
})
