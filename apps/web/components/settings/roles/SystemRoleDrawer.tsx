'use client'

import { Smartphone } from 'lucide-react'
import { roleModuleSummary, type BuiltInRole } from '@/lib/settings/rolesAccess'
import { Button } from '@/components/ui/Button'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'

/** Read-only view of a built-in role whose access is fixed by the application's security policy. */
export function SystemRoleDrawer({ role, onClose }: { role: BuiltInRole; onClose: () => void }) {
  return (
    <SettingsDrawer
      title={role.name}
      description="Built-in role · system-managed"
      onClose={onClose}
      footer={<div className="flex justify-end px-4 py-3 sm:px-5"><Button variant="ghost" onClick={onClose}>Close</Button></div>}
    >
      <dl className="space-y-5 text-sm">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Purpose</dt><dd className="mt-1 text-ink">{role.purpose}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Access</dt><dd className="mt-1 text-ink">System-managed. This role’s access can’t be edited.</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Web modules</dt><dd className="mt-1 text-ink">{role.mobileOnly ? 'This role works in the mobile app and doesn’t use the web app.' : roleModuleSummary(role.id)}</dd></div>
        {role.mobileOnly && (
          <div className="flex items-start gap-2 text-ink-3"><Smartphone size={14} aria-hidden="true" className="mt-0.5 shrink-0" /><p>Mobile-only role.</p></div>
        )}
      </dl>
      <p className="mt-6 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-3">
        What this role can do is set by PatelRep’s built-in security policy. You can create a custom role based on it to narrow which modules a person sees, but a custom role can never add access.
      </p>
    </SettingsDrawer>
  )
}
