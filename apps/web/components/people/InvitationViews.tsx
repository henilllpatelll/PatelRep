'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { RefreshCw, Send, Trash2 } from 'lucide-react'
import { staffApi, type Department, type ReissueInvitationData } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import { ROLE_VALUES, type InvitationEntry } from '@/lib/people/peopleDirectory'
import { formatTimestamp, isValidPhone } from '@/lib/people/peopleDrawers'
import { Button } from '@/components/ui/Button'
import { Banner, DetailRow, Field, FormFooter, Section, SelectControl, TextControl } from './PeopleFormFields'
import { FooterPortal, focusFirstInvalid, type ViewCommon } from './peopleView'
import { StatusBadge } from './PeopleDirectory'
import { useRefreshPeople } from './usePeopleData'
import { usePeopleLabels } from './usePeopleLabels'

interface DetailsProps extends ViewCommon {
  entry: InvitationEntry
  onRevoke: (e: InvitationEntry) => void
}

function useDeliveryText() {
  const { t } = usePeopleLabels()
  return (email: string, status: string | null) => {
    if (status === 'failed') return { tone: 'warning' as const, text: t('people.feedback.emailFailed', { email }) }
    if (status === 'existing_account') return { tone: 'warning' as const, text: t('people.feedback.existingAccount', { email }) }
    return { tone: 'success' as const, text: t('people.feedback.emailRequested', { email }) }
  }
}

export function InvitationDetailsView({ entry, onView, onRevoke, notify }: DetailsProps) {
  const { t, roleLabel } = usePeopleLabels()
  const { i18n } = useTranslation()
  const locale = i18n.language
  const refresh = useRefreshPeople()
  const delivery = useDeliveryText()
  const inv = entry.invitation
  const expired = entry.status === 'expired'
  const [result, setResult] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)

  const resend = useMutation({
    mutationFn: () => staffApi.resendInvitation(inv.id),
    onSuccess: async (res) => { setResult(delivery(res.data.email, res.data.delivery.status)); await refresh() },
    onError: async () => { await refresh() },
  })
  const reissue = useMutation({
    mutationFn: () => staffApi.reissueInvitation(inv.id, {}),
    onSuccess: async (res) => {
      await refresh()
      const d = delivery(res.data.email, res.data.delivery.status)
      notify(d)
      onView({ view: 'invitation', key: `invitation:${res.data.id}` })
    },
    onError: async () => { await refresh() },
  })
  const busy = resend.isPending || reissue.isPending
  const failure = (resend.error ?? reissue.error) as Error | null

  const fmt = (v: string | null | undefined) => formatTimestamp(v, locale) ?? <span className="text-ink-3">—</span>
  const deliveryLabel = inv.delivery?.status === 'requested' ? t('people.invitation.deliveryRequested')
    : inv.delivery?.status === 'failed' ? t('people.invitation.deliveryFailed')
    : inv.delivery?.status === 'existing_account' ? t('people.invitation.deliveryExisting')
    : t('people.invitation.deliveryNone')

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">{entry.name || entry.email}</p>
          <p className="truncate text-sm text-ink-2">{roleLabel(inv.role)}</p>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      <div className="mt-4 space-y-3">
        {expired && <Banner tone="warning">{t('people.invitation.expiredNotice')}</Banner>}
        {result && <Banner tone={result.tone}>{result.text}</Banner>}
        {failure && <Banner tone="error">{failure.message || t('people.feedback.actionFailed')}</Banner>}
      </div>

      <Section title={t('people.invitation.details')}>
        <dl>
          <DetailRow label={t('people.form.fullName')}>{inv.full_name || <span className="text-ink-3">—</span>}</DetailRow>
          <DetailRow label={t('people.form.email')}>{inv.email}</DetailRow>
          {inv.phone && <DetailRow label={t('people.form.phone')}>{inv.phone}</DetailRow>}
          <DetailRow label={t('people.form.department')}>{entry.departmentName ?? t('people.filters.unassigned')}</DetailRow>
          <DetailRow label={t('people.invitation.intendedRole')}>{roleLabel(inv.role)}</DetailRow>
          <DetailRow label={t('people.columns.account')}>{t(`people.status.${entry.status}`)}</DetailRow>
        </dl>
      </Section>

      <Section title={t('people.invitation.timeline')}>
        <dl>
          <DetailRow label={t('people.invitation.invitedOn')}>{fmt(inv.invited_at || inv.created_at)}</DetailRow>
          <DetailRow label={expired ? t('people.invitation.expiredOn') : t('people.invitation.expiresOn')}>{fmt(inv.expires_at)}</DetailRow>
          {inv.accepted_at && <DetailRow label={t('people.invitation.acceptedOn')}>{fmt(inv.accepted_at)}</DetailRow>}
          <DetailRow label={t('people.invitation.lastEmail')}>
            {deliveryLabel}
            {inv.last_sent_at && <span className="block text-xs text-ink-3">{fmt(inv.last_sent_at)}</span>}
          </DetailRow>
        </dl>
      </Section>

      <div className="mt-6 space-y-2">
        {expired ? (
          <Button variant="primary" className="w-full justify-center" disabled={busy} aria-busy={reissue.isPending} onClick={() => reissue.mutate()}>
            <RefreshCw size={15} aria-hidden="true" />{reissue.isPending ? t('people.invitation.reissuing') : t('people.invitation.reissue')}
          </Button>
        ) : (
          <>
            <Button variant="primary" className="w-full justify-center" disabled={busy} aria-busy={resend.isPending} onClick={() => resend.mutate()}>
              <Send size={15} aria-hidden="true" />{resend.isPending ? t('people.invitation.resending') : t('people.actions.resend')}
            </Button>
            <Button variant="outline" className="w-full justify-center" disabled={busy} onClick={() => onView({ view: 'editInvitation', key: entry.key })}>
              {t('people.actions.editInvitation')}
            </Button>
          </>
        )}
        <Button variant="ghost" className="w-full justify-center text-[var(--alert)]" disabled={busy} onClick={() => onRevoke(entry)}>
          <Trash2 size={15} aria-hidden="true" />{t('people.actions.revoke')}
        </Button>
        <p className="pt-1 text-xs text-ink-3">{expired ? t('people.invitation.reissueHint') : t('people.invitation.editHint')}</p>
      </div>
    </div>
  )
}

// ── Edit (revoke and reissue) ───────────────────────────────────────────────

interface EditValues { fullName: string; phone: string; departmentId: string; role: UserRole | '' }

export function InvitationEditView({ entry, departments, footerEl, onDirty, onBack, onView, notify }: ViewCommon & { entry: InvitationEntry; departments: Department[] }) {
  const { t, roleLabel } = usePeopleLabels()
  const refresh = useRefreshPeople()
  const delivery = useDeliveryText()
  const formRef = useRef<HTMLFormElement>(null)
  const inv = entry.invitation
  const initial: EditValues = { fullName: inv.full_name ?? '', phone: inv.phone ?? '', departmentId: inv.department_id ?? '', role: inv.role }
  const [v, setV] = useState<EditValues>(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof EditValues, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const changes: ReissueInvitationData = {}
  if (v.fullName.trim() !== initial.fullName.trim()) changes.full_name = v.fullName.trim()
  if (v.phone.trim() !== initial.phone.trim()) changes.phone = v.phone.trim()
  if (v.departmentId !== initial.departmentId && v.departmentId) changes.department_id = v.departmentId
  if (v.role !== initial.role && v.role) changes.role = v.role
  const dirty = Object.keys(changes).length > 0
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])

  const set = <K extends keyof EditValues>(k: K, val: EditValues[K]) => { setV((p) => ({ ...p, [k]: val })); setErrors((p) => ({ ...p, [k]: undefined })) }

  const save = useMutation({
    mutationFn: () => staffApi.reissueInvitation(inv.id, changes),
    onSuccess: async (res) => {
      await refresh()
      onDirty(false)
      notify(delivery(res.data.email, res.data.delivery.status))
      onView({ view: 'invitation', key: `invitation:${res.data.id}` })
    },
    onError: async (err) => { await refresh(); setFormError((err as Error)?.message || t('people.feedback.actionFailed')) },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (save.isPending) return
    const found: typeof errors = {}
    if (v.fullName.trim().length < 2) found.fullName = 'people.errors.field.fullName'
    if (!isValidPhone(v.phone)) found.phone = 'people.errors.field.phone'
    if (!v.role) found.role = 'people.errors.field.role'
    if (departments.length > 0 && !v.departmentId) found.departmentId = 'people.errors.field.department'
    setErrors(found)
    if (Object.keys(found).length) { requestAnimationFrame(() => focusFirstInvalid(formRef.current)); return }
    setFormError(null)
    save.mutate()
  }
  const err = (k: keyof EditValues) => (errors[k] ? t(errors[k] as string) : null)

  return (
    <form id="people-invitation-edit" ref={formRef} onSubmit={submit} noValidate className="space-y-5">
      <Banner tone="info">{t('people.invitation.editExplain', { email: inv.email })}</Banner>
      {formError && <Banner tone="error">{formError}</Banner>}
      <fieldset className="space-y-4" disabled={save.isPending}>
        <Field label={t('people.form.fullName')} required error={err('fullName')}>
          {(a) => <TextControl {...a} value={v.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={120} />}
        </Field>
        <Field label={t('people.form.phone')} error={err('phone')}>
          {(a) => <TextControl {...a} type="tel" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} maxLength={32} />}
        </Field>
        <Field label={t('people.form.department')} required={departments.length > 0} error={err('departmentId')}>
          {(a) => (
            <SelectControl {...a} value={v.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">{departments.length > 0 ? t('people.onboard.chooseDepartment') : t('people.filters.unassigned')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectControl>
          )}
        </Field>
        <Field label={t('people.invitation.intendedRole')} required error={err('role')} hint={v.role ? t(`people.roleHelp.${v.role}`) : undefined}>
          {(a) => (
            <SelectControl {...a} value={v.role} onChange={(e) => set('role', e.target.value as UserRole)}>
              {ROLE_VALUES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </SelectControl>
          )}
        </Field>
      </fieldset>
      <FooterPortal el={footerEl}>
        <FormFooter formId="people-invitation-edit" primaryLabel={t('people.invitation.saveReissue')} busyLabel={t('people.invitation.reissuing')} busy={save.isPending} disabled={!dirty} onCancel={onBack} />
      </FooterPortal>
    </form>
  )
}
