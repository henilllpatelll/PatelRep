'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { guestRequestsApi, type AccessibleRoomFeature } from '@/lib/api/guest_requests'
import {
  EMPTY_FEATURE_FORM, FEATURE_STATUS_OPTIONS, FEATURE_SUGGESTIONS, featureFormChanged, featureLabel, featureToForm,
  toFeaturePayload, validateFeatureForm, type FeatureFormErrors, type FeatureFormValues,
} from '@/lib/settings/accessibility'
import type { RoomRow } from '@/lib/settings/rooms'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import {
  SettingsField, SettingsSelect, SettingsTextInput, SettingsTextarea, controlA11y,
} from '@/components/settings/workspace/SettingsFormControls'
import { errorMessage, useInvalidateRooms } from './useRoomsData'

export function AccessibilityFeatureDrawer({ feature, rooms, features, onClose, onSaved }: {
  /** Present when editing an existing record. */
  feature?: AccessibleRoomFeature
  rooms: RoomRow[]
  features: AccessibleRoomFeature[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const invalidate = useInvalidateRooms()
  const editing = !!feature
  const initial = useMemo<FeatureFormValues>(() => (feature ? featureToForm(feature) : EMPTY_FEATURE_FORM), [feature])
  const [values, setValues] = useState<FeatureFormValues>(initial)
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = featureFormChanged(values, initial)
  const errors: FeatureFormErrors = useMemo(() => validateFeatureForm(values, features, feature?.id), [values, features, feature?.id])
  const shown = attempted ? errors : {}
  const set = <K extends keyof FeatureFormValues>(key: K) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value as FeatureFormValues[K] }))
    setServerError(null)
  }

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })),
    [rooms],
  )
  const suggestions = useMemo(
    () => Array.from(new Set([...features.map((f) => f.feature_code), ...FEATURE_SUGGESTIONS])).sort(),
    [features],
  )

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (saving) return
    setAttempted(true)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setServerError(null)
    try {
      await guestRequestsApi.upsertAccessibleRoomFeature(toFeaturePayload(values))
      toast.success(editing ? 'Accessibility feature saved.' : 'Accessibility feature added.')
      await invalidate()
      onSaved()
    } catch (err) {
      setServerError(errorMessage(err, 'Could not save the feature. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsDrawer
      title={editing ? 'Edit accessibility feature' : 'Add accessibility feature'}
      description={editing ? `${featureLabel(feature!.feature_code)} · Room ${feature!.rooms?.room_number ?? ''}` : 'Record an accessible feature for a room.'}
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-end gap-3 px-4 py-3 sm:px-5">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="feature-form" loading={saving} disabled={editing && !dirty}>Save feature</Button>
        </div>
      )}
    >
      <form id="feature-form" onSubmit={submit} noValidate className="space-y-4">
        {serverError && (
          <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{serverError}</p>
        )}
        <SettingsField id="feature-room" label="Room" required error={shown.roomId} hint={editing ? 'The room and feature type identify this record and can’t be changed. To record another feature, add a new one.' : undefined}>
          <SettingsSelect {...controlA11y('feature-room', { error: shown.roomId, hint: editing, required: true })} value={values.roomId} onChange={set('roomId')} disabled={editing}>
            <option value="">Select a room…</option>
            {sortedRooms.map((r) => <option key={r.id} value={r.id}>Room {r.roomNumber}</option>)}
          </SettingsSelect>
        </SettingsField>

        <SettingsField id="feature-code" label="Feature type" required error={shown.featureCode} hint={editing ? undefined : 'Pick a suggestion or type your own, e.g. roll-in shower.'}>
          <SettingsTextInput {...controlA11y('feature-code', { error: shown.featureCode, hint: !editing, required: true })} value={values.featureCode} onChange={set('featureCode')} list="feature-code-options" disabled={editing} maxLength={60} autoComplete="off" />
          <datalist id="feature-code-options">{suggestions.map((c) => <option key={c} value={c}>{featureLabel(c)}</option>)}</datalist>
        </SettingsField>

        <SettingsField id="feature-status" label="Operational condition" hint="Whether this feature can be used right now. Separate from the room’s housekeeping status.">
          <SettingsSelect {...controlA11y('feature-status', { hint: true })} value={values.status} onChange={set('status')}>
            {FEATURE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SettingsSelect>
        </SettingsField>

        <SettingsField id="feature-description" label="Description" error={shown.description} hint="Optional. What the feature is, e.g. “Roll-in shower with grab bars”.">
          <SettingsTextInput {...controlA11y('feature-description', { error: shown.description, hint: true })} value={values.description} onChange={set('description')} maxLength={500} />
        </SettingsField>

        <SettingsField id="feature-guidance" label="Staff notes" error={shown.guidance} hint="Optional. Shown to staff when matching a guest to this room.">
          <SettingsTextarea {...controlA11y('feature-guidance', { error: shown.guidance, hint: true })} value={values.guidance} onChange={set('guidance')} maxLength={1000} />
        </SettingsField>
      </form>
    </SettingsDrawer>
  )
}
