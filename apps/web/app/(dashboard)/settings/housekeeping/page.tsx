'use client'

import { useRole } from '@/lib/hooks/useRole'
import { CleaningChecklistEditor } from '@/components/settings/CleaningChecklistEditor'

export default function HousekeepingSettingsPage() {
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'housekeeping_supervisor'

  if (!canManage) {
    return (
      <p className="text-sm text-stone-500 py-8">
        You don&apos;t have permission to manage cleaning checklists.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Cleaning Checklists</h2>
        <p className="text-sm text-stone-500 mt-1">
          Edit the tasks housekeepers see when cleaning each room type. Changes apply to new sessions only — in-progress rooms keep their snapshotted checklist.
        </p>
      </div>
      <CleaningChecklistEditor />
    </div>
  )
}
