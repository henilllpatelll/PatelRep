'use client'

import { useEffect, useId, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronDown, ShieldAlert } from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { cn } from '@/lib/utils'
import {
  canAccessSettings, getVisibleDestinations, resolveActiveDestination,
} from '@/lib/settings/navigation'
import { SettingsNav } from '@/components/settings/workspace/SettingsNav'
import { SETTINGS_ICONS } from '@/components/settings/workspace/settingsIcons'
import { SettingsLoading } from '@/components/settings/workspace/SettingsStates'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { role } = useRole()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()

  // Collapse the small-screen menu whenever the route changes.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  const active = resolveActiveDestination(pathname)
  const destinations = getVisibleDestinations(role)
  const onHome = active?.id === 'home'
  const ActiveIcon = active ? SETTINGS_ICONS[active.icon] : null

  // Defense in depth: the route guard and API already enforce this; never rely on hidden navigation alone.
  if (!role) return <SettingsLoading />
  if (!canAccessSettings(role)) {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <ShieldAlert className="h-8 w-8 text-ink-3" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-ink">Settings are limited to General Managers</h1>
        <p className="text-sm text-ink-3">Ask your GM if you need a configuration changed.</p>
        <Link href="/dashboard" className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-normal tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-3">Configure your property, operations, people and connected systems.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0" aria-label="Settings sidebar">
          {/* Below lg: route context + a disclosure that reveals the same grouped navigation. */}
          <div className="space-y-2 lg:hidden">
            {!onHome && (
              <Link
                href="/settings"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-medium text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <ArrowLeft size={15} aria-hidden="true" /> Settings home
              </Link>
            )}
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex min-h-[48px] w-full items-center gap-3 rounded-[var(--r-lg)] border border-line bg-surface px-4 text-left shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              {ActiveIcon && <ActiveIcon size={18} className="shrink-0 text-ink-3" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-3">Settings menu</span>
                <span className="block truncate text-sm font-medium text-ink">{active?.label ?? 'Settings'}</span>
              </span>
              <ChevronDown size={18} className={cn('shrink-0 text-ink-3 transition-transform motion-reduce:transition-none', menuOpen && 'rotate-180')} aria-hidden="true" />
            </button>
          </div>

          <div
            id={menuId}
            className={cn(
              'mt-2 rounded-[var(--r-lg)] border border-line bg-surface p-3 shadow-card lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none',
              menuOpen ? 'block' : 'hidden',
            )}
          >
            <SettingsNav
              destinations={destinations}
              activeId={active?.id}
              role={role}
              onNavigate={() => setMenuOpen(false)}
            />
          </div>
        </aside>

        <div role="region" className="min-w-0 space-y-4" aria-label={active?.label ?? 'Settings'}>
          {active?.relatedPages && (
            <nav aria-label={`${active.label} pages`} className="flex flex-wrap gap-1 border-b border-line">
              {active.relatedPages.map((page) => {
                const current = pathname === page.href || pathname.startsWith(page.href + '/')
                return (
                  <Link
                    key={page.href}
                    href={page.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      '-mb-px inline-flex min-h-[44px] items-center border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:min-h-[40px]',
                      current ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-ink-3 hover:text-ink',
                    )}
                  >
                    {page.label}
                  </Link>
                )
              })}
            </nav>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
