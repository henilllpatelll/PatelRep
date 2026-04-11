'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore, type UserRole } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { apiClient } from '@/lib/api/client'

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
  subscription: {
    plan_status: string
    credits_included: number
    cap_cents?: number
  }
}

function extractRole(appMeta: Record<string, unknown>, userMeta: Record<string, unknown>): UserRole | null {
  const role = appMeta?.role ?? userMeta?.role
  return (role as UserRole) ?? null
}

// ── Auth listener component (keeps Providers clean) ────────────────────────────
function AuthListener() {
  const { setUser, setSession, setRole, setLoading, clear } = useAuthStore()
  const { setHotel, setSubscription, clear: clearHotel } = useHotelStore()
  const supabase = createClient()
  // Guard against concurrent /auth/me fetches
  const fetchingRef = useRef(false)

  useEffect(() => {
    const fetchProfile = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        const data: MeResponse = await apiClient.get('/auth/me')
        setHotel(data.hotel)
        setSubscription(data.subscription)
        // If the API returns a role, overwrite what we got from the JWT
        if (data.user?.role) {
          setRole(data.user.role)
        }
      } catch {
        // Non-fatal: hotel data simply won't be populated yet (e.g. new user)
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
            session.user.app_metadata as Record<string, unknown>,
            session.user.user_metadata as Record<string, unknown>,
          ),
        )
      } else if (event === 'USER_UPDATED' && session?.user) {
        setUser(session.user)
        setSession(session)
        setRole(extractRole(
          session.user.app_metadata as Record<string, unknown>,
          session.user.user_metadata as Record<string, unknown>,
        ))
      } else if (event === 'SIGNED_OUT') {
        clear()
        clearHotel()
      }
    })

    return () => {
      subscription.unsubscribe()
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
