'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Building2, Layers, Sliders, ShieldCheck,
  ClipboardList, Hotel, CreditCard, Link2,
} from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { cn } from '@/lib/utils'

// ─── Nav config ───────────────────────────────────────────────────────────────

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  roles?: string[]
}

interface NavGroup {
  label?: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/settings/general', label: 'General', icon: Building2 },
      { href: '/settings/departments', label: 'Departments', icon: Layers },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/settings/front-desk', label: 'Front Desk', icon: Sliders, roles: ['gm'] },
      { href: '/settings/roles', label: 'Roles', icon: ShieldCheck, roles: ['gm'] },
      {
        href: '/settings/inspections', label: 'Inspections', icon: ClipboardList,
        roles: ['gm', 'housekeeping_supervisor'],
      },
      { href: '/settings/rooms', label: 'Rooms', icon: Hotel, roles: ['gm'] },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/settings/billing', label: 'Billing', icon: CreditCard, roles: ['gm'] },
      { href: '/settings/integrations', label: 'Integrations', icon: Link2, roles: ['gm'] },
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { role, isGM } = useRole()

  function canSee(item: NavItem): boolean {
    if (!item.roles) return true
    if (isGM) return true
    return item.roles.includes(role ?? '')
  }

  const flatItems = NAV_GROUPS.flatMap(g => g.items).filter(canSee)

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-display font-normal text-ink tracking-tight">Settings</h1>
        <p className="text-sm text-stone-500 mt-1">Manage your hotel profile and configuration.</p>
      </div>

      {/* Mobile nav — horizontal scrollable row */}
      <nav
        className="flex overflow-x-auto gap-0.5 pb-2 border-b border-line sm:hidden"
        aria-label="Settings navigation"
      >
        {flatItems.map(item => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-[var(--caution-soft)] text-[var(--caution)] font-medium'
                  : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100/70',
              )}
            >
              <item.icon size={14} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Desktop two-panel layout */}
      <div className="hidden sm:flex gap-8 items-start">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 space-y-5" aria-label="Settings navigation">
          {NAV_GROUPS.map((group, gi) => {
            const visible = group.items.filter(canSee)
            if (visible.length === 0) return null
            return (
              <div key={gi} className="space-y-0.5">
                {group.label && (
                  <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                    {group.label}
                  </p>
                )}
                {visible.map(item => {
                  const active = isActive(pathname, item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                        active
                          ? 'bg-[var(--caution-soft)] text-[var(--caution)] font-medium'
                          : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100/70',
                      )}
                    >
                      <item.icon size={15} />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>

      {/* Mobile content (below nav) */}
      <div className="sm:hidden">{children}</div>
    </div>
  )
}
