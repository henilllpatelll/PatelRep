'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { guestRequestsApi, type SlaPolicy } from '@/lib/api/guest_requests'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  CATEGORY_OPTIONS, EMPTY_RULE_FORM, IMPACT_OPTIONS, PRIORITY_OPTIONS, SLA_MINUTES_MAX, SLA_MINUTES_MIN, formatDuration, ruleFormChanged,
  ruleToForm, toRulePayload, validateRuleForm, type RuleForm,
} from '@/lib/settings/slaRules'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsField, SettingsSelect, SettingsTextInput, controlA11y } from '@/components/settings/workspace/SettingsFormControls'

export function SlaRuleDrawer({ rule, rules, onClose }: { rule?: SlaPolicy; rules: SlaPolicy[]; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const editing = !!rule
  const initial = useMemo<RuleForm>(() => (rule ? ruleToForm(rule) : EMPTY_RULE_FORM), [rule])
  const [form, setForm] = useState<RuleForm>(initial)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const dirty = ruleFormChanged(form, initial)
  const errors = useMemo(() => validateRuleForm(form, rules, rule?.id), [form, rules, rule?.id])
  const shown = attempted ? errors : {}
  const minutes = Number(form.minutes.trim())
  const preview = Number.isInteger(minutes) && minutes >= SLA_MINUTES_MIN && minutes <= SLA_MINUTES_MAX ? formatDuration(minutes) : null
  const set = <K extends keyof RuleForm>(key: K) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value as RuleForm[K] }))
    setServerError(null)
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return
    setAttempted(true)
    if (errors.combination || errors.minutes) return
    setSaving(true)
    setServerError(null)
    try {
      const payload = toRulePayload(form)
      if (rule) await guestRequestsApi.updateSlaPolicy(rule.id, payload)
      else await guestRequestsApi.createSlaPolicy(payload)
      await queryClient.invalidateQueries({ queryKey: ['sla-policies'] })
      toast.success(editing ? 'Service SLA saved.' : 'Service SLA created.')
      onClose()
    } catch (err) {
      setServerError(errorMessage(err, 'We couldn’t save this rule. Your entries are still here.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsDrawer
      title={editing ? 'Edit Service SLA' : 'Create Service SLA'}
      description="Choose which requests this rule matches, then the response target they get."
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-end gap-3 px-4 py-3 sm:px-5">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="sla-rule-form" loading={saving} disabled={editing && !dirty}>{editing ? 'Save Changes' : 'Create Rule'}</Button>
        </div>
      )}
    >
      <form id="sla-rule-form" onSubmit={submit} noValidate className="space-y-5">
        {serverError && <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{serverError}</p>}

        <fieldset className="space-y-4" aria-describedby="sla-match-help">
          <legend className="text-sm font-semibold text-ink">Matches requests with</legend>
          <p id="sla-match-help" className="-mt-2 text-xs text-ink-3">Leave a field on “Any” to match every value. When several rules match a request, the one with the most fields set is used.</p>
          <SettingsField id="sla-category" label="Category">
            <SettingsSelect {...controlA11y('sla-category', { error: shown.combination })} value={form.category} onChange={set('category')}>
              <option value="">Any category</option>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SettingsSelect>
          </SettingsField>
          <SettingsField id="sla-priority" label="Priority">
            <SettingsSelect {...controlA11y('sla-priority', { error: shown.combination })} value={form.priority} onChange={set('priority')}>
              <option value="">Any priority</option>
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SettingsSelect>
          </SettingsField>
          <SettingsField id="sla-impact" label="Guest Impact">
            <SettingsSelect {...controlA11y('sla-impact', { error: shown.combination })} value={form.guest_impact} onChange={set('guest_impact')}>
              <option value="">Any guest impact</option>
              {IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SettingsSelect>
          </SettingsField>
          {shown.combination && <p role="alert" className="text-xs text-[var(--alert)]">{shown.combination}</p>}
        </fieldset>

        <SettingsField
          id="sla-minutes"
          label="Response Target"
          required
          error={shown.minutes}
          hint={preview ? `${preview}. Matching requests are due this long after they’re created.` : 'Matching requests are due this many minutes after they’re created.'}
        >
          <div className="flex items-center gap-2">
            <SettingsTextInput {...controlA11y('sla-minutes', { error: shown.minutes, hint: true, required: true })} value={form.minutes} onChange={set('minutes')} inputMode="numeric" autoComplete="off" className="max-w-[8rem]" />
            <span className="text-sm text-ink-3">minutes</span>
          </div>
        </SettingsField>
      </form>
    </SettingsDrawer>
  )
}
