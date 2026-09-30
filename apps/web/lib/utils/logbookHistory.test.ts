import assert from 'node:assert/strict'
import test from 'node:test'

import { formatHistoryEvent } from './logbookHistory'

const STRINGS: Record<string, string> = {
  'logbook.acknowledgedFallback': 'a teammate',
  'logbook.shift': 'Shift',
  'logbook.fields.priority': 'priority',
  'logbook.fields.follow_up_at': 'follow-up due time',
  'logbook.historyEvents.created': '{{actor}} created the handoff',
  'logbook.historyEvents.createdFallback': 'Created',
  'logbook.historyEvents.editedFields': '{{actor}} updated {{fields}}',
  'logbook.historyEvents.editedGeneric': '{{actor}} edited the handoff',
  'logbook.historyEvents.carriedForward': '{{actor}} carried the handoff to {{shift}}',
  'logbook.historyEvents.resolved': '{{actor}} marked the handoff resolved',
  'logbook.historyEvents.archived': '{{actor}} archived the handoff',
  'logbook.historyEvents.reopened': '{{actor}} reopened the handoff',
}

function fakeT(key: string, options?: Record<string, unknown>): string {
  const template = STRINGS[key] ?? (typeof options?.defaultValue === 'string' ? options.defaultValue : key)
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token) => String((options as Record<string, unknown> | undefined)?.[token] ?? ''))
}

function event(overrides: Partial<{ event_type: string; actor_name: string | null; metadata: Record<string, unknown> }>) {
  return {
    id: 'ev-1', entry_id: 'e-1', actor_id: 'u-1', created_at: '2026-09-29T20:00:00Z',
    event_type: 'created' as const, actor_name: 'Maria', metadata: {},
    ...overrides,
  } as any
}

test('created event names the actor when known, falls back to a generic label otherwise', () => {
  assert.equal(formatHistoryEvent(fakeT as any, event({ actor_name: 'Maria' }), {}), 'Maria created the handoff')
  assert.equal(formatHistoryEvent(fakeT as any, event({ actor_name: null }), {}), 'Created')
})

test('edited event lists the changed field labels, or falls back generically with none', () => {
  const withFields = event({ event_type: 'edited', actor_name: 'Sarah', metadata: { fields: ['priority', 'follow_up_at'] } })
  assert.equal(formatHistoryEvent(fakeT as any, withFields, {}), 'Sarah updated priority, follow-up due time')

  const noFields = event({ event_type: 'edited', actor_name: 'Sarah', metadata: {} })
  assert.equal(formatHistoryEvent(fakeT as any, noFields, {}), 'Sarah edited the handoff')
})

test('carried_forward resolves the destination shift name from the id map', () => {
  const withShift = event({ event_type: 'carried_forward', actor_name: 'James', metadata: { destination_shift_id: 'night-1' } })
  assert.equal(formatHistoryEvent(fakeT as any, withShift, { 'night-1': 'Night Shift' }), 'James carried the handoff to Night Shift')

  const unknownShift = event({ event_type: 'carried_forward', actor_name: 'James', metadata: { destination_shift_id: 'missing' } })
  assert.equal(formatHistoryEvent(fakeT as any, unknownShift, {}), 'James carried the handoff to Shift')
})

test('resolved and archived events render their fixed sentences', () => {
  assert.equal(formatHistoryEvent(fakeT as any, event({ event_type: 'resolved', actor_name: 'Kevin' }), {}), 'Kevin marked the handoff resolved')
  assert.equal(formatHistoryEvent(fakeT as any, event({ event_type: 'archived', actor_name: 'Kevin' }), {}), 'Kevin archived the handoff')
})
