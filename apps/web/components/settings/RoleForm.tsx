'use client'

import { X, Pencil, Trash2 } from 'lucide-react'
import type { CustomRole } from '@/lib/api/staff'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Types & constants ────────────────────────────────────────────────────────

export interface RoleFormValues {
  name: string
  description: string
  base_role: string
  allowed_modules: string[]
}

export const EMPTY_ROLE_FORM: RoleFormValues = {
  name: '',
  description: '',
  base_role: 'front_desk',
  allowed_modules: ['housekeeping', 'guest-requests', 'lost-found', 'tasks', 'logbook'],
}

export const ALL_MODULES = [
  { key: 'housekeeping',   label: 'Housekeeping' },
  { key: 'engineering',    label: 'Engineering' },
  { key: 'guest-requests', label: 'Guest Requests' },
  { key: 'lost-found',     label: 'Lost & Found' },
  { key: 'tasks',          label: 'Tasks' },
  { key: 'staff',          label: 'Staff' },
  { key: 'scheduling',     label: 'Schedule' },
  { key: 'logbook',        label: 'Logbook' },
  { key: 'sop',            label: 'SOP Library' },
  { key: 'reports',        label: 'Reports' },
  { key: 'ai',             label: 'AI Copilot' },
]

export const BASE_ROLES = [
  { value: 'housekeeper',             label: 'Housekeeper' },
  { value: 'engineer',                label: 'Engineer' },
  { value: 'housekeeping_supervisor', label: 'Housekeeping Supervisor' },
  { value: 'chief_engineer',          label: 'Chief Engineer' },
  { value: 'front_desk',              label: 'Front Desk' },
  { value: 'gm',                      label: 'General Manager' },
]

const BASE_ROLE_LABELS: Record<string, string> = {
  housekeeper:             'Housekeeper',
  engineer:                'Engineer',
  housekeeping_supervisor: 'Supervisor',
  chief_engineer:          'Chief Engineer',
  front_desk:              'Front Desk',
  gm:                      'GM',
}

const BASE_ROLE_COLORS: Record<string, string> = {
  housekeeper:             'bg-teal-100 text-teal-700',
  engineer:                'bg-sky-100 text-sky-700',
  housekeeping_supervisor: 'bg-teal-100 text-teal-800',
  chief_engineer:          'bg-sky-100 text-sky-800',
  front_desk:              'bg-[var(--caution-soft)] text-[var(--caution)]',
  gm:                      'bg-violet-100 text-violet-700',
}

const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  ALL_MODULES.map(m => [m.key, m.label]),
)

// ─── RoleCard ─────────────────────────────────────────────────────────────────

export function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: CustomRole
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold text-stone-900">{role.name}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                BASE_ROLE_COLORS[role.base_role] ?? 'bg-stone-100 text-stone-600'
              }`}
            >
              {BASE_ROLE_LABELS[role.base_role] ?? role.base_role}
            </span>
          </div>
          {role.description && (
            <p className="text-xs text-stone-500 mb-2">{role.description}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {role.allowed_modules.map(mod => (
              <span key={mod} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded">
                {MODULE_LABELS[mod] ?? mod}
              </span>
            ))}
            {role.allowed_modules.length === 0 && (
              <span className="text-xs text-stone-400 italic">No modules selected</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-stone-400 hover:text-[var(--caution)] hover:bg-[var(--caution-soft)] rounded-lg transition-colors"
            aria-label="Edit role"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-stone-400 hover:text-[var(--alert)] hover:bg-red-50 rounded-lg transition-colors"
            aria-label="Delete role"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  )
}

// ─── RoleFormCard ─────────────────────────────────────────────────────────────

export function RoleFormCard({
  values,
  onChange,
  onSave,
  onCancel,
  saving,
  isNew,
}: {
  values: RoleFormValues
  onChange: (v: RoleFormValues) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  isNew?: boolean
}) {
  const toggleModule = (key: string) => {
    onChange({
      ...values,
      allowed_modules: values.allowed_modules.includes(key)
        ? values.allowed_modules.filter(m => m !== key)
        : [...values.allowed_modules, key],
    })
  }

  return (
    <Card className="p-5 space-y-4 border-[var(--caution-line)]/60 bg-[var(--caution-soft)]/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">
          {isNew ? 'New Role' : 'Edit Role'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-stone-400 hover:text-stone-600 rounded transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700">Role Name</label>
          <input
            value={values.name}
            onChange={e => onChange({ ...values, name: e.target.value })}
            placeholder="e.g. Night Auditor"
            className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700">Base Role</label>
          <select
            value={values.base_role}
            onChange={e => onChange({ ...values, base_role: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors"
          >
            {BASE_ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700">
          Description <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <input
          value={values.description}
          onChange={e => onChange({ ...values, description: e.target.value })}
          placeholder="Briefly describe this role's responsibilities"
          className="w-full px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-stone-700">Module Access</label>
        <div className="grid grid-cols-2 gap-1.5">
          {ALL_MODULES.map(({ key, label }) => {
            const enabled = values.allowed_modules.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleModule(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors border ${
                  enabled
                    ? 'bg-[var(--caution-soft)] border-[var(--caution-line)] text-amber-800 font-medium'
                    : 'bg-surface border-line text-ink3 hover:border-line hover:text-ink2'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    enabled ? 'bg-[var(--caution)]' : 'bg-stone-300'
                  }`}
                />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onSave}
          disabled={saving || !values.name.trim()}
        >
          {saving ? 'Saving…' : isNew ? 'Create Role' : 'Save Changes'}
        </Button>
      </div>
    </Card>
  )
}
