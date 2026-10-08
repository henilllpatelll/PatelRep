'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { staffApi, type RoleSchedule, type StaffMember } from '@/lib/api/staff'
import {
  activeCoverageToday, coverageRolesFor, coverageStatus, formatCalendarDate, formatDays, validateCoverage, weekdayNames,
  type CoverageDraft, type CoverageStatus,
} from '@/lib/people/peopleDrawers'
import { IconButton } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { PeopleConfirmDialog } from './PeopleDrawerShell'
import { Banner, Chip, Field, FormFooter, Section, SelectControl, TextControl } from './PeopleFormFields'
import { FooterPortal, focusFirstInvalid, type ViewCommon } from './peopleView'
import { coverageKey, useCoverage, usePeopleHotel, useRefreshPeople } from './usePeopleData'
import { usePeopleLabels } from './usePeopleLabels'
import { useQueryClient } from '@tanstack/react-query'

const FORM_ID = 'people-coverage-form'

const STATUS_STYLE: Record<CoverageStatus, string> = {
  current: 'text-[var(--ready)]',
  upcoming: 'text-[var(--info,var(--accent))]',
  expired: 'text-ink-3',
}

export function CoverageView({ staff, footerEl, onDirty, onBack }: ViewCommon & { staff: StaffMember }) {
  const { t, roleLabel } = usePeopleLabels()
  const { i18n } = useTranslation()
  const locale = i18n.language
  const { hotelId, today } = usePeopleHotel()
  const qc = useQueryClient()
  const refresh = useRefreshPeople()
  const formRef = useRef<HTMLFormElement>(null)
  const roles = coverageRolesFor(staff.role)
  const coverage = useCoverage(staff.user_id, roles.length > 0)
  const rules = coverage.data ?? []

  const initial: CoverageDraft = { role: roles[0] ?? '', days: [], start: today ?? '', end: '' }
  const [draft, setDraft] = useState<CoverageDraft>(initial)
  const [errors, setErrors] = useState<ReturnType<typeof validateCoverage>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<RoleSchedule | null>(null)

  const dirty = draft.days.length > 0 || draft.end !== ''
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => { // the hotel date resolves after first paint on slow loads
    if (today && !draft.start) setDraft((d) => (d.start ? d : { ...d, start: today }))
  }, [today, draft.start])

  const names = useMemo(() => weekdayNames(locale, 'short'), [locale])
  const longNames = useMemo(() => weekdayNames(locale, 'long'), [locale])
  const patch = (p: Partial<CoverageDraft>) => { setDraft((d) => ({ ...d, ...p })); setErrors({}) }
  const toggleDay = (i: number) => patch({ days: draft.days.includes(i) ? draft.days.filter((d) => d !== i) : [...draft.days, i] })

  const add = useMutation({
    mutationFn: () => staffApi.createRoleSchedule(staff.user_id, {
      override_role: draft.role as 'housekeeping_supervisor' | 'engineer',
      days_of_week: [...draft.days].sort((a, b) => a - b),
      start_date: draft.start || undefined,
      end_date: draft.end || undefined,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: coverageKey(hotelId, staff.user_id) })
      setDraft({ ...initial, start: today ?? '' })
      setFormError(null)
      onDirty(false)
    },
    onError: async (err) => {
      await qc.invalidateQueries({ queryKey: coverageKey(hotelId, staff.user_id) })
      setFormError((err as Error)?.message || t('people.feedback.actionFailed'))
    },
  })

  const remove = useMutation({
    mutationFn: (rule: RoleSchedule) => staffApi.deleteRoleSchedule(staff.user_id, rule.id),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: coverageKey(hotelId, staff.user_id) }), refresh()])
      setRemoving(null)
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (add.isPending) return
    const found = validateCoverage(draft, staff.role, rules, today)
    setErrors(found)
    if (Object.keys(found).length) {
      setFormError(null)
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    setFormError(null)
    add.mutate()
  }

  const err = (k: keyof typeof errors) => (errors[k] ? t(errors[k] as string) : null)
  const todayRule = activeCoverageToday(rules, today)

  if (roles.length === 0) {
    return <Banner tone="info">{t('people.coverage.unsupported', { role: roleLabel(staff.role) })}</Banner>
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-2">{t('people.coverage.intro', { name: staff.preferred_name || staff.full_name || staff.email })}</p>

      <Section title={t('people.coverage.existing')}>
        {coverage.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : coverage.isError ? (
          <Banner tone="error" action={<button type="button" onClick={() => coverage.refetch()} className="text-xs font-semibold underline">{t('common.retry')}</button>}>
            {t('people.coverage.loadError')}
          </Banner>
        ) : rules.length === 0 ? (
          <p className="text-sm text-ink-3">{t('people.coverage.none')}</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => {
              const status = coverageStatus(r, today)
              const start = formatCalendarDate(r.start_date, locale)
              const end = formatCalendarDate(r.end_date, locale)
              return (
                <li key={r.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{roleLabel(r.override_role)}</p>
                    <p className="text-xs text-ink-2">{formatDays(r.days_of_week, locale)}</p>
                    <p className="text-xs text-ink-3">
                      {start && end ? `${start} – ${end}` : end ? t('people.coverage.until', { date: end }) : start ? t('people.coverage.from', { date: start }) : t('people.coverage.noDates')}
                    </p>
                    {status && (
                      <p className={`mt-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>
                        {t(`people.coverage.status.${status}`)}{todayRule?.id === r.id ? ` · ${t('people.coverage.appliesToday')}` : ''}
                      </p>
                    )}
                  </div>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving(r)}
                    aria-label={t('people.coverage.removeAria', { role: roleLabel(r.override_role), days: formatDays(r.days_of_week, locale) })}
                    className="h-11 w-11 shrink-0 text-ink-3 hover:text-[var(--alert)] sm:h-9 sm:w-9"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </IconButton>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-3">{t('people.coverage.editHint')}</p>
      </Section>

      <form id={FORM_ID} ref={formRef} onSubmit={submit} noValidate className="space-y-4 border-t border-line pt-5">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.coverage.addHeading')}</h3>
        {formError && <Banner tone="error">{formError}</Banner>}
        <fieldset className="space-y-4" disabled={add.isPending}>
          <Field label={t('people.coverage.role')} required error={err('role')}>
            {(a) => (
              <SelectControl {...a} value={draft.role} onChange={(e) => patch({ role: e.target.value })}>
                {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </SelectControl>
            )}
          </Field>

          <div>
            <p id="coverage-days-label" className="mb-1.5 text-sm font-medium text-ink">{t('people.coverage.days')} <span className="text-[var(--alert)]" aria-hidden="true">*</span></p>
            <div role="group" aria-labelledby="coverage-days-label" aria-describedby={errors.days ? 'coverage-days-err' : undefined} className="flex flex-wrap gap-1.5">
              {names.map((n, i) => (
                <Chip key={i} selected={draft.days.includes(i)} onClick={() => toggleDay(i)} label={longNames[i]}>{n}</Chip>
              ))}
            </div>
            {errors.days && <p id="coverage-days-err" role="alert" className="mt-1 text-xs font-medium text-[var(--alert)]">{t(errors.days)}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('people.coverage.start')} hint={t('people.coverage.startHint')}>
              {(a) => <TextControl {...a} type="date" value={draft.start} onChange={(e) => patch({ start: e.target.value })} />}
            </Field>
            <Field label={t('people.coverage.end')} required error={err('end')}>
              {(a) => <TextControl {...a} type="date" value={draft.end} min={draft.start || undefined} onChange={(e) => patch({ end: e.target.value })} />}
            </Field>
          </div>
          {errors.overlap && <Banner tone="error">{t(errors.overlap)}</Banner>}
        </fieldset>
        <p className="text-xs text-ink-3">{t('people.coverage.note')}</p>
      </form>

      <FooterPortal el={footerEl}>
        <FormFooter
          formId={FORM_ID}
          primaryLabel={t('people.coverage.add')}
          busyLabel={t('people.coverage.adding')}
          busy={add.isPending}
          cancelLabel={t('people.drawer.back')}
          onCancel={onBack}
        />
      </FooterPortal>

      {removing && (
        <PeopleConfirmDialog
          title={t('people.coverage.removeTitle')}
          body={<p>{t('people.coverage.removeBody', { role: roleLabel(removing.override_role), days: formatDays(removing.days_of_week, locale) })}</p>}
          confirmLabel={t('people.coverage.remove')}
          busyLabel={t('people.coverage.removing')}
          tone="destructive"
          busy={remove.isPending}
          error={remove.isError ? (remove.error as Error)?.message || t('people.feedback.actionFailed') : null}
          onConfirm={() => remove.mutate(removing)}
          onCancel={() => { remove.reset(); setRemoving(null) }}
        />
      )}
    </div>
  )
}
