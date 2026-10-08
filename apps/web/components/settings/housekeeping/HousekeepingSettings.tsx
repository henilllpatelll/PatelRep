'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { HOUSEKEEPING_TABS, parseHousekeepingTab, type HousekeepingTab } from '@/lib/settings/housekeepingConfig'
import { useRole } from '@/lib/hooks/useRole'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsTabPanel, SettingsTabs } from '@/components/settings/workspace/SettingsTabs'
import { UnsavedChangesGuard } from '@/components/settings/workspace/UnsavedChangesGuard'
import { AssignmentTab } from './AssignmentTab'
import { CleaningTab } from './CleaningTab'
import { WorkloadTab } from './WorkloadTab'

/** Settings > Housekeeping. The active tab is URL-backed (?tab=) so Settings search and links land on it. */
export function HousekeepingSettings() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'housekeeping_supervisor'
  const tab = parseHousekeepingTab(searchParams.get('tab'))
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<HousekeepingTab | null>(null)

  // Each tab remounts on switch, so a stale flag from the previous tab must not survive it.
  useEffect(() => { setDirty(false) }, [tab])
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), [])

  const go = useCallback((next: HousekeepingTab) => {
    router.replace(`${pathname}?tab=${next}`, { scroll: false })
  }, [pathname, router])

  const requestTab = (next: HousekeepingTab) => {
    if (next === tab) return
    if (dirty) setPending(next)
    else go(next)
  }

  if (!canManage) {
    return <p className="py-8 text-sm text-ink-3">You don’t have permission to manage housekeeping settings.</p>
  }

  return (
    <div className="space-y-5">
      <UnsavedChangesGuard dirty={dirty} />
      <SettingsSectionHeader
        level={1}
        title="Housekeeping"
        description="Configure cleaning standards, workload targets, and automatic assignment preferences."
      />
      <SettingsTabs tabs={HOUSEKEEPING_TABS} value={tab} onChange={requestTab} label="Housekeeping settings" idPrefix="hk" />
      <SettingsTabPanel idPrefix="hk" tab={tab}>
        {tab === 'cleaning' && <CleaningTab onDirtyChange={onDirtyChange} />}
        {tab === 'workload' && <WorkloadTab onDirtyChange={onDirtyChange} />}
        {tab === 'assignment' && <AssignmentTab onDirtyChange={onDirtyChange} />}
      </SettingsTabPanel>

      {pending && (
        <SettingsConfirmDialog
          title="Discard unsaved changes?"
          body={<p>You have unsaved changes on the {HOUSEKEEPING_TABS.find((t) => t.id === tab)?.label} tab. Switching to {HOUSEKEEPING_TABS.find((t) => t.id === pending)?.label} will discard them.</p>}
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          tone="destructive"
          onCancel={() => setPending(null)}
          onConfirm={() => { const next = pending; setPending(null); setDirty(false); go(next) }}
        />
      )}
    </div>
  )
}
