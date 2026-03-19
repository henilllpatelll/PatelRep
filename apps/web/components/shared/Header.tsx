'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, LogOut, Settings, User, ChevronDown } from 'lucide-react'
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
  '/engineering/assets': 'Assets',
  '/engineering/pm-schedules': 'PM Schedules',
  '/engineering/predictions': 'Predictions',
  '/staff': 'Staff',
  '/scheduling': 'Schedule',
  '/logbook': 'Logbook',
  '/sop': 'SOP Library',
  '/reports': 'Reports',
  '/settings': 'Settings',
  '/settings/billing': 'Billing',
  '/settings/integrations': 'Integrations',
  '/guest-requests': 'Guest Requests',
  '/lost-found': 'Lost & Found',
  '/tasks': 'Tasks',
  '/onboarding': 'Setup',
}

const ROLE_LABELS: Record<UserRole, string> = {
  gm: 'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { hotel } = useHotelStore()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const title = PAGE_TITLES[pathname] ?? 'PatelRep'

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

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  return (
    <header className="h-14 flex items-center justify-between px-6 bg-white/70 backdrop-blur-xl border-b border-stone-100 sticky top-0 z-10 shrink-0">
      <span className="text-sm font-semibold text-stone-800">{title}</span>

      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button
          className="p-2 rounded-xl hover:bg-stone-100 transition-colors text-stone-400 hover:text-stone-600"
          aria-label="Notifications"
        >
          <Bell size={16} />
        </button>

        {/* Hotel chip */}
        {hotel && (
          <span className="bg-amber-50 text-amber-700 text-xs font-medium rounded-full px-3 py-1 border border-amber-100">
            {hotel.name}
          </span>
        )}

        {/* User dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-xl hover:bg-stone-100 transition-colors p-1"
            aria-haspopup="true"
            aria-expanded={dropdownOpen}
          >
            <div
              className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold shrink-0`}
            >
              {initials}
            </div>
            <ChevronDown
              size={14}
              className={`text-stone-400 transition-transform duration-150 shrink-0 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Dropdown panel */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-52 bg-white/90 backdrop-blur-2xl border border-stone-100 rounded-xl shadow-lg py-1 z-50">
              {/* User summary */}
              <div className="px-4 py-2.5 border-b border-stone-100">
                <p className="text-sm font-medium text-stone-900 truncate">
                  {fullName}
                </p>
                {roleLabel && (
                  <p className="text-xs text-stone-500 mt-0.5 truncate">
                    {roleLabel}
                  </p>
                )}
              </div>

              {/* Menu items */}
              <div className="py-1">
                <button
                  onClick={() => {
                    setDropdownOpen(false)
                    router.push('/settings/profile')
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                >
                  <User size={15} className="text-stone-400 shrink-0" />
                  Profile
                </button>

                <button
                  onClick={() => {
                    setDropdownOpen(false)
                    router.push('/settings')
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                >
                  <Settings size={15} className="text-stone-400 shrink-0" />
                  Settings
                </button>
              </div>

              <div className="border-t border-stone-100 py-1">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={15} className="shrink-0" />
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
