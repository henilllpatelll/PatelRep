'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Tab = 'password' | 'magic'

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function LoginContent() {
  const [isHydrated, setIsHydrated] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [error, setError] = useState('')

  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => { setIsHydrated(true) }, [])

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
              <h2 className="font-display text-2xl italic text-ink">Check your email</h2>
              <p className="text-[13px] text-ink-3 mt-2 leading-relaxed">
                We sent a magic link to <strong className="text-ink font-medium">{email}</strong>. Click it to sign in &mdash; expires in 1 hour.
              </p>
            </div>
            <button type="button" onClick={() => { setMagicLinkSent(false); setError('') }} className="text-[13px] text-accent font-medium hover:opacity-80 transition-opacity">
              &larr; Back to login
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
        <div className="mb-auto">
          <span className="text-accent font-mono text-lg font-bold tracking-tight">&#10022; PatelRep</span>
          <span className="ml-2 text-[11px] text-ink-4 font-mono uppercase tracking-widest">Hotel AI</span>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-[380px] w-full mx-auto lg:mx-0 py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-ink-3 mb-4">Operator sign in</p>
          <h1 className="font-display text-[42px] leading-[1.05] tracking-[-0.8px] text-ink mb-3">
            Welcome back to <em>your hotel</em>.
          </h1>
          <p className="text-[14px] text-ink-2 leading-relaxed mb-8">
            Sign in to keep the floor running smoothly. The AI has prepared your morning briefing.
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
                {tab === 'password' ? 'Sign In' : 'Magic Link'}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-[var(--r-md)] text-[13px] text-[var(--alert)]" role="alert">
              {error}
            </div>
          )}

          {activeTab === 'password' && (
            <form onSubmit={handlePasswordLogin} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-ink-2" htmlFor="email-pw">Email</label>
                <input id="email-pw" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hotel.com" required disabled={!isHydrated || loading} autoComplete="email" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[12px] font-medium text-ink-2" htmlFor="password-pw">Password</label>
                  <a href="/auth/reset-password" className="text-[12px] text-accent hover:opacity-80 transition-opacity">Forgot password?</a>
                </div>
                <input id="password-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" disabled={!isHydrated || loading} autoComplete="current-password" className={`${inputCls} font-mono`} />
              </div>
              <button type="submit" disabled={!isHydrated || loading || !email || !password} className={`${primaryBtn} mt-2`}>
                {loading ? <><Spinner className="text-white" /> Signing in&hellip;</> : 'Sign In'}
              </button>
            </form>
          )}

          {activeTab === 'magic' && (
            <form onSubmit={handleMagicLink} className="space-y-4" noValidate>
              <p className="text-[13px] text-ink-3 leading-relaxed">Enter your email and we&apos;ll send you a one-click sign-in link. No password required.</p>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-ink-2" htmlFor="email-ml">Email</label>
                <input id="email-ml" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hotel.com" required disabled={!isHydrated || loading} autoComplete="email" className={inputCls} />
              </div>
              <button type="submit" disabled={!isHydrated || loading || !email} className={`${primaryBtn} mt-2`}>
                {loading ? <><Spinner className="text-white" /> Sending&hellip;</> : 'Send Magic Link'}
              </button>
            </form>
          )}
        </div>

        <div className="font-mono text-[11px] text-ink-4 mt-auto">
          v2.1.0 &middot; status: <span className="text-[var(--ready)]">operational</span>
        </div>
      </div>

      {/* Right — hero pane (desktop only) */}
      <div className="hidden lg:flex bg-ink relative overflow-hidden flex-col p-12">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 80% 20%, var(--accent) 0%, transparent 55%), radial-gradient(circle at 10% 90%, var(--ready) 0%, transparent 50%)', opacity: 0.22 }} />
        <div className="relative flex flex-col flex-1 justify-between">
          {/* Top label */}
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[1.4px] text-white/60">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            Lone Star Inn &middot; Austin TX
          </div>

          {/* Dashboard preview */}
          <div className="my-10 rounded-[var(--r-lg)] p-6" style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="text-[11px] text-white/50 uppercase tracking-[1.2px] mb-3 font-mono">This morning &middot; 9:42</div>
            <div className="mb-4">
              <div className="font-mono text-[11px] text-white/50 mb-1">Rooms ready by 3pm</div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[52px] leading-none text-white">52</span>
                <span className="text-lg text-white/40">/ 87</span>
                <span className="ml-auto font-mono text-[12px] text-[var(--ready)]">+6 vs forecast</span>
              </div>
              <div className="h-1 mt-3 rounded-full overflow-hidden bg-white/10">
                <div className="h-full bg-accent rounded-full" style={{ width: '60%' }} />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['78% occ', '24m clean', '6 WOs', '3 VIPs'].map((s) => (
                <span key={s} className="font-mono text-[11px] px-2.5 py-1 rounded-full text-white/80" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>{s}</span>
              ))}
            </div>
          </div>

          {/* Testimonial */}
          <blockquote className="font-display italic text-[21px] leading-[1.4] text-white max-w-sm">
            &ldquo;It&rsquo;s like having a second supervisor on the floor &mdash; quietly catching the things we&rsquo;d miss.&rdquo;
            <footer className="mt-4 not-italic font-sans text-[12px] text-white/50 uppercase tracking-[1.2px]">
              Sandeep R. &middot; GM, Bluebonnet Suites
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
