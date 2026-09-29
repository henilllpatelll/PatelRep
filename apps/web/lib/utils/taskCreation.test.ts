import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGuestRequestCreatePayload,
  buildTaskScheduleCreatePayload,
  computeInternalDueAt,
  DEFAULT_RECURRENCE_DRAFT,
  endOfShiftDate,
  formatSlaDuration,
  GUEST_REQUEST_CATEGORY_VALUES,
  GUEST_REQUEST_PRIORITY_VALUES,
  guestPriorityForCategory,
  INTERNAL_TASK_PRIORITY_VALUES,
  INTERNAL_TASK_TYPE_VALUES,
  isFutureDueAt,
  resolveGuestRequestSlaMinutes,
  sortAssigneesForGuestCategory,
  sortAssigneesForInternalType,
  validateRecurrenceDraft,
} from './taskCreation'
import type { StaffMember } from '@/lib/api/staff'

test('guest-request creation exposes only its backend categories and urgent/normal priorities', () => {
  assert.deepEqual(GUEST_REQUEST_CATEGORY_VALUES, ['housekeeping', 'maintenance', 'service', 'accessibility', 'other'])
  assert.deepEqual(GUEST_REQUEST_PRIORITY_VALUES, ['urgent', 'normal'])
  assert.equal(GUEST_REQUEST_PRIORITY_VALUES.includes('low'), false)
})

test('guest-request creation payload preserves the selected domain values without silent mapping', () => {
  assert.deepEqual(
    buildGuestRequestCreatePayload({
      title: '  Bring a wheelchair  ',
      description: '  Guest requested assistance  ',
      roomId: 'room-204',
      guestName: '  Sam Guest  ',
      priority: 'urgent',
      category: 'accessibility',
      guestImpact: 'high',
      contactPreference: 'sms',
      contactConsent: true,
      assignedTo: 'staff-9',
    }),
    {
      title: 'Bring a wheelchair',
      description: 'Guest requested assistance',
      room_id: 'room-204',
      guest_name: 'Sam Guest',
      priority: 'urgent',
      category: 'accessibility',
      guest_impact: 'high',
      contact_preference: 'sms',
      contact_consent: true,
      assigned_to: 'staff-9',
    },
  )
})

test('contact_preference "none" never sends a preference or asks for consent', () => {
  const payload = buildGuestRequestCreatePayload({
    title: 'Towels', description: '', roomId: '', guestName: '', priority: 'normal', category: 'service',
    guestImpact: 'standard', contactPreference: 'none', contactConsent: false, assignedTo: '',
  })
  assert.equal(payload.contact_preference, undefined)
  assert.equal(payload.contact_consent, undefined)
})

test('internal task mode keeps its valid task types and low priority option', () => {
  assert.deepEqual(INTERNAL_TASK_TYPE_VALUES, ['housekeeping', 'engineering', 'lost_found', 'general'])
  assert.deepEqual(INTERNAL_TASK_PRIORITY_VALUES, ['urgent', 'normal', 'low'])
})

test('accessibility requests are forced urgent, matching the backend 422 rule', () => {
  assert.equal(guestPriorityForCategory('accessibility', 'normal'), 'urgent')
  assert.equal(guestPriorityForCategory('service', 'normal'), 'normal')
})

test('resolveGuestRequestSlaMinutes prefers the most specific matching policy', () => {
  const policies = [
    { category: null, priority: null, guest_impact: null, sla_minutes: 240 },
    { category: 'maintenance' as const, priority: null, guest_impact: null, sla_minutes: 120 },
    { category: 'maintenance' as const, priority: 'urgent' as const, guest_impact: 'high' as const, sla_minutes: 30 },
  ]
  assert.equal(resolveGuestRequestSlaMinutes(policies, { category: 'maintenance', priority: 'urgent', guestImpact: 'high' }), 30)
  assert.equal(resolveGuestRequestSlaMinutes(policies, { category: 'maintenance', priority: 'normal', guestImpact: 'standard' }), 120)
  assert.equal(resolveGuestRequestSlaMinutes(policies, { category: 'service', priority: 'normal', guestImpact: 'standard' }), 240)
  assert.equal(resolveGuestRequestSlaMinutes([], { category: 'service', priority: 'normal', guestImpact: 'standard' }), 240)
})

test('formatSlaDuration renders whole hours, minutes, and mixed durations', () => {
  assert.equal(formatSlaDuration(240), '4h')
  assert.equal(formatSlaDuration(30), '30m')
  assert.equal(formatSlaDuration(90), '1h 30m')
})

test('computeInternalDueAt returns undefined for sla_default so the backend applies its own default', () => {
  assert.equal(computeInternalDueAt('sla_default'), undefined)
})

test('computeInternalDueAt presets add the right offset from now', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')
  assert.equal(computeInternalDueAt('30m', { now }), new Date('2026-01-01T12:30:00.000Z').toISOString())
  assert.equal(computeInternalDueAt('1h', { now }), new Date('2026-01-01T13:00:00.000Z').toISOString())
  assert.equal(computeInternalDueAt('2h', { now }), new Date('2026-01-01T14:00:00.000Z').toISOString())
})

test('computeInternalDueAt never fabricates an end-of-shift time when none is known', () => {
  assert.equal(computeInternalDueAt('end_of_shift', { endOfShiftAt: null }), undefined)
})

test('computeInternalDueAt custom passes the given ISO through unchanged', () => {
  assert.equal(computeInternalDueAt('custom', { customIso: '2026-03-01T00:00:00.000Z' }), '2026-03-01T00:00:00.000Z')
  assert.equal(computeInternalDueAt('custom', {}), undefined)
})

test('isFutureDueAt rejects the past and invalid dates', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')
  assert.equal(isFutureDueAt('2026-01-01T13:00:00.000Z', now), true)
  assert.equal(isFutureDueAt('2026-01-01T11:00:00.000Z', now), false)
  assert.equal(isFutureDueAt('not-a-date', now), false)
})

test('endOfShiftDate rolls to the next day once the end time has already passed today', () => {
  const stillOnShift = new Date('2026-01-01T10:00:00')
  assert.equal(endOfShiftDate('15:00:00', stillOnShift).getDate(), 1)
  const afterShiftEnded = new Date('2026-01-01T23:30:00')
  assert.equal(endOfShiftDate('15:00:00', afterShiftEnded).getDate(), 2)
})

test('validateRecurrenceDraft is a no-op when recurrence is disabled', () => {
  assert.equal(validateRecurrenceDraft(DEFAULT_RECURRENCE_DRAFT, '2026-01-01'), null)
})

test('validateRecurrenceDraft requires interval days for a custom interval', () => {
  const draft = { ...DEFAULT_RECURRENCE_DRAFT, enabled: true, intervalType: 'custom' as const, intervalDays: '' }
  assert.equal(validateRecurrenceDraft(draft, '2026-01-01'), 'tasks.createModal.recurrence.errors.intervalDaysRequired')
  assert.equal(validateRecurrenceDraft({ ...draft, intervalDays: '5' }, '2026-01-01'), null)
})

test('validateRecurrenceDraft requires a valid end count or end date when set', () => {
  const countDraft = { ...DEFAULT_RECURRENCE_DRAFT, enabled: true, endType: 'count' as const, endCount: '' }
  assert.equal(validateRecurrenceDraft(countDraft, '2026-01-01'), 'tasks.createModal.recurrence.errors.endCountRequired')

  const dateDraft = { ...DEFAULT_RECURRENCE_DRAFT, enabled: true, endType: 'date' as const, endDate: '' }
  assert.equal(validateRecurrenceDraft(dateDraft, '2026-01-01'), 'tasks.createModal.recurrence.errors.endDateRequired')

  const beforeStart = { ...dateDraft, endDate: '2025-12-01' }
  assert.equal(validateRecurrenceDraft(beforeStart, '2026-01-01'), 'tasks.createModal.recurrence.errors.endDateBeforeStart')

  const validDate = { ...dateDraft, endDate: '2026-06-01' }
  assert.equal(validateRecurrenceDraft(validDate, '2026-01-01'), null)
})

test('buildTaskScheduleCreatePayload sends a room OR a free-text location, never both', () => {
  const draft = { ...DEFAULT_RECURRENCE_DRAFT, enabled: true, intervalType: 'monthly' as const }
  const withRoom = buildTaskScheduleCreatePayload(draft, {
    title: 'Deep clean', description: '', taskType: 'housekeeping', priority: 'normal',
    roomId: 'room-1', locationText: 'ignored when room is set', assignedTo: '', startDate: '2026-01-01',
  })
  assert.equal(withRoom.room_id, 'room-1')
  assert.equal(withRoom.location_text, undefined)

  const withLocation = buildTaskScheduleCreatePayload(draft, {
    title: 'Deep clean', description: '', taskType: 'housekeeping', priority: 'normal',
    roomId: '', locationText: 'Lobby', assignedTo: '', startDate: '2026-01-01',
  })
  assert.equal(withLocation.room_id, undefined)
  assert.equal(withLocation.location_text, 'Lobby')
})

test('buildTaskScheduleCreatePayload only sends interval_days for a custom interval', () => {
  const weekly = buildTaskScheduleCreatePayload(
    { ...DEFAULT_RECURRENCE_DRAFT, enabled: true, intervalType: 'weekly', intervalDays: '9' },
    { title: 'T', description: '', taskType: 'general', priority: 'normal', roomId: '', locationText: '', assignedTo: '', startDate: '2026-01-01' },
  )
  assert.equal(weekly.interval_days, undefined)

  const custom = buildTaskScheduleCreatePayload(
    { ...DEFAULT_RECURRENCE_DRAFT, enabled: true, intervalType: 'custom', intervalDays: '9' },
    { title: 'T', description: '', taskType: 'general', priority: 'normal', roomId: '', locationText: '', assignedTo: '', startDate: '2026-01-01' },
  )
  assert.equal(custom.interval_days, 9)
})

const staff = (overrides: Partial<StaffMember>): StaffMember => ({
  id: overrides.user_id ?? 'x', user_id: 'x', hotel_id: 'hotel-1', full_name: 'Z', email: 'z@x.com',
  role: 'housekeeper', status: 'active', created_at: '2026-01-01T00:00:00Z', ...overrides,
})

test('sortAssigneesForInternalType surfaces matching roles first, then everyone else alphabetically', () => {
  const list = [
    staff({ user_id: '1', full_name: 'Zed Engineer', role: 'engineer' }),
    staff({ user_id: '2', full_name: 'Amy Housekeeper', role: 'housekeeper' }),
    staff({ user_id: '3', full_name: 'Bea Housekeeper', role: 'housekeeper' }),
    staff({ user_id: '4', full_name: 'Gm Person', role: 'gm' }),
  ]
  const sorted = sortAssigneesForInternalType(list, 'housekeeping')
  assert.deepEqual(sorted.map((s) => s.full_name), ['Amy Housekeeper', 'Bea Housekeeper', 'Gm Person', 'Zed Engineer'])
})

test('sortAssigneesForGuestCategory never hides a valid candidate outside the preferred roles', () => {
  const list = [
    staff({ user_id: '1', full_name: 'Front Desk Dana', role: 'front_desk' }),
    staff({ user_id: '2', full_name: 'Engineer Eli', role: 'engineer' }),
  ]
  const sorted = sortAssigneesForGuestCategory(list, 'maintenance')
  assert.equal(sorted.length, 2)
  assert.equal(sorted[0].full_name, 'Engineer Eli')
})
