'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { staffApi, type Department, type StaffMember } from '@/lib/api/staff'
import {
  diffPersonEdit, hasChanges, personEditInitial, validatePersonEdit, type PersonEditValues,
} from '@/lib/people/peopleDrawers'
import { Banner, Field, FormFooter, SelectControl, TextControl } from './PeopleFormFields'
import { FooterPortal, focusFirstInvalid, type ViewCommon } from './peopleView'
import { useRefreshPeople } from './usePeopleData'
import { usePeopleLabels } from './usePeopleLabels'

interface Props extends ViewCommon {
  staff: StaffMember
  departments: Department[]
  canEditRate: boolean
}

const FORM_ID = 'people-edit-form'

export function PersonEditView({ staff, departments, canEditRate, footerEl, onDirty, onBack, notify }: Props) {
  const { t } = usePeopleLabels()
  const refresh = useRefreshPeople()
  const formRef = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<PersonEditValues>(() => personEditInitial(staff))
  const [errors, setErrors] = useState<Partial<Record<keyof PersonEditValues, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const diff = diffPersonEdit(staff, values, canEditRate)
  const dirty = hasChanges(diff)
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])

  const set = <K extends keyof PersonEditValues>(k: K, v: PersonEditValues[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }))
    setErrors((prev) => ({ ...prev, [k]: undefined }))
  }

  const save = useMutation({
    mutationFn: async () => {
      // Profile and assignment are separate resources; whichever succeeded stays saved and drops out of the next diff.
      if (Object.keys(diff.profile).length) await staffApi.updateProfile(staff.user_id, diff.profile)
      if (Object.keys(diff.assignment).length) await staffApi.update(staff.user_id, diff.assignment)
    },
    onSuccess: async () => {
      await refresh()
      onDirty(false)
      notify({ tone: 'success', text: t('people.edit.saved', { name: values.fullName.trim() || staff.email }) })
      onBack()
    },
    onError: async (err) => {
      await refresh()
      setFormError((err as Error)?.message || t('people.feedback.actionFailed'))
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (save.isPending) return
    const found = validatePersonEdit(values, canEditRate)
    setErrors(found)
    if (Object.keys(found).length) {
      setFormError(null)
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    setFormError(null)
    save.mutate()
  }

  const err = (k: keyof PersonEditValues) => (errors[k] ? t(errors[k] as string) : null)

  return (
    <form id={FORM_ID} ref={formRef} onSubmit={submit} noValidate className="space-y-5">
      {formError && <Banner tone="error">{formError}</Banner>}

      <fieldset className="space-y-4" disabled={save.isPending}>
        <legend className="mb-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.edit.personal')}</legend>
        <Field label={t('people.form.fullName')} required error={err('fullName')}>
          {(a) => <TextControl {...a} value={values.fullName} autoComplete="name" onChange={(e) => set('fullName', e.target.value)} maxLength={120} />}
        </Field>
        <Field label={t('people.form.preferredName')} error={err('preferredName')} hint={t('people.form.preferredNameHint')}>
          {(a) => <TextControl {...a} value={values.preferredName} onChange={(e) => set('preferredName', e.target.value)} maxLength={120} />}
        </Field>
        <Field label={t('people.form.email')} hint={t('people.edit.emailLocked')}>
          {(a) => <TextControl {...a} value={staff.email} type="email" readOnly disabled />}
        </Field>
        <Field label={t('people.form.phone')} error={err('phone')}>
          {(a) => <TextControl {...a} value={values.phone} type="tel" inputMode="tel" autoComplete="tel" onChange={(e) => set('phone', e.target.value)} maxLength={32} />}
        </Field>
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5" disabled={save.isPending}>
        <legend className="mb-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.edit.team')}</legend>
        <Field label={t('people.form.department')} error={err('departmentId')}>
          {(a) => (
            <SelectControl {...a} value={values.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">{t('people.filters.unassigned')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectControl>
          )}
        </Field>
        <p className="text-xs text-ink-3">{t('people.edit.roleElsewhere')}</p>
      </fieldset>

      {canEditRate && (
        <fieldset className="space-y-4 border-t border-line pt-5" disabled={save.isPending}>
          <legend className="mb-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.edit.costing')}</legend>
          <Field label={t('people.profile.laborRate')} error={err('hourlyRate')} hint={t('people.edit.rateHint')}>
            {(a) => (
              <TextControl {...a} value={values.hourlyRate} inputMode="decimal" placeholder={t('people.edit.ratePlaceholder')} onChange={(e) => set('hourlyRate', e.target.value)} />
            )}
          </Field>
        </fieldset>
      )}

      <FooterPortal el={footerEl}>
        <FormFooter
          formId={FORM_ID}
          primaryLabel={t('people.edit.save')}
          busyLabel={t('people.edit.saving')}
          busy={save.isPending}
          disabled={!dirty}
          onCancel={onBack}
        />
      </FooterPortal>
    </form>
  )
}
