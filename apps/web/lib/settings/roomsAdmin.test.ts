import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoomStatus } from '../api/rooms'
import type { AccessibleRoomFeature } from '../api/guest_requests'
import {
  ALL, EMPTY_ROOM_FILTERS, buildRoomsQuery, classifyImportRows, filterRooms, hasActiveFilters, paginate,
  parseRoomsCsv, parseRoomsUrl, splitCsv, summarizeImportResult, toImportPayload, toRoomRows, validateRoomForm,
  distinctBuildings, distinctFloors, buildDraftRow, roomFormChanged, roomToForm, CSV_TEMPLATE, IMPORT_MAX_ROWS,
} from './rooms'
import {
  featureCountsByRoom, filterFeatures, featureLabel, normalizeFeatureCode, toFeaturePayload, validateFeatureForm,
  featureFormChanged, EMPTY_FEATURE_FILTERS, featureStatusMeta, FEATURE_STATUS_OPTIONS,
} from './accessibility'
import { propertyProfileSchema, toFormValues, toUpdatePayload, timezoneOptions } from './propertyProfile'
import { getNavigationTarget } from './unsavedGuard'

function status(id: string, number: string, floor: number, building: string | undefined, typeId: string, code: string): RoomStatus {
  return {
    room_id: id, status: 'CLEAN',
    rooms: { id, room_number: number, floor, building, room_type_id: typeId, room_types: { name: code + ' name', code, base_clean_minutes: 30 } },
  } as unknown as RoomStatus
}

const ROOMS = toRoomRows([
  status('r1', '101', 1, 'A', 'rt1', 'SD'),
  status('r2', '102', 1, 'A', 'rt1', 'SD'),
  status('r3', '201', 2, 'B', 'rt2', 'KS'),
  status('r4', '1001', 10, undefined, 'rt2', 'KS'),
  status('r5', '110', 1, 'A', 'rt2', 'KS'),
])

// ─── Room inventory ───────────────────────────────────────────────────────────

test('room rows are built from the real room_status join and sorted by floor then numeric room number', () => {
  assert.equal(ROOMS.length, 5)
  assert.deepEqual(filterRooms(ROOMS, EMPTY_ROOM_FILTERS).map((r) => r.roomNumber), ['101', '102', '110', '201', '1001'])
  assert.equal(ROOMS[3].building, '')
})

test('search matches room numbers and filters compose', () => {
  assert.deepEqual(filterRooms(ROOMS, { ...EMPTY_ROOM_FILTERS, q: '10' }).map((r) => r.roomNumber), ['101', '102', '110', '1001'])
  assert.deepEqual(filterRooms(ROOMS, { ...EMPTY_ROOM_FILTERS, building: 'A' }).map((r) => r.roomNumber), ['101', '102', '110'])
  assert.deepEqual(filterRooms(ROOMS, { ...EMPTY_ROOM_FILTERS, floor: '1', type: 'rt2' }).map((r) => r.roomNumber), ['110'])
  assert.deepEqual(filterRooms(ROOMS, { ...EMPTY_ROOM_FILTERS, q: 'zzz' }), [])
  assert.deepEqual(distinctBuildings(ROOMS), ['A', 'B'])
  assert.deepEqual(distinctFloors(ROOMS), [1, 2, 10])
  assert.equal(hasActiveFilters(EMPTY_ROOM_FILTERS), false)
  assert.equal(hasActiveFilters({ ...EMPTY_ROOM_FILTERS, floor: '2' }), true)
})

test('filter state round-trips through the URL and a clean view has a clean URL', () => {
  assert.equal(buildRoomsQuery({}), '')
  assert.equal(buildRoomsQuery({ tab: 'rooms', q: '', building: ALL, floor: ALL, type: ALL, page: 1 }), '')
  const qs = buildRoomsQuery({ tab: 'accessibility', q: ' 12 ', building: 'A', floor: '3', type: 'rt1', page: 2 })
  const parsed = parseRoomsUrl(new URLSearchParams(qs))
  assert.deepEqual(parsed, { tab: 'accessibility', q: '12', building: 'A', floor: '3', type: 'rt1', page: 2 })
  assert.equal(parseRoomsUrl(new URLSearchParams('page=-4&tab=bogus')).page, 1)
  assert.equal(parseRoomsUrl(new URLSearchParams('tab=bogus')).tab, 'rooms')
})

test('pagination clamps out-of-range pages', () => {
  const items = Array.from({ length: 120 }, (_, i) => i)
  assert.equal(paginate(items, 1).items.length, 50)
  assert.equal(paginate(items, 3).items.length, 20)
  assert.equal(paginate(items, 99).page, 3)
  assert.equal(paginate([], 1).pages, 1)
})

test('room form validation: required fields, bounds and duplicate room numbers', () => {
  const ok = { roomNumber: '301', floor: '3', building: 'A', roomTypeId: 'rt1' }
  assert.deepEqual(validateRoomForm(ok, ROOMS), {})
  assert.ok(validateRoomForm({ ...ok, roomNumber: '  ' }, ROOMS).roomNumber)
  assert.ok(validateRoomForm({ ...ok, floor: '' }, ROOMS).floor)
  assert.ok(validateRoomForm({ ...ok, floor: '1.5' }, ROOMS).floor)
  assert.ok(validateRoomForm({ ...ok, floor: '500' }, ROOMS).floor)
  assert.ok(validateRoomForm({ ...ok, roomTypeId: '' }, ROOMS).roomTypeId)
  assert.match(validateRoomForm({ ...ok, roomNumber: ' 101 ' }, ROOMS).roomNumber ?? '', /already exists/)
  // Editing a room may keep its own number…
  assert.deepEqual(validateRoomForm({ ...ok, roomNumber: '101' }, ROOMS, 'r1'), {})
  // …but not take another room's.
  assert.ok(validateRoomForm({ ...ok, roomNumber: '102' }, ROOMS, 'r1').roomNumber)
})

test('room form dirty detection ignores surrounding whitespace', () => {
  const base = roomToForm(ROOMS[0])
  assert.equal(roomFormChanged(base, { ...base, roomNumber: ' 101 ' }), false)
  assert.equal(roomFormChanged(base, { ...base, floor: '2' }), true)
})

// ─── Import ───────────────────────────────────────────────────────────────────

test('CSV parsing handles quotes, CRLF, BOM and header aliases', () => {
  assert.deepEqual(splitCsv('﻿a,"b,c",d\r\n1,"x ""q""",3\r\n'), [['a', 'b,c', 'd'], ['1', 'x "q"', '3']])
  const csv = '﻿Room Number,Floor,Type,Type Name,Building\r\n101,1,sd,Standard,A\r\n102,1,SD,,\r\n'
  const { rows, fileError } = parseRoomsCsv(csv)
  assert.equal(fileError, null)
  assert.equal(rows.length, 2)
  assert.deepEqual(
    { n: rows[0].roomNumber, f: rows[0].floor, c: rows[0].typeCode, t: rows[0].typeName, b: rows[0].building, line: rows[0].line },
    { n: '101', f: 1, c: 'SD', t: 'Standard', b: 'A', line: 2 },
  )
  assert.deepEqual(rows[1].errors, [])
})

test('the shipped CSV template parses cleanly', () => {
  const { rows, fileError } = parseRoomsCsv(CSV_TEMPLATE)
  assert.equal(fileError, null)
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.errors.length === 0))
})

test('invalid CSV is explained, never silently defaulted', () => {
  assert.match(parseRoomsCsv('').fileError ?? '', /empty/)
  assert.match(parseRoomsCsv('room_number,floor\n101,1').fileError ?? '', /room_type_code/)
  assert.match(parseRoomsCsv('room_number,floor,room_type_code').fileError ?? '', /no rooms/)
  const big = 'room_number,floor,room_type_code\n' + Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `${i},1,SD`).join('\n')
  assert.match(parseRoomsCsv(big).fileError ?? '', /at most 500/)

  const { rows } = parseRoomsCsv('room_number,floor,room_type_code\n,1,SD\n102,,SD\n103,abc,SD\n104,1,\n')
  assert.deepEqual(rows.map((r) => r.errors.length > 0), [true, true, true, true])
  assert.match(rows[1].errors[0], /Floor is required/)
  assert.match(rows[2].errors[0], /whole number/)
  assert.equal(rows[1].floor, null)
})

test('classification flags existing, in-file duplicate, invalid and new rooms', () => {
  const { rows } = parseRoomsCsv(
    'room_number,floor,room_type_code,room_type_name\n101,1,SD,\n301,3,SD,\n301,3,SD,\n302,3,PH,Penthouse\n303,3,XX,\n,3,SD,\n',
  )
  const result = classifyImportRows(rows, ROOMS, ['SD', 'KS'])
  assert.deepEqual(result.rows.map((r) => r.state), ['exists', 'new', 'duplicate-in-file', 'new', 'invalid', 'invalid'])
  assert.deepEqual(result.counts, { new: 2, exists: 1, 'duplicate-in-file': 1, invalid: 2 })
  assert.deepEqual(result.newTypes, [{ code: 'PH', name: 'Penthouse' }])
  assert.equal(result.rows[3].createsType, true)
  assert.match(result.rows[4].messages[0], /doesn’t exist yet/)
  assert.match(result.rows[2].messages[0], /line 3/)
})

test('room-number duplicate detection is case- and whitespace-insensitive', () => {
  const draft = buildDraftRow({ roomNumber: ' 101 ', floor: '1', typeCode: 'sd', typeName: '', building: '' }, 1)
  assert.equal(classifyImportRows([draft], ROOMS, ['SD']).rows[0].state, 'exists')
  const a = buildDraftRow({ roomNumber: 'A1', floor: '1', typeCode: 'SD', typeName: '', building: '' }, 1)
  const b = buildDraftRow({ roomNumber: 'a1', floor: '1', typeCode: 'SD', typeName: '', building: '' }, 2)
  assert.deepEqual(classifyImportRows([a, b], [], ['SD']).rows.map((r) => r.state), ['new', 'duplicate-in-file'])
})

test('import payload NEVER includes existing, duplicate or invalid rows, so nothing can be overwritten or reset', () => {
  const { rows } = parseRoomsCsv('room_number,floor,room_type_code,room_type_name,building\n101,1,SD,,A\n401,4,SD,,B\n401,4,SD,,B\n402,x,SD,,\n')
  const payload = toImportPayload(classifyImportRows(rows, ROOMS, ['SD']).rows)
  assert.deepEqual(payload, [{ room_number: '401', floor: 4, room_type_code: 'SD', building: 'B' }])
})

test('manual entry rows go through the same validation as CSV rows', () => {
  const good = buildDraftRow({ roomNumber: '501', floor: '5', typeCode: 'ks', typeName: '', building: '' }, 1)
  const bad = buildDraftRow({ roomNumber: '', floor: '5', typeCode: 'KS', typeName: '', building: '' }, 2)
  assert.deepEqual(good.errors, [])
  assert.equal(good.typeCode, 'KS')
  assert.ok(bad.errors.length > 0)
})

test('import results report the real server counts, reasons and any pre-existing rooms', () => {
  const out = summarizeImportResult({ imported_count: 3, reset_count: 1, errors: [{ room_number: '9', reason: 'Database insert for room failed' }, { room_number: null, reason: 'x' }] })
  assert.deepEqual(out, { imported: 3, alreadyExisted: 1, failed: [{ roomNumber: '9', reason: 'Database insert for room failed' }, { roomNumber: '—', reason: 'x' }] })
  assert.deepEqual(summarizeImportResult(undefined), { imported: 0, alreadyExisted: 0, failed: [] })
})

// ─── Accessibility ────────────────────────────────────────────────────────────

const FEATURES = [
  { id: 'f1', room_id: 'r1', feature_code: 'roll_in_shower', operational_status: 'operational', description: 'Roll-in shower with grab bars', rooms: { room_number: '101' } },
  { id: 'f2', room_id: 'r1', feature_code: 'grab_bars', operational_status: 'out_of_service', guidance: 'Bar loose', rooms: { room_number: '101' } },
  { id: 'f3', room_id: 'r3', feature_code: 'roll_in_shower', operational_status: 'inspection_due', rooms: { room_number: '201' } },
] as unknown as AccessibleRoomFeature[]

test('feature codes are normalised the way existing records are stored', () => {
  assert.equal(normalizeFeatureCode(' Roll-in Shower '), 'roll_in_shower')
  assert.equal(featureLabel('roll_in_shower'), 'Roll in shower')
  assert.equal(normalizeFeatureCode('___'), '')
})

test('feature form: required fields, and creating a duplicate room+feature is blocked (API would silently overwrite)', () => {
  const ok = { roomId: 'r3', featureCode: 'grab_bars', status: 'operational' as const, description: '', guidance: '' }
  assert.deepEqual(validateFeatureForm(ok, FEATURES), {})
  assert.ok(validateFeatureForm({ ...ok, roomId: '' }, FEATURES).roomId)
  assert.ok(validateFeatureForm({ ...ok, featureCode: ' ' }, FEATURES).featureCode)
  assert.match(validateFeatureForm({ ...ok, roomId: 'r1', featureCode: 'Grab Bars' }, FEATURES).featureCode ?? '', /already has/)
  assert.deepEqual(validateFeatureForm({ ...ok, roomId: 'r1', featureCode: 'grab_bars' }, FEATURES, 'f2'), {})
})

test('feature payload carries only fields the API supports, and uses the existing status values', () => {
  const payload = toFeaturePayload({ roomId: 'r1', featureCode: 'Grab Bars', status: 'inspection_due', description: ' ', guidance: ' note ' })
  assert.deepEqual(payload, { room_id: 'r1', feature_code: 'grab_bars', operational_status: 'inspection_due', description: undefined, guidance: 'note' })
  assert.deepEqual(FEATURE_STATUS_OPTIONS.map((o) => o.value).sort(), ['inspection_due', 'operational', 'out_of_service'])
  assert.equal(featureStatusMeta('out_of_service').label, 'Out of service')
  assert.equal(featureFormChanged({ roomId: 'r1', featureCode: 'a b', status: 'operational', description: '', guidance: '' }, { roomId: 'r1', featureCode: 'a_b', status: 'operational', description: ' ', guidance: '' }), false)
})

test('feature filters and per-room counts', () => {
  assert.equal(filterFeatures(FEATURES, EMPTY_FEATURE_FILTERS).length, 3)
  assert.deepEqual(filterFeatures(FEATURES, { ...EMPTY_FEATURE_FILTERS, room: 'r1' }).map((f) => f.id), ['f2', 'f1'])
  assert.deepEqual(filterFeatures(FEATURES, { ...EMPTY_FEATURE_FILTERS, status: 'out_of_service' }).map((f) => f.id), ['f2'])
  assert.deepEqual(filterFeatures(FEATURES, { ...EMPTY_FEATURE_FILTERS, feature: 'roll_in_shower' }).map((f) => f.id), ['f1', 'f3'])
  assert.deepEqual(filterFeatures(FEATURES, { ...EMPTY_FEATURE_FILTERS, q: 'loose' }).map((f) => f.id), ['f2'])
  assert.deepEqual(filterFeatures(FEATURES, { ...EMPTY_FEATURE_FILTERS, q: '201' }).map((f) => f.id), ['f3'])
  assert.equal(featureCountsByRoom(FEATURES).get('r1'), 2)
  assert.equal(featureCountsByRoom(FEATURES).get('r2'), undefined)
})

// ─── Property profile ─────────────────────────────────────────────────────────

const HOTEL = {
  id: 'h1', name: 'Sonesta ES Suites', address: '1234 Main St', city: 'Fort Worth', state: 'TX', zip: '76137',
  phone: '+1 (817) 439-1300', room_count: 114, timezone: 'America/Chicago', average_daily_rate_cents: 12950, created_at: '',
}

test('existing hotel values populate the form, ADR converts from cents', () => {
  const v = toFormValues(HOTEL)
  assert.equal(v.name, 'Sonesta ES Suites')
  assert.equal(v.timezone, 'America/Chicago')
  assert.equal(v.average_daily_rate, 129.5)
  assert.equal(toFormValues({ ...HOTEL, average_daily_rate_cents: null }).average_daily_rate, undefined)
  assert.equal('room_count' in v, false)
})

test('save payload persists ADR in cents (or null to clear), keeps timezone, and never writes room_count', () => {
  const payload = toUpdatePayload({ ...toFormValues(HOTEL), state: 'tx', average_daily_rate: 129.99, timezone: 'America/Denver' })
  assert.equal(payload.average_daily_rate_cents, 12999)
  assert.equal(payload.timezone, 'America/Denver')
  assert.equal(payload.state, 'TX')
  assert.equal('room_count' in payload, false)
  assert.equal(toUpdatePayload({ ...toFormValues(HOTEL), average_daily_rate: undefined }).average_daily_rate_cents, null)
  assert.equal(toUpdatePayload({ ...toFormValues(HOTEL), average_daily_rate: 0 }).average_daily_rate_cents, 0)
})

test('profile validation shows field errors for invalid input and accepts the saved hotel', () => {
  assert.equal(propertyProfileSchema.safeParse(toFormValues(HOTEL)).success, true)
  const bad = propertyProfileSchema.safeParse({ ...toFormValues(HOTEL), name: 'A', state: 'Texas', zip: '12', phone: 'abc', average_daily_rate: -1 })
  assert.equal(bad.success, false)
  if (!bad.success) {
    const fields = bad.error.issues.map((i) => i.path[0]).sort()
    assert.deepEqual(fields, ['average_daily_rate', 'name', 'phone', 'state', 'zip'])
  }
})

test('a saved non-US timezone stays selectable so saving never silently rewrites it', () => {
  assert.equal(timezoneOptions('America/Chicago').length, 7)
  const options = timezoneOptions('Europe/London')
  assert.equal(options.length, 8)
  assert.equal(options[7].value, 'Europe/London')
})

// ─── Unsaved-changes navigation guard ─────────────────────────────────────────

test('only plain same-origin link clicks that change the page are intercepted', () => {
  const base = { currentHref: 'https://app.test/settings/general', origin: 'https://app.test' }
  assert.equal(getNavigationTarget({ ...base, href: '/settings/rooms' }), '/settings/rooms')
  assert.equal(getNavigationTarget({ ...base, href: 'https://app.test/tasks?x=1#y' }), '/tasks?x=1#y')
  assert.equal(getNavigationTarget({ ...base, href: '/settings/general' }), null)
  assert.equal(getNavigationTarget({ ...base, href: '#section' }), null)
  assert.equal(getNavigationTarget({ ...base, href: 'https://other.test/' }), null)
  assert.equal(getNavigationTarget({ ...base, href: 'mailto:a@b.c' }), null)
  assert.equal(getNavigationTarget({ ...base, href: '/x', target: '_blank' }), null)
  assert.equal(getNavigationTarget({ ...base, href: '/x', download: true }), null)
  assert.equal(getNavigationTarget({ ...base, href: '/x', modifier: true }), null)
})
