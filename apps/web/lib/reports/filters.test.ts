import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  defaultFilters,
  filterQuery,
  filtersFromParams,
  filtersToParams,
  hotelToday,
  isValidCustomRange,
  isValidIsoDate,
  parseView,
  resolvePreset,
} from './filters'

const TODAY = '2026-10-07'
const params = (query: string) => new URLSearchParams(query)

test('hotel-local today uses the hotel timezone, not the browser/UTC date', () => {
  // 02:00Z on Oct 8 is still Oct 7 in Chicago and already Oct 8 in Auckland.
  const instant = new Date('2026-10-08T02:00:00Z')
  assert.equal(hotelToday('America/Chicago', instant), '2026-10-07')
  assert.equal(hotelToday('Pacific/Auckland', instant), '2026-10-08')
  assert.equal(hotelToday('Not/AZone', instant), '2026-10-08') // bad zone falls back safely
})

test('presets resolve to inclusive hotel-local ranges', () => {
  assert.deepEqual(resolvePreset('today', TODAY), { start: TODAY, end: TODAY })
  assert.deepEqual(resolvePreset('last_7_days', TODAY), { start: '2026-10-01', end: TODAY })
  assert.deepEqual(resolvePreset('last_30_days', TODAY), { start: '2026-09-08', end: TODAY })
  assert.deepEqual(resolvePreset('last_90_days', TODAY), { start: '2026-07-10', end: TODAY })
  assert.deepEqual(resolvePreset('year_to_date', TODAY), { start: '2026-01-01', end: TODAY })
})

test('date math handles month and year boundaries', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addDays('2028-03-01', -1), '2028-02-29')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(isValidIsoDate('2026-02-30'), false)
  assert.equal(isValidIsoDate('2026-2-3'), false)
  assert.equal(isValidIsoDate('2026-10-07'), true)
})

test('no URL params -> defaults (last 30 days, previous-period comparison)', () => {
  const filters = filtersFromParams(params(''), TODAY)
  assert.deepEqual(filters, { ...defaultFilters(TODAY) })
  assert.equal(filters.preset, 'last_30_days')
  assert.equal(filters.compare, 'previous')
  assert.equal(filters.department, '')
})

test('valid URL params are restored exactly (refresh / back-forward)', () => {
  const filters = filtersFromParams(params('range=custom&from=2026-09-01&to=2026-09-15&cmp=last_year&dept=engineering'), TODAY)
  assert.deepEqual(filters, { preset: 'custom', start: '2026-09-01', end: '2026-09-15', compare: 'last_year', department: 'engineering' })
  assert.equal(filtersFromParams(params('range=last_7_days&cmp=none'), TODAY).compare, 'none')
})

test('invalid URL params fall back to safe defaults instead of throwing', () => {
  const bad = [
    'range=custom&from=2026-10-09&to=2026-10-10', // future
    'range=custom&from=2026-10-05&to=2026-10-01', // inverted
    'range=custom&from=nope&to=2026-10-01',
    'range=custom', // missing dates
    'range=custom&from=2020-01-01&to=2026-10-01', // too long
  ]
  for (const query of bad) {
    const filters = filtersFromParams(params(query), TODAY)
    assert.equal(filters.preset, 'last_30_days', query)
    assert.equal(filters.end, TODAY, query)
  }
  assert.equal(filtersFromParams(params('range=forever'), TODAY).preset, 'last_30_days')
  assert.equal(filtersFromParams(params('cmp=weird'), TODAY).compare, 'previous')
  assert.equal(filtersFromParams(params('dept=front-office'), TODAY).department, '')
})

test('department filter is limited to the caller authorised departments', () => {
  assert.equal(filtersFromParams(params('dept=housekeeping'), TODAY, ['engineering']).department, '')
  assert.equal(filtersFromParams(params('dept=engineering'), TODAY, ['engineering']).department, 'engineering')
})

test('filters round-trip through the URL and defaults are omitted', () => {
  assert.equal(filtersToParams(defaultFilters(TODAY)).toString(), '')
  const custom = { preset: 'custom', start: '2026-09-01', end: '2026-09-15', compare: 'none', department: 'housekeeping' } as const
  const url = filtersToParams(custom, params('view=team'))
  assert.equal(url.get('view'), 'team') // other params preserved
  assert.deepEqual(filtersFromParams(url, TODAY), custom)
  // Preset ranges store only the preset so a bookmarked "last 7 days" stays fresh tomorrow.
  const seven = filtersToParams({ ...defaultFilters(TODAY), preset: 'last_7_days', ...resolvePreset('last_7_days', TODAY) })
  assert.equal(seven.toString(), 'range=last_7_days')
})

test('custom range validation', () => {
  assert.equal(isValidCustomRange('2026-10-01', '2026-10-07', TODAY), true)
  assert.equal(isValidCustomRange('2026-10-01', '2026-10-08', TODAY), false)
  assert.equal(isValidCustomRange('2026-10-07', '2026-10-01', TODAY), false)
})

test('view param must be both known and permitted', () => {
  assert.equal(parseView('team', ['team', 'overview']), 'team')
  assert.equal(parseView('management', ['overview']), null) // hidden by URL tampering
  assert.equal(parseView('hax', ['overview']), null)
  assert.equal(parseView(null, ['overview']), null)
})

test('API query omits comparison when none and optional department', () => {
  const f = { ...defaultFilters(TODAY), compare: 'none' as const }
  assert.deepEqual(filterQuery(f), { start_date: '2026-09-08', end_date: TODAY, compare: undefined, department: undefined })
  assert.equal(filterQuery({ ...f, department: 'engineering' }).department, 'engineering')
  assert.equal(filterQuery({ ...f, department: 'engineering' }, false).department, undefined)
})
