'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { staffApi } from '@/lib/api/staff'
import { errorMessage } from '@/lib/settings/apiErrors'
import {
  CUSTOM_BASE_ROLES, EMPTY_ROLE_FORM, ROLE_NAMES, moduleLabel, modulesForRole, reconcileModules, roleFormChanged, roleToForm, toRolePayload,
  validateRoleForm, type RoleForm,
} from '@/lib/settings/rolesAccess'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsField, SettingsSelect, SettingsTextInput, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { DeleteRoleDialog } from './DeleteRoleDialog'
import { ModuleChecklist } from './ModuleChecklist'
import type { CustomRoleRow } from './useCustomRoles'

export function CustomRoleDrawer({ role, roles, onClose }: { role?: CustomRoleRow; roles: CustomRoleRow[]; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const editing = !!role
  const initial = useMemo<RoleForm>(() => (role ? roleToForm(role) : EMPTY_ROLE_FORM), [role])
  const [form, setForm] = useState<RoleForm>(initial)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [dropped, setDropped] = useState<string[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const assigned = role?.assigned_staff_count ?? 0
  // A role saved against the General Manager base before that was disallowed keeps working but can't be re-based onto it.
  const legacyGm = role?.base_role === 'gm'
  const dirty = roleFormChanged(form, initial)
  const errors = useMemo(() => validateRoleForm(form, roles, role?.id), [form, roles, role?.id])
  const shown = attempted ? errors : {}
  const available = useMemo(() => modulesForRole(form.base_role), [form.base_role])

  const patch = (next: Partial<RoleForm>) => { setForm((f) => ({ ...f, ...next })); setServerError(null) }

  function changeBase(base: RoleForm['base_role']) {
    const { kept, dropped: gone } = reconcileModules(base, form.allowed_modules)
    setDropped(gone)
    patch({ base_role: base, allowed_modules: kept })
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return
    setAttempted(true)
    if (errors.name || errors.modules) return
    setSaving(true)
    setServerError(null)
    try {
      const payload = toRolePayload(form)
      if (role) await staffApi.updateCustomRole(role.id, payload)
      else await staffApi.createCustomRole(payload)
      await queryClient.invalidateQueries({ queryKey: ['custom-roles'] })
      toast.success(editing ? 'Role saved.' : 'Role created.')
      onClose()
    } catch (err) {
      setServerError(errorMessage(err, 'We couldn’t save this role. Your changes are still here.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsDrawer
      title={editing ? 'Edit Custom Role' : 'Create Custom Role'}
      description="A custom role is a variant of a built-in role. It can narrow which modules appear, never add access the base role doesn’t have."
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          {editing && <Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)} disabled={saving}><Trash2 size={14} aria-hidden="true" /> Delete Role</Button>}
          <div className="ml-auto flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
            <Button type="submit" form="custom-role-form" loading={saving} disabled={editing && !dirty}>Save Role</Button>
          </div>
        </div>
      )}
    >
      <form id="custom-role-form" onSubmit={submit} noValidate className="space-y-6">
        {serverError && <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{serverError}</p>}

        <section aria-label="Role information" className="space-y-4">
          <h3 className="text-sm font-semibold text-ink">Role information</h3>
          <SettingsField id="role-name" label="Role Name" required error={shown.name}>
            <SettingsTextInput {...controlA11y('role-name', { error: shown.name, required: true })} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Night Auditor" maxLength={120} autoComplete="off" />
          </SettingsField>
          <SettingsField
            id="role-base"
            label="Base Role"
            required
            hint={assigned > 0 ? `${assigned} active staff hold this role, so its base role is locked.` : 'The built-in role this one is based on. It decides what the person can actually do.'}
          >
            <SettingsSelect {...controlA11y('role-base', { hint: true, required: true })} value={form.base_role} onChange={(e) => changeBase(e.target.value as RoleForm['base_role'])} disabled={assigned > 0 || legacyGm}>
              {legacyGm && <option value="gm">{ROLE_NAMES.gm} (existing)</option>}
              {CUSTOM_BASE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </SettingsSelect>
          </SettingsField>
          <SettingsField id="role-description" label="Description" hint="Optional. Shown to other GMs.">
            <SettingsTextInput {...controlA11y('role-description', { hint: true })} value={form.description} onChange={(e) => patch({ description: e.target.value })} maxLength={500} autoComplete="off" />
          </SettingsField>
        </section>

        <section aria-label="Module access" className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Module access</h3>
          <p className="-mt-1 text-xs text-ink-3">Only modules the {ROLE_NAMES[form.base_role] ?? 'base'} role can open are listed. People with this role see just the ones you tick.</p>
          {dropped.length > 0 && (
            <p role="status" className="rounded-lg border border-[var(--caution-line)] bg-[var(--caution-soft)] px-3 py-2 text-xs text-ink">
              Not available to {ROLE_NAMES[form.base_role]}, so unticked: {dropped.map(moduleLabel).join(', ')}.
            </p>
          )}
          <ModuleChecklist legend="Modules" modules={available} selected={form.allowed_modules} onChange={(allowed_modules) => patch({ allowed_modules })} error={shown.modules} idPrefix="role-module" />
        </section>
      </form>

      {confirmingDelete && role && <DeleteRoleDialog role={role} onClose={() => setConfirmingDelete(false)} onDeleted={onClose} />}
    </SettingsDrawer>
  )
}
