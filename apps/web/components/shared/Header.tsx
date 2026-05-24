'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Settings, ChevronDown, Menu, Search, Sparkles, Bell, ArrowRight, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/stores/authStore'

const ROLE_LABELS: Record<UserRole, string> = {
  gm: 'General Manager',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  chief_engineer: 'Chief Engineer',
  housekeeper: 'Housekeeper',
  engineer: 'Engineer',
  front_desk: 'Front Desk',
}

const COMMANDS = [
  { label: 'Dashboard', href: '/dashboard', hint: 'Today overview' },
  { label: 'Room Board', href: '/housekeeping', hint: 'Housekeeping status' },
  { label: 'Work Orders', href: '/engineering/work-orders', hint: 'Maintenance kanban' },
  { label: 'Guest Requests', href: '/guest-requests', hint: 'Service recovery' },
  { label: 'Tasks', href: '/tasks', hint: 'Open task list' },
  { label: 'Staff', href: '/staff', hint: 'Team directory' },
  { label: 'Schedule', href: '/scheduling', hint: '7-day matrix' },
  { label: 'SOP Library', href: '/sop', hint: 'Search procedures' },
  { label: 'Reports', href: '/reports', hint: 'KPI reports' },
  { label: 'Settings', href: '/settings', hint: 'Hotel profile' },
]

interface HeaderProps {
  onMenuToggle?: () => void
}

export function Header({ onMenuToggle }: HeaderProps) {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const commandInputRef = useRef<HTMLInputElement>(null)

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

  const handleCopilotOpen = useCallback(() => {
    document.dispatchEvent(new CustomEvent('copilot:open'))
  }, [])

  const openCommandPalette = useCallback(() => {
    setCommandOpen(true)
    requestAnimationFrame(() => commandInputRef.current?.focus())
  }, [])

  const runCommand = useCallback((href: string) => {
    setCommandOpen(false)
    setCommandQuery('')
    router.push(href)
  }, [router])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        handleCopilotOpen()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openCommandPalette()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleCopilotOpen, openCommandPalette])

  useEffect(() => {
    if (!commandOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCommandOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => commandInputRef.current?.focus())
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [commandOpen])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setDropdownOpen(false); return }
      if (e.key !== 'Tab') return
      const items = Array.from(
        dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[data-user-menu-item]') ?? [],
      )
      if (!items.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
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

  const today = format(new Date(), 'EEE, MMM d')
  const hour = new Date().getHours()
  const shift = hour < 15 ? 'Day shift' : hour < 23 ? 'Evening shift' : 'Night shift'
  const filteredCommands = COMMANDS.filter((command) => {
    const q = commandQuery.toLowerCase().trim()
    if (!q) return true
    return `${command.label} ${command.hint}`.toLowerCase().includes(q)
  }).slice(0, 7)

  return (
    <header className="h-14 flex items-center justify-between px-4 md:px-5 bg-paper border-b border-line sticky top-0 z-50 shrink-0 gap-3">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuToggle}
        className="md:hidden -ml-1 flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-2 transition-colors text-ink3 hover:text-ink shrink-0"
        aria-label="Open menu"
      >
        <Menu size={16} />
      </button>

      {/* Search */}
      <div className={cn(
        'hidden md:flex items-center gap-2 bg-surface border border-line rounded-[9px] px-3 py-2 transition-all duration-150 flex-1 max-w-[480px]',
        searchFocused ? 'border-accent ring-2 ring-[var(--accent-soft)]' : 'hover:border-ink4'
      )}>
        <Search size={13} className="text-ink3 shrink-0" />
        <input
          id="topbar-search"
          type="text"
          placeholder="Search rooms, work orders, guests…"
          value=""
          onFocus={() => { setSearchFocused(true); openCommandPalette() }}
          onBlur={() => setSearchFocused(false)}
          onChange={() => undefined}
          className="text-[13px] text-ink placeholder:text-ink3 bg-transparent outline-none flex-1 min-w-0"
          aria-label="Open command palette"
        />
        <kbd className="hidden lg:inline-flex font-mono text-[10px] text-ink3 bg-surface-3 border border-line px-[5px] py-px rounded shrink-0">
          ⌘K
        </kbd>
      </div>

      {commandOpen && (
        <div className="fixed inset-0 z-[80] bg-ink/25 backdrop-blur-sm p-4 pt-[12vh]" role="presentation" onMouseDown={() => setCommandOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="mx-auto w-full max-w-xl overflow-hidden rounded-[var(--r-xl)] border border-line bg-surface shadow-pop"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Search size={15} className="text-ink3 shrink-0" />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredCommands[0]) {
                    e.preventDefault()
                    runCommand(filteredCommands[0].href)
                  }
                }}
                placeholder="Search rooms, work orders, guests..."
                className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink4"
              />
              <button
                onClick={() => setCommandOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink3 hover:bg-surface-2 hover:text-ink"
                aria-label="Close command palette"
              >
                <X size={14} />
              </button>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {filteredCommands.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-ink3">No matching command</p>
              ) : (
                filteredCommands.map((command) => (
                  <button
                    key={command.href}
                    onClick={() => runCommand(command.href)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                      <ArrowRight size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{command.label}</span>
                      <span className="block text-[11px] text-ink3">{command.hint}</span>
                    </span>
                    <span className="font-mono text-[10px] text-ink4">{command.href}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Date + shift */}
      <div className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink2 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-ready shrink-0" />
        <span className="font-mono">{today} · {shift}</span>
      </div>

      <div className="hidden lg:block w-px h-5 bg-line shrink-0" />

      {/* Ask copilot */}
      <button
        onClick={handleCopilotOpen}
        className="hidden md:inline-flex items-center gap-1.5 bg-[var(--ai-soft)] text-[var(--ai)] border border-[var(--ai-line)] px-2.5 h-8 rounded-lg text-[12px] font-medium hover:opacity-90 transition-opacity shrink-0"
        aria-label="Open AI Copilot (⌘J)"
      >
        <Sparkles size={13} />
        <span>Ask copilot</span>
        <span className="font-mono text-[10px] opacity-60 ml-1">⌘J</span>
      </button>

      {/* Notification bell */}
      <button
        className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-surface border border-line text-ink2 hover:bg-surface-2 transition-colors shrink-0"
        aria-label="Notifications"
      >
        <Bell size={14} />
        <span className="absolute -top-[3px] -right-[3px] w-[14px] h-[14px] rounded-full bg-accent text-white text-[9px] font-bold font-mono flex items-center justify-center border-2 border-paper">
          3
        </span>
      </button>

      {/* User dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex min-h-[32px] min-w-[32px] items-center justify-center gap-1.5 rounded-lg hover:bg-surface-2 transition-colors px-1"
          aria-haspopup="true"
          aria-expanded={dropdownOpen}
          aria-label={`User menu for ${fullName}`}
        >
          <div className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
            {initials}
          </div>
          <ChevronDown
            size={11}
            className={cn('text-ink3 transition-transform duration-150 shrink-0 hidden md:block', dropdownOpen && 'rotate-180')}
          />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 mt-1.5 w-52 bg-surface border border-line rounded-xl shadow-pop py-1 z-50">
            <div className="px-4 py-2.5 border-b border-line-2">
              <p className="text-[13px] font-medium text-ink truncate">{fullName}</p>
              {roleLabel && <p className="text-[11px] text-ink3 mt-0.5 truncate">{roleLabel}</p>}
            </div>
            <div className="py-1">
              <button
                data-user-menu-item
                onClick={() => { setDropdownOpen(false); router.push('/settings') }}
                className="w-full min-h-[38px] flex items-center gap-2.5 px-4 py-2 text-[13px] text-ink2 hover:bg-surface-2 hover:text-ink transition-colors"
              >
                <Settings size={13} className="text-ink3 shrink-0" />
                Settings
              </button>
            </div>
            <div className="border-t border-line-2 py-1">
              <button
                data-user-menu-item
                onClick={handleSignOut}
                className="w-full min-h-[38px] flex items-center gap-2.5 px-4 py-2 text-[13px] text-alert hover:bg-[var(--alert-soft)] transition-colors"
              >
                <LogOut size={13} className="shrink-0" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
