import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ShiftAssignment } from '@/lib/api/scheduling'
import type { StaffInvitation, StaffMember } from '@/lib/api/staff'
import {
  DEFAULT_FILTERS, UNASSIGNED_DEPARTMENT, buildDirectory, buildTodayMap, decodeFilters, encodeFilters,
  filterDirectory, formatClock, formatShiftRange, hotelToday, sortDirectory, summarize,
} from '@/lib/people/peopleDirectory'

const label = (r: string) => r.replace(/_/g, ' ')

const staff = (id: string, over: Partial<StaffMember> = {}): StaffMember => ({
  id: `role-${id}`, user_id: id, hotel_id: 'h1', full_name: id, email: `${id}@hotel.com`, role: 'housekeeper',
  status: 'active', created_at: '2026-01-01', ...over,
})
const invite = (id: string, over: Partial<StaffInvitation> = {}): StaffInvitation => ({
  id, hotel_id: 'h1', email: `${id}@new.com`, role: 'front_desk', status: 'pending', invited_at: '', created_at: '',
  expires_at: '', delivery: { status: 'requested', error: null, note: '' }, ...over,
})
const assign = (user_id: string, over: Partial<ShiftAssignment> = {}): ShiftAssignment => ({
  id: `a-${user_id}`, tenant_id: 'h1', user_id, shift_id: 's', work_date: '2026-10-08', is_on_shift: false,
  clocked_in_at: null, clocked_out_at: null, created_at: '',
  shifts: { name: 'AM', start_time: '07:00:00', end_time: '15:00:00' }, ...over,
})

describe('buildDirectory', () => {
  it('keeps staff and invitation identities distinct even if ids collide', () => {
    const d = buildDirectory([staff('x')], [invite('x')])
    assert.deepEqual(d.map((e) => e.key), ['staff:x', 'invitation:x'])
  })
  it('shows each open invitation once and hides accepted/revoked ones', () => {
    const d = buildDirectory([], [
      invite('a'), invite('b', { status: 'expired' }), invite('c', { status: 'accepted' }), invite('d', { status: 'revoked' }),
    ])
    assert.deepEqual(d.map((e) => [e.key, e.status]), [['invitation:a', 'invited'], ['invitation:b', 'expired']])
  })
  it('does not list an invitation for an email that already has an account', () => {
    const d = buildDirectory([staff('maria', { email: 'Maria@Hotel.com' })], [invite('i1', { email: 'maria@hotel.com' })])
    assert.equal(d.length, 1)
    assert.equal(d[0].kind, 'staff')
  })
  it('maps inactive staff to deactivated and prefers the API department name', () => {
    const d = buildDirectory([staff('a', { status: 'inactive', department_id: 'd1', department_name: 'Engineering' })], [], { d1: 'Ignored' })
    assert.equal(d[0].status, 'deactivated')
    assert.equal(d[0].departmentName, 'Engineering')
  })
  it('falls back to the departments list, never to a role-derived department', () => {
    const d = buildDirectory([staff('a', { department_id: 'd1' }), staff('b')], [], { d1: 'Housekeeping' })
    assert.equal(d[0].departmentName, 'Housekeeping')
    assert.equal(d[1].departmentName, null)
  })
})

describe('today', () => {
  it('distinguishes clocked in, scheduled and finished; clock-in wins', () => {
    const m = buildTodayMap([
      assign('a'),
      assign('b', { is_on_shift: true, clocked_in_at: 't' }),
      assign('c', { clocked_in_at: 't', clocked_out_at: 't2' }),
      assign('d'),
      assign('d', { clocked_in_at: 't' }),
    ])
    assert.equal(m.get('a')?.kind, 'scheduled')
    assert.equal(m.get('b')?.kind, 'clocked_in')
    assert.equal(m.get('c')?.kind, 'finished')
    assert.equal(m.get('d')?.kind, 'clocked_in')
    assert.equal(m.get('zzz'), undefined)
  })
  it('formats shift times without inventing values', () => {
    assert.equal(formatClock('07:00:00'), '7 AM')
    assert.equal(formatClock('15:30:00'), '3:30 PM')
    assert.equal(formatClock('00:00:00'), '12 AM')
    assert.equal(formatClock(null), null)
    assert.equal(formatClock('garbage'), null)
    assert.equal(formatShiftRange('07:00:00', '15:00:00'), '7 AM–3 PM')
    assert.equal(formatShiftRange(null, null), null)
  })
  it('computes the hotel-local date, not the UTC date', () => {
    const t = new Date('2026-10-08T02:00:00Z')
    assert.equal(hotelToday('America/Chicago', t), '2026-10-07')
    assert.equal(hotelToday('UTC', t), '2026-10-08')
    assert.equal(hotelToday('Not/AZone', t), null)
    assert.equal(hotelToday(undefined, t), null)
  })
})

describe('summarize', () => {
  const people = [staff('a'), staff('b'), staff('c', { status: 'inactive' })]
  it('counts active people only and distinct scheduled active staff', () => {
    const today = buildTodayMap([assign('a'), assign('a'), assign('b', { clocked_in_at: 't' }), assign('c')])
    const s = summarize(people, [invite('i1'), invite('i2', { status: 'expired' })], today)
    assert.deepEqual(s, { active: 2, scheduledToday: 2, clockedIn: 1, pendingInvites: 1 })
  })
  it('reports unknown (null), not zero, when a source is unavailable', () => {
    assert.deepEqual(summarize(people, undefined, undefined),
      { active: 2, scheduledToday: null, clockedIn: null, pendingInvites: null })
    assert.equal(summarize(undefined, [], new Map()).active, null)
  })
  it('does not count an invitation whose email already has an account', () => {
    assert.equal(summarize([staff('a', { email: 'x@y.com' })], [invite('i', { email: 'X@y.com' })], new Map()).pendingInvites, 0)
  })
})

describe('filter, search and sort', () => {
  const dir = buildDirectory(
    [
      staff('maria', { full_name: 'Maria Garcia', preferred_name: 'Mari', phone: '(512) 555-0142', department_id: 'hk', department_name: 'Housekeeping' }),
      staff('david', { full_name: 'David Lee', role: 'engineer', department_id: 'en', department_name: 'Engineering' }),
      staff('old', { full_name: 'Old Timer', status: 'inactive' }),
    ],
    [invite('sam', { full_name: 'Samantha Brown' }), invite('exp', { status: 'expired', full_name: 'Zed' })],
  )
  const f = (over = {}) => ({ ...DEFAULT_FILTERS, status: 'all' as const, ...over })
  const keys = (es: ReturnType<typeof filterDirectory>) => es.map((e) => e.key)

  it('defaults to active people', () => {
    assert.deepEqual(keys(filterDirectory(dir, DEFAULT_FILTERS, label)), ['staff:maria', 'staff:david'])
  })
  it('searches name, preferred name, email, department and role case-insensitively', () => {
    for (const q of ['GARCIA', 'mari', 'david@hotel', 'engineering', 'front desk']) {
      assert.ok(filterDirectory(dir, f({ q }), label).length >= 1, q)
    }
    assert.deepEqual(keys(filterDirectory(dir, f({ q: 'samantha' }), label)), ['invitation:sam'])
  })
  it('normalizes phone searches', () => {
    for (const q of ['5125550142', '512-555', '(512) 555-0142', '555 0142']) {
      assert.deepEqual(keys(filterDirectory(dir, f({ q }), label)), ['staff:maria'], q)
    }
  })
  it('combines filters', () => {
    assert.deepEqual(keys(filterDirectory(dir, f({ department: 'en', role: 'engineer' }), label)), ['staff:david'])
    assert.deepEqual(keys(filterDirectory(dir, f({ department: 'hk', role: 'engineer' }), label)), [])
    assert.deepEqual(keys(filterDirectory(dir, f({ status: 'deactivated' }), label)), ['staff:old'])
    assert.deepEqual(keys(filterDirectory(dir, f({ status: 'expired' }), label)), ['invitation:exp'])
    assert.deepEqual(keys(filterDirectory(dir, f({ department: UNASSIGNED_DEPARTMENT, status: 'invited' }), label)), ['invitation:sam'])
  })
  it('sorts deterministically with unassigned departments last', () => {
    const sorted = (sort: 'name' | 'department' | 'role' | 'status', d: 'asc' | 'desc' = 'asc') =>
      keys(sortDirectory(filterDirectory(dir, f(), label), { sort, dir: d }, label))
    assert.deepEqual(sorted('name'), ['staff:david', 'staff:maria', 'staff:old', 'invitation:sam', 'invitation:exp'].sort((a, b) => {
      const n = (k: string) => ({ 'staff:david': 'David Lee', 'staff:maria': 'Mari', 'staff:old': 'Old Timer', 'invitation:sam': 'Samantha Brown', 'invitation:exp': 'Zed' })[k] as string
      return n(a).localeCompare(n(b))
    }))
    assert.equal(sorted('name', 'desc')[0], 'invitation:exp')
    assert.deepEqual(sorted('department').slice(0, 2), ['staff:david', 'staff:maria'])
    assert.deepEqual(sorted('status'), ['staff:david', 'staff:maria', 'invitation:sam', 'invitation:exp', 'staff:old'])
    assert.deepEqual(sorted('status'), sorted('status'))
  })
})

describe('URL state', () => {
  it('round-trips and omits defaults', () => {
    assert.equal(encodeFilters(DEFAULT_FILTERS), '')
    const custom = {
      ...DEFAULT_FILTERS, q: 'ma', department: 'd1', role: 'engineer' as const, status: 'invited' as const,
      sort: 'role' as const, dir: 'desc' as const,
    }
    assert.deepEqual(decodeFilters(new URLSearchParams(encodeFilters(custom))), custom)
  })
  it('ignores invalid values', () => {
    assert.deepEqual(decodeFilters(new URLSearchParams('status=nope&role=king&sort=x&dir=up')), DEFAULT_FILTERS)
  })
})
