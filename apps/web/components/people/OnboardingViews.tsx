'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, ChevronDown, Copy, Eye, EyeOff, MailCheck } from 'lucide-react'
import { staffApi, type Department, type StaffInvitation } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import { ROLE_VALUES } from '@/lib/people/peopleDirectory'
import { EMPTY_ONBOARDING, compatibleCustomRoles, validateOnboarding, type OnboardingValues } from '@/lib/people/peopleDrawers'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { Banner, DetailRow, Field, FormFooter, SelectControl, TextControl } from './PeopleFormFields'
import { FooterPortal, focusFirstInvalid, type ViewCommon } from './peopleView'
import { useCustomRoles, useRefreshPeople } from './usePeopleData'
import { usePeopleLabels } from './usePeopleLabels'

type Errors = Partial<Record<keyof OnboardingValues, string>>

function useOnboarding(mode: 'invite' | 'manual', departments: Department[], formRef: RefObject<HTMLFormElement | null>) {
  const [values, setValues] = useState<OnboardingValues>(EMPTY_ONBOARDING)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const set = <K extends keyof OnboardingValues>(k: K, v: OnboardingValues[K]) => {
    setValues((p) => ({ ...p, [k]: v }))
    setErrors((p) => ({ ...p, [k]: undefined }))
  }
  const dirty = values.fullName !== '' || values.email !== '' || values.phone !== '' || values.preferredName !== '' || values.role !== '' || values.departmentId !== ''
  const requireDepartment = departments.length > 0
  const validate = () => {
    const found = validateOnboarding(values, { requireDepartment, manual: mode === 'manual' })
    setErrors(found)
    if (Object.keys(found).length) requestAnimationFrame(() => focusFirstInvalid(formRef.current))
    return Object.keys(found).length === 0
  }
  return { values, set, errors, formError, setFormError, dirty, validate, requireDepartment, reset: () => { setValues(EMPTY_ONBOARDING); setErrors({}); setFormError(null) } }
}

function PersonFields({ f, departments, manual }: { f: ReturnType<typeof useOnboarding>; departments: Department[]; manual: boolean }) {
  const { t, roleLabel } = usePeopleLabels()
  const customRoles = useCustomRoles(manual)
  const [advanced, setAdvanced] = useState(false)
  const { values: v, set, errors } = f
  const err = (k: keyof OnboardingValues) => (errors[k] ? t(errors[k] as string) : null)
  const fit = v.role ? compatibleCustomRoles(customRoles.data ?? [], v.role as UserRole) : []

  return (
    <>
      <fieldset className="space-y-4">
        <legend className="mb-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.onboard.personal')}</legend>
        <Field label={t('people.form.fullName')} required error={err('fullName')}>
          {(a) => <TextControl {...a} value={v.fullName} autoComplete="off" onChange={(e) => set('fullName', e.target.value)} maxLength={120} />}
        </Field>
        {manual && (
          <Field label={t('people.form.preferredName')} hint={t('people.form.preferredNameHint')}>
            {(a) => <TextControl {...a} value={v.preferredName} autoComplete="off" onChange={(e) => set('preferredName', e.target.value)} maxLength={120} />}
          </Field>
        )}
        <Field label={manual ? t('people.onboard.loginEmail') : t('people.onboard.workEmail')} required error={err('email')} hint={manual ? t('people.onboard.loginEmailHint') : undefined}>
          {(a) => <TextControl {...a} value={v.email} type="email" inputMode="email" autoComplete="off" onChange={(e) => set('email', e.target.value)} maxLength={254} />}
        </Field>
        <Field label={t('people.form.phone')} error={err('phone')}>
          {(a) => <TextControl {...a} value={v.phone} type="tel" inputMode="tel" autoComplete="off" onChange={(e) => set('phone', e.target.value)} maxLength={32} />}
        </Field>
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="mb-3 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.edit.team')}</legend>
        <Field label={t('people.form.department')} required={f.requireDepartment} error={err('departmentId')}>
          {(a) => (
            <SelectControl {...a} value={v.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">{f.requireDepartment ? t('people.onboard.chooseDepartment') : t('people.filters.unassigned')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectControl>
          )}
        </Field>
        <Field label={t('people.form.role')} required error={err('role')} hint={v.role ? t(`people.roleHelp.${v.role}`) : t('people.onboard.roleHint')}>
          {(a) => (
            <SelectControl {...a} value={v.role} onChange={(e) => { set('role', e.target.value as OnboardingValues['role']); set('customRoleId', '') }}>
              <option value="">{t('people.onboard.chooseRole')}</option>
              {ROLE_VALUES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </SelectControl>
          )}
        </Field>

        {manual && (
          <div>
            <button
              type="button"
              aria-expanded={advanced}
              aria-controls="people-advanced-access"
              onClick={() => setAdvanced((o) => !o)}
              className="flex min-h-[44px] w-full items-center justify-between rounded-lg text-sm font-medium text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[36px]"
            >
              {t('people.onboard.advanced')}
              <ChevronDown size={16} aria-hidden="true" className={cn('transition-transform motion-reduce:transition-none', advanced && 'rotate-180')} />
            </button>
            {advanced && (
              <div id="people-advanced-access" className="mt-2">
                <Field label={t('people.profile.customAccess')} hint={!v.role ? t('people.onboard.customNeedsRole') : fit.length === 0 ? t('people.access.noPolicies', { role: roleLabel(v.role as UserRole) }) : t('people.access.customHint')}>
                  {(a) => (
                    <SelectControl {...a} value={v.customRoleId} disabled={!v.role || fit.length === 0} onChange={(e) => set('customRoleId', e.target.value)}>
                      <option value="">{t('people.profile.standard')}</option>
                      {fit.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </SelectControl>
                  )}
                </Field>
              </div>
            )}
          </div>
        )}
      </fieldset>
    </>
  )
}

// ── Invite by email ─────────────────────────────────────────────────────────

export function InviteView({ departments, footerEl, onDirty, onClose, notify }: ViewCommon & { departments: Department[] }) {
  const { t, roleLabel } = usePeopleLabels()
  const refresh = useRefreshPeople()
  const formRef = useRef<HTMLFormElement>(null)
  const f = useOnboarding('invite', departments, formRef)
  const [sent, setSent] = useState<StaffInvitation | null>(null)

  useEffect(() => { onDirty(!sent && f.dirty) }, [sent, f.dirty, onDirty])

  const invite = useMutation({
    mutationFn: () => staffApi.invite({
      full_name: f.values.fullName.trim(),
      email: f.values.email.trim(),
      role: f.values.role as UserRole,
      department_id: f.values.departmentId || undefined,
      phone: f.values.phone.trim() || undefined,
    }),
    onSuccess: async (res) => { await refresh(); onDirty(false); setSent(res.data) },
    onError: (err) => f.setFormError((err as Error)?.message || t('people.onboard.inviteFailed')),
  })

  const resend = useMutation({
    mutationFn: (id: string) => staffApi.resendInvitation(id),
    onSuccess: async (res) => { await refresh(); setSent(res.data) },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (invite.isPending) return
    f.setFormError(null)
    if (f.validate()) invite.mutate()
  }

  if (sent) {
    const status = sent.delivery?.status ?? null
    const tone = status === 'requested' ? 'success' : 'warning'
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <span className={cn('flex h-12 w-12 items-center justify-center rounded-full', status === 'requested' ? 'bg-[var(--ready-soft)] text-[var(--ready)]' : 'bg-[var(--caution-soft)] text-[var(--caution)]')}>
            <MailCheck size={22} aria-hidden="true" />
          </span>
          <h3 className="text-base font-semibold text-ink">
            {status === 'requested' ? t('people.onboard.sentTitle') : status === 'failed' ? t('people.onboard.failedTitle') : t('people.onboard.existingTitle')}
          </h3>
        </div>
        <Banner tone={tone}>
          {status === 'requested'
            ? t('people.feedback.emailRequested', { email: sent.email })
            : status === 'failed'
              ? t('people.feedback.emailFailed', { email: sent.email })
              : t('people.feedback.existingAccount', { email: sent.email })}
        </Banner>
        {resend.isError && <Banner tone="error">{(resend.error as Error)?.message || t('people.feedback.actionFailed')}</Banner>}
        <dl className="rounded-lg border border-line px-3">
          <DetailRow label={t('people.onboard.recipient')}>{sent.full_name ? `${sent.full_name} · ${sent.email}` : sent.email}</DetailRow>
          <DetailRow label={t('people.form.department')}>{sent.department_name ?? t('people.filters.unassigned')}</DetailRow>
          <DetailRow label={t('people.form.role')}>{roleLabel(sent.role)}</DetailRow>
          <DetailRow label={t('people.columns.account')}>{t('people.status.invited')}</DetailRow>
        </dl>
        {status === 'failed' && (
          <Button variant="outline" className="w-full justify-center" disabled={resend.isPending} onClick={() => resend.mutate(sent.id)}>
            {resend.isPending ? t('people.invitation.resending') : t('people.actions.resend')}
          </Button>
        )}
        <FooterPortal el={footerEl}>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1 justify-center" onClick={() => { setSent(null); f.reset(); invite.reset() }}>{t('people.onboard.inviteAnother')}</Button>
            <Button variant="primary" className="flex-1 justify-center" onClick={() => { notify({ tone: status === 'requested' ? 'success' : 'warning', text: status === 'requested' ? t('people.feedback.emailRequested', { email: sent.email }) : status === 'failed' ? t('people.feedback.emailFailed', { email: sent.email }) : t('people.feedback.existingAccount', { email: sent.email }) }); onClose() }}>{t('people.onboard.done')}</Button>
          </div>
        </FooterPortal>
      </div>
    )
  }

  return (
    <form id="people-invite-form" ref={formRef} onSubmit={submit} noValidate className="space-y-5">
      <p className="text-sm text-ink-2">{t('people.onboard.inviteIntro')}</p>
      {f.formError && <Banner tone="error">{f.formError}</Banner>}
      <div className="space-y-5" aria-busy={invite.isPending}>
        <PersonFields f={f} departments={departments} manual={false} />
      </div>
      <FooterPortal el={footerEl}>
        <FormFooter formId="people-invite-form" primaryLabel={t('people.onboard.send')} busyLabel={t('people.onboard.sending')} busy={invite.isPending} onCancel={onClose} />
      </FooterPortal>
    </form>
  )
}

// ── Create account manually ─────────────────────────────────────────────────

interface Credentials { name: string; email: string; password: string }

export function CreateAccountView({ departments, footerEl, onDirty, onClose, notify }: ViewCommon & { departments: Department[] }) {
  const { t } = usePeopleLabels()
  const refresh = useRefreshPeople()
  const formRef = useRef<HTMLFormElement>(null)
  const f = useOnboarding('manual', departments, formRef)
  const [creds, setCreds] = useState<Credentials | null>(null)
  const [reveal, setReveal] = useState(false)
  const [copied, setCopied] = useState<'email' | 'password' | null>(null)

  // Unsaved form work, or a one-time password that has not been handed off yet, both warrant a discard prompt.
  useEffect(() => { if (creds) onDirty(true, 'credentials'); else onDirty(f.dirty, 'form') }, [creds, f.dirty, onDirty])
  // The password lives only in this component's state (never storage or the query cache); leaving the view discards it.

  const create = useMutation({
    mutationFn: () => staffApi.addDirect({
      full_name: f.values.fullName.trim(),
      preferred_name: f.values.preferredName.trim() || undefined,
      email: f.values.email.trim(),
      role: f.values.role as UserRole,
      department_id: f.values.departmentId || undefined,
      custom_role_id: f.values.customRoleId || undefined,
      phone: f.values.phone.trim() || undefined,
      password: f.values.credential === 'chosen' ? f.values.password : undefined,
    }),
    onSuccess: async (res) => {
      const password = f.values.credential === 'chosen' ? f.values.password : res.data.temp_password
      setCreds({ name: res.data.full_name, email: f.values.email.trim(), password })
      create.reset() // keep the password out of the shared mutation cache
      await refresh()
    },
    onError: (err) => f.setFormError((err as Error)?.message || t('people.onboard.createFailed')),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (create.isPending) return
    f.setFormError(null)
    if (f.validate()) create.mutate()
  }

  const copy = async (what: 'email' | 'password', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000)
    } catch { /* clipboard unavailable: the value is still visible to copy by hand */ }
  }

  if (creds) {
    return (
      <div className="space-y-5">
        <Banner tone="success">{t('people.onboard.createdBody', { name: creds.name })}</Banner>
        <div className="space-y-3 rounded-lg border border-[var(--caution-line)] bg-[var(--caution-soft)] p-4">
          <p className="text-sm font-semibold text-ink">{t('people.onboard.handoffTitle')}</p>
          <p className="text-xs text-ink-2">{t('people.onboard.handoffBody')}</p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-ink-3">{t('people.form.email')}</dt>
              <dd className="mt-0.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-ink">{creds.email}</span>
                <Button variant="ghost" size="sm" onClick={() => copy('email', creds.email)} aria-label={t('people.onboard.copyEmail')}>
                  {copied === 'email' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                </Button>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">{t('people.onboard.password')}</dt>
              <dd className="mt-0.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-ink">{reveal ? creds.password : '•'.repeat(Math.min(creds.password.length, 16))}</span>
                <Button variant="ghost" size="sm" onClick={() => setReveal((r) => !r)} aria-pressed={reveal} aria-label={reveal ? t('people.onboard.hidePassword') : t('people.onboard.showPassword')}>
                  {reveal ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copy('password', creds.password)} aria-label={t('people.onboard.copyPassword')}>
                  {copied === 'password' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                </Button>
              </dd>
            </div>
          </dl>
          <p role="status" className="sr-only">{copied ? t('people.onboard.copied') : ''}</p>
        </div>
        <FooterPortal el={footerEl}>
          <Button
            variant="primary"
            className="w-full justify-center"
            onClick={() => { setCreds(null); onDirty(false); notify({ tone: 'success', text: t('people.feedback.accountCreated') }); onClose() }}
          >
            {t('people.onboard.handoffDone')}
          </Button>
        </FooterPortal>
      </div>
    )
  }

  return (
    <form id="people-create-form" ref={formRef} onSubmit={submit} noValidate className="space-y-5" autoComplete="off">
      <Banner tone="warning">{t('people.onboard.manualWarning')}</Banner>
      {f.formError && <Banner tone="error">{f.formError}</Banner>}
      <div className="space-y-5" aria-busy={create.isPending}>
        <PersonFields f={f} departments={departments} manual />
        <fieldset className="space-y-3 border-t border-line pt-5">
          <legend className="mb-1 text-[10.5px] font-semibold uppercase tracking-[1px] text-ink-3">{t('people.onboard.credentialHeading')}</legend>
          {(['generated', 'chosen'] as const).map((c) => (
            <label key={c} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 has-[:checked]:border-[var(--accent)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--focus-ring)]">
              <input type="radio" name="credential" value={c} checked={f.values.credential === c} onChange={() => f.set('credential', c)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium text-ink">{t(`people.onboard.credential.${c}`)}</span>
                <span className="block text-xs text-ink-3">{t(`people.onboard.credential.${c}Hint`)}</span>
              </span>
            </label>
          ))}
          {f.values.credential === 'chosen' && (
            <Field label={t('people.onboard.password')} required error={f.errors.password ? t(f.errors.password) : null} hint={t('people.onboard.passwordHint')}>
              {(a) => <TextControl {...a} type="password" autoComplete="new-password" value={f.values.password} onChange={(e) => f.set('password', e.target.value)} maxLength={128} />}
            </Field>
          )}
        </fieldset>
      </div>
      <FooterPortal el={footerEl}>
        <FormFooter formId="people-create-form" primaryLabel={t('people.onboard.create')} busyLabel={t('people.onboard.creating')} busy={create.isPending} onCancel={onClose} />
      </FooterPortal>
    </form>
  )
}
