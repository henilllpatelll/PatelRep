'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'request' | 'confirm'

function Spinner() {
  return (
    <svg
      className="w-5 h-5 text-white animate-spin"
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

// ── Request mode: ask for email, send reset link ──────────────────────────────
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

    if (resetError) {
      setError(resetError.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg
            className="w-6 h-6 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Check your email</h2>
        <p className="text-sm text-gray-500">
          We sent a password reset link to <strong>{email}</strong>. It expires in 1 hour.
        </p>
        <a
          href="/login"
          className="inline-block mt-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
        >
          &larr; Back to Login
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Reset Password</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="email">
          Email
        </label>
        <input
          id="email"
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
        className="w-full py-2 px-4 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Spinner />
            Sending&hellip;
          </>
        ) : (
          'Send Reset Link'
        )}
      </button>

      <div className="text-center">
        <a href="/login" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
          &larr; Back to Login
        </a>
      </div>
    </form>
  )
}

// ── Confirm mode: set new password ────────────────────────────────────────────
function ConfirmForm({ code }: { code: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [exchanging, setExchanging] = useState(true)
  const [error, setError] = useState('')

  // Exchange the code for a session first so updateUser works
  useEffect(() => {
    const exchange = async () => {
      const supabase = createClient()
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeError) {
        setError(exchangeError.message)
      }
      setExchanging(false)
    }
    exchange()
  }, [code])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }
    router.replace('/dashboard')
  }

  if (exchanging) {
    return (
      <div className="text-center space-y-3">
        <div className="flex justify-center">
          <svg
            className="w-8 h-8 text-brand-600 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
        <p className="text-gray-500 text-sm">Verifying your link&hellip;</p>
      </div>
    )
  }

  if (error && exchanging === false && !password) {
    // Exchange failed — link invalid or expired
    return (
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <svg
            className="w-6 h-6 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Link expired or invalid</h2>
        <p className="text-sm text-red-600">{error}</p>
        <a
          href="/auth/reset-password"
          className="inline-block mt-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
        >
          Request a new link
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Set New Password</h1>
        <p className="mt-1 text-sm text-gray-500">Choose a strong password for your account.</p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="new-password">
          New Password
        </label>
        <input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="At least 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="confirm-password">
          Confirm Password
        </label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="Re-enter your password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !password || !confirm}
        className="w-full py-2 px-4 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Spinner />
            Updating&hellip;
          </>
        ) : (
          'Update Password'
        )}
      </button>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ResetPasswordPage() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const mode: Mode = code ? 'confirm' : 'request'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8 bg-white rounded-xl shadow-lg">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-brand-700">PatelRep</h1>
          <p className="mt-1 text-sm text-gray-500">Hotel Operations AI</p>
        </div>

        {mode === 'request' ? <RequestForm /> : <ConfirmForm code={code!} />}
      </div>
    </div>
  )
}
