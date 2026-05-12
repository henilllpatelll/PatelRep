'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

type Tab = 'password' | 'magic'

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`w-5 h-5 animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
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

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // After sign-in, redirect to ?redirectTo param, or onboarding if no hotel, else dashboard
  const getRedirectPath = (hotelId: string | undefined | null): string => {
    const redirectTo = searchParams.get('redirectTo')
    if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
      return redirectTo
    }
    return hotelId ? '/dashboard' : '/onboarding'
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    const hotelId =
      (data.user?.app_metadata as Record<string, unknown>)?.hotel_id ??
      (data.user?.user_metadata as Record<string, unknown>)?.hotel_id

    // Hard navigation ensures session cookies are written before the server reads them
    window.location.href = getRedirectPath(hotelId as string | undefined)
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    })

    if (otpError) {
      setError(otpError.message)
    } else {
      setMagicLinkSent(true)
    }
    setLoading(false)
  }

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    setError('')
    setMagicLinkSent(false)
  }

  // ── Magic link sent confirmation ──────────────────────────────────────────
  if (magicLinkSent) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.08) 0%, transparent 70%), #FEFAF4' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full max-w-md bg-white/80 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.08)] border border-amber-100/60 p-8 space-y-6 text-center"
        >
          <div>
            <h1 className="text-3xl font-extrabold text-amber-600">✦ PatelRep</h1>
            <p className="text-sm text-slate-400 mt-1">Hotel Operations AI</p>
          </div>

          <div className="flex justify-center">
            <div className="bg-green-100 rounded-full p-3">
              <svg
                className="w-7 h-7 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900">Check your email</h2>
            <p className="mt-2 text-sm text-slate-400">
              We sent a magic link to <strong className="text-slate-700">{email}</strong>. Click the link to sign in. It
              expires in 1 hour.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setMagicLinkSent(false)
              setError('')
            }}
            className="inline-flex items-center gap-1 text-sm text-amber-600 hover:text-amber-800 font-medium"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Login
          </button>
        </motion.div>
      </div>
    )
  }

  // ── Login card ────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.08) 0%, transparent 70%), #FEFAF4' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md bg-white/80 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.08)] border border-amber-100/60 p-8 space-y-6"
      >
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-amber-600">✦ PatelRep</h1>
          <p className="text-sm text-slate-400 mt-1">Hotel Operations AI</p>
        </div>

        {/* Tab toggle */}
        <div className="flex bg-stone-100 rounded-xl p-1">
          <button
            type="button"
            disabled={!isHydrated || loading}
            onClick={() => handleTabChange('password')}
            className={`flex-1 py-2 text-sm transition-all rounded-lg ${
              activeTab === 'password'
                ? 'bg-white text-amber-700 shadow-sm font-semibold'
                : 'text-stone-400'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            disabled={!isHydrated || loading}
            onClick={() => handleTabChange('magic')}
            className={`flex-1 py-2 text-sm transition-all rounded-lg ${
              activeTab === 'magic'
                ? 'bg-white text-amber-700 shadow-sm font-semibold'
                : 'text-stone-400'
            }`}
          >
            Magic Link
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm" role="alert">
            {error}
          </div>
        )}

        {/* ── Password tab ── */}
        {activeTab === 'password' && (
          <form onSubmit={handlePasswordLogin} className="space-y-4" noValidate>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email-pw">
                Email
              </label>
              <Input
                id="email-pw"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hotel.com"
                required
                disabled={!isHydrated || loading}
                autoComplete="email"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700" htmlFor="password-pw">
                  Password
                </label>
                <a
                  href="/auth/reset-password"
                  className="text-sm text-amber-600 hover:text-amber-800"
                >
                  Forgot password?
                </a>
              </div>
              <Input
                id="password-pw"
                type="password"
                disabled={!isHydrated || loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!isHydrated || loading || !email || !password}
            >
              {loading ? (
                <>
                  <Spinner className="text-white" />
                  Signing in&hellip;
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        )}

        {/* ── Magic link tab ── */}
        {activeTab === 'magic' && (
          <form onSubmit={handleMagicLink} className="space-y-4" noValidate>
            <p className="text-sm text-slate-400">
              Enter your email and we&apos;ll send you a one-click sign-in link. No password
              required.
            </p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email-ml">
                Email
              </label>
              <Input
                id="email-ml"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hotel.com"
                required
                disabled={!isHydrated || loading}
                autoComplete="email"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!isHydrated || loading || !email}
            >
              {loading ? (
                <>
                  <Spinner className="text-white" />
                  Sending&hellip;
                </>
              ) : (
                'Send Magic Link'
              )}
            </Button>
          </form>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-slate-400">EN | ES</p>
      </motion.div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.08) 0%, transparent 70%), #FEFAF4' }}
      />
    }>
      <LoginContent />
    </Suspense>
  )
}
