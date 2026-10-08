/**
 * Pure helpers for the Accessibility tab. The data model is `accessible_room_features`:
 * `feature_code` is free text (unique per room), `operational_status` is a 3-value enum,
 * and `description` / `guidance` are optional notes. Nothing here implies ADA compliance.
 */
import type { AccessibleRoomFeature } from '@/lib/api/guest_requests'
import { ALL } from '@/lib/settings/rooms'

export type FeatureStatus = AccessibleRoomFeature['operational_status']

export const FEATURE_STATUS_OPTIONS: { value: FeatureStatus; label: string; tone: 'ready' | 'alert' | 'caution' }[] = [
  { value: 'operational', label: 'Operational', tone: 'ready' },
  { value: 'inspection_due', label: 'Inspection due', tone: 'caution' },
  { value: 'out_of_service', label: 'Out of service', tone: 'alert' },
]

export function featureStatusMeta(status: string) {
  return FEATURE_STATUS_OPTIONS.find((o) => o.value === status) ?? { value: status, label: status, tone: 'caution' as const }
}

/** Suggestions only — the backend accepts any code, so existing/custom codes always work. */
export const FEATURE_SUGGESTIONS = [
  'roll_in_shower', 'grab_bars', 'hearing_accessible', 'mobility_accessible', 'visual_alarm', 'lowered_fixtures',
] as const

export function featureLabel(code: string): string {
  const text = code.replace(/[_-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : code
}

/** "Roll-in shower" → "roll_in_shower" (matches how existing codes are stored). */
export function normalizeFeatureCode(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export interface FeatureFormValues {
  roomId: string
  featureCode: string
  status: FeatureStatus
  description: string
  guidance: string
}

export type FeatureFormErrors = Partial<Record<keyof FeatureFormValues, string>>

export const EMPTY_FEATURE_FORM: FeatureFormValues = {
  roomId: '', featureCode: '', status: 'operational', description: '', guidance: '',
}

export function featureToForm(f: AccessibleRoomFeature): FeatureFormValues {
  return {
    roomId: f.room_id,
    featureCode: f.feature_code,
    status: f.operational_status,
    description: f.description ?? '',
    guidance: f.guidance ?? '',
  }
}

/**
 * The API upserts on (room, feature_code), so saving a "new" feature that already exists would
 * silently overwrite it. Creating therefore refuses duplicates and points the user at Edit.
 */
export function validateFeatureForm(
  values: FeatureFormValues,
  existing: Pick<AccessibleRoomFeature, 'id' | 'room_id' | 'feature_code'>[],
  editingId?: string,
): FeatureFormErrors {
  const errors: FeatureFormErrors = {}
  if (!values.roomId) errors.roomId = 'Choose a room.'
  const code = normalizeFeatureCode(values.featureCode)
  if (!code) errors.featureCode = 'Enter a feature type.'
  else if (code.length > 60) errors.featureCode = 'Feature type is too long.'
  else if (!editingId && existing.some((f) => f.room_id === values.roomId && f.feature_code === code)) {
    errors.featureCode = 'This room already has that feature. Edit the existing entry instead.'
  }
  if (values.description.length > 500) errors.description = 'Description can be at most 500 characters.'
  if (values.guidance.length > 1000) errors.guidance = 'Staff notes can be at most 1000 characters.'
  return errors
}

export function featureFormChanged(a: FeatureFormValues, b: FeatureFormValues): boolean {
  return (
    a.roomId !== b.roomId ||
    normalizeFeatureCode(a.featureCode) !== normalizeFeatureCode(b.featureCode) ||
    a.status !== b.status ||
    a.description.trim() !== b.description.trim() ||
    a.guidance.trim() !== b.guidance.trim()
  )
}

export function toFeaturePayload(values: FeatureFormValues) {
  return {
    room_id: values.roomId,
    feature_code: normalizeFeatureCode(values.featureCode),
    operational_status: values.status,
    description: values.description.trim() || undefined,
    guidance: values.guidance.trim() || undefined,
  }
}

export interface FeatureFilters { q: string; room: string; feature: string; status: string }
export const EMPTY_FEATURE_FILTERS: FeatureFilters = { q: '', room: ALL, feature: ALL, status: ALL }

export function filterFeatures(features: AccessibleRoomFeature[], f: FeatureFilters): AccessibleRoomFeature[] {
  const q = f.q.trim().toLowerCase()
  return features
    .filter((x) => {
      if (f.room !== ALL && x.room_id !== f.room) return false
      if (f.feature !== ALL && x.feature_code !== f.feature) return false
      if (f.status !== ALL && x.operational_status !== f.status) return false
      if (q) {
        const hay = [x.rooms?.room_number, x.feature_code, featureLabel(x.feature_code), x.description, x.guidance]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    .sort((a, b) =>
      (a.rooms?.room_number ?? '').localeCompare(b.rooms?.room_number ?? '', undefined, { numeric: true }) ||
      a.feature_code.localeCompare(b.feature_code))
}

export function featureCountsByRoom(features: Pick<AccessibleRoomFeature, 'room_id'>[]): Map<string, number> {
  const counts = new Map<string, number>()
  features.forEach((f) => counts.set(f.room_id, (counts.get(f.room_id) ?? 0) + 1))
  return counts
}
