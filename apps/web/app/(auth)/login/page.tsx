'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LanguageToggle } from '@/components/shared/LanguageToggle'
import { useTranslation } from 'react-i18next'
import { MOBILE_ONLY_ROLES, type UserRole } from '@/lib/utils/routeGuard'
import { resolvedApiUrl } from '@/lib/api/client'
import { AuthV2Scope, authV2Styles as v2s } from '@/components/design-v2/shell/AuthV2Scope'

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
      // Same destination as proxy.ts and the auth callback, which show the mobile-only notice
      window.location.assign('/login?mobileOnly=1')
      return
    }

    const hotelId =
      (data.user?.app_metadata as Record<string, unknown>)?.hotel_id ??
      (data.user?.user_metadata as Record<string, unknown>)?.hotel_id
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


  // Design System V2 is the one sign-in design for every hotel.
  return (
    <AuthV2Scope>
      <div className={v2s.card} data-testid="login-v2">
        <div className={v2s.topRow}>
          <div className={v2s.brand}>
            <span className={v2s.logo} aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M4 21V8l8-5 8 5v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className={v2s.brandText}>
              <span className={v2s.brandName}>PatelRep</span>
              <span className={v2s.brandTag}>{t('login.brandTag')}</span>
            </span>
          </div>
          <LanguageToggle />
        </div>

        {magicLinkSent ? (
          <div className={`${v2s.form} ${v2s.center}`}>
            <div className={v2s.sentIcon} aria-hidden>
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className={v2s.heading}>
              <h1 className={v2s.title}>{t('login.checkEmailTitle')}</h1>
              <p className={v2s.subtitle}>{t('login.checkEmailBody', { email })}</p>
            </div>
            <button type="button" className={v2s.textBtn} onClick={() => { setMagicLinkSent(false); setError('') }}>
              &larr; {t('login.backToLogin')}
            </button>
          </div>
        ) : (
          <>
            <div className={v2s.heading}>
              <h1 className={v2s.title}>{t('login.title')}</h1>
              <p className={v2s.subtitle}>{t('login.subtitle')}</p>
            </div>

            <div className={v2s.tabs} role="tablist">
              {(['password', 'magic'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  disabled={!isHydrated || loading}
                  onClick={() => handleTabChange(tab)}
                  className={`${v2s.tab} ${activeTab === tab ? v2s.tabActive : ''}`}
                >
                  {tab === 'password' ? t('login.passwordTab') : t('login.magicTab')}
                </button>
              ))}
            </div>

            {mobileOnlyParam && (
              <div className={`${v2s.notice} ${v2s.noticeWarn}`} role="alert">
                <strong>Web portal is for management staff only</strong>
                <div>Housekeepers and engineers should use the PatelRep mobile app.</div>
              </div>
            )}

            {error && (
              <div className={`${v2s.notice} ${v2s.noticeError}`} role="alert">
                {error}
              </div>
            )}

            {activeTab === 'password' && (
              <form onSubmit={handlePasswordLogin} className={v2s.form} noValidate>
                <div className={v2s.field}>
                  <label className={v2s.label} htmlFor="email-pw">{t('login.email')}</label>
                  <input id="email-pw" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hotel.com" required disabled={!isHydrated || loading} autoComplete="email" className={v2s.input} />
                </div>
                <div className={v2s.field}>
                  <div className={v2s.labelRow}>
                    <label className={v2s.label} htmlFor="password-pw">{t('login.password')}</label>
                    <a href="/auth/reset-password" className={v2s.link}>{t('login.forgotPassword')}</a>
                  </div>
                  <div className={v2s.passwordWrap}>
                    <input id="password-pw" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={!isHydrated || loading} autoComplete="current-password" className={v2s.input} />
                    <button type="button" className={v2s.reveal} onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                        {showPassword ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        ) : (
                          <>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={!isHydrated || loading || !email || !password} className={v2s.primaryBtn}>
                  {loading ? <><Spinner /> {t('login.signingIn')}</> : t('login.passwordTab')}
                </button>
              </form>
            )}

            {activeTab === 'magic' && (
              <form onSubmit={handleMagicLink} className={v2s.form} noValidate>
                <p className={v2s.subtitle}>{t('login.magicIntro')}</p>
                <div className={v2s.field}>
                  <label className={v2s.label} htmlFor="email-ml">{t('login.email')}</label>
                  <input id="email-ml" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hotel.com" required disabled={!isHydrated || loading} autoComplete="email" className={v2s.input} />
                </div>
                <button type="submit" disabled={!isHydrated || loading || !email} className={v2s.primaryBtn}>
                  {loading ? <><Spinner /> {t('login.sending')}</> : t('login.sendMagicLink')}
                </button>
              </form>
            )}

            <div className={v2s.health} data-testid="service-health" role="status" aria-live="polite">
              {serviceHealth === 'checking' && t('login.healthChecking')}
              {serviceHealth === 'connected' && <span className={v2s.healthOk}>{t('login.healthConnected')}</span>}
              {serviceHealth === 'unavailable' && <span className={v2s.healthBad}>{t('login.healthUnavailable')}</span>}
            </div>
          </>
        )}
      </div>
    </AuthV2Scope>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <LoginContent />
    </Suspense>
  )
}
