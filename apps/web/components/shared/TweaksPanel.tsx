'use client'

import { useState } from 'react'
import { Settings2, Sun, Moon, X } from 'lucide-react'
import { useUIPreferencesStore } from '@/stores/uiPreferencesStore'
import { cn } from '@/lib/utils'

type Density = 'comfortable' | 'balanced' | 'dense'
type Accent = 'terracotta' | 'teal' | 'blue' | 'rose'

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'dense', label: 'Dense' },
]

const ACCENT_OPTIONS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'terracotta', label: 'Terracotta', swatch: '#b8431c' },
  { value: 'teal', label: 'Teal', swatch: '#0c6e63' },
  { value: 'blue', label: 'Blue', swatch: '#265d8a' },
  { value: 'rose', label: 'Rose', swatch: '#a6263c' },
]

export function TweaksPanel() {
  const [open, setOpen] = useState(false)
  const { density, theme, accent, setDensity, setAccent, toggleTheme } = useUIPreferencesStore()

  return (
    <div className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="bg-surface border border-line rounded-[var(--r-lg)] shadow-pop w-52 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Display</span>
            <button onClick={() => setOpen(false)} className="text-ink4 hover:text-ink transition-colors" aria-label="Close tweaks">
              <X size={12} />
            </button>
          </div>

          {/* Theme */}
          <div>
            <p className="text-[10px] text-ink3 mb-1.5">Theme</p>
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-2 border border-line text-xs font-medium text-ink2 hover:bg-surface-3 transition-colors"
            >
              {theme === 'dark' ? <Moon size={12} /> : <Sun size={12} />}
              {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              <span className="ml-auto text-ink4 text-[10px]">toggle</span>
            </button>
          </div>

          {/* Density */}
          <div>
            <p className="text-[10px] text-ink3 mb-1.5">Density</p>
            <div className="flex gap-1">
              {DENSITY_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDensity(value)}
                  className={cn(
                    'flex-1 py-1.5 rounded-md text-[10px] font-medium transition-colors',
                    density === value
                      ? 'bg-ink text-paper'
                      : 'bg-surface-2 text-ink3 hover:bg-surface-3'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Accent */}
          <div>
            <p className="text-[10px] text-ink3 mb-1.5">Accent</p>
            <div className="grid grid-cols-4 gap-1.5">
              {ACCENT_OPTIONS.map(({ value, label, swatch }) => (
                <button
                  key={value}
                  onClick={() => setAccent(value)}
                  className={cn(
                    'h-8 rounded-md border transition-all flex items-center justify-center',
                    accent === value ? 'border-ink ring-2 ring-[var(--accent-soft)]' : 'border-line hover:border-ink4'
                  )}
                  aria-label={`Use ${label} accent`}
                  title={label}
                >
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: swatch }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Display preferences"
        className={cn(
          'w-9 h-9 flex items-center justify-center rounded-full border shadow-md transition-all',
          open
            ? 'bg-ink text-paper border-ink'
            : 'bg-surface border-line text-ink3 hover:bg-surface-2'
        )}
      >
        <Settings2 size={15} />
      </button>
    </div>
  )
}
