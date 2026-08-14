'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Bed, Library, Loader2, MessageSquare, Search, Wrench, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { getAllowedHrefs, getAllowedNavItems, NAV_LABEL_KEYS } from '@/lib/utils/navigation'
import { roomsApi, type RoomStatus } from '@/lib/api/rooms'
import { sopApi } from '@/lib/api/sop'
import { engineeringApi } from '@/lib/api/engineering'
import { guestRequestsApi } from '@/lib/api/guest_requests'

interface PaletteResult {
  key: string
  href: string
  primary: string
  secondary?: string
  icon: React.ElementType
}

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 250

/**
 * Global ⌘K / Ctrl-K palette. Lists the current user's allowed nav routes —
 * reuses the exact allow-list from lib/utils/navigation.ts so it can never
 * show a route the Sidebar would hide — plus grouped record search across
 * rooms, work orders, guest requests, and SOPs, each fetch gated behind the
 * same allow-list so a role never even queries an entity it can't reach.
 */
export function CommandPalette({ redesigned }: { redesigned?: boolean }) {
  const router = useRouter()
  const { t } = useTranslation()
  const { role } = useRole()
  const customRoleModules = useAuthStore((state) => state.customRoleModules)
  const { hotel } = useHotelStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
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
    setDebouncedQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const trimmed = debouncedQuery.trim()
  const showRecords = open && trimmed.length >= MIN_QUERY_LENGTH

  const allowed = getAllowedHrefs({
    role,
    customRoleModules,
    frontDeskModules: hotel?.front_desk_modules ?? null,
  })
  const roomsAllowed = allowed.includes('/housekeeping')
  const workOrdersAllowed = allowed.includes('/engineering')
  const guestsAllowed = allowed.includes('/guest-requests')
  const sopsAllowed = allowed.includes('/sop')

  const items = getAllowedNavItems({
    role,
    customRoleModules,
    frontDeskModules: hotel?.front_desk_modules ?? null,
  })

  const navResults: PaletteResult[] = items
    .map((item) => ({ href: item.href, label: t(NAV_LABEL_KEYS[item.label] ?? item.label) }))
    .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8)
    .map((item) => ({ key: `nav-${item.href}`, href: item.href, primary: item.label, icon: ArrowRight }))

  // Rooms + SOPs: fetch the full tenant list once (cached), filter client-side as the user types
  const roomsQuery = useQuery({
    queryKey: ['command-palette-rooms'],
    queryFn: () => roomsApi.list(),
    enabled: open && roomsAllowed,
    staleTime: 60_000,
  })
  const sopQuery = useQuery({
    queryKey: ['command-palette-sops'],
    queryFn: () => sopApi.listDocuments(),
    enabled: open && sopsAllowed,
    staleTime: 60_000,
  })

  // Work orders + guest requests: paginated server-side, so search via the q param
  const workOrdersQuery = useQuery({
    queryKey: ['command-palette-work-orders', trimmed],
    queryFn: () => engineeringApi.listWorkOrders({ q: trimmed, per_page: 5 }),
    enabled: workOrdersAllowed && showRecords,
  })
  const guestsQuery = useQuery({
    queryKey: ['command-palette-guest-requests', trimmed],
    queryFn: () => guestRequestsApi.listRequests({ q: trimmed, per_page: 5 }),
    enabled: guestsAllowed && showRecords,
  })

  const allRooms: RoomStatus[] = (roomsQuery.data as any)?.data ?? []
  const roomResults: PaletteResult[] = showRecords
    ? allRooms
        .filter((r) => r.rooms?.room_number?.toLowerCase().includes(trimmed.toLowerCase()))
        .slice(0, 5)
        .map((r) => ({
          key: `room-${r.room_id}`,
          href: `/housekeeping?room=${r.room_id}`,
          primary: `Room ${r.rooms?.room_number ?? '?'}`,
          secondary: r.status,
          icon: Bed,
        }))
    : []

  const workOrderResults: PaletteResult[] = showRecords
    ? ((workOrdersQuery.data as any)?.data ?? []).map((wo: any) => ({
        key: `wo-${wo.id}`,
        href: `/engineering/work-orders?focus=${wo.id}`,
        primary: `WO #${wo.work_order_number}`,
        secondary: wo.title,
        icon: Wrench,
      }))
    : []

  const guestResults: PaletteResult[] = showRecords
    ? ((guestsQuery.data as any)?.data ?? []).map((gr: any) => ({
        key: `guest-${gr.id}`,
        href: `/guest-requests?focus=${gr.id}`,
        primary: `Request #${gr.request_number}`,
        secondary: gr.title,
        icon: MessageSquare,
      }))
    : []

  const allSops = (sopQuery.data as any)?.data ?? []
  const sopResults: PaletteResult[] = showRecords
    ? allSops
        .filter(
          (d: any) =>
            d.title?.toLowerCase().includes(trimmed.toLowerCase()) ||
            d.category?.toLowerCase().includes(trimmed.toLowerCase()),
        )
        .slice(0, 5)
        .map((d: any) => ({
          key: `sop-${d.id}`,
          href: `/sop?focus=${d.id}`,
          primary: d.title,
          secondary: d.category ?? undefined,
          icon: Library,
        }))
    : []

  const allResults = [...navResults, ...roomResults, ...workOrderResults, ...guestResults, ...sopResults]

  const groups: {
    key: string
    labelKey: string
    allowed: boolean
    loading: boolean
    results: PaletteResult[]
  }[] = [
    { key: 'rooms', labelKey: 'palette.groupRooms', allowed: roomsAllowed, loading: roomsQuery.isLoading, results: roomResults },
    { key: 'workOrders', labelKey: 'palette.groupWorkOrders', allowed: workOrdersAllowed, loading: workOrdersQuery.isLoading, results: workOrderResults },
    { key: 'guests', labelKey: 'palette.groupGuests', allowed: guestsAllowed, loading: guestsQuery.isLoading, results: guestResults },
    { key: 'sops', labelKey: 'palette.groupSops', allowed: sopsAllowed, loading: sopQuery.isLoading, results: sopResults },
  ]

  const hasAnyResults = allResults.length > 0
  const anyGroupLoading = showRecords && groups.some((g) => g.allowed && g.loading)

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
                if (e.key === 'Enter' && allResults[0]) {
                  e.preventDefault()
                  navigate(allResults[0].href)
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
            {!hasAnyResults && !anyGroupLoading ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink3">{t('header.noMatchingCommand')}</p>
            ) : (
              <>
                {navResults.length > 0 && (
                  <div className="mb-1">
                    {showRecords && (
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink4">
                        {t('palette.groupNav')}
                      </p>
                    )}
                    {navResults.map((item) => (
                      <PaletteResultRow key={item.key} item={item} onSelect={navigate} />
                    ))}
                  </div>
                )}
                {showRecords &&
                  groups.map((group) =>
                    group.allowed ? (
                      <div key={group.key} className="mb-1">
                        {(group.loading || group.results.length > 0) && (
                          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink4">
                            {t(group.labelKey)}
                          </p>
                        )}
                        {group.loading ? (
                          <p className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink3">
                            <Loader2 size={12} className="animate-spin" />
                            {t('palette.searching')}
                          </p>
                        ) : (
                          group.results.map((item) => (
                            <PaletteResultRow key={item.key} item={item} onSelect={navigate} />
                          ))
                        )}
                      </div>
                    ) : null,
                  )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PaletteResultRow({ item, onSelect }: { item: PaletteResult; onSelect: (href: string) => void }) {
  const Icon = item.icon
  return (
    <button
      onClick={() => onSelect(item.href)}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent shrink-0">
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{item.primary}</span>
        {item.secondary && <span className="block truncate text-[11px] text-ink3">{item.secondary}</span>}
      </span>
    </button>
  )
}
