import type { CustomRole, RoleSchedule, StaffInvitation, StaffMember, UpdateStaffData, UpdateStaffProfileData } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import { ROLE_VALUES, type DirectoryEntry } from '@/lib/people/peopleDirectory'

/**
 * Pure rules behind the People drawers (profile, edit, access, coverage, onboarding, invitations).
 * Everything here mirrors a server rule for fast feedback only - the API re-validates every request.
 * Error values are i18n keys under `people.errors.field.*` / `people.coverage.errors.*`.
 */

// ── Drawer view state ───────────────────────────────────────────────────────

/** One drawer, several internal views: Directory -> Profile -> focused form -> Profile. */
export type DrawerView =
  | { view: 'profile'; key: string }
  | { view: 'editInvitation'; key: string }
  | { view: 'edit'; key: string }
  | { view: 'access'; key: string }
  | { view: 'coverage'; key: string }
  | { view: 'invitation'; key: string }
  | { view: 'invite' }
  | { view: 'create' }

/** Where "Back" goes from each focused form. */
export function backTarget(v: DrawerView): DrawerView | null {
  switch (v.view) {
    case 'edit':
    case 'access':
    case 'coverage':
      return { view: 'profile', key: v.key }
    case 'editInvitation':
      return { view: 'invitation', key: v.key }
    default:
      return null
  }
}

// ── Safe contact links ──────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@<>"',;:?&=()[\]\\]+@[^\s@<>"',;:?&=()[\]\\]+\.[^\s@<>"',;:?&=()[\]\\]{2,}$/

export function isValidEmail(email: string | null | undefined): boolean {
  const v = (email ?? '').trim()
  return v.length <= 254 && EMAIL_RE.test(v)
}

/** `mailto:` only for a clean address; anything odd yields no link rather than an injectable one. */
export function safeMailHref(email: string | null | undefined): string | null {
  const v = (email ?? '').trim()
  return isValidEmail(v) ? `mailto:${v}` : null
}

const phoneDigits = (s: string) => s.replace(/\D/g, '')

/** Free-form phone text: digits plus the usual separators, 7-15 digits (E.164 maximum). */
export function isValidPhone(phone: string | null | undefined): boolean {
  const v = (phone ?? '').trim()
  if (!v) return true // optional
  if (!/^\+?[\d\s().-]+$/.test(v)) return false
  const n = phoneDigits(v).length
  return n >= 7 && n <= 15
}

/** `tel:` only when there is a valid number; separators are stripped from the link target. */
export function safeTelHref(phone: string | null | undefined): string | null {
  const v = (phone ?? '').trim()
  if (!v || !isValidPhone(v)) return null
  return `tel:${v.startsWith('+') ? '+' : ''}${phoneDigits(v)}`
}

// ── Money ───────────────────────────────────────────────────────────────────

export const MAX_HOURLY_RATE = 500

/** '' -> null (clears the rate); otherwise a number in [0, 500] or `invalid`. */
export function parseHourlyRate(input: string): { ok: true; value: number | null } | { ok: false } {
  const v = input.trim()
  if (v === '') return { ok: true, value: null }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { ok: false }
  const n = Number(v)
  return n >= 0 && n <= MAX_HOURLY_RATE ? { ok: true, value: n } : { ok: false }
}

// ── Edit person ─────────────────────────────────────────────────────────────

export interface PersonEditValues {
  fullName: string
  preferredName: string
  phone: string
  departmentId: string // '' = unassigned
  hourlyRate: string
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>

export function personEditInitial(s: StaffMember): PersonEditValues {
  return {
    fullName: s.full_name ?? '',
    preferredName: s.preferred_name ?? '',
    phone: s.phone ?? '',
    departmentId: s.department_id ?? '',
    hourlyRate: s.hourly_rate != null ? String(s.hourly_rate) : '',
  }
}

export function validatePersonEdit(v: PersonEditValues, includeRate: boolean): FieldErrors<keyof PersonEditValues> {
  const errors: FieldErrors<keyof PersonEditValues> = {}
  if (v.fullName.trim().length < 2) errors.fullName = 'people.errors.field.fullName'
  if (v.fullName.trim().length > 120) errors.fullName = 'people.errors.field.tooLong'
  if (v.preferredName.trim().length > 120) errors.preferredName = 'people.errors.field.tooLong'
  if (!isValidPhone(v.phone)) errors.phone = 'people.errors.field.phone'
  if (includeRate && !parseHourlyRate(v.hourlyRate).ok) errors.hourlyRate = 'people.errors.field.hourlyRate'
  return errors
}

/** Only fields that actually changed are sent, so unrelated values are never overwritten. */
export function diffPersonEdit(
  original: StaffMember,
  next: PersonEditValues,
  includeRate: boolean,
): { profile: UpdateStaffProfileData; assignment: UpdateStaffData } {
  const o = personEditInitial(original)
  const profile: UpdateStaffProfileData = {}
  const assignment: UpdateStaffData = {}
  if (next.fullName.trim() !== o.fullName.trim()) profile.full_name = next.fullName.trim()
  if (next.preferredName.trim() !== o.preferredName.trim()) profile.preferred_name = next.preferredName.trim() || null
  if (next.phone.trim() !== o.phone.trim()) profile.phone = next.phone.trim() || null
  if (next.departmentId !== o.departmentId) assignment.department_id = next.departmentId || null
  if (includeRate && next.hourlyRate.trim() !== o.hourlyRate.trim()) {
    const parsed = parseHourlyRate(next.hourlyRate)
    if (parsed.ok) assignment.hourly_rate = parsed.value
  }
  return { profile, assignment }
}

export const hasChanges = (d: { profile: object; assignment: object }) =>
  Object.keys(d.profile).length > 0 || Object.keys(d.assignment).length > 0

// ── Onboarding ──────────────────────────────────────────────────────────────

export interface OnboardingValues {
  fullName: string
  preferredName: string
  email: string
  phone: string
  departmentId: string
  role: UserRole | ''
  customRoleId: string
  /** Manual creation only. */
  credential: 'generated' | 'chosen'
  password: string
}

export const EMPTY_ONBOARDING: OnboardingValues = {
  fullName: '', preferredName: '', email: '', phone: '', departmentId: '', role: '', customRoleId: '',
  credential: 'generated', password: '',
}

export function validateOnboarding(
  v: OnboardingValues, opts: { requireDepartment: boolean; manual: boolean },
): FieldErrors<keyof OnboardingValues> {
  const errors: FieldErrors<keyof OnboardingValues> = {}
  if (v.fullName.trim().length < 2) errors.fullName = 'people.errors.field.fullName'
  if (v.fullName.trim().length > 120) errors.fullName = 'people.errors.field.tooLong'
  if (!isValidEmail(v.email)) errors.email = 'people.errors.field.email'
  if (!isValidPhone(v.phone)) errors.phone = 'people.errors.field.phone'
  if (!v.role || !ROLE_VALUES.includes(v.role)) errors.role = 'people.errors.field.role'
  if (opts.requireDepartment && !v.departmentId) errors.departmentId = 'people.errors.field.department'
  if (opts.manual && v.credential === 'chosen' && v.password.length < 8) errors.password = 'people.errors.field.password'
  return errors
}

// ── Access ──────────────────────────────────────────────────────────────────

/** Custom access policies that can sit on this base role (the server enforces the same match). */
export function compatibleCustomRoles(roles: CustomRole[], role: UserRole): CustomRole[] {
  // The Roles screen saves chief-engineer policies against the engineer base role; the API accepts the same pairing.
  return roles.filter((r) => r.base_role === role || (role === 'chief_engineer' && r.base_role === 'engineer'))
}

/** After a role change, keep the custom policy only if it still fits - otherwise it is cleared. */
export function customRoleAfterRoleChange(roles: CustomRole[], role: UserRole, currentId: string | null): string | null {
  if (!currentId) return null
  return compatibleCustomRoles(roles, role).some((r) => r.id === currentId) ? currentId : null
}

export function buildAccessUpdate(
  original: Pick<StaffMember, 'role' | 'custom_role_id'>,
  next: { role: UserRole; customRoleId: string | null },
): UpdateStaffData {
  const update: UpdateStaffData = {}
  if (next.role !== original.role) update.role = next.role
  if (next.customRoleId !== (original.custom_role_id ?? null)) update.custom_role_id = next.customRoleId
  // A role change must always state the custom policy explicitly so the server can check they still match.
  if (update.role && !('custom_role_id' in update) && original.custom_role_id) update.custom_role_id = next.customRoleId
  return update
}

export function isLastActiveGm(staff: StaffMember[], userId: string): boolean {
  const gms = staff.filter((s) => s.status === 'active' && s.role === 'gm')
  return gms.length === 1 && gms[0].user_id === userId
}

export interface AccessGuards {
  /** Role cannot change away from GM (own access, or the hotel's last GM). */
  roleLocked: boolean
  reason: 'self' | 'lastGm' | null
}

export function accessGuards(staff: StaffMember[], target: StaffMember, selfUserId: string | null): AccessGuards {
  if (target.role === 'gm' && target.status === 'active') {
    if (target.user_id === selfUserId) return { roleLocked: true, reason: 'self' }
    if (isLastActiveGm(staff, target.user_id)) return { roleLocked: true, reason: 'lastGm' }
  }
  return { roleLocked: false, reason: null }
}

// ── Temporary coverage ──────────────────────────────────────────────────────

/** base role -> roles it may cover. Mirrors the API's COVERAGE_TRANSITIONS; the server is authoritative. */
export const COVERAGE_TRANSITIONS: Partial<Record<UserRole, Array<'housekeeping_supervisor' | 'engineer'>>> = {
  housekeeper: ['housekeeping_supervisor'],
}

export const coverageRolesFor = (role: UserRole) => COVERAGE_TRANSITIONS[role] ?? []

export type CoverageStatus = 'current' | 'upcoming' | 'expired'

/** Derived only from real dates in the hotel's calendar; null `today` means unknown, never guessed. */
export function coverageStatus(s: Pick<RoleSchedule, 'start_date' | 'end_date'>, today: string | null): CoverageStatus | null {
  if (!today) return null
  if (s.end_date && s.end_date < today) return 'expired'
  if (s.start_date && s.start_date > today) return 'upcoming'
  return 'current'
}

/** 0=Sunday .. 6=Saturday for a YYYY-MM-DD calendar date (timezone-free). */
export function weekdayOf(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
}

export interface CoverageDraft {
  role: string
  days: number[]
  start: string
  end: string
}

const rangesOverlap = (aS: string | null, aE: string | null, bS: string | null, bE: string | null) =>
  (aE === null || bS === null || bS <= aE) && (bE === null || aS === null || aS <= bE)

export function validateCoverage(
  d: CoverageDraft, baseRole: UserRole, existing: RoleSchedule[], today: string | null,
): FieldErrors<'role' | 'days' | 'end' | 'overlap'> {
  const errors: FieldErrors<'role' | 'days' | 'end' | 'overlap'> = {}
  if (!d.role) errors.role = 'people.coverage.errors.role'
  else if (d.role === baseRole) errors.role = 'people.coverage.errors.self'
  else if (!(coverageRolesFor(baseRole) as string[]).includes(d.role)) errors.role = 'people.coverage.errors.transition'
  if (d.days.length === 0) errors.days = 'people.coverage.errors.days'
  if (!d.end) errors.end = 'people.coverage.errors.endRequired'
  else if (d.start && d.start > d.end) errors.end = 'people.coverage.errors.order'
  else if (today && d.end < today) errors.end = 'people.coverage.errors.past'
  if (!errors.days) {
    const clash = existing.some(
      (o) => o.days_of_week.some((x) => d.days.includes(x)) &&
        rangesOverlap(d.start || null, d.end || null, o.start_date ?? null, o.end_date ?? null),
    )
    if (clash) errors.overlap = 'people.coverage.errors.overlap'
  }
  return errors
}

/** The coverage rule (if any) that changes today's effective role, per the same date + weekday rule the API uses. */
export function activeCoverageToday(schedules: RoleSchedule[], today: string | null): RoleSchedule | null {
  const wd = today ? weekdayOf(today) : null
  if (!today || wd === null) return null
  return schedules.find((s) => coverageStatus(s, today) === 'current' && s.days_of_week.includes(wd)) ?? null
}

// ── Row / profile actions ───────────────────────────────────────────────────

export type PersonAction =
  | 'profile' | 'edit' | 'access' | 'schedule' | 'deactivate' | 'reactivate'
  | 'invitation' | 'resend' | 'editInvitation' | 'reissue' | 'revoke'

/** Menu content per record type. Nothing is listed unless it really works for that record. */
export function actionsFor(
  entry: DirectoryEntry, ctx: { selfUserId: string | null; staff: StaffMember[] },
): PersonAction[] {
  if (entry.kind === 'staff') {
    if (entry.status !== 'active') return ['profile', 'reactivate']
    const s = entry.staff
    const blocked = s.user_id === ctx.selfUserId || isLastActiveGm(ctx.staff, s.user_id)
    return ['profile', 'edit', 'access', 'schedule', ...(blocked ? [] : (['deactivate'] as const))]
  }
  return entry.status === 'expired'
    ? ['invitation', 'reissue', 'revoke']
    : ['invitation', 'resend', 'editInvitation', 'revoke']
}

export function invitationIsOpen(inv: Pick<StaffInvitation, 'status'>): boolean {
  return inv.status === 'pending' || inv.status === 'expired'
}

/** Deep link to the existing Team Report employee drawer; the Reports page re-checks access itself. */
export function teamReportHref(userId: string): string | null {
  return /^[A-Za-z0-9-]{1,64}$/.test(userId) ? `/reports?d=employee&eid=${encodeURIComponent(userId)}` : null
}

// ── Display helpers ─────────────────────────────────────────────────────────

/** YYYY-MM-DD rendered as a calendar date, never shifted by the viewer's timezone. */
export function formatCalendarDate(date: string | null | undefined, locale: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

/** Weekday names for 0=Sunday..6=Saturday in the UI language (2023-01-01 was a Sunday). */
export function weekdayNames(locale: string, style: 'short' | 'long' = 'short'): string[] {
  const f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: style })
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i))))
}

export function formatDays(days: number[], locale: string): string {
  const names = weekdayNames(locale)
  return [...days].sort((a, b) => a - b).map((d) => names[d]).join(' · ')
}

/** A full timestamp (invitation created / expires / accepted) in the viewer's locale. */
export function formatTimestamp(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}
