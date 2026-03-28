'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

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
        <div className="flex justify-center">
          <div className="bg-green-100 rounded-full p-3">
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
        </div>
        <h2 className="text-xl font-bold text-slate-900">Check your email</h2>
        <p className="text-sm text-slate-400">
          We sent a password reset link to <strong className="text-slate-700">{email}</strong>. It expires in 1 hour.
        </p>
        <a
          href="/login"
          className="inline-block mt-2 text-sm text-amber-600 hover:text-amber-800 font-medium"
        >
          &larr; Back to Login
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Reset Password</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="email">
          Email
        </label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@hotel.com"
          required
          autoComplete="email"
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={loading || !email}
      >
        {loading ? (
          <>
            <Spinner />
            Sending&hellip;
          </>
        ) : (
          'Send Reset Link'
        )}
      </Button>

      <div className="text-center">
        <a href="/login" className="text-sm text-amber-600 hover:text-amber-800 font-medium">
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
            className="w-8 h-8 text-amber-500 animate-spin"
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
        <p className="text-slate-400 text-sm">Verifying your link&hellip;</p>
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
        <h2 className="text-xl font-bold text-slate-900">Link expired or invalid</h2>
        <p className="text-sm text-red-600">{error}</p>
        <a
          href="/auth/reset-password"
          className="inline-block mt-2 text-sm text-amber-600 hover:text-amber-800 font-medium"
        >
          Request a new link
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Set New Password</h1>
        <p className="mt-1 text-sm text-slate-400">Choose a strong password for your account.</p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="new-password">
          New Password
        </label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="confirm-password">
          Confirm Password
        </label>
        <Input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Re-enter your password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={loading || !password || !confirm}
      >
        {loading ? (
          <>
            <Spinner />
            Updating&hellip;
          </>
        ) : (
          'Update Password'
        )}
      </Button>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const mode: Mode = code ? 'confirm' : 'request'

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.08) 0%, transparent 70%), #FEFAF4' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-md bg-white/80 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.08)] border border-amber-100/60 p-8"
      >
        <div className="text-center mb-6">
          <h1 className="text-3xl font-extrabold text-amber-600">✦ PatelRep</h1>
          <p className="text-sm text-slate-400 mt-1">Hotel Operations AI</p>
        </div>

        {mode === 'request' ? <RequestForm /> : <ConfirmForm code={code!} />}
      </motion.div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.08) 0%, transparent 70%), #FEFAF4' }}
      />
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}
