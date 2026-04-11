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
  /** Day-of-week schedule override. null = use base role. Never persisted — re-fetched each session. */
  effectiveRole: UserRole | null
  /** allowed_modules from the staff member's assigned custom role. null = no custom role. Never persisted. */
  customRoleModules: string[] | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setSession: (session: Session | null) => void
  setRole: (role: UserRole | null) => void
  setEffectiveRole: (role: UserRole | null) => void
  setCustomRoleModules: (modules: string[] | null) => void
  setLoading: (isLoading: boolean) => void
  clear: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      session: null,
      role: null,
      effectiveRole: null,
      customRoleModules: null,
      isLoading: true,
      setUser: (user) => set({ user }),
      setSession: (session) => set({ session }),
      setRole: (role) => set({ role }),
      setEffectiveRole: (effectiveRole) => set({ effectiveRole }),
      setCustomRoleModules: (customRoleModules) => set({ customRoleModules }),
      setLoading: (isLoading) => set({ isLoading }),
      clear: () => set({ user: null, session: null, role: null, effectiveRole: null, customRoleModules: null, isLoading: false }),
    }),
    {
      name: 'auth-store',
      // effectiveRole is deliberately excluded — it's re-fetched fresh each session load
      partialize: (state) => ({ user: state.user, session: state.session, role: state.role }),
    }
  )
)
