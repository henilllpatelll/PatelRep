'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MOBILE_ONLY_ROLES, type UserRole } from '@/lib/utils/routeGuard'

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const norm = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = norm.padEnd(norm.length + ((4 - (norm.length % 4)) % 4), '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch { return {} }
}

async function checkMobileOnly(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  const claims = decodeJwtPayload(data.session?.access_token ?? '')
  const role = (claims.user_role ?? claims.role) as UserRole | undefined
  return !!role && MOBILE_ONLY_ROLES.has(role)
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()
      const code = searchParams.get('code')
      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type') as 'magiclink' | 'recovery' | 'invite' | null
      const redirectTo = searchParams.get('next') ?? '/dashboard'

      if (tokenHash && type) {
        const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (verifyError) { setError(verifyError.message); return }
        if (await checkMobileOnly(supabase)) {
          await supabase.auth.signOut()
          router.replace('/login?mobileOnly=1')
          return
        }
        router.replace(redirectTo)
        return
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) { setError(exchangeError.message); return }
        if (await checkMobileOnly(supabase)) {
          await supabase.auth.signOut()
          router.replace('/login?mobileOnly=1')
          return
        }
        router.replace(redirectTo)
        return
      }

      router.replace(redirectTo)
    }

    handleCallback()
  }, [router, searchParams])

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div>
          <span className="text-accent font-mono text-lg font-bold tracking-tight">&#10022; PatelRep</span>
        </div>

        {error ? (
          <>
            <div className="w-12 h-12 rounded-full bg-[var(--alert-soft)] flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-[var(--alert)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-2xl text-ink">Authentication failed</h2>
              <p className="text-[13px] text-[var(--alert)] mt-2">{error}</p>
              <p className="text-[13px] text-ink-3 mt-1 leading-relaxed">
                Your link may have expired or already been used. Please request a new one.
              </p>
            </div>
            <a href="/login" className="inline-block text-[13px] text-accent font-medium hover:opacity-80 transition-opacity">
              &larr; Back to Login
            </a>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <Spinner />
            </div>
            <p className="text-[13px] text-ink-2 font-medium">Signing you in&hellip;</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <span className="text-accent font-mono text-lg font-bold tracking-tight">&#10022; PatelRep</span>
          <div className="flex justify-center">
            <svg className="w-5 h-5 animate-spin text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <p className="text-[13px] text-ink-2 font-medium">Signing you in&hellip;</p>
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  )
}
