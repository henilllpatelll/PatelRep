'use client'

import { useMemo } from 'react'
import { Accessibility, ChevronLeft, ChevronRight, Pencil, Plus, Upload } from 'lucide-react'
import {
  distinctBuildings, distinctFloors, filterRooms, hasActiveFilters, paginate, type RoomFilters, type RoomRow,
} from '@/lib/settings/rooms'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import type { RoomType } from '@/lib/api/rooms'
import { FilterSelect, SearchBox } from './FilterControls'

interface Props {
  rooms: RoomRow[]
  types: RoomType[]
  accessibilityCounts: Map<string, number>
  filters: RoomFilters
  page: number
  loading: boolean
  error: boolean
  onRetry: () => void
  onFilters: (next: Partial<RoomFilters>) => void
  onReset: () => void
  onPage: (page: number) => void
  onAdd: () => void
  onImport: () => void
  onEdit: (roomId: string) => void
}

function AccessibilityMark({ count }: { count: number }) {
  if (!count) return <span className="text-ink-4" aria-label="No accessibility features recorded">—</span>
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2" title={`${count} accessibility feature${count === 1 ? '' : 's'} recorded`}>
      <Accessibility size={14} className="text-ink-3" aria-hidden="true" />
      <span className="sr-only">{count} accessibility feature{count === 1 ? '' : 's'} recorded</span>
      <span aria-hidden="true">{count}</span>
    </span>
  )
}

export function RoomsTab({
  rooms, types, accessibilityCounts, filters, page, loading, error, onRetry, onFilters, onReset, onPage, onAdd, onImport, onEdit,
}: Props) {
  const filtered = useMemo(() => filterRooms(rooms, filters), [rooms, filters])
  const paged = useMemo(() => paginate(filtered, page), [filtered, page])
  const buildings = useMemo(() => distinctBuildings(rooms), [rooms])
  const floors = useMemo(() => distinctFloors(rooms), [rooms])
  const showBuilding = buildings.length > 0
  const active = hasActiveFilters(filters)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox label="rooms" value={filters.q} onChange={(q) => onFilters({ q })} placeholder="Search by room number" className="w-full sm:w-60" />
        {showBuilding && (
          <FilterSelect label="Building" value={filters.building} onChange={(building) => onFilters({ building })} allLabel="All buildings" options={buildings.map((b) => ({ value: b, label: b }))} />
        )}
        <FilterSelect label="Floor" value={filters.floor} onChange={(floor) => onFilters({ floor })} allLabel="All floors" options={floors.map((f) => ({ value: String(f), label: `Floor ${f}` }))} />
        <FilterSelect label="Room type" value={filters.type} onChange={(type) => onFilters({ type })} allLabel="All room types" options={types.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))} />
        {active && <Button variant="ghost" size="sm" onClick={onReset}>Clear filters</Button>}
        <p className="ml-auto text-xs text-ink-3" role="status" aria-live="polite">
          {loading ? '' : active ? `${filtered.length} of ${rooms.length} rooms` : `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}`}
        </p>
      </div>

      <SettingsCard className="overflow-hidden p-0">
        {loading ? (
          <SettingsLoading label="Loading rooms…" />
        ) : error ? (
          <SettingsError message="We couldn't load your rooms." onRetry={onRetry} />
        ) : rooms.length === 0 ? (
          <SettingsEmpty
            title="No rooms yet"
            body="Add rooms one at a time, or import your whole inventory from a CSV."
            action={
              <div className="flex gap-2">
                <Button size="sm" onClick={onAdd}><Plus size={14} aria-hidden="true" /> Add room</Button>
                <Button size="sm" variant="outline" onClick={onImport}><Upload size={14} aria-hidden="true" /> Import rooms</Button>
              </div>
            }
          />
        ) : filtered.length === 0 ? (
          <SettingsEmpty title="No rooms match" body="Try a different room number or clear the filters." action={<Button size="sm" variant="outline" onClick={onReset}>Clear search and filters</Button>} />
        ) : (
          <>
            {/* Wide screens: table */}
            <table className="hidden w-full text-left text-sm sm:table">
              <caption className="sr-only">Rooms</caption>
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  <th scope="col" className="px-4 py-2.5">Room</th>
                  <th scope="col" className="px-4 py-2.5">Floor</th>
                  <th scope="col" className="px-4 py-2.5">Room type</th>
                  {showBuilding && <th scope="col" className="px-4 py-2.5">Building</th>}
                  <th scope="col" className="px-4 py-2.5">Accessibility</th>
                  <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {paged.items.map((room) => (
                  <tr key={room.id} onClick={() => onEdit(room.id)} className="cursor-pointer transition-colors hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEdit(room.id) }}
                        className="rounded font-semibold text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                        aria-label={`Edit room ${room.roomNumber}`}
                      >
                        {room.roomNumber}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{room.floor ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-2">{room.roomTypeCode ? <span title={room.roomTypeName}>{room.roomTypeCode}</span> : '—'}</td>
                    {showBuilding && <td className="px-4 py-2.5 text-ink-2">{room.building || '—'}</td>}
                    <td className="px-4 py-2.5"><AccessibilityMark count={accessibilityCounts.get(room.id) ?? 0} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(room.id) }} aria-label={`Edit room ${room.roomNumber} details`}>
                        <Pencil size={13} aria-hidden="true" /> Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Narrow screens: compact list */}
            <ul className="divide-y divide-line-2 sm:hidden">
              {paged.items.map((room) => (
                <li key={room.id}>
                  <button type="button" onClick={() => onEdit(room.id)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]" aria-label={`Edit room ${room.roomNumber}`}>
                    <span className="w-14 shrink-0 text-base font-semibold text-ink">{room.roomNumber}</span>
                    <span className="min-w-0 flex-1 text-[13px] text-ink-2">
                      Floor {room.floor ?? '—'} · {room.roomTypeCode || 'No type'}{room.building ? ` · ${room.building}` : ''}
                    </span>
                    <AccessibilityMark count={accessibilityCounts.get(room.id) ?? 0} />
                    <ChevronRight size={16} className="shrink-0 text-ink-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            {paged.pages > 1 && (
              <nav aria-label="Rooms pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
                <p className="text-xs text-ink-3">Page {paged.page} of {paged.pages}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onPage(paged.page - 1)} disabled={paged.page <= 1}><ChevronLeft size={14} aria-hidden="true" /> Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => onPage(paged.page + 1)} disabled={paged.page >= paged.pages}>Next <ChevronRight size={14} aria-hidden="true" /></Button>
                </div>
              </nav>
            )}
          </>
        )}
      </SettingsCard>
    </div>
  )
}


