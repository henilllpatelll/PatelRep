'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { staffApi, type CustomRole } from '@/lib/api/staff'
import { errorMessage } from '@/lib/settings/apiErrors'
import { useToast } from '@/components/ui/Toast'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import type { CustomRoleRow } from './useCustomRoles'

/**
 * Deleting is refused while active staff hold the role (the API enforces it too): removing it would silently
 * change their access, so staff are never reassigned for you.
 */
export function DeleteRoleDialog({ role, onClose, onDeleted }: { role: CustomRole | CustomRoleRow; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const assigned = (role as CustomRoleRow).assigned_staff_count ?? 0
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (busy || assigned > 0) return
    setBusy(true)
    setError(null)
    try {
      await staffApi.deleteCustomRole(role.id)
      await queryClient.invalidateQueries({ queryKey: ['custom-roles'] })
      toast.success(`“${role.name}” was deleted.`)
      onDeleted()
    } catch (err) {
      setError(errorMessage(err, 'We couldn’t delete this role. Nothing was changed.'))
      setBusy(false)
    }
  }

  return (
    <SettingsConfirmDialog
      title="Delete Custom Role?"
      body={assigned > 0 ? (
        <>
          <p className="font-medium text-ink">{role.name}</p>
          <p>{assigned} active staff {assigned === 1 ? 'member holds' : 'members hold'} this role, so it can’t be deleted yet. Move them to another role in People first. They won’t be reassigned automatically.</p>
        </>
      ) : (
        <>
          <p className="font-medium text-ink">{role.name}</p>
          <p>No active staff hold this role. It will be removed from your roles. Built-in roles are never affected.</p>
        </>
      )}
      confirmLabel={assigned > 0 ? 'Can’t delete yet' : 'Delete Role'}
      cancelLabel={assigned > 0 ? 'Close' : 'Cancel'}
      tone="destructive"
      busy={busy}
      error={error}
      onCancel={() => { if (!busy) onClose() }}
      onConfirm={assigned > 0 ? onClose : remove}
    />
  )
}
