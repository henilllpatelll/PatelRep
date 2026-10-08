import type { StaffInvitation, StaffMember } from '@/lib/api/staff'
import type { ShiftAssignment } from '@/lib/api/scheduling'
import type { UserRole } from '@/stores/authStore'

/**
 * Pure view-model for the People directory. Staff accounts and invitations stay separate
 * records in the database; this merges them for display and keeps their identities distinct
 * (`staff:<user_id>` vs `invitation:<invitation_id>`).
 */

export type DirectoryStatus = 'active' | 'invited' | 'expired' | 'deactivated'
export type DirectoryKind = 'staff' | 'invitation'

export const STATUS_ORDER: DirectoryStatus[] = ['active', 'invited', 'expired', 'deactivated']
export const ROLE_VALUES: UserRole[] = [
  'gm', 'housekeeping_supervisor', 'housekeeper', 'chief_engineer', 'engineer', 'front_desk',
]
export const UNASSIGNED_DEPARTMENT = '__none__'

interface BaseEntry {
  key: string
  name: string
  email: string
  phone: string | null
  avatarUrl: string | null
  departmentId: string | null
  departmentName: string | null
  role: UserRole
  customRoleName: string | null
  status: DirectoryStatus
}
export interface StaffEntry extends BaseEntry { kind: 'staff'; staff: StaffMember }
export interface InvitationEntry extends BaseEntry { kind: 'invitation'; invitation: StaffInvitation }
export type DirectoryEntry = StaffEntry | InvitationEntry

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export function buildDirectory(
  staff: StaffMember[],
  invitations: StaffInvitation[],
  departmentNames: Record<string, string> = {},
): DirectoryEntry[] {
  const entries: DirectoryEntry[] = []
  const staffEmails = new Set<string>()
  for (const s of staff) {
    if (s.email) staffEmails.add(norm(s.email))
    entries.push({
      kind: 'staff',
      key: `staff:${s.user_id}`,
      staff: s,
      name: (s.preferred_name?.trim() || s.full_name || '').trim(),
      email: s.email ?? '',
      phone: s.phone ?? null,
      avatarUrl: s.avatar_url ?? null,
      departmentId: s.department_id ?? null,
      departmentName: s.department_name ?? (s.department_id ? departmentNames[s.department_id] ?? null : null),
      role: s.role,
      customRoleName: s.custom_role_name ?? null,
      status: s.status === 'active' ? 'active' : 'deactivated',
    })
  }
  for (const inv of invitations) {
    // Only open invitations are shown; an email that already has an account is not "invited".
    if (inv.status !== 'pending' && inv.status !== 'expired') continue
    if (staffEmails.has(norm(inv.email))) continue
    entries.push({
      kind: 'invitation',
      key: `invitation:${inv.id}`,
      invitation: inv,
      name: inv.full_name?.trim() ?? '',
      email: inv.email,
      phone: inv.phone ?? null,
      avatarUrl: null,
      departmentId: inv.department_id ?? null,
      departmentName: inv.department_name ?? (inv.department_id ? departmentNames[inv.department_id] ?? null : null),
      role: inv.role,
      customRoleName: null,
      status: inv.status === 'expired' ? 'expired' : 'invited',
    })
  }
  return entries
}

// ── Today ───────────────────────────────────────────────────────────────────

export type TodayState =
  | { kind: 'clocked_in'; start: string | null; end: string | null; shiftName: string | null }
  | { kind: 'scheduled'; start: string | null; end: string | null; shiftName: string | null }
  | { kind: 'finished'; start: string | null; end: string | null; shiftName: string | null }
  | { kind: 'not_scheduled' }

const RANK: Record<string, number> = { clocked_in: 3, scheduled: 2, finished: 1 }

/** One entry per user_id from the day's assignment rows. Clock-in beats scheduled beats finished. */
export function buildTodayMap(assignments: ShiftAssignment[]): Map<string, TodayState> {
  const map = new Map<string, TodayState>()
  for (const a of assignments) {
    const kind = a.clocked_in_at && !a.clocked_out_at ? 'clocked_in' : a.clocked_out_at ? 'finished' : 'scheduled'
    const state: Exclude<TodayState, { kind: 'not_scheduled' }> = {
      kind, start: a.shifts?.start_time ?? null, end: a.shifts?.end_time ?? null, shiftName: a.shifts?.name ?? null,
    }
    const prev = map.get(a.user_id)
    const prevStart = prev && prev.kind !== 'not_scheduled' ? prev.start ?? '' : ''
    const better = !prev || prev.kind === 'not_scheduled' || RANK[kind] > RANK[prev.kind] ||
      (RANK[kind] === RANK[prev.kind] && (state.start ?? '') < prevStart)
    if (better) map.set(a.user_id, state)
  }
  return map
}

/** "07:00:00" -> "7 AM", "15:30:00" -> "3:30 PM". Wall-clock hotel time; no zone conversion. */
export function formatClock(time: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '')
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, '0')} ${suffix}`
}

export function formatShiftRange(start: string | null, end: string | null): string | null {
  const a = formatClock(start)
  const b = formatClock(end)
  if (a && b) return `${a}–${b}`
  return a ?? b
}

/** Calendar date (YYYY-MM-DD) in the hotel's timezone; null when the zone is missing/invalid. */
export function hotelToday(timezone: string | null | undefined, now: Date = new Date()): string | null {
  if (!timezone) return null
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)
  } catch {
    return null
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface DirectorySummary {
  active: number | null
  scheduledToday: number | null
  clockedIn: number | null
  pendingInvites: number | null
}

/** A null count means "unknown" (its source failed or has not loaded) - never rendered as 0. */
export function summarize(
  staff: StaffMember[] | undefined,
  invitations: StaffInvitation[] | undefined,
  today: Map<string, TodayState> | undefined,
): DirectorySummary {
  const activeIds = staff ? new Set(staff.filter((s) => s.status === 'active').map((s) => s.user_id)) : null
  let scheduled: number | null = null
  let clockedIn: number | null = null
  if (activeIds && today) {
    scheduled = 0
    clockedIn = 0
    for (const [userId, state] of today) {
      if (!activeIds.has(userId) || state.kind === 'not_scheduled') continue
      scheduled++
      if (state.kind === 'clocked_in') clockedIn++
    }
  }
  const staffEmails = new Set((staff ?? []).map((s) => norm(s.email)))
  return {
    active: activeIds ? activeIds.size : null,
    scheduledToday: scheduled,
    clockedIn,
    pendingInvites: invitations
      ? invitations.filter((i) => i.status === 'pending' && !staffEmails.has(norm(i.email))).length
      : null,
  }
}

// ── Filter / search / sort ──────────────────────────────────────────────────

export type SortKey = 'name' | 'department' | 'role' | 'status'
export type SortDir = 'asc' | 'desc'

export interface DirectoryFilters {
  q: string
  department: string // '' = all, UNASSIGNED_DEPARTMENT, or a department id
  role: UserRole | ''
  status: DirectoryStatus | 'all'
  sort: SortKey
  dir: SortDir
}

export const DEFAULT_FILTERS: DirectoryFilters = {
  q: '', department: '', role: '', status: 'active', sort: 'name', dir: 'asc',
}

const digits = (s: string) => s.replace(/\D/g, '')

export function matchesSearch(entry: DirectoryEntry, query: string, roleLabel: string): boolean {
  const q = norm(query)
  if (!q) return true
  const text = [
    entry.name, entry.email, entry.phone ?? '', entry.departmentName ?? '',
    roleLabel, entry.customRoleName ?? '',
  ].map(norm)
  if (entry.kind === 'staff') text.push(norm(entry.staff.full_name), norm(entry.staff.preferred_name))
  if (text.some((t) => t.includes(q))) return true
  const qd = digits(q)
  return qd.length >= 3 && digits(entry.phone ?? '').includes(qd)
}

export function filterDirectory(
  entries: DirectoryEntry[], f: DirectoryFilters, roleLabel: (r: UserRole) => string,
): DirectoryEntry[] {
  return entries.filter((e) => {
    if (f.status !== 'all' && e.status !== f.status) return false
    if (f.role && e.role !== f.role) return false
    if (f.department === UNASSIGNED_DEPARTMENT) {
      if (e.departmentId) return false
    } else if (f.department && e.departmentId !== f.department) return false
    return matchesSearch(e, f.q, roleLabel(e.role))
  })
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function sortDirectory(
  entries: DirectoryEntry[], f: Pick<DirectoryFilters, 'sort' | 'dir'>, roleLabel: (r: UserRole) => string,
): DirectoryEntry[] {
  const nameOf = (e: DirectoryEntry) => e.name || e.email
  const primary = (e: DirectoryEntry): string | number => {
    switch (f.sort) {
      case 'department': return e.departmentName ?? '￿' // unassigned last
      case 'role': return roleLabel(e.role)
      case 'status': return STATUS_ORDER.indexOf(e.status)
      default: return nameOf(e)
    }
  }
  const sign = f.dir === 'desc' ? -1 : 1
  return [...entries].sort((a, b) => {
    const pa = primary(a)
    const pb = primary(b)
    const c = typeof pa === 'number' && typeof pb === 'number' ? pa - pb : collator.compare(String(pa), String(pb))
    if (c !== 0) return c * sign
    return collator.compare(nameOf(a), nameOf(b)) || collator.compare(a.key, b.key)
  })
}

// ── URL state ───────────────────────────────────────────────────────────────

const SORT_KEYS: SortKey[] = ['name', 'department', 'role', 'status']

export function decodeFilters(params: URLSearchParams): DirectoryFilters {
  const status = params.get('status') as DirectoryFilters['status'] | null
  const role = params.get('role') as UserRole | null
  const sort = params.get('sort') as SortKey | null
  return {
    q: params.get('q') ?? '',
    department: params.get('dept') ?? '',
    role: role && ROLE_VALUES.includes(role) ? role : '',
    status: status && (status === 'all' || STATUS_ORDER.includes(status)) ? status : DEFAULT_FILTERS.status,
    sort: sort && SORT_KEYS.includes(sort) ? sort : 'name',
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** Defaults are omitted so the default view has a clean URL. */
export function encodeFilters(f: DirectoryFilters): string {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.department) p.set('dept', f.department)
  if (f.role) p.set('role', f.role)
  if (f.status !== DEFAULT_FILTERS.status) p.set('status', f.status)
  if (f.sort !== 'name') p.set('sort', f.sort)
  if (f.dir !== 'asc') p.set('dir', f.dir)
  return p.toString()
}

export function hasActiveFilters(f: DirectoryFilters): boolean {
  return !!(f.q.trim() || f.department || f.role || f.status !== DEFAULT_FILTERS.status)
}
