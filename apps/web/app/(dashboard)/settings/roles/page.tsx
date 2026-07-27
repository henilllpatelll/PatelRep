'use client'

import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Plus } from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { staffApi } from '@/lib/api/staff'
import type { CreateCustomRoleData } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import {
  RoleCard,
  RoleFormCard,
  type RoleFormValues,
  EMPTY_ROLE_FORM,
} from '@/components/settings/RoleForm'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RolesSettingsPage() {
  const { hotel } = useHotelStore()
  const { isGM } = useRole()
  const queryClient = useQueryClient()
  const toast = useToast()

  const [roleFormOpen, setRoleFormOpen] = useState<'create' | string | null>(null)
  const [roleForm, setRoleForm] = useState<RoleFormValues>(EMPTY_ROLE_FORM)
  const [roleSaving, setRoleSaving] = useState(false)

  const { data: customRoles = [], refetch: refetchCustomRoles } = useQuery({
    queryKey: ['custom-roles', hotel?.id],
    queryFn: () => staffApi.listCustomRoles(),
    enabled: !!hotel?.id && isGM,
    select: res => res.data,
  })

  const saveRole = useCallback(async () => {
    if (!hotel?.id) return
    setRoleSaving(true)
    try {
      const payload: CreateCustomRoleData = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || undefined,
        base_role: roleForm.base_role as UserRole,
        allowed_modules: roleForm.allowed_modules,
      }
      if (roleFormOpen === 'create') {
        await staffApi.createCustomRole(payload)
      } else if (roleFormOpen) {
        await staffApi.updateCustomRole(roleFormOpen, payload)
      }
      setRoleFormOpen(null)
      await refetchCustomRoles()
      toast.success(roleFormOpen === 'create' ? 'Role created.' : 'Role updated.')
    } catch (err: any) {
      toast.error(err.message || 'Failed to save role.')
    } finally {
      setRoleSaving(false)
    }
  }, [hotel, roleFormOpen, roleForm, refetchCustomRoles, toast])

  const deleteRole = useCallback(async (roleId: string) => {
    if (!hotel?.id) return
    try {
      await staffApi.deleteCustomRole(roleId)
      await refetchCustomRoles()
      toast.success('Role removed.')
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete role.')
    }
  }, [hotel, refetchCustomRoles, toast])

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-stone-900">Custom Roles</h2>
          <p className="text-sm text-stone-500 mt-1">
            Define named roles with custom module access for your team. Dashboard is always visible.
          </p>
        </div>
        {roleFormOpen !== 'create' && (
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setRoleForm({ ...EMPTY_ROLE_FORM })
              setRoleFormOpen('create')
            }}
          >
            <Plus size={14} className="inline mr-1.5 -mt-0.5" />
            New Role
          </Button>
        )}
      </div>

      {roleFormOpen === 'create' && (
        <RoleFormCard
          values={roleForm}
          onChange={setRoleForm}
          onSave={saveRole}
          onCancel={() => setRoleFormOpen(null)}
          saving={roleSaving}
          isNew
        />
      )}

      {customRoles.length === 0 && roleFormOpen !== 'create' && (
        <EmptyState
          icon={<ShieldCheck className="w-5 h-5" />}
          title="No custom roles yet"
          body="Create a role to define custom module access for your team."
        />
      )}

      <div className="space-y-3">
        {customRoles.map(cr =>
          roleFormOpen === cr.id ? (
            <RoleFormCard
              key={cr.id}
              values={roleForm}
              onChange={setRoleForm}
              onSave={saveRole}
              onCancel={() => setRoleFormOpen(null)}
              saving={roleSaving}
            />
          ) : (
            <RoleCard
              key={cr.id}
              role={cr}
              onEdit={() => {
                setRoleForm({
                  name: cr.name,
                  description: cr.description ?? '',
                  base_role: cr.base_role,
                  allowed_modules: cr.allowed_modules,
                })
                setRoleFormOpen(cr.id)
              }}
              onDelete={() => deleteRole(cr.id)}
            />
          ),
        )}
      </div>
    </div>
  )
}
