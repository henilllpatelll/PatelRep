'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore, type UserRole } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { ApiClientError, apiClient } from '@/lib/api/client'
import { staffApi } from '@/lib/api/staff'

// ── Types ──────────────────────────────────────────────────────────────────────
interface MeResponse {
  user: {
    id: string
    email: string
    role: UserRole
    full_name: string
  }
  hotel: {
    id: string
    name: string
    timezone: string
    room_count: number
    logo_url?: string
  }
  hotels?: Array<{
    id: string
    name: string
    timezone: string
    room_count: number
    logo_url?: string
    front_desk_modules?: string[]
  }>
  subscription: {
    plan_status: string
    credits_included: number
    cap_cents?: number
  }
}

// Standard Supabase/Postgres DB roles — never our app roles
const SUPABASE_DB_ROLES = new Set(['authenticated', 'anon', 'service_role', 'postgres'])

function decodeJwtRole(accessToken: string | undefined): UserRole | null {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>
    const role = claims.role as string | undefined
    if (role && !SUPABASE_DB_ROLES.has(role)) return role as UserRole
  } catch {
    // Ignore malformed JWT
  }
  return null
}

function extractRole(session: Session | null, appMeta: Record<string, unknown>, userMeta: Record<string, unknown>): UserRole | null {
  // Primary: decode JWT access token — role is a top-level custom claim from the JWT hook
  const jwtRole = decodeJwtRole(session?.access_token)
  if (jwtRole) return jwtRole
  // Fallback: app_metadata / user_metadata (older hook format)
  const role = appMeta?.role ?? userMeta?.role
  return (role as UserRole) ?? null
}

// ── Auth listener component (keeps Providers clean) ────────────────────────────
function AuthListener() {
  const {
    setUser,
    setSession,
    setRole,
    setEffectiveRole,
    setCustomRoleModules,
    setLoading,
    clear,
  } = useAuthStore()
  const { setHotel, setHotels, setSubscription, clear: clearHotel } = useHotelStore()
  const supabase = createClient()
  const router = useRouter()
  // Guard against concurrent /auth/me fetches
  const fetchingRef = useRef(false)

  useEffect(() => {
    const fetchEffectiveRole = async () => {
      try {
        const res = await staffApi.getEffectiveRole()
        setEffectiveRole((res.data?.effective_role as UserRole) ?? null)
        setCustomRoleModules(res.data?.custom_role?.allowed_modules ?? null)
      } catch {
        // Non-critical context. Base JWT role remains the source of truth.
        setEffectiveRole(null)
        setCustomRoleModules(null)
      }
    }

    const fetchProfile = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        const data: MeResponse = await apiClient.get('/auth/me')
        setHotel(data.hotel)
        setHotels(data.hotels?.length ? data.hotels : [data.hotel])
        setSubscription(data.subscription)
        // If the API returns a role, overwrite what we got from the JWT
        if (data.user?.role) {
          setRole(data.user.role)
        }
        await fetchEffectiveRole()
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          clear()
          clearHotel()
          await supabase.auth.signOut().catch(() => undefined)
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            router.replace('/login?reason=session-expired')
          }
        } else if (err instanceof ApiClientError && err.status === 403) {
          clearHotel()
          setEffectiveRole(null)
          setCustomRoleModules(null)
          if (
            typeof window !== 'undefined' &&
            !window.location.pathname.startsWith('/login') &&
            !window.location.pathname.startsWith('/onboarding')
          ) {
            router.replace('/onboarding')
          }
        }
      } finally {
        fetchingRef.current = false
      }
    }

    // Hydrate from existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        setSession(session)
        setRole(
          extractRole(
            session,
            session.user.app_metadata as Record<string, unknown>,
            session.user.user_metadata as Record<string, unknown>,
          ),
        )
        fetchProfile()
      }
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user)
        setSession(session)
        setRole(
          extractRole(
            session,
            session.user.app_metadata as Record<string, unknown>,
            session.user.user_metadata as Record<string, unknown>,
          ),
        )
        fetchProfile()
        setLoading(false)
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user)
        setSession(session)
        setRole(
          extractRole(
            session,
            session.user.app_metadata as Record<string, unknown>,
            session.user.user_metadata as Record<string, unknown>,
          ),
        )
      } else if (event === 'USER_UPDATED' && session?.user) {
        setUser(session.user)
        setSession(session)
        setRole(extractRole(
          session,
          session.user.app_metadata as Record<string, unknown>,
          session.user.user_metadata as Record<string, unknown>,
        ))
      } else if (event === 'SIGNED_OUT') {
        clear()
        clearHotel()
      }
    })

    const handleSessionExpired = () => {
      clear()
      clearHotel()
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        router.replace('/login?reason=session-expired')
      }
    }
    window.addEventListener('patelrep:session-expired', handleSessionExpired)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('patelrep:session-expired', handleSessionExpired)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

// ── Root Providers component ───────────────────────────────────────────────────
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,        // 30 seconds
            refetchInterval: 60 * 1000,  // auto-refresh every 60s — no manual refresh needed
            refetchOnWindowFocus: true,  // fresh data when staff switch back to the tab
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthListener />
      {children}
    </QueryClientProvider>
  )
}
