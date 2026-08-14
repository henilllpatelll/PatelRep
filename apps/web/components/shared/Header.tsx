'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Settings, ChevronDown, Menu, Search, Sparkles, Bell, CheckCheck } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/hooks/useAuth'
import { getInitials, getAvatarColor } from '@/lib/utils/avatar'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/stores/authStore'
import { LanguageToggle } from '@/components/shared/LanguageToggle'
import { useTranslation } from 'react-i18next'
import { notificationsApi, type Notification } from '@/lib/api/notifications'

interface HeaderProps {
  onMenuToggle?: () => void
  redesigned?: boolean
}

export function Header({ onMenuToggle, redesigned }: HeaderProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user, signOut } = useAuth()
  const { t, i18n } = useTranslation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsTab, setNotificationsTab] = useState<'unread' | 'all'>('unread')
  const [searchFocused, setSearchFocused] = useState(false)
  const [dateShiftLabel, setDateShiftLabel] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)

  // Badge always reflects the unread-only count, independent of which tab the panel shows
  const { data: unreadNotificationsData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.list({ is_read: false, limit: 20 }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const unreadCount: number = ((unreadNotificationsData as any)?.data ?? []).length

  // GET /notifications' `is_read` param name is misleading: false/absent -> unread-only,
  // true -> full read+unread history (still hotel_id + user_id scoped server-side)
  const { data: notificationsData } = useQuery({
    queryKey: ['notifications', notificationsTab],
    queryFn: () => notificationsApi.list({ is_read: notificationsTab === 'all', limit: 20 }),
    staleTime: 30_000,
  })
  const notifications: Notification[] = (notificationsData as any)?.data ?? []

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead()
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const handleMarkRead = async (id: string) => {
    await notificationsApi.markRead(id)
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

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
  const roleLabel = role ? t(`roles.${role}`) : null

  const handleSignOut = async () => {
    setDropdownOpen(false)
    await signOut()
    router.push('/login')
  }

  const handleCopilotOpen = useCallback(() => {
    document.dispatchEvent(new CustomEvent('copilot:open'))
  }, [])

  const openCommandPalette = useCallback(() => {
    document.dispatchEvent(new CustomEvent('command-palette:open'))
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        handleCopilotOpen()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleCopilotOpen])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false)
      }
    }
    if (notificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [notificationsOpen])

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

  useEffect(() => {
    const now = new Date()
    const today = new Intl.DateTimeFormat(i18n.language === 'es' ? 'es-US' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(now)
    const hour = now.getHours()
    const shift = hour < 15 ? t('header.dayShift') : hour < 23 ? t('header.eveningShift') : t('header.nightShift')
    setDateShiftLabel(`${today} · ${shift}`)
  }, [i18n.language, t])

  return (
    <header className="h-14 flex items-center justify-between px-4 md:px-5 bg-paper border-b border-line sticky top-0 z-50 shrink-0 gap-3">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuToggle}
        className="md:hidden -ml-1 flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-2 transition-colors text-ink3 hover:text-ink shrink-0"
        aria-label={t('header.openMenu')}
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
          placeholder={t('header.searchPlaceholder')}
          value=""
          onFocus={() => { setSearchFocused(true); openCommandPalette() }}
          onBlur={() => setSearchFocused(false)}
          onChange={() => undefined}
          className="text-[13px] text-ink placeholder:text-ink3 bg-transparent outline-none flex-1 min-w-0"
          aria-label={t('header.openCommandPalette')}
        />
        <kbd className="hidden lg:inline-flex font-mono text-[10px] text-ink3 bg-surface-3 border border-line px-[5px] py-px rounded shrink-0">
          ⌘K
        </kbd>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Date + shift */}
      <div className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink2 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-ready shrink-0" />
        <span className="font-mono">{dateShiftLabel || '\u00a0'}</span>
      </div>

      <div className="hidden lg:block w-px h-5 bg-line shrink-0" />

      <LanguageToggle className="hidden sm:inline-flex shrink-0" />

      {/* Ask copilot */}
      <button
        onClick={handleCopilotOpen}
        className="hidden md:inline-flex items-center gap-1.5 bg-[var(--ai-soft)] text-[var(--ai)] border border-[var(--ai-line)] px-2.5 h-8 rounded-lg text-[12px] font-medium hover:opacity-90 transition-opacity shrink-0"
        aria-label={`${t('header.openCopilot')} (Cmd+J)`}
      >
        <Sparkles size={13} />
        <span>{t('header.askCopilot')}</span>
        <span className="font-mono text-[10px] opacity-60 ml-1">⌘J</span>
      </button>

      {/* Notification bell */}
      <div className="relative" ref={notificationsRef}>
        <button
          onClick={() => setNotificationsOpen((prev) => !prev)}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-surface border border-line text-ink2 hover:bg-surface-2 transition-colors shrink-0"
          aria-label={t('header.notifications')}
          aria-haspopup="true"
          aria-expanded={notificationsOpen}
        >
          <Bell size={14} />
          {unreadCount > 0 && (
            <span className="absolute -top-[3px] -right-[3px] w-[14px] h-[14px] rounded-full bg-accent text-white text-[9px] font-bold font-mono flex items-center justify-center border-2 border-paper">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {notificationsOpen && (
          <div className="absolute right-0 mt-1.5 w-80 bg-surface border border-line rounded-xl shadow-pop z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-line-2">
              <p className="text-[13px] font-semibold text-ink">{t('header.notifications')}</p>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-[11px] text-ink3 hover:text-ink transition-colors"
                >
                  <CheckCheck size={12} />
                  {t('header.markAllRead')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-line-2">
              <button
                onClick={() => setNotificationsTab('unread')}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                  notificationsTab === 'unread' ? 'bg-surface-2 text-ink' : 'text-ink3 hover:text-ink'
                )}
              >
                {t('header.notificationsUnread')}
              </button>
              <button
                onClick={() => setNotificationsTab('all')}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                  notificationsTab === 'all' ? 'bg-surface-2 text-ink' : 'text-ink3 hover:text-ink'
                )}
              >
                {t('header.notificationsAll')}
              </button>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-ink3">{t('header.noNotifications')}</p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleMarkRead(n.id)}
                    className="w-full text-left flex gap-3 px-4 py-3 border-b border-line-2 last:border-0 hover:bg-surface-2 transition-colors"
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', n.is_read ? 'bg-transparent' : 'bg-accent')} />
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-[12.5px] leading-snug', n.is_read ? 'font-normal text-ink3' : 'font-medium text-ink')}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-[11.5px] text-ink3 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10.5px] text-ink4 mt-1 font-mono">
                        {new Date(n.created_at).toLocaleTimeString(i18n.language === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* User dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex min-h-[32px] min-w-[32px] items-center justify-center gap-1.5 rounded-lg hover:bg-surface-2 transition-colors px-1"
          aria-haspopup="true"
          aria-expanded={dropdownOpen}
          aria-label={t('header.userMenuFor', { name: fullName })}
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
                {t('header.settings')}
              </button>
            </div>
            <div className="border-t border-line-2 py-1">
              <button
                data-user-menu-item
                onClick={handleSignOut}
                className="w-full min-h-[38px] flex items-center gap-2.5 px-4 py-2 text-[13px] text-alert hover:bg-[var(--alert-soft)] transition-colors"
              >
                <LogOut size={13} className="shrink-0" />
                {t('header.signOut')}
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
