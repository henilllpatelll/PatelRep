'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, MailCheck } from 'lucide-react'
import { apiClient } from '@/lib/api/client'
import { createClient } from '@/lib/supabase/client'
import { LANGUAGE_STORAGE_KEY, normalizeLanguage } from '@/i18n'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'
import { useAuthStore } from '@/stores/authStore'
import {
  ACCENT_OPTIONS, DENSITY_OPTIONS, LANGUAGE_OPTIONS, THEME_OPTIONS,
  buildProfileRows, canEditProfileInPeople, isLanguageChoice,
} from '@/lib/settings/preferences'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { cn } from '@/lib/utils'

interface MeUser {
  email?: string | null
  full_name?: string | null
  preferred_name?: string | null
  phone?: string | null
}
interface MeResponse { user?: MeUser; hotel?: { name?: string | null } }

/** Native radio inputs give arrow-key navigation and a single tab stop for free. */
function ChoiceGroup<T extends string>({ label, name, value, options, onChange }: {
  label: string
  name: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; hint?: string; swatch?: string }>
  onChange: (next: T) => void
}) {
  const labelId = useId()
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="space-y-2">
      <p id={labelId} className="text-sm font-medium text-ink-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = option.value === value
          return (
            <label
              key={option.value}
              className={cn(
                'relative inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[var(--r-md)] border px-3.5 text-sm font-medium transition-colors motion-reduce:transition-none lg:min-h-[40px]',
                'focus-within:ring-2 focus-within:ring-[var(--focus-ring)]',
                checked ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-ink' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.swatch && (
                <span className="h-4 w-4 shrink-0 rounded-full border border-line" style={{ backgroundColor: option.swatch }} aria-hidden="true" />
              )}
              <span>{option.label}</span>
              {option.hint && <span className="sr-only">{`, ${option.hint}`}</span>}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function ProfileSection() {
  const { t } = useTranslation()
  const role = useAuthStore((s) => s.role)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => apiClient.get('/auth/me') as Promise<MeResponse>,
    staleTime: 60_000,
  })

  const rows = data
    ? buildProfileRows({
        fullName: data.user?.full_name,
        preferredName: data.user?.preferred_name,
        email: data.user?.email,
        phone: data.user?.phone,
        roleLabel: role ? t(`roles.${role}`) : null,
        hotelName: data.hotel?.name,
      })
    : []

  return (
    <SettingsCard aria-label="Account" className="space-y-4">
      <SettingsSectionHeader
        level={2}
        title="Account"
        description="Your profile as it appears to your team."
        className="[&_h2]:text-base"
      />
      {isLoading ? (
        <SettingsLoading label="Loading profile…" />
      ) : isError ? (
        <SettingsError message="We couldn't load your profile." onRetry={() => refetch()} />
      ) : (
        <>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.id} className="min-w-0">
                <dt className="text-xs text-ink-3">{row.label}</dt>
                <dd className="mt-0.5 break-words text-sm font-medium text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-ink-3">
            These details are read-only here.{' '}
            {canEditProfileInPeople(role) ? (
              <>
                You can update them in{' '}
                <Link href="/staff" className="font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                  Staff
                </Link>
                . Your sign-in email is managed by your account provider.
              </>
            ) : (
              <>Ask your General Manager to change your name or phone number. Your sign-in email is managed by your account provider.</>
            )}
          </p>
        </>
      )}
    </SettingsCard>
  )
}

function AppearanceSection() {
  const { theme, density, accent, setTheme, setDensity, setAccent } = useUIPreferencesStore()
  const [status, setStatus] = useState('')
  const say = (message: string) => setStatus(message)

  return (
    <SettingsCard aria-label="Appearance" className="space-y-5">
      <SettingsSectionHeader
        level={2}
        title="Appearance"
        description="Changes apply immediately and are saved on this device and browser only."
        className="[&_h2]:text-base"
      />
      <ChoiceGroup
        label="Theme"
        name="theme"
        value={theme}
        options={THEME_OPTIONS}
        onChange={(next) => { setTheme(next); say(`Theme set to ${next}.`) }}
      />
      <ChoiceGroup
        label="Interface density"
        name="density"
        value={density}
        options={DENSITY_OPTIONS}
        onChange={(next) => { setDensity(next); say(`Density set to ${DENSITY_OPTIONS.find((o) => o.value === next)?.label}.`) }}
      />
      <ChoiceGroup
        label="Accent color"
        name="accent"
        value={accent}
        options={ACCENT_OPTIONS}
        onChange={(next) => { setAccent(next); say(`Accent color set to ${ACCENT_OPTIONS.find((o) => o.value === next)?.label}.`) }}
      />
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
    </SettingsCard>
  )
}

function LanguageSection() {
  const { i18n } = useTranslation()
  const current = normalizeLanguage(i18n.language)
  const [status, setStatus] = useState('')

  const change = async (next: string) => {
    if (!isLanguageChoice(next)) return
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next) } catch { /* storage may be blocked; the switch still applies for this session */ }
    await i18n.changeLanguage(next)
    setStatus(`Language set to ${LANGUAGE_OPTIONS.find((o) => o.value === next)?.label}.`)
  }

  return (
    <SettingsCard aria-label="Language" className="space-y-4">
      <SettingsSectionHeader
        level={2}
        title="Language"
        description="Saved on this device and browser only. Spanish applies to the floor-facing screens that have been translated; administrative pages, including Settings, remain in English."
        className="[&_h2]:text-base"
      />
      <ChoiceGroup label="Preferred language" name="language" value={current} options={LANGUAGE_OPTIONS} onChange={change} />
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
    </SettingsCard>
  )
}

type ResetState = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }

function SecuritySection() {
  const user = useAuthStore((s) => s.user)
  const email = user?.email ?? null
  const [state, setState] = useState<ResetState>({ kind: 'idle' })

  const sendReset = async () => {
    if (!email) return
    setState({ kind: 'sending' })
    // The same Supabase Auth recovery flow as "Forgot password" on the login screen.
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    setState(error ? { kind: 'error', message: error.message } : { kind: 'sent', email })
  }

  return (
    <SettingsCard aria-label="Account and security" className="space-y-4">
      <SettingsSectionHeader
        level={2}
        title="Account & security"
        description="Change your password with a secure reset link sent to your sign-in email."
        className="[&_h2]:text-base"
      />
      {email ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" loading={state.kind === 'sending'} onClick={sendReset}>
            Email me a password reset link
          </Button>
          <span className="text-xs text-ink-3">Sent to {email}</span>
        </div>
      ) : (
        <p className="text-sm text-ink-3">
          We couldn&apos;t find your sign-in email.{' '}
          <Link href="/auth/reset-password" className="font-semibold text-[var(--accent)] hover:underline">
            Reset your password <ArrowRight size={13} className="inline" aria-hidden="true" />
          </Link>
        </p>
      )}
      <div role="status" aria-live="polite">
        {state.kind === 'sent' && (
          <p className="flex items-start gap-2 text-sm text-[var(--ready)]">
            <MailCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            Check {state.email} for a reset link. It expires in 1 hour.
          </p>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="text-sm text-[var(--alert)]">We couldn&apos;t send the reset email: {state.message}</p>
        )}
      </div>
    </SettingsCard>
  )
}

export function MyPreferences() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SettingsSectionHeader
        level={1}
        title="My Preferences"
        description="Manage your personal PatelRep experience. These settings are yours alone and don't change anything for your property or team."
        className="[&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-normal [&_h1]:tracking-tight"
      />
      <ProfileSection />
      <AppearanceSection />
      <LanguageSection />
      <SecuritySection />
    </div>
  )
}
