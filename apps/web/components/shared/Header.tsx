'use client'

import { useState, useRef, useEffect } from 'react'
import { Bell, LogOut, Settings, User, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useHotelStore } from '@/stores/hotelStore'
import { useAuth } from '@/lib/hooks/useAuth'
import type { UserRole } from '@/stores/authStore'

const ROLE_LABELS: Record<UserRole, string> = {
  gm: 'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-brand-600',
    'bg-violet-600',
    'bg-amber-600',
    'bg-teal-600',
    'bg-sky-600',
    'bg-rose-600',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
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
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0 z-20">
      {/* Left: Hotel name */}
      <div>
        {hotel && (
          <p className="text-sm font-semibold text-gray-900">{hotel.name}</p>
        )}
      </div>

      {/* Right: Bell + User menu */}
      <div className="flex items-center gap-1">
        {/* Notification bell */}
        <button
          className="relative p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          aria-label="Notifications"
        >
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* User dropdown */}
        <div className="relative ml-1" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="flex items-center gap-2.5 pl-2 pr-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
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
                <p className="text-xs text-gray-500 whitespace-nowrap truncate max-w-[140px]">
                  {roleLabel}
                </p>
              )}
            </div>

            <ChevronDown
              size={14}
              className={`text-gray-400 transition-transform duration-150 shrink-0 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Dropdown panel */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-52 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
              {/* User summary */}
              <div className="px-4 py-2.5 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {fullName}
                </p>
                {roleLabel && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
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
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User size={15} className="text-gray-400 shrink-0" />
                  Profile
                </button>

                <button
                  onClick={() => {
                    setDropdownOpen(false)
                    router.push('/settings')
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Settings size={15} className="text-gray-400 shrink-0" />
                  Settings
                </button>
              </div>

              <div className="border-t border-gray-100 py-1">
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
