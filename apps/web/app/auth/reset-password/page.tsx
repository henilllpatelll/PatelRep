'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LanguageToggle } from '@/components/shared/LanguageToggle'

type Mode = 'request' | 'confirm'

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  )
}

const inputCls = 'w-full border border-line rounded-[var(--r-md)] px-3 py-2.5 text-[13px] text-ink bg-surface focus:outline-none focus:border-accent focus:ring-1 focus:ring-[var(--accent-soft)] transition-colors placeholder:text-ink-4'
const primaryBtn = 'w-full bg-accent text-white font-medium rounded-[var(--r-md)] px-4 py-2.5 text-[13px] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2'

// -- Request mode --
function RequestForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    if (resetError) { setError(resetError.message) } else { setSent(true) }
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="text-center space-y-6">
        <div className="w-12 h-12 rounded-full bg-[var(--ready-soft)] flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-[var(--ready)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <h2 className="font-display text-2xl text-ink">Check your email</h2>
          <p className="text-[13px] text-ink-3 mt-2 leading-relaxed">
            We sent a reset link to <strong className="text-ink">{email}</strong>. It expires in 1 hour.
          </p>
        </div>
        <button type="button" onClick={() => setSent(false)} className="text-[13px] text-accent font-medium hover:opacity-80 transition-opacity">
          &larr; Send again
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <div className="px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-[var(--r-md)] text-[13px] text-[var(--alert)]" role="alert">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-ink-2" htmlFor="reset-email">Email</label>
        <input
          id="reset-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@hotel.com"
          required
          disabled={loading}
          autoComplete="email"
          className={inputCls}
        />
      </div>
      <button type="submit" disabled={loading || !email} className={`${primaryBtn} mt-2`}>
        {loading ? <><Spinner className="text-white" /> Sending&hellip;</> : 'Send Reset Link'}
      </button>
      <div className="text-center">
        <a href="/login" className="text-[13px] text-ink-3 hover:text-accent transition-colors">&larr; Back to Login</a>
      </div>
    </form>
  )
}

// -- Confirm mode --
function ConfirmForm({ code }: { code: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exchanging, setExchanging] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const exchange = async () => {
      const supabase = createClient()
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeError) setError(exchangeError.message)
      setExchanging(false)
    }
    exchange()
  }, [code])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) { setError(updateError.message); setLoading(false); return }
    router.replace('/dashboard')
  }

  if (exchanging) {
    return (
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <Spinner className="text-accent" />
        </div>
        <p className="text-[13px] text-ink-3">Verifying your link&hellip;</p>
      </div>
    )
  }

  if (error && !password) {
    return (
      <div className="text-center space-y-6">
        <div className="w-12 h-12 rounded-full bg-[var(--alert-soft)] flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-[var(--alert)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <div>
          <h2 className="font-display text-2xl text-ink">Link expired or invalid</h2>
          <p className="text-[13px] text-[var(--alert)] mt-2">{error}</p>
        </div>
        <a href="/auth/reset-password" className="text-[13px] text-accent font-medium hover:opacity-80 transition-opacity">
          Request a new link
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <div className="px-4 py-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-[var(--r-md)] text-[13px] text-[var(--alert)]" role="alert">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-ink-2" htmlFor="new-password">New Password</label>
        <div className="relative">
          <input
            id="new-password"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
            disabled={loading}
            autoComplete="new-password"
            className={`${inputCls} pr-10 font-mono`}
          />
          <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2 transition-colors" aria-label={showPw ? 'Hide password' : 'Show password'}>
            {showPw ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <p className="text-[11px] text-ink-4">Must be at least 8 characters</p>
      </div>
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-ink-2" htmlFor="confirm-password">Confirm Password</label>
        <div className="relative">
          <input
            id="confirm-password"
            type={showConfirm ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter your password"
            required
            minLength={8}
            disabled={loading}
            autoComplete="new-password"
            className={`${inputCls} pr-10 font-mono`}
          />
          <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2 transition-colors" aria-label={showConfirm ? 'Hide password' : 'Show password'}>
            {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>
      <button type="submit" disabled={loading || !password || !confirm} className={`${primaryBtn} mt-2`}>
        {loading ? <><Spinner className="text-white" /> Updating&hellip;</> : 'Update Password'}
      </button>
      <div className="text-center">
        <a href="/login" className="text-[13px] text-ink-3 hover:text-accent transition-colors">&larr; Back to Login</a>
      </div>
    </form>
  )
}

// -- Page --
function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const mode: Mode = code ? 'confirm' : 'request'

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-paper">
      {/* Left — form pane */}
      <div className="flex flex-col p-10 lg:p-16">
        {/* Logo */}
        <div className="mb-auto flex items-center justify-between gap-3">
          <div>
            <a href="/login">
              <span className="text-accent font-mono text-lg font-bold tracking-tight">&#10022; PatelRep</span>
            </a>
            <span className="ml-2 text-[11px] text-ink-4 font-mono uppercase tracking-widest">Staff Portal</span>
          </div>
          <LanguageToggle />
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-[380px] w-full mx-auto lg:mx-0 py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-ink-3 mb-4">Account Security</p>
          <h1 className="font-display text-[42px] leading-[1.05] tracking-[-0.8px] text-ink mb-3">
            {mode === 'request' ? 'Reset Password' : 'Set New Password'}
          </h1>
          <p className="text-[14px] text-ink-2 leading-relaxed mb-8">
            {mode === 'request'
              ? "Enter your work email and we'll send you a secure reset link."
              : 'Choose a strong password for your hotel staff account.'}
          </p>

          {mode === 'request' ? <RequestForm /> : <ConfirmForm code={code!} />}
        </div>

        <div className="font-mono text-[11px] text-ink-4 mt-auto">
          v2.1.0 &middot; Status: <span className="text-[var(--ready)]">Operational</span>
        </div>
      </div>

      {/* Right — hero pane (desktop only) */}
      <div className="hidden lg:flex bg-ink relative overflow-hidden flex-col p-12">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 80% 20%, var(--accent) 0%, transparent 55%), radial-gradient(circle at 10% 90%, var(--ready) 0%, transparent 50%)', opacity: 0.22 }} />
        <div className="relative flex flex-col flex-1 justify-between">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[1.4px] text-white/60">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            PatelRep Hotel Operations
          </div>

          <div className="my-10 rounded-[var(--r-lg)] p-6" style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="text-[11px] text-white/50 uppercase tracking-[1.2px] mb-4 font-mono">Security Tips</div>
            <ul className="space-y-3">
              {[
                'Reset links expire after 1 hour',
                'Use a unique password not used elsewhere',
                'Your active sessions will remain signed in',
              ].map((tip) => (
                <li key={tip} className="flex items-start gap-2.5 text-[13px] text-white/70">
                  <svg className="w-4 h-4 text-[var(--ready)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          <blockquote className="font-display italic text-[21px] leading-[1.4] text-white max-w-sm">
            &ldquo;Your team&rsquo;s security is our priority. Hotel data stays where it belongs.&rdquo;
            <footer className="mt-4 not-italic font-sans text-[12px] text-white/50 uppercase tracking-[1.2px]">
              PatelRep Security
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <ResetPasswordContent />
    </Suspense>
  )
}
