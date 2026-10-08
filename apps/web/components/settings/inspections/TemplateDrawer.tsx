'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  TEMPLATE_NAME_MAX, countDraft, describeStats, templateDraftChanged, toTemplatePayload, validateTemplateDraft, type TemplateDraft,
} from '@/lib/settings/inspectionTemplates'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsField, SettingsTextInput, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { SettingsSwitch } from '@/components/settings/workspace/SettingsSwitch'
import { TemplateStructureEditor } from './TemplateStructureEditor'

/**
 * Create or edit an inspection template. `templateId` set means edit; otherwise a new template is created
 * from `initial` (which is also how Duplicate works: a pre-filled copy the user reviews and saves).
 */
export function TemplateDrawer({ templateId, initial, isCurrentDefault, copyOf, onClose }: {
  templateId?: string
  initial: TemplateDraft
  isCurrentDefault: boolean
  /** Name of the template being copied, when this is a duplicate. */
  copyOf?: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<TemplateDraft>(initial)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const editing = !!templateId
  const dirty = templateDraftChanged(draft, initial)
  const { errors, valid } = useMemo(() => validateTemplateDraft(draft), [draft])
  const stats = countDraft(draft)

  const change = (next: TemplateDraft) => { setDraft(next); setServerError(null) }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return
    setAttempted(true)
    if (!valid) return
    setSaving(true)
    setServerError(null)
    try {
      const payload = toTemplatePayload(draft)
      if (editing) await housekeepingApi.updateInspectionTemplate(templateId!, payload)
      else await housekeepingApi.createInspectionTemplate(payload)
      await queryClient.invalidateQueries({ queryKey: ['inspection-templates'] })
      toast.success(editing ? 'Template saved.' : 'Template created.')
      onClose()
    } catch (err) {
      // Stay open with every edit intact.
      setServerError(errorMessage(err, 'We couldn’t save this template. Your changes are still here.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsDrawer
      width="lg"
      title={editing ? 'Edit Inspection Template' : 'Create Inspection Template'}
      description={copyOf ? `A copy of “${copyOf}”. Review it, then save to create a new template. The original is not changed.` : 'Sections and checks that supervisors work through when they inspect a room.'}
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <p role={serverError ? 'alert' : 'status'} className={serverError ? 'mr-auto min-w-0 flex-1 text-[13px] text-[var(--alert)]' : 'mr-auto text-[13px] text-ink-3'}>
            {serverError ?? (saving ? 'Saving…' : '')}
          </p>
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="template-form" loading={saving} disabled={editing && !dirty}>Save Template</Button>
        </div>
      )}
    >
      <form id="template-form" onSubmit={submit} noValidate className="space-y-6">
        <section aria-label="General details" className="space-y-4">
          <SettingsField id="template-name" label="Template Name" required error={attempted ? errors.name : undefined}>
            <SettingsTextInput {...controlA11y('template-name', { error: attempted ? errors.name : undefined, required: true })} value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} maxLength={TEMPLATE_NAME_MAX + 20} placeholder="e.g. Standard Room Inspection" autoComplete="off" />
          </SettingsField>
          <SettingsSwitch
            id="template-default"
            checked={draft.is_default}
            disabled={isCurrentDefault}
            onChange={(is_default) => change({ ...draft, is_default })}
            label="Default Template"
            description={isCurrentDefault
              ? 'This is the current default. To change it, set another template as the default.'
              : 'Pre-selected when supervisors start an inspection. This replaces the current default for future inspections only; completed inspections keep the template they used.'}
          />
        </section>

        <section aria-label="Checklist structure" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Checklist structure</h3>
            <span className="text-xs text-ink-3">{describeStats(stats)}</span>
          </div>
          <TemplateStructureEditor draft={draft} errors={errors} showErrors={attempted} onChange={change} />
        </section>
      </form>
    </SettingsDrawer>
  )
}
