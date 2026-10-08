import assert from 'node:assert/strict'
import test from 'node:test'
import { CLOSED, drawerToParams, parseDrawer, sameDrawer, type DrawerState } from './drawerState'
import { assignedWorkHref, assetHref, recordHref, roomHref, routeHref } from './links'
import { formatChange, formatValue, titleCase } from './format'

const roundTrip = (state: DrawerState) => parseDrawer(drawerToParams(state))

test('every drawer type round-trips through the URL', () => {
  const states: DrawerState[] = [
    { kind: 'metric-detail', metric: 'maintenance_sla' },
    { kind: 'filtered-records', recordKind: 'work_orders', filter: 'sla_missed', extra: { category: 'hvac', bucket_start: '2026-10-01', bucket_end: '2026-10-01' }, title: 'HVAC work orders' },
    { kind: 'employee-performance', userId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
    { kind: 'room-asset-performance', entity: 'room', id: 'a1b2c3d4-0000-0000-0000-000000000001' },
    { kind: 'trend-comparison', metric: 'guest_sla', segment: 'category' },
  ]
  for (const state of states) assert.deepEqual(roundTrip(state), state)
  assert.deepEqual(roundTrip(CLOSED), CLOSED)
})

test('unknown or malformed drawer params close the drawer (no throw)', () => {
  const bad = ['d=nope', 'd=metric', 'd=records&rk=users&rf=all', 'd=records&rk=work_orders', 'd=employee&eid=../../etc', 'd=entity&ek=hotel&eid=1', "d=metric&m=<script>"]
  for (const query of bad) assert.deepEqual(parseDrawer(new URLSearchParams(query)), CLOSED, query)
})

test('only allow-listed extra filters are read back from the URL', () => {
  const state = parseDrawer(new URLSearchParams('d=records&rk=work_orders&rf=all&x_category=hvac&x_evil=1&x_status=a%20b'))
  assert.equal(state.kind, 'filtered-records')
  if (state.kind === 'filtered-records') {
    assert.deepEqual(state.extra, { category: 'hvac' }) // unknown key ignored; value with a space rejected
  }
})

test('drawer params replace each other and preserve report filters', () => {
  const first = drawerToParams({ kind: 'metric-detail', metric: 'guest_sla' }, new URLSearchParams('view=overview&range=last_7_days'))
  const second = drawerToParams({ kind: 'employee-performance', userId: 'abc-1' }, first)
  assert.equal(second.get('view'), 'overview')
  assert.equal(second.get('range'), 'last_7_days')
  assert.equal(second.get('m'), null) // previous drawer keys cleared
  assert.equal(drawerToParams(CLOSED, second).toString(), 'view=overview&range=last_7_days')
  assert.equal(sameDrawer({ kind: 'metric-detail', metric: 'a' }, { kind: 'metric-detail', metric: 'a' }), true)
})

test('record links reuse existing operational screens and refuse unsafe ids', () => {
  assert.equal(recordHref('work_orders', { id: 'abc-123' }), '/engineering?tab=work-orders&focus=abc-123')
  assert.equal(recordHref('guest_requests', { id: 'abc-123' }), '/tasks?type=guest_request&focus=abc-123')
  assert.equal(recordHref('work_orders', { id: '../x?y=1' }), null)
  assert.equal(recordHref('inspections', { id: 'i1' }, 'chief_engineer'), null) // no housekeeping access
  assert.equal(recordHref('inspections', { id: 'i1' }, 'housekeeping_supervisor'), '/housekeeping/inspections')
  assert.equal(assetHref('asset-1'), '/engineering?tab=assets&asset=asset-1')
  assert.equal(assetHref(null), null)
  assert.equal(roomHref('room-1', 'housekeeping_supervisor'), null)
  assert.equal(roomHref('room-1', 'gm'), '/engineering?room=room-1')
  assert.equal(routeHref('/scheduling'), '/scheduling')
  assert.equal(routeHref('https://evil.example'), null)
  assert.equal(routeHref('/billing'), null)
  assert.equal(assignedWorkHref('u1', 'chief_engineer'), '/engineering?tab=work-orders')
})

test('missing values are never rendered as zero', () => {
  assert.equal(formatValue(null, 'percent'), '—')
  assert.equal(formatValue(undefined), '—')
  assert.equal(formatValue(0, 'percent'), '0%') // a real zero is still shown
  assert.equal(formatValue(93.74, 'percent'), '93.7%')
  assert.equal(formatValue(45, 'minutes'), '45 min')
  assert.equal(formatValue(150, 'minutes'), '2.5 h')
  assert.equal(formatValue(24000, 'currency'), '$240')
  assert.equal(formatValue(0.4, 'hours'), '24 min') // a real sub-hour duration is not shown as "0 h"
  assert.equal(formatValue(0, 'hours'), '0 h')
})

test('percentage-point and percent changes are labelled differently', () => {
  assert.equal(formatChange({ change: -4.6, change_kind: 'percentage_points' }), '−4.6 percentage points')
  assert.equal(formatChange({ change: 20, change_kind: 'percent' }), '+20%')
  assert.equal(formatChange({ change: 0, change_kind: 'percent' }), '0%')
  assert.equal(titleCase('guest_requests'), 'Guest Requests')
})
