import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CustomRole, RoleSchedule, StaffMember } from '@/lib/api/staff'
import {
  EMPTY_ONBOARDING, accessGuards, actionsFor, activeCoverageToday, backTarget, buildAccessUpdate, compatibleCustomRoles,
  coverageStatus, customRoleAfterRoleChange, diffPersonEdit, hasChanges, isLastActiveGm, isValidPhone, parseHourlyRate,
  personEditInitial, safeMailHref, safeTelHref, teamReportHref, validateCoverage, validateOnboarding, validatePersonEdit,
  weekdayOf,
} from '@/lib/people/peopleDrawers'
import { buildDirectory } from '@/lib/people/peopleDirectory'

const staff = (o: Partial<StaffMember> = {}): StaffMember => ({
  id: 'r1', user_id: 'u1', hotel_id: 'h1', full_name: 'Maria Garcia', email: 'maria@hotel.com', role: 'housekeeper',
  status: 'active', created_at: '2026-01-01', ...o,
})
const sched = (o: Partial<RoleSchedule> = {}): RoleSchedule => ({
  id: 's1', override_role: 'housekeeping_supervisor', days_of_week: [1, 2], created_at: '2026-01-01', ...o,
})
const cr = (id: string, base_role: CustomRole['base_role']): CustomRole => ({
  id, name: id, base_role, allowed_modules: [], is_active: true, created_at: '2026-01-01',
})

describe('contact links', () => {
  it('only builds mailto/tel links from clean values', () => {
    assert.equal(safeMailHref('maria@hotel.com'), 'mailto:maria@hotel.com')
    for (const bad of ['', null, 'a b@c.com', 'x@y.com?bcc=evil@z.com', 'javascript:alert(1)', 'a@b', 'a@b.com,c@d.com']) {
      assert.equal(safeMailHref(bad as string | null), null, String(bad))
    }
    assert.equal(safeTelHref('(555) 555-0142'), 'tel:5555550142')
    assert.equal(safeTelHref('+1 555 555 0142'), 'tel:+15555550142')
    for (const bad of ['', null, 'call me', '123', 'tel:5551234567;x=1', '555-0142 ext 9 ; DROP']) {
      assert.equal(safeTelHref(bad as string | null), null, String(bad))
    }
  })
  it('phone is optional but must look like a number when given', () => {
    assert.ok(isValidPhone(''))
    assert.ok(isValidPhone('555 555 0142'))
    assert.ok(!isValidPhone('abc'))
  })
})

describe('hourly rate', () => {
  it('parses blank as clear and rejects bad values', () => {
    assert.deepEqual(parseHourlyRate(''), { ok: true, value: null })
    assert.deepEqual(parseHourlyRate('18.5'), { ok: true, value: 18.5 })
    for (const bad of ['-1', '501', 'abc', '1.234', '1e3']) assert.equal(parseHourlyRate(bad).ok, false, bad)
  })
})

describe('edit person', () => {
  const s = staff({ preferred_name: 'Mari', phone: '5555550142', department_id: 'd1', hourly_rate: 18.5 })
  it('sends only changed fields', () => {
    const v = personEditInitial(s)
    assert.equal(hasChanges(diffPersonEdit(s, v, true)), false)
    const d = diffPersonEdit(s, { ...v, preferredName: '', departmentId: '', hourlyRate: '20' }, true)
    assert.deepEqual(d.profile, { preferred_name: null })
    assert.deepEqual(d.assignment, { department_id: null, hourly_rate: 20 })
  })
  it('never includes the rate for non-GM callers', () => {
    const d = diffPersonEdit(s, { ...personEditInitial(s), hourlyRate: '99' }, false)
    assert.deepEqual(d.assignment, {})
  })
  it('validates required and malformed fields', () => {
    const e = validatePersonEdit({ ...personEditInitial(s), fullName: ' ', phone: 'x', hourlyRate: '9999' }, true)
    assert.deepEqual(Object.keys(e).sort(), ['fullName', 'hourlyRate', 'phone'])
    assert.deepEqual(validatePersonEdit(personEditInitial(s), true), {})
  })
})

describe('onboarding', () => {
  const ok = { ...EMPTY_ONBOARDING, fullName: 'New Person', email: 'new@x.com', role: 'housekeeper' as const }
  it('requires name, email and role; department only when configured', () => {
    assert.deepEqual(validateOnboarding(ok, { requireDepartment: false, manual: false }), {})
    assert.deepEqual(
      Object.keys(validateOnboarding(EMPTY_ONBOARDING, { requireDepartment: true, manual: false })).sort(),
      ['departmentId', 'email', 'fullName', 'role'],
    )
  })
  it('only checks the password when the GM chooses one', () => {
    assert.deepEqual(validateOnboarding({ ...ok, password: '' }, { requireDepartment: false, manual: true }), {})
    assert.ok(validateOnboarding({ ...ok, credential: 'chosen', password: 'short' }, { requireDepartment: false, manual: true }).password)
  })
})

describe('access', () => {
  const roles = [cr('hk', 'housekeeper'), cr('eng', 'engineer')]
  it('offers only custom policies that fit the base role and clears the rest on a role change', () => {
    assert.deepEqual(compatibleCustomRoles(roles, 'housekeeper').map((r) => r.id), ['hk'])
    assert.equal(customRoleAfterRoleChange(roles, 'housekeeper', 'hk'), 'hk')
    assert.equal(customRoleAfterRoleChange(roles, 'front_desk', 'hk'), null)
  })
  it('builds a minimal update and always restates the custom policy on a role change', () => {
    const o = { role: 'housekeeper' as const, custom_role_id: 'hk' }
    assert.deepEqual(buildAccessUpdate(o, { role: 'housekeeper', customRoleId: 'hk' }), {})
    assert.deepEqual(buildAccessUpdate(o, { role: 'front_desk', customRoleId: null }), { role: 'front_desk', custom_role_id: null })
    assert.deepEqual(
      buildAccessUpdate({ role: 'housekeeper', custom_role_id: null }, { role: 'housekeeper', customRoleId: 'hk' }),
      { custom_role_id: 'hk' },
    )
  })
  it('locks the role of yourself and of the last GM', () => {
    const gm1 = staff({ user_id: 'g1', role: 'gm' })
    const gm2 = staff({ user_id: 'g2', role: 'gm' })
    assert.equal(isLastActiveGm([gm1], 'g1'), true)
    assert.equal(isLastActiveGm([gm1, gm2], 'g1'), false)
    assert.deepEqual(accessGuards([gm1, gm2], gm1, 'g1'), { roleLocked: true, reason: 'self' })
    assert.deepEqual(accessGuards([gm1], gm1, 'someone'), { roleLocked: true, reason: 'lastGm' })
    assert.deepEqual(accessGuards([gm1, gm2], gm2, 'g1'), { roleLocked: false, reason: null })
  })
})

describe('coverage', () => {
  it('derives status from real dates only', () => {
    assert.equal(coverageStatus({ start_date: '2026-10-01', end_date: '2026-10-20' }, '2026-10-08'), 'current')
    assert.equal(coverageStatus({ start_date: '2026-10-10' }, '2026-10-08'), 'upcoming')
    assert.equal(coverageStatus({ end_date: '2026-10-07' }, '2026-10-08'), 'expired')
    assert.equal(coverageStatus({}, '2026-10-08'), 'current')
    assert.equal(coverageStatus({}, null), null)
  })
  it('computes weekday without timezone drift', () => {
    assert.equal(weekdayOf('2026-10-08'), 4) // Thursday
    assert.equal(weekdayOf('nope'), null)
  })
  it('applies only inside the date window on a covered weekday', () => {
    const s = [sched({ days_of_week: [4], start_date: '2026-10-01', end_date: '2026-10-31' })]
    assert.equal(activeCoverageToday(s, '2026-10-08')?.id, 's1')
    assert.equal(activeCoverageToday(s, '2026-10-09'), null) // Friday
    assert.equal(activeCoverageToday(s, '2026-11-05'), null) // expired
  })
  it('validates role, days, date order, past end and overlaps', () => {
    const draft = { role: 'housekeeping_supervisor', days: [1], start: '2026-10-10', end: '2026-10-20' }
    assert.deepEqual(validateCoverage(draft, 'housekeeper', [], '2026-10-08'), {})
    assert.ok(validateCoverage({ ...draft, role: 'housekeeper' }, 'housekeeper', [], null).role)
    assert.ok(validateCoverage({ ...draft, role: 'engineer' }, 'housekeeper', [], null).role)
    assert.ok(validateCoverage(draft, 'front_desk', [], null).role)
    assert.ok(validateCoverage({ ...draft, days: [] }, 'housekeeper', [], null).days)
    assert.ok(validateCoverage({ ...draft, end: '' }, 'housekeeper', [], null).end) // temporary coverage needs an end
    assert.ok(validateCoverage({ ...draft, end: '2026-10-01' }, 'housekeeper', [], null).end)
    assert.ok(validateCoverage({ ...draft, start: '', end: '2026-10-01' }, 'housekeeper', [], '2026-10-08').end)
    const other = [sched({ days_of_week: [1, 3], start_date: '2026-10-15', end_date: '2026-10-30' })]
    assert.ok(validateCoverage(draft, 'housekeeper', other, null).overlap)
    assert.equal(validateCoverage({ ...draft, days: [2] }, 'housekeeper', other, null).overlap, undefined) // other weekday
    assert.equal(validateCoverage({ ...draft, end: '2026-10-14' }, 'housekeeper', other, null).overlap, undefined) // other dates
  })
})

describe('actions and navigation', () => {
  const gm = staff({ user_id: 'g1', role: 'gm' })
  const hk = staff({ user_id: 'u1' })
  const off = staff({ user_id: 'u2', status: 'inactive' })
  const inv = (status: 'pending' | 'expired') => ({
    id: 'i1', hotel_id: 'h1', email: 'n@x.com', role: 'housekeeper' as const, status,
    invited_at: '', created_at: '', expires_at: '', delivery: { status: null, error: null, note: '' },
  })
  const dir = buildDirectory([gm, hk, off], [inv('pending'), { ...inv('expired'), id: 'i2', email: 'e@x.com' }])
  const find = (k: string) => dir.find((e) => e.key === k)!
  const ctx = { selfUserId: 'g1', staff: [gm, hk, off] }
  it('lists only working actions per record type', () => {
    assert.deepEqual(actionsFor(find('staff:u1'), ctx), ['profile', 'edit', 'access', 'schedule', 'deactivate'])
    assert.deepEqual(actionsFor(find('staff:u2'), ctx), ['profile', 'reactivate'])
    assert.deepEqual(actionsFor(find('invitation:i1'), ctx), ['invitation', 'resend', 'editInvitation', 'revoke'])
    assert.deepEqual(actionsFor(find('invitation:i2'), ctx), ['invitation', 'reissue', 'revoke'])
  })
  it('hides deactivate for yourself and for the last GM', () => {
    assert.ok(!actionsFor(find('staff:g1'), ctx).includes('deactivate'))
    assert.ok(!actionsFor(find('staff:g1'), { ...ctx, selfUserId: 'other' }).includes('deactivate'))
  })
  it('returns from focused forms to the profile', () => {
    assert.deepEqual(backTarget({ view: 'edit', key: 'staff:u1' }), { view: 'profile', key: 'staff:u1' })
    assert.equal(backTarget({ view: 'profile', key: 'staff:u1' }), null)
  })
  it('only links to Team Report for well-formed ids', () => {
    assert.equal(teamReportHref('3f2a-1'), '/reports?d=employee&eid=3f2a-1')
    assert.equal(teamReportHref('x&d=evil'), null)
  })
})
