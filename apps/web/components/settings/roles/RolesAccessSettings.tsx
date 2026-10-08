'use client'

import { useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Eye, Pencil, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react'
import { BUILT_IN_ROLES, ROLE_NAMES, normalizeModules, type BuiltInRole } from '@/lib/settings/rolesAccess'
import { useRole } from '@/lib/hooks/useRole'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { CustomRoleDrawer } from './CustomRoleDrawer'
import { DeleteRoleDialog } from './DeleteRoleDialog'
import { FrontDeskAccessDrawer } from './FrontDeskAccessDrawer'
import { SystemRoleDrawer } from './SystemRoleDrawer'
import { useCustomRoles, type CustomRoleRow } from './useCustomRoles'

type Drawer =
  | { kind: 'create' }
  | { kind: 'edit'; role: CustomRoleRow }
  | { kind: 'system'; role: BuiltInRole }
  | { kind: 'frontDesk' }
  | null

export function RolesAccessSettings() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isGM } = useRole()
  const rolesQuery = useCustomRoles()
  const roles = rolesQuery.data ?? []

  // `?access=front-desk` opens the Front Desk drawer: it is where the retired /settings/front-desk page now lands.
  const [drawer, setDrawer] = useState<Drawer>(() => (searchParams.get('access') === 'front-desk' ? { kind: 'frontDesk' } : null))
  const [deleting, setDeleting] = useState<CustomRoleRow | null>(null)

  const closeDrawer = useCallback(() => {
    setDrawer(null)
    if (searchParams.get('access')) router.replace(pathname, { scroll: false })
  }, [pathname, router, searchParams])

  if (!isGM) return <p className="py-8 text-sm text-ink-3">Roles & Access is limited to General Managers.</p>

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        level={1}
        title="Roles & Access"
        description="Manage staff access to PatelRep modules and customize available roles."
        actions={<Button onClick={() => setDrawer({ kind: 'create' })}><Plus size={14} aria-hidden="true" /> Create Role</Button>}
      />

      <section aria-labelledby="builtin-heading" className="space-y-3">
        <h2 id="builtin-heading" className="text-xs font-semibold uppercase tracking-wide text-ink-3">Built-in roles</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {BUILT_IN_ROLES.map((role) => (
            <li key={role.id}>
              <SettingsCard as="article" aria-label={role.name} className="flex h-full flex-col gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-ink">{role.name}</h3>
                  <p className="mt-1 text-[13px] text-ink-3">{role.purpose}</p>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <span aria-hidden="true" className={role.access === 'frontDesk' ? 'h-1.5 w-1.5 rounded-full bg-[var(--accent)]' : 'h-1.5 w-1.5 rounded-full bg-ink-3'} />
                    {role.access === 'frontDesk' ? 'Configurable module access' : 'System-managed access'}
                  </p>
                </div>
                {role.access === 'frontDesk' ? (
                  <Button variant="outline" size="sm" className="self-start" onClick={() => setDrawer({ kind: 'frontDesk' })} aria-label="Manage Front Desk access">
                    <SlidersHorizontal size={13} aria-hidden="true" /> Manage Access
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setDrawer({ kind: 'system', role })} aria-label={`View ${role.name}`}>
                    <Eye size={13} aria-hidden="true" /> View
                  </Button>
                )}
              </SettingsCard>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="custom-heading" className="space-y-3">
        <h2 id="custom-heading" className="text-xs font-semibold uppercase tracking-wide text-ink-3">Custom roles</h2>
        {rolesQuery.isLoading ? <SettingsLoading label="Loading custom roles…" />
          : rolesQuery.isError ? <SettingsError message="We couldn’t load the custom roles." onRetry={() => rolesQuery.refetch()} />
          : roles.length === 0 ? (
            <SettingsEmpty
              icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
              title="No custom roles yet"
              body="Create a role to give a group of staff a narrower set of modules than their built-in role."
              action={<Button onClick={() => setDrawer({ kind: 'create' })}><Plus size={14} aria-hidden="true" /> Create Role</Button>}
            />
          ) : (
            <ul className="space-y-2">
              {roles.map((role) => {
                const count = normalizeModules(role.allowed_modules).length
                const staff = role.assigned_staff_count ?? 0
                return (
                  <li key={role.id}>
                    <SettingsCard as="article" aria-label={role.name} className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-ink">{role.name}</h3>
                        <p className="mt-0.5 text-[13px] text-ink-3">
                          Based on {ROLE_NAMES[role.base_role] ?? role.base_role} · {count} {count === 1 ? 'module' : 'modules'} · {staff} active {staff === 1 ? 'staff member' : 'staff'}
                        </p>
                        {role.description && <p className="mt-1 truncate text-xs text-ink-3">{role.description}</p>}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setDrawer({ kind: 'edit', role })} aria-label={`Edit ${role.name}`}><Pencil size={13} aria-hidden="true" /> Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(role)} aria-label={`Delete ${role.name}`} className="text-ink-3 hover:text-[var(--alert)]"><Trash2 size={14} aria-hidden="true" /></Button>
                    </SettingsCard>
                  </li>
                )
              })}
            </ul>
          )}
      </section>

      {drawer?.kind === 'create' && <CustomRoleDrawer roles={roles} onClose={closeDrawer} />}
      {drawer?.kind === 'edit' && <CustomRoleDrawer key={drawer.role.id} role={roles.find((r) => r.id === drawer.role.id) ?? drawer.role} roles={roles} onClose={closeDrawer} />}
      {drawer?.kind === 'system' && <SystemRoleDrawer role={drawer.role} onClose={closeDrawer} />}
      {drawer?.kind === 'frontDesk' && <FrontDeskAccessDrawer onClose={closeDrawer} />}
      {deleting && <DeleteRoleDialog role={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />}
    </div>
  )
}
