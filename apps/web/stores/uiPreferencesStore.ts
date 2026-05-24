import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Density = 'comfortable' | 'balanced' | 'dense'
type Theme = 'light' | 'dark'

interface UIPreferencesState {
  density: Density
  theme: Theme
  setDensity: (density: Density) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useUIPreferencesStore = create<UIPreferencesState>()(
  persist(
    (set, get) => ({
      density: 'balanced',
      theme: 'light',
      setDensity: (density) => set({ density }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
    }),
    { name: 'patelrep-ui-prefs' }
  )
)
