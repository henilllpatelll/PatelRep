import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Density = 'comfortable' | 'balanced' | 'dense'
type Theme = 'light' | 'dark'
type Accent = 'terracotta' | 'teal' | 'blue' | 'rose'

interface UIPreferencesState {
  density: Density
  theme: Theme
  accent: Accent
  setDensity: (density: Density) => void
  setTheme: (theme: Theme) => void
  setAccent: (accent: Accent) => void
  toggleTheme: () => void
}

export const useUIPreferencesStore = create<UIPreferencesState>()(
  persist(
    (set, get) => ({
      density: 'balanced',
      theme: 'light',
      accent: 'terracotta',
      setDensity: (density) => set({ density }),
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
    }),
    { name: 'patelrep-ui-prefs' }
  )
)
