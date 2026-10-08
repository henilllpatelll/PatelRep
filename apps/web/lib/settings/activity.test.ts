import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActivityEvent } from '@/lib/api/activity'
import {
  EMPTY_FILTERS, countActiveFilters, dayKey, dayLabel, daysBetween, describeChange, exportRange, filtersToQuery, filtersToSearch,
  formatFullTimestamp, formatTime, formatValue, groupEventsByDay, hasAnyFilter, humanizeKey, parseFilters, presetRange, safeZone, sourceLabel,
} from './activity'

const CHI = 'America/Chicago'
const ev = (id: string, occurred_at: string): ActivityEvent => ({
  id, action: 'settings.room.created', title: 'Room added', category: 'rooms', category_label: 'Rooms', occurred_at,
  actor: { id: 'u', name: 'Alice', role: 'gm', role_label: 'General Manager' },
  resource: { type: 'room', type_label: 'Room', id: 'r', name: 'Room 101' }, source: 'api', has_details: true,
})

test('filters round-trip through the URL and only keep valid, non-empty values', () => {
  const params = new URLSearchParams('q=sla&category=rooms&date_from=2026-10-01&date_to=bad&junk=1')
  const filters = parseFilters(params)
  assert.deepEqual(filters, { ...EMPTY_FILTERS, q: 'sla', category: 'rooms', date_from: '2026-10-01' })
  assert.equal(filtersToSearch(filters), '?q=sla&category=rooms&date_from=2026-10-01')
  assert.equal(filtersToSearch(EMPTY_FILTERS), '')
  assert.deepEqual(filtersToQuery(filters), { q: 'sla', category: 'rooms', date_from: '2026-10-01' })
  assert.equal(parseFilters(new URLSearchParams()).q, '')
})

test('active filter indicators count a date range once and exclude the search box', () => {
  assert.equal(countActiveFilters(EMPTY_FILTERS), 0)
  assert.equal(countActiveFilters({ ...EMPTY_FILTERS, q: 'x' }), 0)
  assert.equal(countActiveFilters({ ...EMPTY_FILTERS, category: 'rooms', actor_id: 'u', date_from: '2026-10-01', date_to: '2026-10-05' }), 3)
  assert.equal(hasAnyFilter({ ...EMPTY_FILTERS, q: 'x' }), true)
  assert.equal(hasAnyFilter(EMPTY_FILTERS), false)
})

test('events are grouped by the hotel-local day, not the UTC day', () => {
  // 03:30 UTC on Oct 9 is 10:30 PM on Oct 8 in Chicago (CDT).
  const now = Date.parse('2026-10-09T15:00:00Z')
  assert.equal(dayKey('2026-10-09T03:30:00Z', CHI), '2026-10-08')
  assert.equal(dayKey('2026-10-09T03:30:00Z', 'UTC'), '2026-10-09')
  const groups = groupEventsByDay([ev('1', '2026-10-09T14:00:00Z'), ev('2', '2026-10-09T03:30:00Z'), ev('3', '2026-10-08T20:00:00Z'), ev('4', '2026-10-05T20:00:00Z')], CHI, now)
  assert.deepEqual(groups.map((g) => [g.label, g.events.map((e) => e.id)]), [
    ['Today', ['1']], ['Yesterday', ['2', '3']], ['Monday, October 5', ['4']],
  ])
})

test('day labels add the year only for other years', () => {
  assert.equal(dayLabel('2026-10-09', '2026-10-09'), 'Today')
  assert.equal(dayLabel('2025-12-31', '2026-10-09'), 'Wednesday, December 31, 2025')
})

test('timestamps are formatted in the hotel zone with its abbreviation', () => {
  assert.equal(formatFullTimestamp('2026-10-08T19:41:00Z', CHI), 'October 8, 2026 · 2:41 PM CDT')
  assert.equal(formatFullTimestamp('2026-01-08T20:41:00Z', CHI), 'January 8, 2026 · 2:41 PM CST')
  assert.equal(formatTime('2026-10-08T19:41:00Z', CHI), '2:41 PM')
  assert.equal(safeZone('Not/AZone'), 'UTC')
  assert.equal(safeZone(null), 'UTC')
})

test('export range defaults to the server default and reports its length', () => {
  const now = Date.parse('2026-10-09T15:00:00Z')
  assert.deepEqual(exportRange(EMPTY_FILTERS, CHI, now), { from: '2026-09-10', to: '2026-10-09', days: 30 })
  assert.equal(exportRange({ ...EMPTY_FILTERS, date_from: '2026-01-01', date_to: '2026-10-01' }, CHI, now).days, 274)
  assert.equal(daysBetween('2026-10-01', '2026-10-01'), 1)
  assert.deepEqual(presetRange(7, CHI, now), { date_from: '2026-10-03', date_to: '2026-10-09' })
})

test('values are humanised and "not recorded" stays distinct from "not set"', () => {
  assert.equal(formatValue(null), 'Not set')
  assert.equal(formatValue(true), 'Yes')
  assert.equal(formatValue(['lost-found', 'tasks']), 'Lost found, Tasks')
  assert.equal(formatValue([]), 'None')
  assert.equal(formatValue({ balance_workload: false }), 'Balance workload: No')
  assert.equal(humanizeKey('prefer_same_floor'), 'Prefer same floor')

  const created = describeChange({ field: 'room_number', label: 'Room number', after: '101' })
  assert.deepEqual(created, { kind: 'value', label: 'Room number', before: null, after: '101' })
  const cleared = describeChange({ field: 'building', label: 'Building', before: 'East', after: null })
  assert.deepEqual(cleared, { kind: 'value', label: 'Building', before: 'East', after: 'Not set' })
})

test('list and map changes show added/removed and per-key differences', () => {
  const list = describeChange({ field: 'modules', label: 'Modules', before: ['housekeeping', 'tasks'], after: ['housekeeping', 'tasks', 'logbook'], added: ['logbook'], removed: [] })
  assert.deepEqual(list, { kind: 'list', label: 'Modules', before: ['Housekeeping', 'Tasks'], after: ['Housekeeping', 'Tasks', 'Logbook'], added: ['Logbook'], removed: [] })
  const map = describeChange({ field: 'preferences', label: 'Prefs', before: { balance_workload: true }, after: { balance_workload: false }, changed_keys: ['balance_workload'] })
  assert.deepEqual(map, { kind: 'map', label: 'Prefs', rows: [{ key: 'Balance workload', before: 'Yes', after: 'No' }] })
  const noBefore = describeChange({ field: 'modules', label: 'Modules', after: ['tasks'], added: ['tasks'], removed: [] })
  assert.equal(noBefore.kind === 'list' && noBefore.before, undefined)
})

test('source labels only name recorded sources', () => {
  assert.equal(sourceLabel('automation'), 'Automated process')
  assert.equal(sourceLabel(null), null)
})
