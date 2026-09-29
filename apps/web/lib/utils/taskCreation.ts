import type { GuestRequest, SlaPolicy } from '@/lib/api/guest_requests'
import type { CreateTaskScheduleData, Priority, TaskType } from '@/lib/api/tasks'
import type { StaffMember } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'

export type GuestRequestCategory = GuestRequest['category']
export type GuestRequestPriority = GuestRequest['priority']
export type GuestImpact = GuestRequest['guest_impact']
export type ContactPreference = NonNullable<GuestRequest['contact_preference']>

export const INTERNAL_TASK_TYPE_VALUES = ['housekeeping', 'engineering', 'lost_found', 'general'] as const satisfies readonly TaskType[]
export const INTERNAL_TASK_PRIORITY_VALUES = ['urgent', 'normal', 'low'] as const satisfies readonly Priority[]
export const GUEST_REQUEST_CATEGORY_VALUES = ['housekeeping', 'maintenance', 'service', 'accessibility', 'other'] as const satisfies readonly GuestRequestCategory[]
export const GUEST_REQUEST_PRIORITY_VALUES = ['urgent', 'normal'] as const satisfies readonly GuestRequestPriority[]
export const GUEST_IMPACT_VALUES = ['low', 'standard', 'high'] as const satisfies readonly GuestImpact[]
export const CONTACT_PREFERENCE_VALUES = ['none', 'sms', 'call', 'email', 'in_person'] as const satisfies readonly ContactPreference[]

export interface GuestRequestCreationValues {
  title: string
  description: string
  roomId: string
  guestName: string
  priority: GuestRequestPriority
  category: GuestRequestCategory
  guestImpact: GuestImpact
  contactPreference: ContactPreference
  contactConsent: boolean
  assignedTo: string
}

/** Builds the real guest-request domain payload without translating user selections. */
export function buildGuestRequestCreatePayload(values: GuestRequestCreationValues) {
  return {
    title: values.title.trim().slice(0, 120),
    description: values.description.trim() || undefined,
    room_id: values.roomId || undefined,
    guest_name: values.guestName.trim() || undefined,
    priority: values.priority,
    category: values.category,
    guest_impact: values.guestImpact,
    contact_preference: values.contactPreference === 'none' ? undefined : values.contactPreference,
    contact_consent: values.contactPreference !== 'none' ? values.contactConsent : undefined,
    assigned_to: values.assignedTo || undefined,
  }
}

/** Accessibility requests must be urgent (backend rejects any other priority) —
 * auto-correct instead of letting the user hit a 422 on submit. */
export function guestPriorityForCategory(category: GuestRequestCategory, currentPriority: GuestRequestPriority): GuestRequestPriority {
  return category === 'accessibility' ? 'urgent' : currentPriority
}

// ── SLA ──────────────────────────────────────────────────────────────────────
// Single frontend mirror of each domain's backend SLA source, so the create
// drawer's "due at" preview never drifts from what the server will actually set.

// Mirrors apps/api/routers/tasks.py SLA_MINUTES.
export const INTERNAL_SLA_MINUTES: Record<Priority, number> = { urgent: 60, normal: 240, low: 480 }

export function formatSlaDuration(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Mirrors apps/api/services/guest_recovery/contracts.py resolve_sla_minutes:
 * most-specific matching tenant policy wins, defaulting to 4 hours. */
export function resolveGuestRequestSlaMinutes(
  policies: Pick<SlaPolicy, 'category' | 'priority' | 'guest_impact' | 'sla_minutes'>[],
  values: { category: GuestRequestCategory; priority: GuestRequestPriority; guestImpact: GuestImpact },
): number {
  const candidates = policies.filter((policy) =>
    (policy.category === null || policy.category === undefined || policy.category === values.category) &&
    (policy.priority === null || policy.priority === undefined || policy.priority === values.priority) &&
    (policy.guest_impact === null || policy.guest_impact === undefined || policy.guest_impact === values.guestImpact),
  )
  if (candidates.length === 0) return 240
  const specificity = (p: typeof candidates[number]) => Number(p.category != null) + Number(p.priority != null) + Number(p.guest_impact != null)
  return [...candidates].sort((a, b) => specificity(b) - specificity(a))[0].sla_minutes
}

// ── Internal Task custom due date ────────────────────────────────────────────

export type DueDatePreset = 'sla_default' | '30m' | '1h' | '2h' | 'end_of_shift' | 'custom'
const DUE_DATE_PRESET_MINUTES: Partial<Record<DueDatePreset, number>> = { '30m': 30, '1h': 60, '2h': 120 }

/** Returns undefined for sla_default (let the backend apply its own default) or
 * when a preset can't be computed (e.g. end_of_shift with no real shift data —
 * never fabricate a time). */
export function computeInternalDueAt(
  preset: DueDatePreset,
  options: { now?: Date; endOfShiftAt?: Date | null; customIso?: string } = {},
): string | undefined {
  const now = options.now ?? new Date()
  if (preset === 'sla_default') return undefined
  if (preset === 'end_of_shift') return options.endOfShiftAt ? options.endOfShiftAt.toISOString() : undefined
  if (preset === 'custom') return options.customIso || undefined
  const minutes = DUE_DATE_PRESET_MINUTES[preset]
  return minutes ? new Date(now.getTime() + minutes * 60_000).toISOString() : undefined
}

/** Small time-math helper so components never call Date.now()/new Date() directly
 * in render (React purity) — the caller supplies "now" once via state/effect. */
export function minutesFromNowAt(minutes: number, now: Date): Date {
  return new Date(now.getTime() + minutes * 60_000)
}

export function isFutureDueAt(iso: string, now: Date = new Date()): boolean {
  const parsed = new Date(iso)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()
}

/** Combines today's (or the given) date with a shift's "HH:MM:SS" end_time,
 * rolling to the next day if that time has already passed — a shift ending at
 * 23:00 checked at 23:30 means "end of shift" is tomorrow 23:00, not the past. */
export function endOfShiftDate(endTime: string, now: Date = new Date()): Date {
  const [hours, minutes] = endTime.split(':').map(Number)
  const candidate = new Date(now)
  candidate.setHours(hours, minutes, 0, 0)
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

// ── Location ─────────────────────────────────────────────────────────────────

export type LocationType = 'room' | 'other'

// ── Recurrence (Internal Tasks only — see services/task_schedules.py) ───────

export type RecurrenceIntervalType = CreateTaskScheduleData['interval_type']
export type RecurrenceEndType = CreateTaskScheduleData['end_type']

export interface RecurrenceDraft {
  enabled: boolean
  intervalType: RecurrenceIntervalType
  intervalDays: string
  endType: RecurrenceEndType
  endCount: string
  endDate: string
}

export const DEFAULT_RECURRENCE_DRAFT: RecurrenceDraft = {
  enabled: false,
  intervalType: 'weekly',
  intervalDays: '',
  endType: 'never',
  endCount: '',
  endDate: '',
}

/** Returns an i18n key for the first invalid field, or null when the draft is submittable. */
export function validateRecurrenceDraft(draft: RecurrenceDraft, startDate: string): string | null {
  if (!draft.enabled) return null
  if (draft.intervalType === 'custom' && (!draft.intervalDays || Number(draft.intervalDays) < 1)) {
    return 'tasks.createModal.recurrence.errors.intervalDaysRequired'
  }
  if (draft.endType === 'count' && (!draft.endCount || Number(draft.endCount) < 1)) {
    return 'tasks.createModal.recurrence.errors.endCountRequired'
  }
  if (draft.endType === 'date') {
    if (!draft.endDate) return 'tasks.createModal.recurrence.errors.endDateRequired'
    if (draft.endDate < startDate) return 'tasks.createModal.recurrence.errors.endDateBeforeStart'
  }
  return null
}

export function buildTaskScheduleCreatePayload(
  draft: RecurrenceDraft,
  base: { title: string; description: string; taskType: Exclude<TaskType, 'guest_request'>; priority: Priority; roomId: string; locationText: string; assignedTo: string; startDate: string },
): CreateTaskScheduleData {
  return {
    title: base.title.trim().slice(0, 120),
    description: base.description.trim() || undefined,
    task_type: base.taskType,
    priority: base.priority,
    room_id: base.roomId || undefined,
    location_text: base.roomId ? undefined : base.locationText.trim() || undefined,
    assigned_to: base.assignedTo || undefined,
    interval_type: draft.intervalType,
    interval_days: draft.intervalType === 'custom' ? Number(draft.intervalDays) : undefined,
    start_date: base.startDate,
    end_type: draft.endType,
    end_count: draft.endType === 'count' ? Number(draft.endCount) : undefined,
    end_date: draft.endType === 'date' ? draft.endDate : undefined,
  }
}

// ── Assignee ordering (section 8) ────────────────────────────────────────────
// Preferred roles surface first (alphabetical among themselves), then every
// other allowed assignee alphabetically — never hides a valid candidate.

const PREFERRED_ROLES_FOR_TASK_TYPE: Record<Exclude<TaskType, 'guest_request'>, UserRole[]> = {
  housekeeping: ['housekeeper', 'housekeeping_supervisor'],
  engineering: ['engineer', 'chief_engineer'],
  lost_found: [],
  general: [],
}

const PREFERRED_ROLES_FOR_GUEST_CATEGORY: Record<GuestRequestCategory, UserRole[]> = {
  housekeeping: ['housekeeper', 'housekeeping_supervisor'],
  maintenance: ['engineer', 'chief_engineer'],
  service: ['front_desk', 'housekeeping_supervisor'],
  accessibility: [],
  other: [],
}

function sortByPreferredRoles(staff: StaffMember[], preferredRoles: UserRole[]): StaffMember[] {
  const rank = (member: StaffMember) => {
    const index = preferredRoles.indexOf(member.role)
    return index === -1 ? preferredRoles.length : index
  }
  return [...staff].sort((a, b) => rank(a) - rank(b) || a.full_name.localeCompare(b.full_name))
}

export function sortAssigneesForInternalType(staff: StaffMember[], taskType: Exclude<TaskType, 'guest_request'>): StaffMember[] {
  return sortByPreferredRoles(staff, PREFERRED_ROLES_FOR_TASK_TYPE[taskType])
}

export function sortAssigneesForGuestCategory(staff: StaffMember[], category: GuestRequestCategory): StaffMember[] {
  return sortByPreferredRoles(staff, PREFERRED_ROLES_FOR_GUEST_CATEGORY[category])
}
