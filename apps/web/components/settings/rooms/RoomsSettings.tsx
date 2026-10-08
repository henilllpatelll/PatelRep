'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus, Upload } from 'lucide-react'
import type { AccessibleRoomFeature } from '@/lib/api/guest_requests'
import { featureCountsByRoom } from '@/lib/settings/accessibility'
import {
  EMPTY_ROOM_FILTERS, buildRoomsQuery, distinctBuildings, parseRoomsUrl, type RoomFilters, type RoomRow, type RoomsTabId,
} from '@/lib/settings/rooms'
import { useRole } from '@/lib/hooks/useRole'
import { Button } from '@/components/ui/Button'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { cn } from '@/lib/utils'
import { AccessibilityFeatureDrawer } from './AccessibilityFeatureDrawer'
import { AccessibilityTab } from './AccessibilityTab'
import { RoomDrawer } from './RoomDrawer'
import { RoomsImportDialog } from './RoomsImportDialog'
import { RoomsTab } from './RoomsTab'
import { toRoomRows } from '@/lib/settings/rooms'
import { roomsApi, type RoomStatus } from '@/lib/api/rooms'
import { useAccessibleFeatures, useRoomRows, useRoomTypes } from './useRoomsData'

type Drawer =
  | { kind: 'room'; mode: 'create' }
  | { kind: 'room'; mode: 'edit'; roomId: string }
  | { kind: 'feature'; feature?: AccessibleRoomFeature }
  | null

const TABS: { id: RoomsTabId; label: string }[] = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'accessibility', label: 'Accessibility' },
]

export function RoomsSettings() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isGM } = useRole()
  const url = useMemo(() => parseRoomsUrl(searchParams), [searchParams])

  const roomsQuery = useRoomRows()
  const typesQuery = useRoomTypes()
  const featuresQuery = useAccessibleFeatures()
  const rooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data])
  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data])
  const features = useMemo(() => featuresQuery.data ?? [], [featuresQuery.data])
  const counts = useMemo(() => featureCountsByRoom(features), [features])

  const [drawer, setDrawer] = useState<Drawer>(null)
  const [importing, setImporting] = useState(false)

  // Search is typed locally and mirrored to the URL (debounced) so views are shareable and survive reloads.
  const [q, setQ] = useState(url.q)
  useEffect(() => { setQ(url.q) }, [url.q])
  const urlRef = useRef(url)
  useEffect(() => { urlRef.current = url }, [url])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const navigate = useCallback((next: Partial<typeof url>, resetPage = true) => {
    const current = urlRef.current
    const merged = { ...current, ...next, page: resetPage && !('page' in next) ? 1 : (next.page ?? current.page) }
    router.replace(`${pathname}${buildRoomsQuery(merged)}`, { scroll: false })
  }, [pathname, router])

  const onFilters = (next: Partial<RoomFilters>) => {
    const { q: nextQ, ...rest } = next
    if (nextQ !== undefined) {
      setQ(nextQ)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => navigate({ q: nextQ }), 250)
    }
    if (Object.keys(rest).length > 0) navigate(rest)
  }

  const resetFilters = () => {
    if (timer.current) clearTimeout(timer.current) // a pending search update must not resurrect old state
    setQ('')
    router.replace(`${pathname}${buildRoomsQuery({ ...EMPTY_ROOM_FILTERS, tab: 'rooms' })}`, { scroll: false })
  }

  const filters: RoomFilters = { q, building: url.building, floor: url.floor, type: url.type }

  // Room search/filters belong to the Rooms tab only, so switching tabs starts from a clean URL.
  const switchTab = (tab: RoomsTabId) => {
    if (timer.current) clearTimeout(timer.current)
    setQ('')
    router.replace(`${pathname}${buildRoomsQuery({ tab })}`, { scroll: false })
  }

  const editingRoom: RoomRow | undefined = drawer?.kind === 'room' && drawer.mode === 'edit'
    ? rooms.find((r) => r.id === drawer.roomId)
    : undefined

  const refreshRooms = useCallback(async (): Promise<RoomRow[]> => {
    const res = (await roomsApi.list()) as { data: RoomStatus[] }
    return toRoomRows(res.data ?? [])
  }, [])

  return (
    <div className="space-y-5">
      <SettingsSectionHeader
        level={1}
        title="Rooms & Accessibility"
        description="Manage your room inventory, types, floors, buildings and accessibility features."
        actions={isGM && url.tab === 'rooms' ? (
          <>
            <Button variant="outline" onClick={() => setImporting(true)}><Upload size={14} aria-hidden="true" /> Import rooms</Button>
            <Button onClick={() => setDrawer({ kind: 'room', mode: 'create' })}><Plus size={14} aria-hidden="true" /> Add room</Button>
          </>
        ) : isGM ? (
          <Button onClick={() => setDrawer({ kind: 'feature' })} disabled={rooms.length === 0}><Plus size={14} aria-hidden="true" /> Add accessibility feature</Button>
        ) : undefined}
      />

      <div role="tablist" aria-label="Rooms and accessibility" className="flex border-b border-line">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`rooms-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={url.tab === tab.id}
            aria-controls={`rooms-panel-${tab.id}`}
            tabIndex={url.tab === tab.id ? 0 : -1}
            onClick={() => switchTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              switchTab(url.tab === 'rooms' ? 'accessibility' : 'rooms')
              requestAnimationFrame(() => document.getElementById(`rooms-tab-${url.tab === 'rooms' ? 'accessibility' : 'rooms'}`)?.focus())
            }}
            className={cn(
              '-mb-px min-h-[44px] border-b-2 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[40px]',
              url.tab === tab.id ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rooms-panel-${url.tab}`} aria-labelledby={`rooms-tab-${url.tab}`}>
        {url.tab === 'rooms' ? (
          <RoomsTab
            rooms={rooms}
            types={types}
            accessibilityCounts={counts}
            filters={filters}
            page={url.page}
            loading={roomsQuery.isLoading}
            error={roomsQuery.isError}
            onRetry={() => roomsQuery.refetch()}
            onFilters={onFilters}
            onReset={resetFilters}
            onPage={(page) => navigate({ page }, false)}
            onAdd={() => setDrawer({ kind: 'room', mode: 'create' })}
            onImport={() => setImporting(true)}
            onEdit={(roomId) => setDrawer({ kind: 'room', mode: 'edit', roomId })}
          />
        ) : (
          <AccessibilityTab
            features={features}
            rooms={rooms}
            loading={featuresQuery.isLoading}
            error={featuresQuery.isError}
            onRetry={() => featuresQuery.refetch()}
            onAdd={() => setDrawer({ kind: 'feature' })}
            onEdit={(feature) => setDrawer({ kind: 'feature', feature })}
          />
        )}
      </div>

      {drawer?.kind === 'room' && (drawer.mode === 'create' || editingRoom) && (
        <RoomDrawer
          key={drawer.mode === 'edit' ? drawer.roomId : 'new'}
          mode={drawer.mode}
          room={editingRoom}
          rooms={rooms}
          types={types}
          buildings={distinctBuildings(rooms)}
          onClose={() => setDrawer(null)}
          onSaved={() => setDrawer(null)}
        />
      )}
      {drawer?.kind === 'feature' && (
        <AccessibilityFeatureDrawer
          key={drawer.feature?.id ?? 'new'}
          feature={drawer.feature}
          rooms={rooms}
          features={features}
          onClose={() => setDrawer(null)}
          onSaved={() => setDrawer(null)}
        />
      )}
      {importing && (
        <RoomsImportDialog existingRooms={rooms} types={types} onRefreshRooms={refreshRooms} onClose={() => setImporting(false)} />
      )}
    </div>
  )
}


