'use client'

import { useEffect, useMemo, useState } from 'react'
import { Pencil, Search } from 'lucide-react'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  WEIGHT_LABELS, WEIGHT_TYPES, buildOverrideRows, filterOverrideRows, formatCredits, toWorkloadDraft, toWorkloadPayload,
  validateWorkload, workloadDirty, type WeightType, type WorkloadDraft,
} from '@/lib/settings/housekeepingConfig'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsActionFooter } from '@/components/settings/workspace/SettingsActionFooter'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsField, SettingsTextInput, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { WorkloadOverrideDrawer } from './WorkloadOverrideDrawer'
import { useHousekeepers, useHousekeepingSettingsQuery, useSaveHousekeepingSettings } from './useHousekeepingSettings'

export function WorkloadTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const toast = useToast()
  const settings = useHousekeepingSettingsQuery()
  const staff = useHousekeepers()
  const save = useSaveHousekeepingSettings()
  const saved = settings.data
  const [draft, setDraft] = useState<WorkloadDraft | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const current = draft ?? (saved ? toWorkloadDraft(saved) : null)
  const dirty = !!(saved && draft && workloadDirty(draft, saved))
  const validation = useMemo(() => (current ? validateWorkload(current) : null), [current])

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const rows = useMemo(
    () => buildOverrideRows(staff.data ?? [], saved?.capacity_overrides ?? {}),
    [staff.data, saved?.capacity_overrides],
  )
  const visibleRows = filterOverrideRows(rows, query)
  const editingRow = rows.find((row) => row.userId === editingId)

  if (settings.isLoading) return <SettingsLoading label="Loading workload settings…" />
  if (settings.isError || !saved || !current || !validation) return <SettingsError message="We couldn’t load the workload settings." onRetry={() => settings.refetch()} />

  const edit = (next: WorkloadDraft) => { setDraft(next); setSaveError(null) }
  const shown = attempted ? validation.errors : { weights: {} as Partial<Record<WeightType, string>> }

  async function onSave() {
    if (save.isPending) return
    setAttempted(true)
    if (!validation!.valid) return
    setSaveError(null)
    try {
      await save.mutateAsync(toWorkloadPayload(current!))
      setDraft(null)
      setAttempted(false)
      toast.success('Workload settings saved.')
    } catch (err) {
      setSaveError(errorMessage(err, 'We couldn’t save the workload settings. Your changes are still here.'))
    }
  }

  return (
    <div className="space-y-5">
      <SettingsCard className="space-y-5 overflow-clip p-0">
        <div className="space-y-6 p-5">
          <section aria-label="Daily target" className="space-y-3">
            <SettingsSectionHeader level={3} title="Daily target" description="Sets the baseline workload capacity used when planning daily housekeeping assignments." />
            <SettingsField id="daily-target" label="Standard workload credits per attendant" required error={shown.target} className="max-w-xs">
              <SettingsTextInput {...controlA11y('daily-target', { error: shown.target, required: true })} value={current.default_target_credits} onChange={(e) => edit({ ...current, default_target_credits: e.target.value })} inputMode="decimal" autoComplete="off" />
            </SettingsField>
          </section>

          <section aria-label="Cleaning weights" className="space-y-3">
            <SettingsSectionHeader level={3} title="Cleaning weights" description="Higher weights represent more work when calculating assignments." />
            <div className="grid gap-4 sm:grid-cols-3">
              {WEIGHT_TYPES.map((type) => (
                <SettingsField key={type} id={`weight-${type}`} label={WEIGHT_LABELS[type]} required error={shown.weights[type]}>
                  <SettingsTextInput
                    {...controlA11y(`weight-${type}`, { error: shown.weights[type], required: true })}
                    value={current.credit_weights[type]}
                    onChange={(e) => edit({ ...current, credit_weights: { ...current.credit_weights, [type]: e.target.value } })}
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </SettingsField>
              ))}
            </div>
          </section>
        </div>
        <SettingsActionFooter
          sticky
          dirty={dirty}
          saving={save.isPending}
          onSave={onSave}
          onDiscard={() => { setDraft(null); setAttempted(false); setSaveError(null) }}
          saveLabel="Save Changes"
          discardLabel="Discard Changes"
          dirtyMessage="Unsaved changes. Room planning keeps using the saved values until you save."
          error={saveError}
        />
      </SettingsCard>

      <SettingsCard aria-labelledby="overrides-heading" className="space-y-4">
        <div>
          <h3 id="overrides-heading" className="text-sm font-semibold text-ink">Staff workload overrides</h3>
          <p className="mt-1 max-w-prose text-sm text-ink-3">
            Housekeepers use the hotel default of {formatCredits(saved.default_target_credits)} credits unless you set a custom capacity. Capacity changes save as soon as you confirm them.
          </p>
        </div>

        {staff.isLoading ? <SettingsLoading label="Loading staff…" />
          : staff.isError ? <SettingsError message="We couldn’t load your housekeepers." onRetry={() => staff.refetch()} />
          : rows.length === 0 ? <SettingsEmpty title="No active housekeepers" body="Add housekeepers in People, then set their capacity here." />
          : (
            <>
              <div className="relative max-w-sm">
                <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <SettingsTextInput type="search" aria-label="Search staff" placeholder="Search staff…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
              </div>
              {visibleRows.length === 0 ? <SettingsEmpty title="No staff match your search" /> : (
                <ul className="divide-y divide-line rounded-[var(--r-md)] border border-line">
                  <li aria-hidden="true" className="hidden items-center justify-between bg-surface-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-3 sm:flex"><span>Staff name</span><span className="mr-24">Daily capacity</span></li>
                  {visibleRows.map((row) => (
                    <li key={row.userId} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.name}</span>
                      <span className={row.override === null ? 'text-sm text-ink-3' : 'text-sm font-medium text-ink'}>
                        {row.override === null ? 'Hotel Default' : formatCredits(row.override)}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setEditingId(row.userId)} aria-label={`Edit workload capacity for ${row.name}`}>
                        <Pencil size={13} aria-hidden="true" /> Edit
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
      </SettingsCard>

      {editingRow && (
        <WorkloadOverrideDrawer
          key={editingRow.userId}
          row={editingRow}
          hotelDefault={saved.default_target_credits}
          overrides={saved.capacity_overrides}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}
