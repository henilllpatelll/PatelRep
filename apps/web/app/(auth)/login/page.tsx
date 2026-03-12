'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<Tab>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [error, setError] = useState('')

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full p-8 bg-white rounded-xl shadow-lg space-y-6 text-center">
          <div>
            <h1 className="text-3xl font-bold text-brand-700">PatelRep</h1>
            <p className="mt-1 text-gray-500 text-sm">Hotel Operations AI</p>
          </div>

          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
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
            <h2 className="text-xl font-semibold text-gray-900">Check your email</h2>
            <p className="mt-2 text-sm text-gray-500">
              We sent a magic link to <strong>{email}</strong>. Click the link to sign in. It
              expires in 1 hour.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setMagicLinkSent(false)
              setError('')
            }}
            className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium"
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
        </div>
      </div>
    )
  }

  // ── Login card ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8 bg-white rounded-xl shadow-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-brand-700">PatelRep</h1>
          <p className="mt-1 text-gray-500 text-sm">Hotel Operations AI</p>
        </div>

        {/* Tab toggle */}
        <div className="flex rounded-lg border border-gray-200 p-1 bg-gray-50">
          <button
            type="button"
            onClick={() => handleTabChange('password')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'password'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('magic')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'magic'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
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
              <label className="block text-sm font-medium text-gray-700" htmlFor="email-pw">
                Email
              </label>
              <input
                id="email-pw"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="you@hotel.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700" htmlFor="password-pw">
                  Password
                </label>
                <a
                  href="/auth/reset-password"
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  Forgot password?
                </a>
              </div>
              <input
                id="password-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="••••••••••••"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-2 px-4 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <Spinner className="text-white" />
                  Signing in&hellip;
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        )}

        {/* ── Magic link tab ── */}
        {activeTab === 'magic' && (
          <form onSubmit={handleMagicLink} className="space-y-4" noValidate>
            <p className="text-sm text-gray-500">
              Enter your email and we&apos;ll send you a one-click sign-in link. No password
              required.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="email-ml">
                Email
              </label>
              <input
                id="email-ml"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="you@hotel.com"
                required
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-2 px-4 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <Spinner className="text-white" />
                  Sending&hellip;
                </>
              ) : (
                'Send Magic Link'
              )}
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400">EN | ES</p>
      </div>
    </div>
  )
}
