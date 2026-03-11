'use client'

import { useEffect } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore, type UserRole } from '@/stores/authStore'

export interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

function extractRole(user: User | null): UserRole | null {
  if (!user) return null
  // Role may be stored in app_metadata (set by the Auth hook / Edge Function)
  // or fall back to user_metadata for dev convenience
  const role =
    (user.app_metadata as Record<string, unknown>)?.role ??
    (user.user_metadata as Record<string, unknown>)?.role
  return (role as UserRole) ?? null
}

export function useAuth(): AuthState {
  const { user, session, isLoading, setUser, setSession, setRole, setLoading, clear } =
    useAuthStore()

  const supabase = createClient()

  useEffect(() => {
    // Get the current session on mount
    const initSession = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()

      if (currentSession?.user) {
        setUser(currentSession.user)
        setSession(currentSession)
        setRole(extractRole(currentSession.user))
      }
      setLoading(false)
    }

    initSession()

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession?.user) {
        setUser(newSession.user)
        setSession(newSession)
        setRole(extractRole(newSession.user))
      } else {
        clear()
      }
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = async (): Promise<void> => {
    await supabase.auth.signOut()
    clear()
  }

  return { user, session, loading: isLoading, signOut }
}
