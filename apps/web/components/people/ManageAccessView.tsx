'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import { ROLE_VALUES } from '@/lib/people/peopleDirectory'
import {
  accessGuards, buildAccessUpdate, compatibleCustomRoles, customRoleAfterRoleChange,
} from '@/lib/people/peopleDrawers'
import { ALL_MODULES } from '@/components/settings/RoleForm'
import { Skeleton } from '@/components/ui/Skeleton'
import { Banner, DetailRow, Field, FormFooter, Section, SelectControl } from './PeopleFormFields'
import { FooterPortal, type ViewCommon } from './peopleView'
import { useCustomRoles, useRefreshPeople } from './usePeopleData'
import { usePeopleLabels } from './usePeopleLabels'

interface Props extends ViewCommon {
  staff: StaffMember
  staffList: StaffMember[]
  selfUserId: string | null
}

const FORM_ID = 'people-access-form'
const MODULE_LABEL = new Map<string, string>(ALL_MODULES.map((m) => [m.key, m.label]))

export function ManageAccessView({ staff, staffList, selfUserId, footerEl, onDirty, onBack, notify }: Props) {
  const { t, roleLabel } = usePeopleLabels()
  const refresh = useRefreshPeople()
  const customRoles = useCustomRoles()
  const roles = useMemo(() => customRoles.data ?? [], [customRoles.data])
  const guards = accessGuards(staffList, staff, selfUserId)

  const [role, setRole] = useState<UserRole>(staff.role)
  const [customRoleId, setCustomRoleId] = useState<string | null>(staff.custom_role_id ?? null)
  const [formError, setFormError] = useState<string | null>(null)

  const update = buildAccessUpdate(staff, { role, customRoleId })
  const dirty = Object.keys(update).length > 0
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])

  const options = useMemo(() => {
    const fit = compatibleCustomRoles(roles, role)
    // Keep the currently assigned policy visible even if it no longer fits, so it can be seen and cleared.
    const current = roles.find((r) => r.id === customRoleId)
    return current && !fit.some((r) => r.id === current.id) ? [...fit, current] : fit
  }, [roles, role, customRoleId])
  const selected = roles.find((r) => r.id === customRoleId) ?? null
  const clearedByRole = !!staff.custom_role_id && customRoleId === null && role !== staff.role

  const onRoleChange = (next: UserRole) => {
    setRole(next)
    setCustomRoleId((cur) => customRoleAfterRoleChange(roles, next, cur))
  }

  const save = useMutation({
    mutationFn: () => staffApi.update(staff.user_id, update),
    onSuccess: async () => {
      await refresh()
      onDirty(false)
      notify({ tone: 'success', text: t('people.access.saved', { name: staff.preferred_name || staff.full_name || staff.email }) })
      onBack()
    },
    onError: async (err) => {
      await refresh()
      setFormError((err as Error)?.message || t('people.feedback.actionFailed'))
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (save.isPending || !dirty) return
    setFormError(null)
    save.mutate()
  }

  const modules = (selected?.allowed_modules ?? []).map((m) => MODULE_LABEL.get(m)).filter((m): m is string => !!m)

  return (
    <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-5">
      {formError && <Banner tone="error">{formError}</Banner>}
      {guards.roleLocked && (
        <Banner tone="info">
          <span className="flex items-center gap-1.5 font-medium"><Lock size={13} aria-hidden="true" />
            {guards.reason === 'self' ? t('people.access.lockedSelf') : t('people.access.lockedLastGm')}
          </span>
        </Banner>
      )}

      <fieldset className="space-y-4" disabled={save.isPending}>
        <legend className="mb-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.access.baseHeading')}</legend>
        <Field label={t('people.profile.baseRole')} hint={t('people.access.baseHint')}>
          {(a) => (
            <SelectControl {...a} value={role} disabled={guards.roleLocked || (!!staff.custom_role_id && !customRoles.data) || save.isPending} onChange={(e) => onRoleChange(e.target.value as UserRole)}>
              {ROLE_VALUES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </SelectControl>
          )}
        </Field>
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5" disabled={save.isPending}>
        <legend className="mb-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.access.customHeading')}</legend>
        {customRoles.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : customRoles.isError ? (
          <Banner tone="error" action={<button type="button" onClick={() => customRoles.refetch()} className="text-xs font-semibold underline">{t('common.retry')}</button>}>
            {t('people.access.rolesError')}
          </Banner>
        ) : (
          <Field label={t('people.profile.customAccess')} hint={options.length === 0 ? t('people.access.noPolicies', { role: roleLabel(role) }) : t('people.access.customHint')}>
            {(a) => (
              <SelectControl {...a} value={customRoleId ?? ''} onChange={(e) => setCustomRoleId(e.target.value || null)}>
                <option value="">{t('people.profile.standard')}</option>
                {options.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </SelectControl>
            )}
          </Field>
        )}
        {clearedByRole && <Banner tone="warning">{t('people.access.policyCleared')}</Banner>}
      </fieldset>

      <Section title={t('people.access.summaryHeading')}>
        <dl>
          <DetailRow label={t('people.profile.baseRole')}>{roleLabel(role)}</DetailRow>
          <DetailRow label={t('people.profile.customAccess')}>{selected?.name ?? t('people.profile.standard')}</DetailRow>
          {selected && (
            <DetailRow label={t('people.access.modules')}>
              {modules.length ? modules.join(', ') : t('people.access.modulesNone')}
            </DetailRow>
          )}
        </dl>
        <p className="mt-2 text-xs text-ink-3">{t('people.access.previewNote')}</p>
        <Link href="/settings/roles" className="mt-1 inline-flex min-h-[36px] items-center text-xs font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          {t('people.access.openRoles')} →
        </Link>
        <p className="mt-2 text-xs text-ink-3">{t('people.access.timing')}</p>
      </Section>

      <FooterPortal el={footerEl}>
        <FormFooter
          formId={FORM_ID}
          primaryLabel={t('people.access.save')}
          busyLabel={t('people.edit.saving')}
          busy={save.isPending}
          disabled={!dirty}
          onCancel={onBack}
        />
      </FooterPortal>
    </form>
  )
}
