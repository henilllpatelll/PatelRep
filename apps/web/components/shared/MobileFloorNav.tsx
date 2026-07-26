'use client'

import { Bed, ClipboardList, LayoutDashboard, MessageSquare, Sparkles, Wrench } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/lib/hooks/useRole'
import { cn } from '@/lib/utils'
import { NAV_LABEL_KEYS } from '@/lib/utils/navigation'

interface FloorNavItem { href: string; label: string; icon: React.ElementType }

type FloorRole = 'housekeeper' | 'engineer' | 'front_desk'

const FLOOR_NAV: Record<FloorRole, FloorNavItem[]> = {
  housekeeper: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/housekeeping', label: 'My Rooms', icon: Bed },
    { href: '/guest-requests', label: 'Guest Requests', icon: MessageSquare },
  ],
  engineer: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/engineering/work-orders', label: 'Work Orders', icon: Wrench },
    { href: '/tasks', label: 'Tasks', icon: ClipboardList },
    { href: '/ai', label: 'AI Copilot', icon: Sparkles },
  ],
  front_desk: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/housekeeping', label: 'Housekeeping', icon: Bed },
    { href: '/guest-requests', label: 'Guest Requests', icon: MessageSquare },
    { href: '/tasks', label: 'Tasks', icon: ClipboardList },
  ],
}

function isFloorRole(role: string | null): role is FloorRole {
  return role === 'housekeeper' || role === 'engineer' || role === 'front_desk'
}

/** Bottom tab bar for floor roles only — managers keep the sidebar + mobile drawer. */
export function MobileFloorNav() {
  const pathname = usePathname()
  const { role } = useRole()
  const { t } = useTranslation()

  if (!isFloorRole(role)) return null
  const items = FLOOR_NAV[role]

  return (
    <nav
      aria-label={t('nav.floorNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
              active ? 'text-accent' : 'text-ink3'
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            <span>{t(NAV_LABEL_KEYS[label] ?? label)}</span>
          </Link>
        )
      })}
    </nav>
  )
}
