import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Session, User } from '@supabase/supabase-js'

export type UserRole =
  | 'gm'
  | 'housekeeping_supervisor'
  | 'chief_engineer'
  | 'housekeeper'
  | 'engineer'
  | 'front_desk'

interface AuthStore {
  user: User | null
  session: Session | null
  role: UserRole | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setSession: (session: Session | null) => void
  setRole: (role: UserRole | null) => void
  setLoading: (isLoading: boolean) => void
  clear: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      session: null,
      role: null,
      isLoading: true,
      setUser: (user) => set({ user }),
      setSession: (session) => set({ session }),
      setRole: (role) => set({ role }),
      setLoading: (isLoading) => set({ isLoading }),
      clear: () => set({ user: null, session: null, role: null, isLoading: false }),
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({ user: state.user, session: state.session }),
    }
  )
)
