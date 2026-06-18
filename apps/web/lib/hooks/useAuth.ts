'use client'

import type { Session, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/authStore'

export interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const { user, session, isLoading, clear } = useAuthStore()
  const supabase = createClient()

  const signOut = async (): Promise<void> => {
    try {
      await supabase.auth.signOut()
    } catch {
      // Always clear local state even if the server-side sign-out fails
    } finally {
      clear()
    }
  }

  return { user, session, loading: isLoading, signOut }
}
