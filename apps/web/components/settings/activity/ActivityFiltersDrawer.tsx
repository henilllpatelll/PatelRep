'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { activityApi } from '@/lib/api/activity'
import { EMPTY_FILTERS, dayKey, presetRange, type ActivityFilters } from '@/lib/settings/activity'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsField, SettingsSelect, SettingsTextInput } from '@/components/settings/workspace/SettingsFormControls'

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 12 months', days: 365 },
]

/** Compact filter drawer. Edits are a draft; nothing changes the list until "Apply Filters". */
export function ActivityFiltersDrawer({
  filters, hotelId, zone, onApply, onClose,
}: {
  filters: ActivityFilters
  hotelId?: string
  zone: string
  onApply: (next: ActivityFilters) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<ActivityFilters>(filters)
  const [today] = useState(() => dayKey(Date.now(), zone)) // latest selectable day, in the property's zone
  const options = useQuery({ queryKey: ['settings-activity-options'], queryFn: () => activityApi.categories(), staleTime: Infinity })
  const actors = useQuery({
    queryKey: ['settings-activity-actors', hotelId],
    queryFn: () => activityApi.actors(),
    enabled: !!hotelId,
    staleTime: 60_000,
  })
  const set = (patch: Partial<ActivityFilters>) => setDraft((d) => ({ ...d, ...patch }))
  const rangeInvalid = Boolean(draft.date_from && draft.date_to && draft.date_from > draft.date_to)

  return (
    <SettingsDrawer
      title="Filters"
      description="Narrow the activity list. The default view covers the last 30 days."
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <Button variant="ghost" onClick={() => { onApply({ ...EMPTY_FILTERS, q: filters.q }); }}>Clear Filters</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={requestClose}>Cancel</Button>
            <Button onClick={() => onApply({ ...draft, q: filters.q })} disabled={rangeInvalid}>Apply Filters</Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-5">
        <SettingsField id="activity-category" label="Category">
          <SettingsSelect id="activity-category" value={draft.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All categories</option>
            {options.data?.data.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </SettingsSelect>
        </SettingsField>

        <SettingsField id="activity-actor" label="Actor" hint={actors.isError ? 'People couldn’t be loaded right now.' : undefined}>
          <SettingsSelect id="activity-actor" value={draft.actor_id} onChange={(e) => set({ actor_id: e.target.value })}>
            <option value="">Anyone</option>
            {actors.data?.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </SettingsSelect>
        </SettingsField>

        <SettingsField id="activity-resource" label="Resource type">
          <SettingsSelect id="activity-resource" value={draft.resource_type} onChange={(e) => set({ resource_type: e.target.value })}>
            <option value="">All resources</option>
            {options.data?.meta.resource_types.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </SettingsSelect>
        </SettingsField>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink-2">Date range</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.days} size="sm" variant="outline" onClick={() => set(presetRange(p.days, zone))}>{p.label}</Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SettingsField id="activity-from" label="From">
              <SettingsTextInput id="activity-from" type="date" max={draft.date_to || today} value={draft.date_from} onChange={(e) => set({ date_from: e.target.value })} />
            </SettingsField>
            <SettingsField id="activity-to" label="To" error={rangeInvalid ? 'The end date must be on or after the start date.' : undefined}>
              <SettingsTextInput id="activity-to" type="date" min={draft.date_from || undefined} max={today} value={draft.date_to} onChange={(e) => set({ date_to: e.target.value })} aria-invalid={rangeInvalid || undefined} />
            </SettingsField>
          </div>
          <p className="text-xs text-ink-3">Dates are in the property’s time zone. A range can cover at most 12 months.</p>
        </fieldset>
      </div>
    </SettingsDrawer>
  )
}
