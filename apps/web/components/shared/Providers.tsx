'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore, type UserRole } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { ApiClientError, apiClient } from '@/lib/api/client'
import { staffApi } from '@/lib/api/staff'
import { isPublicRoute } from '@/lib/utils/routeGuard'
import { LanguageSync } from '@/components/shared/LanguageSync'

// ── Types ──────────────────────────────────────────────────────────────────────
/** Hotel-context refresh cadence (tenant feature flags reach an open tab this way). /auth/* is limited to 10/min per user. */
const CONTEXT_REFRESH_INTERVAL_MS = 10 * 60 * 1000
/** A visibility/online-triggered refresh is skipped when the last attempt was more recent than this. */
const CONTEXT_MIN_REFRESH_GAP_MS = 2 * 60 * 1000

interface MeResponse {
  user: {
    id: string
    email: string
    role: UserRole
    full_name?: string | null
    preferred_name?: string | null
  }
  hotel: {
    id: string
    name: string
    timezone: string
    room_count: number
    logo_url?: string
    web_redesign_sections?: string[]
    enabled_features?: string[]
  }
  hotels?: Array<{
    id: string
    name: string
    timezone: string
    room_count: number
    logo_url?: string
    front_desk_modules?: string[]
    web_redesign_sections?: string[]
    enabled_features?: string[]
  }>
  subscription: {
    plan_status: string
    credits_included: number
    cap_cents?: number
  }
}

// Standard Supabase/Postgres DB roles — never our app roles
const SUPABASE_DB_ROLES = new Set(['authenticated', 'anon', 'service_role', 'postgres'])
const APP_ROLE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function writeAppRoleCookie(role: UserRole | null) {
  if (typeof document === 'undefined') return
  if (!role) {
    document.cookie = 'pr_role=; Path=/; Max-Age=0; SameSite=Lax'
    return
  }
  document.cookie = `pr_role=${encodeURIComponent(role)}; Path=/; Max-Age=${APP_ROLE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
}

function decodeJwtRole(accessToken: string | undefined): UserRole | null {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>
    const role = (claims.user_role ?? claims.role) as string | undefined
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
    setFullName,
    setEffectiveRole,
    setCustomRoleModules,
    setLoading,
    clear,
  } = useAuthStore()
  const { setContext, setSubscription, clear: clearHotel } = useHotelStore()
  const router = useRouter()
  // Guard against concurrent /auth/me fetches
  const fetchingRef = useRef(false)
  // When the last /auth/me attempt started; focus/reconnect refreshes inside the min gap are skipped (rate limit).
  const lastAttemptRef = useRef(0)

  useEffect(() => {
    const supabase = createClient()
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

    // `refresh` re-reads only the hotel context (the tenant feature flags). It never touches the
    // role, name or schedule, so a background refresh cannot change what a signed-in person is allowed to do.
    const fetchProfile = async (refresh = false) => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      lastAttemptRef.current = Date.now()
      // Who this read is for. If the signed-in person changes while it is in flight, its answer is discarded.
      const requestedFor = useAuthStore.getState().user?.id ?? null
      try {
        // /auth/me sits behind the strict auth rate limit; a burst of page loads can get a 429.
        // Without the profile the hotel store stays empty and hotel-gated pages never render,
        // so wait out Retry-After (bounded) and retry instead of leaving the session half-loaded.
        let data: MeResponse | undefined
        for (let attempt = 0; !data; attempt += 1) {
          try {
            data = await apiClient.get('/auth/me')
          } catch (err) {
            if (!(err instanceof ApiClientError) || err.status !== 429 || refresh || attempt >= 2) throw err
            const waitSeconds = Math.min(Math.max(err.retryAfterSeconds ?? 5, 1), 60)
            await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
          }
        }
        if ((useAuthStore.getState().user?.id ?? null) !== requestedFor) return
        setContext({ hotel: data.hotel, hotels: data.hotels, userId: requestedFor, fetchedAt: Date.now() })
        setSubscription(data.subscription)
        if (refresh) return
        // If the API returns a role, overwrite what we got from the JWT
        if (data.user?.role) {
          setRole(data.user.role)
          writeAppRoleCookie(data.user.role)
        }
        const displayName = data.user?.preferred_name?.trim() || data.user?.full_name?.trim()
        if (displayName) {
          setFullName(displayName)
        }
        await fetchEffectiveRole()
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          clear()
          clearHotel()
          writeAppRoleCookie(null)
          await supabase.auth.signOut().catch(() => undefined)
          if (typeof window !== 'undefined' && !isPublicRoute(window.location.pathname)) {
            router.replace('/login?reason=session-expired')
          }
        } else if (err instanceof ApiClientError && err.status === 403) {
          clearHotel()
          setEffectiveRole(null)
          setCustomRoleModules(null)
          if (
            typeof window !== 'undefined' &&
            !isPublicRoute(window.location.pathname) &&
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
        const role = extractRole(
          session,
          session.user.app_metadata as Record<string, unknown>,
          session.user.user_metadata as Record<string, unknown>,
        )
        setRole(role)
        writeAppRoleCookie(role)
        fetchProfile()
      }
      setLoading(false)
    }).catch(() => {
      // Network error getting session — treat as unauthenticated
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        // A different person must never inherit the previous person's hotel context (and with it its design).
        if (useAuthStore.getState().user?.id !== session.user.id) clearHotel()
        setUser(session.user)
        setSession(session)
        const role = extractRole(
          session,
          session.user.app_metadata as Record<string, unknown>,
          session.user.user_metadata as Record<string, unknown>,
        )
        setRole(role)
        writeAppRoleCookie(role)
        fetchProfile()
        setLoading(false)
      } else if ((event as string) === 'TOKEN_REFRESH_FAILED') {
        clear()
        clearHotel()
        writeAppRoleCookie(null)
        if (typeof window !== 'undefined' && !isPublicRoute(window.location.pathname)) {
          router.replace('/login?reason=session-expired')
        }
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user)
        setSession(session)
        const role = extractRole(
          session,
          session.user.app_metadata as Record<string, unknown>,
          session.user.user_metadata as Record<string, unknown>,
        )
        setRole(role)
        writeAppRoleCookie(role)
        // The token refresh is also how a hotel change reaches this tab; re-read the hotel context behind it.
        void fetchProfile(true)
      } else if (event === 'USER_UPDATED' && session?.user) {
        setUser(session.user)
        setSession(session)
        const role = extractRole(
          session,
          session.user.app_metadata as Record<string, unknown>,
          session.user.user_metadata as Record<string, unknown>,
        )
        setRole(role)
        writeAppRoleCookie(role)
      } else if (event === 'SIGNED_OUT') {
        clear()
        clearHotel()
        writeAppRoleCookie(null)
        if (typeof window !== 'undefined' && !isPublicRoute(window.location.pathname)) {
          router.replace('/login?reason=session-expired')
        }
      }
    })

    const handleSessionExpired = () => {
      clear()
      clearHotel()
      writeAppRoleCookie(null)
      if (typeof window !== 'undefined' && !isPublicRoute(window.location.pathname)) {
        router.replace('/login?reason=session-expired')
      }
    }
    window.addEventListener('patelrep:session-expired', handleSessionExpired)

    // Context refresh (how a tenant feature flag flipped by Feature Rollout reaches an open tab): when the tab becomes visible or the
    // network returns, and on a slow timer while visible. Skipped when signed out or when one ran moments ago.
    const refreshIfDue = (minGapMs: number) => {
      if (!useAuthStore.getState().user) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (Date.now() - lastAttemptRef.current < minGapMs) return
      void fetchProfile(true)
    }
    const onVisible = () => refreshIfDue(CONTEXT_MIN_REFRESH_GAP_MS)
    const onOnline = () => refreshIfDue(CONTEXT_MIN_REFRESH_GAP_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    const refreshTimer = window.setInterval(() => refreshIfDue(CONTEXT_REFRESH_INTERVAL_MS - 1000), CONTEXT_REFRESH_INTERVAL_MS)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('patelrep:session-expired', handleSessionExpired)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.clearInterval(refreshTimer)
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
      <MotionConfig reducedMotion="user">
        <LanguageSync>
          <AuthListener />
          {children}
        </LanguageSync>
      </MotionConfig>
    </QueryClientProvider>
  )
}
