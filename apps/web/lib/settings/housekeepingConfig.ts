/**
 * Pure logic for Settings > Housekeeping (cleaning checklists, workload, assignment preferences).
 * No React, no network: everything here is unit-tested in housekeepingConfig.test.ts.
 */
import type { AssignmentPreferences, HousekeepingSettings } from '@/lib/api/hotels'
import type { ChecklistItemInput, ChecklistTemplate } from '@/lib/api/checklists'

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export type HousekeepingTab = 'cleaning' | 'workload' | 'assignment'
export const HOUSEKEEPING_TABS: readonly { id: HousekeepingTab; label: string }[] = [
  { id: 'cleaning', label: 'Cleaning' },
  { id: 'workload', label: 'Workload' },
  { id: 'assignment', label: 'Assignment' },
]

export function parseHousekeepingTab(value: string | null | undefined): HousekeepingTab {
  return HOUSEKEEPING_TABS.find((tab) => tab.id === value)?.id ?? 'cleaning'
}

// ─── Cleaning checklists ──────────────────────────────────────────────────────

/** Identifiers are the backend `clean_type` values and must never change. */
export const CLEAN_TYPES = ['DEP', 'FULL', 'LIGHT', 'DEFAULT'] as const
export type CleanType = (typeof CLEAN_TYPES)[number]

export const CLEAN_TYPE_COPY: Record<CleanType, { tab: string; title: string; hint: string }> = {
  DEP: { tab: 'Departure', title: 'Departure Cleaning', hint: 'Used when a guest has checked out.' },
  FULL: { tab: 'Full Service', title: 'Full Service Cleaning', hint: 'Used for stayovers with a full linen change.' },
  LIGHT: { tab: 'Light Service', title: 'Light Service Cleaning', hint: 'Used for stayovers that only need a light refresh.' },
  DEFAULT: { tab: 'Default', title: 'Default Cleaning', hint: 'Used when no other cleaning type applies.' },
}

export const CHECKLIST_SECTIONS = ['Bedroom', 'Bathroom', 'General', 'Amenities', 'Closet', 'Kitchenette', 'Entrance'] as const

export interface ChecklistDraftItem {
  /** Local identity only (drag/reorder/edit). Never sent to the server. */
  key: string
  section: string
  label: string
  is_required: boolean
}

let counter = 0
export function newDraftKey(): string {
  counter += 1
  return `new-${counter}`
}

export function toDraftItems(items: ChecklistTemplate['items'] | undefined): ChecklistDraftItem[] {
  return [...(items ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({ key: item.id, section: item.section, label: item.label, is_required: item.is_required }))
}

export function draftsEqual(a: ChecklistDraftItem[], b: ChecklistDraftItem[]): boolean {
  return a.length === b.length && a.every((item, i) => (
    item.key === b[i].key && item.section === b[i].section && item.label === b[i].label && item.is_required === b[i].is_required
  ))
}

/** Index after the last item of `section`, or the end of the list when the section is new. */
function sectionInsertIndex(items: ChecklistDraftItem[], section: string): number {
  for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].section === section) return i + 1
  return items.length
}

/** New items join the end of their section so sections stay grouped. */
export function addDraftItem(items: ChecklistDraftItem[], item: Omit<ChecklistDraftItem, 'key'>): ChecklistDraftItem[] {
  const next = [...items]
  next.splice(sectionInsertIndex(items, item.section), 0, { ...item, key: newDraftKey() })
  return next
}

/** Edits an item in place. Changing its section moves it to the end of the new section's group. */
export function updateDraftItem(items: ChecklistDraftItem[], key: string, patch: Omit<ChecklistDraftItem, 'key'>): ChecklistDraftItem[] {
  const current = items.find((item) => item.key === key)
  if (!current) return items
  const updated = { ...current, ...patch }
  if (current.section === patch.section) return items.map((item) => (item.key === key ? updated : item))
  const without = items.filter((item) => item.key !== key)
  const next = [...without]
  next.splice(sectionInsertIndex(without, patch.section), 0, updated)
  return next
}

export function removeDraftItem(items: ChecklistDraftItem[], key: string): ChecklistDraftItem[] {
  return items.filter((item) => item.key !== key)
}

export function moveDraftItem(items: ChecklistDraftItem[], key: string, direction: 1 | -1): ChecklistDraftItem[] {
  const from = items.findIndex((item) => item.key === key)
  const to = from + direction
  if (from < 0 || to < 0 || to >= items.length) return items
  return reorderDraftItems(items, from, to)
}

export function reorderDraftItems(items: ChecklistDraftItem[], from: number, to: number): ChecklistDraftItem[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export interface ChecklistGroup { section: string; items: { item: ChecklistDraftItem; index: number }[] }

/** Consecutive items of the same section share a heading. The saved order stays authoritative. */
export function groupChecklist(items: ChecklistDraftItem[]): ChecklistGroup[] {
  const groups: ChecklistGroup[] = []
  items.forEach((item, index) => {
    const last = groups[groups.length - 1]
    if (last && last.section === item.section) last.items.push({ item, index })
    else groups.push({ section: item.section, items: [{ item, index }] })
  })
  return groups
}

export const CHECKLIST_LABEL_MAX = 200

export function validateChecklistItem(values: { section: string; label: string }): { section?: string; label?: string } {
  const errors: { section?: string; label?: string } = {}
  if (!values.section.trim()) errors.section = 'Choose a section.'
  const label = values.label.trim()
  if (!label) errors.label = 'Describe the task.'
  else if (label.length > CHECKLIST_LABEL_MAX) errors.label = `Keep the description under ${CHECKLIST_LABEL_MAX} characters.`
  return errors
}

/** Whole-checklist save payload: the backend replaces all items wholesale in this order. */
export function toChecklistPayload(items: ChecklistDraftItem[]): ChecklistItemInput[] {
  return items.map(({ section, label, is_required }) => ({ section, label: label.trim(), is_required }))
}

// ─── Workload ─────────────────────────────────────────────────────────────────

export const WEIGHT_TYPES = ['DEP', 'FULL', 'LIGHT'] as const
export type WeightType = (typeof WEIGHT_TYPES)[number]
export const WEIGHT_LABELS: Record<WeightType, string> = { DEP: 'Departure Cleaning', FULL: 'Full Service', LIGHT: 'Light Service' }

/** Mirrors UpdateHousekeepingSettingsRequest in apps/api/models/requests.py. */
export const TARGET_LIMITS = { min: 0, max: 100 } as const   // exclusive min
export const WEIGHT_LIMITS = { min: 0, max: 10 } as const    // inclusive
export const OVERRIDE_LIMITS = { min: 0, max: 100 } as const // exclusive min

export type ParsedCredit = { ok: true; value: number } | { ok: false; error: string }

export function parseCredit(text: string, kind: 'target' | 'weight' | 'override'): ParsedCredit {
  const raw = text.trim()
  if (!raw) return { ok: false, error: 'Enter a number.' }
  const value = Number(raw)
  if (!Number.isFinite(value)) return { ok: false, error: 'Enter a valid number.' }
  if (kind === 'weight') {
    if (value < WEIGHT_LIMITS.min || value > WEIGHT_LIMITS.max) return { ok: false, error: `Use a value from ${WEIGHT_LIMITS.min} to ${WEIGHT_LIMITS.max}.` }
  } else {
    const max = kind === 'target' ? TARGET_LIMITS.max : OVERRIDE_LIMITS.max
    if (value <= 0 || value > max) return { ok: false, error: `Use a value above 0, up to ${max}.` }
  }
  return { ok: true, value }
}

export interface WorkloadDraft {
  default_target_credits: string
  credit_weights: Record<WeightType, string>
}

export function toWorkloadDraft(settings: Pick<HousekeepingSettings, 'default_target_credits' | 'credit_weights'>): WorkloadDraft {
  return {
    default_target_credits: String(settings.default_target_credits),
    credit_weights: { DEP: String(settings.credit_weights.DEP), FULL: String(settings.credit_weights.FULL), LIGHT: String(settings.credit_weights.LIGHT) },
  }
}

export function workloadDirty(draft: WorkloadDraft, saved: Pick<HousekeepingSettings, 'default_target_credits' | 'credit_weights'>): boolean {
  const a = toWorkloadDraft(saved)
  return draft.default_target_credits.trim() !== a.default_target_credits
    || WEIGHT_TYPES.some((type) => draft.credit_weights[type].trim() !== a.credit_weights[type])
}

export interface WorkloadErrors { target?: string; weights: Partial<Record<WeightType, string>> }

export function validateWorkload(draft: WorkloadDraft): { errors: WorkloadErrors; valid: boolean } {
  const errors: WorkloadErrors = { weights: {} }
  const target = parseCredit(draft.default_target_credits, 'target')
  if (!target.ok) errors.target = target.error
  for (const type of WEIGHT_TYPES) {
    const weight = parseCredit(draft.credit_weights[type], 'weight')
    if (!weight.ok) errors.weights[type] = weight.error
  }
  return { errors, valid: !errors.target && Object.keys(errors.weights).length === 0 }
}

/** Only the workload fields: assignment preferences are never part of this save. */
export function toWorkloadPayload(draft: WorkloadDraft): Pick<HousekeepingSettings, 'default_target_credits' | 'credit_weights'> {
  const num = (text: string) => Number(text.trim())
  return {
    default_target_credits: num(draft.default_target_credits),
    credit_weights: { DEP: num(draft.credit_weights.DEP), FULL: num(draft.credit_weights.FULL), LIGHT: num(draft.credit_weights.LIGHT) },
  }
}

export function formatCredits(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

export interface OverrideRow { userId: string; name: string; override: number | null }

/** One row per housekeeper; `override` is null when the hotel default applies. */
export function buildOverrideRows(
  staff: { user_id: string; full_name: string }[],
  overrides: Record<string, number>,
): OverrideRow[] {
  return staff
    .map((member) => ({ userId: member.user_id, name: member.full_name, override: typeof overrides[member.user_id] === 'number' ? overrides[member.user_id] : null }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function filterOverrideRows(rows: OverrideRow[], query: string): OverrideRow[] {
  const q = query.trim().toLowerCase()
  return q ? rows.filter((row) => row.name.toLowerCase().includes(q)) : rows
}

/**
 * Next overrides map after editing one person. `null` (or a value equal to the hotel default) removes the
 * override so the default keeps applying; every other person's override is untouched.
 */
export function applyOverride(
  overrides: Record<string, number>,
  userId: string,
  value: number | null,
  hotelDefault: number,
): Record<string, number> {
  const next = { ...overrides }
  if (value === null || value === hotelDefault) delete next[userId]
  else next[userId] = value
  return next
}

// ─── Assignment preferences ───────────────────────────────────────────────────

export type AssignmentKey = keyof AssignmentPreferences

export const ASSIGNMENT_GROUPS: { id: 'priority' | 'workload' | 'availability' | 'location'; title: string; items: AssignmentKey[] }[] = [
  { id: 'priority', title: 'Priority', items: ['prioritize_guest_waiting', 'prioritize_rush', 'prioritize_earliest_arrival'] },
  { id: 'workload', title: 'Workload', items: ['balance_workload', 'minimize_reassignment'] },
  { id: 'availability', title: 'Availability', items: ['avoid_on_break', 'exclude_off_shift', 'exclude_unavailable'] },
  { id: 'location', title: 'Location', items: ['prefer_same_building', 'prefer_same_floor'] },
]

/** Wording matches what Auto-balance actually does today; see services/housekeeping assignment rules. */
export const ASSIGNMENT_COPY: Record<AssignmentKey, { label: string; description: string }> = {
  prioritize_guest_waiting: { label: 'Guest waiting', description: 'Put guest-waiting rooms ahead of routine cleaning.' },
  prioritize_rush: { label: 'Rush rooms', description: 'Put manually rushed rooms ahead of routine cleaning.' },
  prioritize_earliest_arrival: { label: 'Earliest arrivals', description: 'Prefer rooms with the earliest upcoming arrival.' },
  balance_workload: { label: 'Balance workload across attendants', description: 'Use the configured workload credits to distribute new work.' },
  minimize_reassignment: { label: 'Minimize unnecessary reassignment', description: 'Keep acceptable existing room assignments in place.' },
  avoid_on_break: { label: 'Avoid staff on break', description: 'Keep new Auto-balance work off attendants on an active break.' },
  exclude_off_shift: { label: 'Exclude off-shift staff', description: 'Do not propose new work for attendants whose shift has ended.' },
  exclude_unavailable: { label: 'Exclude unavailable staff', description: 'Do not propose new work for attendants who are not scheduled or available.' },
  prefer_same_building: { label: 'Prefer same building', description: 'Reduce building changes when the room layout includes building data.' },
  prefer_same_floor: { label: 'Prefer same floor', description: 'Reduce floor changes when the room layout includes floor data.' },
}

export const ASSIGNMENT_KEYS: AssignmentKey[] = ASSIGNMENT_GROUPS.flatMap((group) => group.items)

export function assignmentDirty(draft: AssignmentPreferences, saved: AssignmentPreferences): boolean {
  return ASSIGNMENT_KEYS.some((key) => draft[key] !== saved[key])
}
