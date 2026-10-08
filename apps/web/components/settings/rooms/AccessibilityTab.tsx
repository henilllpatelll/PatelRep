'use client'

import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Pencil, Plus } from 'lucide-react'
import type { AccessibleRoomFeature } from '@/lib/api/guest_requests'
import {
  EMPTY_FEATURE_FILTERS, FEATURE_STATUS_OPTIONS, featureLabel, featureStatusMeta, filterFeatures, type FeatureFilters,
} from '@/lib/settings/accessibility'
import { ALL, type RoomRow } from '@/lib/settings/rooms'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { FilterSelect, SearchBox } from './FilterControls'

export function AccessibilityTab({ features, rooms, loading, error, onRetry, onAdd, onEdit }: {
  features: AccessibleRoomFeature[]
  rooms: RoomRow[]
  loading: boolean
  error: boolean
  onRetry: () => void
  onAdd: () => void
  onEdit: (feature: AccessibleRoomFeature) => void
}) {
  const [filters, setFilters] = useState<FeatureFilters>(EMPTY_FEATURE_FILTERS)
  const filtered = useMemo(() => filterFeatures(features, filters), [features, filters])
  const roomOptions = useMemo(
    () => Array.from(new Map(features.map((f) => [f.room_id, f.rooms?.room_number ?? f.room_id])).entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
      .map(([value, label]) => ({ value, label: `Room ${label}` })),
    [features],
  )
  const featureOptions = useMemo(
    () => Array.from(new Set(features.map((f) => f.feature_code))).sort().map((c) => ({ value: c, label: featureLabel(c) })),
    [features],
  )
  const active = filters.q.trim() !== '' || filters.room !== ALL || filters.feature !== ALL || filters.status !== ALL
  const set = (next: Partial<FeatureFilters>) => setFilters((f) => ({ ...f, ...next }))
  const noRooms = rooms.length === 0

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-ink-3">
        Record which rooms have accessible features and whether each is usable right now. Staff see this on accessibility guest requests.
        A recorded feature is not an ADA compliance certification, and this status is separate from the room’s housekeeping or maintenance status.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox label="features" value={filters.q} onChange={(q) => set({ q })} placeholder="Search rooms or features…" className="w-full sm:w-64" />
        <FilterSelect label="Room" value={filters.room} onChange={(room) => set({ room })} allLabel="All rooms" options={roomOptions} />
        <FilterSelect label="Feature" value={filters.feature} onChange={(feature) => set({ feature })} allLabel="All features" options={featureOptions} />
        <FilterSelect label="Condition" value={filters.status} onChange={(status) => set({ status })} allLabel="Any condition" options={FEATURE_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        {active && <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FEATURE_FILTERS)}>Clear filters</Button>}
        <p className="ml-auto text-xs text-ink-3" role="status" aria-live="polite">
          {loading ? '' : active ? `${filtered.length} of ${features.length}` : `${features.length} recorded`}
        </p>
      </div>

      <SettingsCard className="overflow-hidden p-0">
        {loading ? (
          <SettingsLoading label="Loading accessibility features…" />
        ) : error ? (
          <SettingsError message="We couldn't load accessibility features." onRetry={onRetry} />
        ) : features.length === 0 ? (
          <SettingsEmpty
            title="No accessibility features recorded"
            body={noRooms ? 'Add rooms first, then record their accessible features.' : 'Add a feature such as a roll-in shower or grab bars to a room.'}
            action={!noRooms ? <Button size="sm" onClick={onAdd}><Plus size={14} aria-hidden="true" /> Add accessibility feature</Button> : undefined}
          />
        ) : filtered.length === 0 ? (
          <SettingsEmpty title="Nothing matches" body="Try different words or clear the filters." action={<Button size="sm" variant="outline" onClick={() => setFilters(EMPTY_FEATURE_FILTERS)}>Clear filters</Button>} />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <caption className="sr-only">Accessibility features</caption>
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  <th scope="col" className="px-4 py-2.5">Room</th>
                  <th scope="col" className="px-4 py-2.5">Feature</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Notes / description</th>
                  <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {filtered.map((f) => {
                  const meta = featureStatusMeta(f.operational_status)
                  return (
                    <tr key={f.id} onClick={() => onEdit(f)} className="cursor-pointer align-top transition-colors hover:bg-surface-2">
                      <td className="px-4 py-2.5 font-semibold text-ink">{f.rooms?.room_number ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink">{featureLabel(f.feature_code)}</td>
                      <td className="px-4 py-2.5">
                        <Pill tone={meta.tone} size="sm">{meta.label}</Pill>
                        {f.last_verified_at && <p className="mt-1 text-[11px] text-ink-3">Verified {formatDistanceToNow(new Date(f.last_verified_at), { addSuffix: true })}</p>}
                      </td>
                      <td className="max-w-xs px-4 py-2.5 text-ink-2">
                        {f.description && <p>{f.description}</p>}
                        {f.guidance && <p className="mt-0.5 text-xs text-ink-3">Staff: {f.guidance}</p>}
                        {!f.description && !f.guidance && <span className="text-ink-4">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(f) }} aria-label={`Edit ${featureLabel(f.feature_code)} in room ${f.rooms?.room_number ?? ''}`}>
                          <Pencil size={13} aria-hidden="true" /> Edit
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <ul className="divide-y divide-line-2 md:hidden">
              {filtered.map((f) => {
                const meta = featureStatusMeta(f.operational_status)
                return (
                  <li key={f.id}>
                    <button type="button" onClick={() => onEdit(f)} className="flex min-h-[56px] w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]" aria-label={`Edit ${featureLabel(f.feature_code)} in room ${f.rooms?.room_number ?? ''}`}>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-ink">Room {f.rooms?.room_number ?? '—'}</span>
                        <span className="text-sm text-ink-2">{featureLabel(f.feature_code)}</span>
                        <span className="ml-auto"><Pill tone={meta.tone} size="sm">{meta.label}</Pill></span>
                      </span>
                      {(f.description || f.guidance) && <span className="text-[13px] text-ink-3">{f.description || f.guidance}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </SettingsCard>
    </div>
  )
}
