'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LanguageToggle } from '@/components/shared/LanguageToggle'
import { useTranslation } from 'react-i18next'
import { MOBILE_ONLY_ROLES, type UserRole } from '@/lib/utils/routeGuard'
import { resolvedApiUrl } from '@/lib/api/client'

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const norm = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = norm.padEnd(norm.length + ((4 - (norm.length % 4)) % 4), '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch { return {} }
}

type Tab = 'password' | 'magic'
type ServiceHealth = 'checking' | 'connected' | 'unavailable'

function getHealthUrl(): string {
  return `${resolvedApiUrl.replace(/\/v1\/?$/, '')}/health`
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function LoginContent() {
  const { t } = useTranslation()
  const [isHydrated, setIsHydrated] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth>('checking')

  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const mobileOnlyParam = searchParams.get('mobileOnly') === '1'

  useEffect(() => {
    setIsHydrated(true)
    if (mobileOnlyParam) {
      // Sign them out so navigating away doesn't bounce them back into a redirect loop
      supabase.auth.signOut()
    }
  }, [mobileOnlyParam, supabase])

  useEffect(() => {
    const healthUrl = getHealthUrl()
    const controller = new AbortController()

    async function checkServiceHealth(endpoint: string) {
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const health = await response.json() as { status?: string; db?: string }
        setServiceHealth(response.ok && health.status === 'ok' && health.db === 'ok' ? 'connected' : 'unavailable')
      } catch {
        if (!controller.signal.aborted) setServiceHealth('unavailable')
      }
    }

    void checkServiceHealth(healthUrl)
    return () => controller.abort()
  }, [])

  const getRedirectPath = (hotelId: string | undefined | null): string => {
    const redirectTo = searchParams.get('redirectTo')
    if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) return redirectTo
    return hotelId ? '/dashboard' : '/onboarding'
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) { setError(signInError.message); setLoading(false); return }

    // Block floor staff from the web portal immediately after sign-in
    const claims = decodeJwtPayload(data.session?.access_token ?? '')
    const userRole = (claims.user_role ?? claims.role) as UserRole | undefined
    if (userRole && MOBILE_ONLY_ROLES.has(userRole)) {
      await supabase.auth.signOut()
      setError('Web portal access is restricted to Front Desk, GM, and Supervisor staff. Housekeepers and engineers should use the PatelRep mobile app.')
      setLoading(false)
      return
    }

    const hotelId =
      (data.user?.app_metadata as Record<string, unknown>)?.hotel_id ??
      (data.user?.user_metadata as Record<string, unknown>)?.hotel_id
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(getRedirectPath(hotelId as string | undefined))
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
    })
    if (otpError) { setError(otpError.message) } else { setMagicLinkSent(true) }
    setLoading(false)
  }

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    setError('')
    setMagicLinkSent(false)
  }

  const inputCls = 'w-full border border-line rounded-[var(--r-md)] px-3 py-2.5 text-[13px] text-ink bg-surface focus:outline-none focus:border-accent focus:ring-1 focus:ring-[var(--accent-soft)] transition-colors placeholder:text-ink-4'
  const primaryBtn = 'w-full bg-accent text-white font-medium rounded-[var(--r-md)] px-4 py-2.5 text-[13px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2'

  if (magicLinkSent) {
    return (
      <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-paper">
        <div className="flex flex-col items-center justify-center p-10">
          <div className="w-full max-w-sm text-center space-y-6">
            <div className="w-12 h-12 rounded-full bg-[var(--ready-soft)] flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-[var(--ready)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-2xl italic text-ink">{t('login.checkEmailTitle')}</h2>
              <p className="text-[13px] text-ink-3 mt-2 leading-relaxed">
                {t('login.checkEmailBody', { email })}
              </p>
            </div>
            <button type="button" onClick={() => { setMagicLinkSent(false); setError('') }} className="text-[13px] text-accent font-medium hover:opacity-80 transition-opacity">
              &larr; {t('login.backToLogin')}
            </button>
          </div>
        </div>
        <div className="hidden lg:flex bg-ink relative overflow-hidden" />
      </div>
    )
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-paper">
      {/* Left — form pane */}
      <div className="flex flex-col p-10 lg:p-16">
        {/* Logo */}
        <div className="mb-auto flex items-center justify-between gap-3">
          <div>
            <span className="text-accent font-mono text-lg font-bold tracking-tight">&#10022; PatelRep</span>
            <span className="ml-2 text-[11px] text-ink-4 font-mono uppercase tracking-widest">{t('login.brandTag')}</span>
          </div>
          <LanguageToggle />
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-[380px] w-full mx-auto lg:mx-0 py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-ink-3 mb-4">{t('login.eyebrow')}</p>
          <h1 className="font-display text-[42px] leading-[1.05] tracking-[-0.8px] text-ink mb-3">
            {t('login.title')}
          </h1>
          <p className="text-[14px] text-ink-2 leading-relaxed mb-8">
            {t('login.subtitle')}
          </p>

          {/* Tab switcher */}
          <div className="flex bg-surface-3 rounded-[var(--r-md)] p-1 mb-5" role="tablist">
            {(['password', 'magic'] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                disabled={!isHydrated || loading}
                onClick={() => handleTabChange(tab)}
                className={`flex-1 py-2 text-[13px] rounded-[var(--r-sm)] transition-all ${
                  activeTab === tab ? 'bg-surface text-accent shadow-sm font-semibold' : 'text-ink-3'
                }`}
              >
                {tab === 'password' ? t('login.passwordTab') : t('login.magicTab')}
              </button>
            ))}
          </div>

          {mobileOnlyParam && (
            <div className="mb-4 px-4 py-3 bg-[var(--caution-soft)] border border-[var(--caution-line)] rounded-[var(--r-md)] text-[13px]" role="alert">
              <div className="font-semibold text-[var(--caution)] mb-0.5">Web portal is for management staff only</div>
              <div className="text-ink-2">Housekeepers and engineers should use the PatelRep mobile app.</div>
            </div>
          )}

          {error && (
            <div className="mb-4 px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-[var(--r-md)] text-[13px] text-[var(--alert)]" role="alert">
              {error}
            </div>
          )}

          {activeTab === 'password' && (
            <form onSubmit={handlePasswordLogin} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-ink-2" htmlFor="email-pw">{t('login.email')}</label>
                <input id="email-pw" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hotel.com" required disabled={!isHydrated || loading} autoComplete="email" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[12px] font-medium text-ink-2" htmlFor="password-pw">{t('login.password')}</label>
                  <a href="/auth/reset-password" className="text-[12px] text-accent hover:opacity-80 transition-opacity">{t('login.forgotPassword')}</a>
                </div>
                <div className="relative">
                  <input id="password-pw" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" disabled={!isHydrated || loading} autoComplete="current-password" className={`${inputCls} pr-10 font-mono`} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2 transition-colors" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    )}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={!isHydrated || loading || !email || !password} className={`${primaryBtn} mt-2`}>
                {loading ? <><Spinner className="text-white" /> {t('login.signingIn')}</> : t('login.passwordTab')}
              </button>
            </form>
          )}

          {activeTab === 'magic' && (
            <form onSubmit={handleMagicLink} className="space-y-4" noValidate>
              <p className="text-[13px] text-ink-3 leading-relaxed">{t('login.magicIntro')}</p>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-ink-2" htmlFor="email-ml">{t('login.email')}</label>
                <input id="email-ml" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hotel.com" required disabled={!isHydrated || loading} autoComplete="email" className={inputCls} />
              </div>
              <button type="submit" disabled={!isHydrated || loading || !email} className={`${primaryBtn} mt-2`}>
                {loading ? <><Spinner className="text-white" /> {t('login.sending')}</> : t('login.sendMagicLink')}
              </button>
            </form>
          )}
        </div>

        <div className="font-mono text-[11px] text-ink-4 mt-auto" data-testid="service-health" role="status" aria-live="polite">
          {serviceHealth === 'checking' && t('login.healthChecking')}
          {serviceHealth === 'connected' && <span className="text-[var(--ready)]">{t('login.healthConnected')}</span>}
          {serviceHealth === 'unavailable' && <span className="text-[var(--alert)]">{t('login.healthUnavailable')}</span>}
        </div>
      </div>

      {/* Right — hero pane (desktop only) */}
      <div className="hidden lg:flex bg-ink relative overflow-hidden flex-col p-12">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 80% 20%, var(--accent) 0%, transparent 55%), radial-gradient(circle at 10% 90%, var(--ready) 0%, transparent 50%)', opacity: 0.22 }} />
        <div className="relative flex flex-col flex-1 justify-between">
          {/* Top label */}
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[1.4px] text-white/60">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            {t('login.heroLocation')}
          </div>

          {/* Dashboard preview */}
          <div className="my-10 rounded-[var(--r-lg)] p-6" style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="text-[11px] text-white/50 uppercase tracking-[1.2px] mb-3 font-mono">{t('login.heroTime')}</div>
            <div className="mb-4">
              <div className="font-mono text-[11px] text-white/50 mb-1">{t('login.roomsReady')}</div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[52px] leading-none text-white">52</span>
                <span className="text-lg text-white/40">/ 87</span>
                <span className="ml-auto font-mono text-[12px] text-[var(--ready)]">{t('login.forecast')}</span>
              </div>
              <div className="h-1 mt-3 rounded-full overflow-hidden bg-white/10">
                <div className="h-full bg-accent rounded-full" style={{ width: '60%' }} />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[
                t('login.occupancyChip'),
                t('login.cleanTimeChip'),
                t('login.workOrdersChip'),
                t('login.vipChip'),
              ].map((s) => (
                <span key={s} className="font-mono text-[11px] px-2.5 py-1 rounded-full text-white/80" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>{s}</span>
              ))}
            </div>
          </div>

          {/* Testimonial */}
          <blockquote className="font-display italic text-[21px] leading-[1.4] text-white max-w-sm">
            &ldquo;{t('login.testimonial')}&rdquo;
            <footer className="mt-4 not-italic font-sans text-[12px] text-white/50 uppercase tracking-[1.2px]">
              {t('login.testimonialByline')}
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <LoginContent />
    </Suspense>
  )
}
