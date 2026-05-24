'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Settings, ChevronDown, Menu } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { useHotelStore } from '@/stores/hotelStore'
import type { UserRole } from '@/stores/authStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/housekeeping': 'Housekeeping',
  '/housekeeping/assignments': 'Assignments',
  '/housekeeping/inspections': 'Inspections',
  '/housekeeping/rooms': 'All Rooms',
  '/engineering': 'Engineering',
  '/engineering/work-orders': 'Work Orders',
  '/engineering/assets': 'Assets',
  '/engineering/pm-schedules': 'PM Schedules',
  '/engineering/predictions': 'Predictions',
  '/staff': 'Staff',
  '/scheduling': 'Schedule',
  '/logbook': 'Logbook',
  '/sop': 'SOP Library',
  '/reports': 'Reports',
  '/billing': 'Billing',
  '/settings': 'Settings',
  '/settings/billing': 'Billing',
  '/settings/integrations': 'Integrations',
  '/guest-requests': 'Guest Requests',
  '/lost-found': 'Lost & Found',
  '/tasks': 'Tasks',
  '/onboarding': 'Setup',
  '/ai': 'AI Copilot',
}

const ROLE_LABELS: Record<UserRole, string> = {
  gm: 'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

interface HeaderProps {
  onMenuToggle?: () => void
}

export function Header({ onMenuToggle }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { hotel } = useHotelStore()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const title =
    PAGE_TITLES[pathname] ??
    Object.entries(PAGE_TITLES)
      .sort((a, b) => b[0].length - a[0].length)
      .find(([key]) => pathname.startsWith(key + '/'))?.[1] ??
    'PatelRep'

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.app_metadata?.full_name as string | undefined) ||
    user?.email ||
    'User'

  const role: UserRole | null =
    ((user?.app_metadata?.role as UserRole | undefined) ??
      (user?.user_metadata?.role as UserRole | undefined)) ??
    null

  const initials = getInitials(fullName)
  const avatarBg = getAvatarColor(fullName)
  const roleLabel = role ? ROLE_LABELS[role] : null

  const handleSignOut = async () => {
    setDropdownOpen(false)
    await signOut()
    router.push('/login')
  }

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDropdownOpen(false)
        return
      }
      if (e.key !== 'Tab') return

      const items = Array.from(
        dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[data-user-menu-item]') ?? [],
      )
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
      requestAnimationFrame(() => {
        dropdownRef.current?.querySelector<HTMLButtonElement>('[data-user-menu-item]')?.focus()
      })
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [dropdownOpen])

  return (
    <header className="h-12 flex items-center justify-between px-4 md:px-6 bg-paper/90 backdrop-blur-xl border-b border-line sticky top-0 z-50 shrink-0">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuToggle}
          className="md:hidden -ml-2 flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-2 transition-colors text-ink3 hover:text-ink"
          aria-label="Open menu"
        >
          <Menu size={17} />
        </button>
        <span className="text-sm font-medium text-ink tracking-tight">{title}</span>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {/* User dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="flex min-h-[36px] min-w-[36px] items-center justify-center gap-2 rounded-lg hover:bg-surface-2 transition-colors px-1.5"
            aria-haspopup="true"
            aria-expanded={dropdownOpen}
            aria-label={`User menu for ${fullName}`}
          >
            <div className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
              {initials}
            </div>
            <ChevronDown
              size={12}
              className={`text-ink3 transition-transform duration-150 shrink-0 ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-52 bg-surface border border-line rounded-xl shadow-[var(--shadow-pop)] py-1 z-50">
              <div className="px-4 py-2.5 border-b border-line-2">
                <p className="text-sm font-medium text-ink truncate">{fullName}</p>
                {roleLabel && <p className="text-xs text-ink3 mt-0.5 truncate">{roleLabel}</p>}
              </div>
              <div className="py-1">
                <button
                  data-user-menu-item
                  onClick={() => { setDropdownOpen(false); router.push('/settings') }}
                  className="w-full min-h-[40px] flex items-center gap-2.5 px-4 py-2 text-sm text-ink2 hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  <Settings size={14} className="text-ink3 shrink-0" />
                  Settings
                </button>
              </div>
              <div className="border-t border-line-2 py-1">
                <button
                  data-user-menu-item
                  onClick={handleSignOut}
                  className="w-full min-h-[40px] flex items-center gap-2.5 px-4 py-2 text-sm text-alert hover:bg-alert-soft transition-colors"
                >
                  <LogOut size={14} className="shrink-0" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
