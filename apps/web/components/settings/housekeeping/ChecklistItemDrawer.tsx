'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { CHECKLIST_LABEL_MAX, CHECKLIST_SECTIONS, validateChecklistItem } from '@/lib/settings/housekeepingConfig'
import { Button } from '@/components/ui/Button'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsField, SettingsSelect, SettingsTextarea, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { SettingsSwitch } from '@/components/settings/workspace/SettingsSwitch'

export interface ChecklistItemValues { section: string; label: string; is_required: boolean }

/**
 * Edits one item of the checklist *draft*. Nothing is written to the server from here: the whole checklist is
 * saved from the page with "Save changes", and the drawer says so.
 */
export function ChecklistItemDrawer({ mode, cleaningTitle, initial, onSubmit, onDelete, onClose }: {
  mode: 'add' | 'edit'
  cleaningTitle: string
  initial: ChecklistItemValues
  onSubmit: (values: ChecklistItemValues) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [values, setValues] = useState<ChecklistItemValues>(initial)
  const [attempted, setAttempted] = useState(false)
  const errors = useMemo(() => validateChecklistItem(values), [values])
  const shown = attempted ? errors : {}
  const dirty = values.section !== initial.section || values.label !== initial.label || values.is_required !== initial.is_required
  // Keep an unusual existing section selectable instead of silently rewriting it.
  const sections = useMemo(
    () => (CHECKLIST_SECTIONS as readonly string[]).includes(initial.section) || !initial.section ? [...CHECKLIST_SECTIONS] : [initial.section, ...CHECKLIST_SECTIONS],
    [initial.section],
  )

  function submit(event?: FormEvent) {
    event?.preventDefault()
    setAttempted(true)
    if (errors.section || errors.label) return
    onSubmit({ ...values, label: values.label.trim() })
  }

  return (
    <SettingsDrawer
      title={mode === 'add' ? 'Add Checklist Item' : 'Edit Checklist Item'}
      description={`Updates the ${cleaningTitle} draft. Select Save changes on the page to publish it to staff.`}
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          {mode === 'edit' && onDelete && (
            <Button type="button" variant="destructive" onClick={onDelete}><Trash2 size={14} aria-hidden="true" /> Delete Item</Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={requestClose}>Cancel</Button>
            <Button type="submit" form="checklist-item-form">Save Item</Button>
          </div>
        </div>
      )}
    >
      <form id="checklist-item-form" onSubmit={submit} noValidate className="space-y-5">
        <SettingsField id="checklist-section" label="Section" required error={shown.section} hint="Items in the same section are shown together.">
          <SettingsSelect {...controlA11y('checklist-section', { error: shown.section, hint: true, required: true })} value={values.section} onChange={(e) => setValues((v) => ({ ...v, section: e.target.value }))}>
            {sections.map((section) => <option key={section} value={section}>{section}</option>)}
          </SettingsSelect>
        </SettingsField>
        <SettingsField id="checklist-label" label="Task Description" required error={shown.label}>
          <SettingsTextarea
            {...controlA11y('checklist-label', { error: shown.label, required: true })}
            value={values.label}
            onChange={(e) => setValues((v) => ({ ...v, label: e.target.value }))}
            maxLength={CHECKLIST_LABEL_MAX + 50}
            placeholder="e.g. Wipe down the bathroom mirror"
            autoFocus
          />
        </SettingsField>
        <SettingsSwitch
          id="checklist-required"
          checked={values.is_required}
          onChange={(is_required) => setValues((v) => ({ ...v, is_required }))}
          label="Required"
          description="Marks the task as mandatory for the housekeeper."
        />
      </form>
    </SettingsDrawer>
  )
}
