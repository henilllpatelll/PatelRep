'use client'

import { useState, useRef, useEffect } from 'react'
import { Bell, LogOut, Settings, User, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useHotelStore } from '@/stores/hotelStore'
import { useAuth } from '@/lib/hooks/useAuth'
import type { UserRole } from '@/stores/authStore'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'

const ROLE_LABELS: Record<UserRole, string> = {
  gm: 'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

export function Header() {
  const router = useRouter()
  const { hotel } = useHotelStore()
  const { user, signOut } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
    <header className="bg-white/[0.55] backdrop-blur-lg border-b border-white/[0.80] h-13 px-6 flex items-center justify-between shrink-0 z-20">
      {/* Left: Hotel name + date */}
      <div>
        {hotel && (
          <p className="text-sm font-semibold text-gray-900">{hotel.name}</p>
        )}
        <p className="text-xs text-slate-400 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Right: Bell + User menu */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <button
          className="relative flex items-center justify-center bg-white/70 border border-white/90 rounded-lg w-8 h-8 cursor-pointer text-slate-500 hover:text-slate-700 transition-colors"
          aria-label="Notifications"
        >
          <Bell size={16} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* User dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="flex items-center gap-2.5 pl-2 pr-2 py-1.5 rounded-lg hover:bg-white/50 transition-colors"
            aria-haspopup="true"
            aria-expanded={dropdownOpen}
          >
            {/* Initials avatar */}
            <div
              className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold shrink-0`}
            >
              {initials}
            </div>

            {/* Name + role — hidden on small screens */}
            <div className="hidden sm:block text-left leading-tight min-w-0">
              <p className="text-sm font-medium text-gray-900 whitespace-nowrap truncate max-w-[140px]">
                {fullName}
              </p>
              {roleLabel && (
                <p className="text-xs text-slate-500 whitespace-nowrap truncate max-w-[140px]">
                  {roleLabel}
                </p>
              )}
            </div>

            <ChevronDown
              size={14}
              className={`text-slate-400 transition-transform duration-150 shrink-0 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Dropdown panel */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-52 bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-xl shadow-lg py-1 z-50">
              {/* User summary */}
              <div className="px-4 py-2.5 border-b border-white/60">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {fullName}
                </p>
                {roleLabel && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
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
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-white/60 transition-colors"
                >
                  <User size={15} className="text-slate-400 shrink-0" />
                  Profile
                </button>

                <button
                  onClick={() => {
                    setDropdownOpen(false)
                    router.push('/settings')
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-white/60 transition-colors"
                >
                  <Settings size={15} className="text-slate-400 shrink-0" />
                  Settings
                </button>
              </div>

              <div className="border-t border-white/60 py-1">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50/60 transition-colors"
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
