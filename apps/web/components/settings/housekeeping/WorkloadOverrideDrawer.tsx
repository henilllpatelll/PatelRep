'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { errorMessage } from '@/lib/settings/apiErrors'
import { applyOverride, formatCredits, parseCredit, type OverrideRow } from '@/lib/settings/housekeepingConfig'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsField, SettingsTextInput, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { useSaveHousekeepingSettings } from './useHousekeepingSettings'

/**
 * One person's capacity. Unlike the page-level Save/Discard (target and weights), this saves immediately,
 * because it is its own focused action, and it sends only `capacity_overrides` built from the latest saved map.
 */
export function WorkloadOverrideDrawer({ row, hotelDefault, overrides, onClose }: {
  row: OverrideRow
  hotelDefault: number
  overrides: Record<string, number>
  onClose: () => void
}) {
  const toast = useToast()
  const save = useSaveHousekeepingSettings()
  const initialMode = row.override === null ? 'default' : 'custom'
  const [mode, setMode] = useState<'default' | 'custom'>(initialMode)
  const [text, setText] = useState(row.override === null ? '' : String(row.override))
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const parsed = useMemo(() => (mode === 'custom' ? parseCredit(text, 'override') : null), [mode, text])
  const fieldError = attempted && parsed && !parsed.ok ? parsed.error : undefined
  const dirty = mode !== initialMode || (mode === 'custom' && text.trim() !== (row.override === null ? '' : String(row.override)))

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (save.isPending) return
    setAttempted(true)
    if (parsed && !parsed.ok) return
    const value = parsed?.ok ? parsed.value : null
    const next = applyOverride(overrides, row.userId, value, hotelDefault)
    setServerError(null)
    try {
      await save.mutateAsync({ capacity_overrides: next })
      toast.success(value === null || value === hotelDefault ? `${row.name} now uses the hotel default.` : `${row.name}’s capacity saved.`)
      onClose()
    } catch (err) {
      setServerError(errorMessage(err, 'We couldn’t save this capacity. Please try again.'))
    }
  }

  return (
    <SettingsDrawer
      title="Edit Workload Capacity"
      description={row.name}
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-end gap-3 px-4 py-3 sm:px-5">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="workload-override-form" loading={save.isPending} disabled={!dirty}>Save Capacity</Button>
        </div>
      )}
    >
      <form id="workload-override-form" onSubmit={submit} noValidate className="space-y-5">
        {serverError && <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{serverError}</p>}

        <dl className="grid grid-cols-2 gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3 text-sm">
          <div><dt className="text-xs text-ink-3">Staff member</dt><dd className="mt-0.5 font-medium text-ink">{row.name}</dd></div>
          <div><dt className="text-xs text-ink-3">Hotel default</dt><dd className="mt-0.5 font-medium text-ink">{formatCredits(hotelDefault)} credits</dd></div>
          <div className="col-span-2"><dt className="text-xs text-ink-3">Current setting</dt><dd className="mt-0.5 font-medium text-ink">{row.override === null ? 'Hotel default (no override)' : `Custom: ${formatCredits(row.override)} credits`}</dd></div>
        </dl>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink-2">Capacity mode</legend>
          {([
            ['default', 'Use Hotel Default', `Plans up to ${formatCredits(hotelDefault)} credits a day, and follows the hotel default if it changes.`],
            ['custom', 'Custom Capacity', 'Set a different daily limit for this person.'],
          ] as const).map(([value, label, hint]) => (
            <label key={value} className="flex cursor-pointer items-start gap-3 rounded-[var(--r-md)] border border-line p-3 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
              <input type="radio" name="capacity-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setServerError(null) }} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
              <span><span className="block text-sm font-medium text-ink">{label}</span><span className="mt-0.5 block text-xs text-ink-3">{hint}</span></span>
            </label>
          ))}
        </fieldset>

        {mode === 'custom' && (
          <SettingsField id="override-credits" label="Daily Workload Credits" required error={fieldError} hint={`Above 0, up to 100. The hotel default is ${formatCredits(hotelDefault)}.`}>
            <SettingsTextInput {...controlA11y('override-credits', { error: fieldError, hint: true, required: true })} value={text} onChange={(e) => { setText(e.target.value); setServerError(null) }} inputMode="decimal" autoComplete="off" autoFocus />
          </SettingsField>
        )}
      </form>
    </SettingsDrawer>
  )
}
