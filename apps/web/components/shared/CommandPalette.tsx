'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { getAllowedNavItems, NAV_LABEL_KEYS } from '@/lib/utils/navigation'

/**
 * Global ⌘K / Ctrl-K palette. Lists only the current user's allowed routes —
 * reuses the exact allow-list from lib/utils/navigation.ts so it can never
 * show a route the Sidebar would hide.
 */
export function CommandPalette({ redesigned }: { redesigned?: boolean }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { role } = useRole()
  const customRoleModules = useAuthStore((state) => state.customRoleModules)
  const { hotel } = useHotelStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    document.addEventListener('command-palette:open', handleOpen)
    return () => document.removeEventListener('command-palette:open', handleOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const items = getAllowedNavItems({
    role,
    customRoleModules,
    frontDeskModules: hotel?.front_desk_modules ?? null,
  })

  const filtered = items
    .map((item) => ({ href: item.href, label: t(NAV_LABEL_KEYS[item.label] ?? item.label) }))
    .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8)

  function navigate(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-ink/25 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] z-[81] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-[var(--r-xl)] border border-line bg-surface shadow-pop"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{t('header.commandPalette')}</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Search size={15} className="shrink-0 text-ink3" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered[0]) {
                  e.preventDefault()
                  navigate(filtered[0].href)
                }
              }}
              placeholder={t('common.searchPlaceholder')}
              className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink4"
            />
            <Dialog.Close
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink3 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
              aria-label={t('header.closeCommandPalette')}
            >
              <X size={14} />
            </Dialog.Close>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink3">{t('header.noMatchingCommand')}</p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.href}
                  onClick={() => navigate(item.href)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <ArrowRight size={14} />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{item.label}</span>
                  <span className="font-mono text-[10px] text-ink4">{item.href}</span>
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
