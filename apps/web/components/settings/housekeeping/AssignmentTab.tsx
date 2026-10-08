'use client'

import { useEffect, useState } from 'react'
import type { AssignmentPreferences } from '@/lib/api/hotels'
import { errorMessage } from '@/lib/settings/apiErrors'
import { ASSIGNMENT_COPY, ASSIGNMENT_GROUPS, assignmentDirty } from '@/lib/settings/housekeepingConfig'
import { useToast } from '@/components/ui/Toast'
import { SettingsActionFooter } from '@/components/settings/workspace/SettingsActionFooter'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { SettingsSwitch } from '@/components/settings/workspace/SettingsSwitch'
import { useHousekeepingSettingsQuery, useSaveHousekeepingSettings } from './useHousekeepingSettings'

export function AssignmentTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const toast = useToast()
  const settings = useHousekeepingSettingsQuery()
  const save = useSaveHousekeepingSettings()
  const saved = settings.data?.assignment_preferences
  const [draft, setDraft] = useState<AssignmentPreferences | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const current = draft ?? saved
  const dirty = !!(saved && draft && assignmentDirty(draft, saved))

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  if (settings.isLoading) return <SettingsLoading label="Loading assignment preferences…" />
  if (settings.isError || !saved || !current) return <SettingsError message="We couldn’t load the assignment preferences." onRetry={() => settings.refetch()} />

  async function onSave() {
    if (save.isPending || !draft) return
    setSaveError(null)
    try {
      await save.mutateAsync({ assignment_preferences: draft })
      setDraft(null)
      toast.success('Assignment preferences saved.')
    } catch (err) {
      setSaveError(errorMessage(err, 'We couldn’t save the assignment preferences. Your changes are still here.'))
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-ink-3">Choose the rules Auto-balance follows when it proposes room assignments. Manual assignments always remain a supervisor decision.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {ASSIGNMENT_GROUPS.map((group) => (
          <SettingsCard key={group.id} aria-labelledby={`assignment-${group.id}`} className="space-y-4">
            <h3 id={`assignment-${group.id}`} className="text-sm font-semibold text-ink">{group.title}</h3>
            {group.items.map((key) => (
              <SettingsSwitch
                key={key}
                id={`assignment-${key}`}
                checked={current[key]}
                disabled={save.isPending}
                onChange={(next) => { setDraft({ ...current, [key]: next }); setSaveError(null) }}
                label={ASSIGNMENT_COPY[key].label}
                description={ASSIGNMENT_COPY[key].description}
              />
            ))}
          </SettingsCard>
        ))}
      </div>
      <SettingsCard className="overflow-clip p-0">
        <SettingsActionFooter
          sticky
          dirty={dirty}
          saving={save.isPending}
          onSave={onSave}
          onDiscard={() => { setDraft(null); setSaveError(null) }}
          saveLabel="Save Changes"
          discardLabel="Discard Changes"
          dirtyMessage="Unsaved changes. Auto-balance keeps using the saved rules until you save."
          error={saveError}
        />
      </SettingsCard>
    </div>
  )
}
