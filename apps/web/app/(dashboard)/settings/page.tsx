'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { hotelsApi } from '@/lib/api/hotels'
import { staffApi } from '@/lib/api/staff'
import { housekeepingApi, type InspectionTemplate } from '@/lib/api/housekeeping'
import type { CustomRole, CreateCustomRoleData } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import {
  CheckCircle2, Building2, Layers, Sliders,
  Bed, Bell, Package, ClipboardList, BookOpen, Library, FileText,
  ShieldCheck, Plus, Pencil, Trash2, X,
  Wrench, Users, Calendar, Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Schema ───────────────────────────────────────────────────────────────────

const hotelProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  address: z.string().min(5, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().length(2, 'Use 2-letter state code (e.g. TX)'),
  zip: z
    .string()
    .regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  phone: z
    .string()
    .regex(/^\+?[\d\s\-().]{7,20}$/, 'Enter a valid phone number'),
  timezone: z.string().min(1, 'Timezone is required'),
  room_count: z
    .number({ invalid_type_error: 'Must be a number' })
    .int()
    .min(1, 'Must be at least 1 room')
    .max(999, 'Max 999 rooms'),
})

type HotelProfileFormValues = z.infer<typeof hotelProfileSchema>

// ─── Constants ────────────────────────────────────────────────────────────────

const US_TIMEZONES = [
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
]

const DEPARTMENTS = [
  { name: 'Housekeeping', color: 'bg-teal-500', description: 'Room cleaning and laundry' },
  { name: 'Engineering', color: 'bg-sky-500', description: 'Maintenance and repairs' },
  { name: 'Front Desk', color: 'bg-amber-500', description: 'Guest services and check-in' },
  { name: 'Management', color: 'bg-violet-500', description: 'Hotel operations and oversight' },
]

type Tab = 'general' | 'departments' | 'front_desk' | 'roles' | 'inspections'

const FRONT_DESK_MODULES = [
  { key: 'housekeeping',    label: 'Housekeeping',    description: 'Room board, assignments and inspections', icon: Bed },
  { key: 'engineering',     label: 'Maintenance',     description: 'Work orders and maintenance tracking', icon: Wrench },
  { key: 'guest-requests',  label: 'Guest Requests',  description: 'Guest service requests and escalations', icon: Bell },
  { key: 'lost-found',      label: 'Lost & Found',    description: 'Log and look up guest items', icon: Package },
  { key: 'tasks',           label: 'Tasks',           description: 'Assign and track ad-hoc tasks', icon: ClipboardList },
  { key: 'staff',           label: 'Staff',           description: 'View and manage hotel staff', icon: Users },
  { key: 'scheduling',      label: 'Schedule',        description: 'Staff scheduling and shifts', icon: Calendar },
  { key: 'logbook',         label: 'Logbook',         description: 'Shift-by-shift log entries', icon: BookOpen },
  { key: 'sop',             label: 'SOP Library',     description: 'Standard operating procedures', icon: Library },
  { key: 'reports',         label: 'Reports',         description: 'Analytics and daily summaries', icon: FileText },
  { key: 'ai',              label: 'AI Copilot',      description: 'AI-powered hotel insights and automation', icon: Sparkles },
]

const DEFAULT_FD_MODULES = ['housekeeping', 'engineering', 'guest-requests', 'lost-found', 'tasks', 'logbook']

// ─── Custom Roles Constants ───────────────────────────────────────────────────

const ALL_MODULES = [
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

const BASE_ROLES = [
  { value: 'housekeeper',            label: 'Housekeeper' },
  { value: 'engineer',               label: 'Engineer' },
  { value: 'housekeeping_supervisor', label: 'Housekeeping Supervisor' },
  { value: 'chief_engineer',         label: 'Chief Engineer' },
  { value: 'front_desk',             label: 'Front Desk' },
  { value: 'gm',                     label: 'General Manager' },
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
  front_desk:              'bg-amber-100 text-amber-700',
  gm:                      'bg-violet-100 text-violet-700',
}

const MODULE_LABELS: Record<string, string> = Object.fromEntries(ALL_MODULES.map(m => [m.key, m.label]))

// ─── Role Form Types ──────────────────────────────────────────────────────────

interface RoleFormValues {
  name: string
  description: string
  base_role: string
  allowed_modules: string[]
}

const EMPTY_ROLE_FORM: RoleFormValues = {
  name: '',
  description: '',
  base_role: 'front_desk',
  allowed_modules: ['housekeeping', 'guest-requests', 'lost-found', 'tasks', 'logbook'],
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FormField({
  id,
  label,
  error,
  children,
}: {
  id?: string
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function Input({
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 text-sm border rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
        error
          ? 'border-red-300 focus:ring-red-500'
          : 'border-amber-200/40 hover:border-amber-200 focus:ring-amber-400/50 focus:border-amber-200'
      }`}
    />
  )
}

function RoleCard({
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
            <span className="text-sm font-semibold text-slate-900">{role.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BASE_ROLE_COLORS[role.base_role] ?? 'bg-gray-100 text-gray-600'}`}>
              {BASE_ROLE_LABELS[role.base_role] ?? role.base_role}
            </span>
          </div>
          {role.description && (
            <p className="text-xs text-gray-500 mb-2">{role.description}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {role.allowed_modules.map(mod => (
              <span key={mod} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded">
                {MODULE_LABELS[mod] ?? mod}
              </span>
            ))}
            {role.allowed_modules.length === 0 && (
              <span className="text-xs text-gray-400 italic">No modules selected</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            aria-label="Edit role"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            aria-label="Delete role"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  )
}

function RoleFormCard({
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
    <Card className="p-5 space-y-4 border-amber-200/60 bg-amber-50/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">
          {isNew ? 'New Role' : 'Edit Role'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Role Name</label>
          <input
            value={values.name}
            onChange={e => onChange({ ...values, name: e.target.value })}
            placeholder="e.g. Night Auditor"
            className="w-full px-3 py-2 text-sm border border-amber-200/40 rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Base Role</label>
          <select
            value={values.base_role}
            onChange={e => onChange({ ...values, base_role: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-amber-200/40 rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors"
          >
            {BASE_ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">
          Description <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          value={values.description}
          onChange={e => onChange({ ...values, description: e.target.value })}
          placeholder="Briefly describe this role's responsibilities"
          className="w-full px-3 py-2 text-sm border border-amber-200/40 rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Module Access</label>
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
                    ? 'bg-amber-50 border-amber-200 text-amber-800 font-medium'
                    : 'bg-white border-stone-200 text-stone-500 hover:border-stone-300 hover:text-stone-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${enabled ? 'bg-amber-500' : 'bg-stone-300'}`} />
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

// ─── Inspection Template Types ───────────────────────────────────────────────

interface TemplateItemForm {
  section: string
  description: string
  is_required: boolean
}

interface TemplateFormValues {
  name: string
  is_default: boolean
  items: TemplateItemForm[]
}

const INSPECTION_SECTIONS = [
  'Bathroom', 'Sleeping Area', 'General', 'Amenities',
  'Closet', 'Balcony', 'Kitchenette', 'Entrance',
]

const EMPTY_TEMPLATE_FORM: TemplateFormValues = {
  name: '',
  is_default: false,
  items: [
    { section: 'Bathroom', description: '', is_required: true },
    { section: 'Sleeping Area', description: '', is_required: true },
    { section: 'General', description: '', is_required: true },
  ],
}

// ─── Template Sub-components ──────────────────────────────────────────────────

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: InspectionTemplate
  onEdit: () => void
  onDelete: () => void
}) {
  const sectionGroups = template.items.reduce<Record<string, InspectionTemplate['items']>>(
    (acc, item) => { (acc[item.section] ??= []).push(item); return acc },
    {}
  )

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">{template.name}</span>
            {template.is_default && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700">Default</span>
            )}
            <span className="text-xs text-gray-400">
              {template.items.length} item{template.items.length !== 1 ? 's' : ''}
            </span>
          </div>
          {Object.entries(sectionGroups).slice(0, 2).map(([section, items]) => (
            <div key={section} className="flex items-baseline gap-1.5 mb-0.5">
              <span className="text-xs font-medium text-gray-500 w-24 shrink-0 truncate">{section}</span>
              <span className="text-xs text-gray-400 truncate">
                {items.map((i) => i.description).join(' · ')}
              </span>
            </div>
          ))}
          {Object.keys(sectionGroups).length > 2 && (
            <p className="text-xs text-gray-400 mt-0.5">
              +{Object.keys(sectionGroups).length - 2} more section{Object.keys(sectionGroups).length > 3 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            aria-label="Edit template"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            aria-label="Delete template"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  )
}

function TemplateFormCard({
  values,
  onChange,
  onSave,
  onCancel,
  saving,
  isNew,
}: {
  values: TemplateFormValues
  onChange: (v: TemplateFormValues) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  isNew?: boolean
}) {
  const addItem = () =>
    onChange({ ...values, items: [...values.items, { section: 'General', description: '', is_required: true }] })

  const removeItem = (idx: number) =>
    onChange({ ...values, items: values.items.filter((_, i) => i !== idx) })

  const updateItem = (idx: number, field: keyof TemplateItemForm, value: string | boolean) =>
    onChange({ ...values, items: values.items.map((item, i) => i === idx ? { ...item, [field]: value } : item) })

  return (
    <Card className="p-5 space-y-4 border-teal-200/60 bg-teal-50/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">
          {isNew ? 'New Template' : 'Edit Template'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">Template Name</label>
        <input
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder="e.g. Standard Room Inspection"
          className="w-full px-3 py-2 text-sm border border-teal-200/40 rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={values.is_default}
          onClick={() => onChange({ ...values, is_default: !values.is_default })}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
            values.is_default ? 'bg-teal-400' : 'bg-stone-200'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              values.is_default ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className="text-sm text-gray-700">Set as default template</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">Checklist Items</label>
          <span className="text-xs text-gray-400">
            {values.items.length} item{values.items.length !== 1 ? 's' : ''}
          </span>
        </div>

        {values.items.length === 0 && (
          <p className="text-xs text-gray-400 italic py-1">No items yet.</p>
        )}

        <div className="space-y-2">
          {values.items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={item.section}
                onChange={(e) => updateItem(idx, 'section', e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400/50 w-28 shrink-0"
              >
                {INSPECTION_SECTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <input
                value={item.description}
                onChange={(e) => updateItem(idx, 'description', e.target.value)}
                placeholder="Item description"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400/50 bg-white min-w-0"
              />
              <button
                type="button"
                title={item.is_required ? 'Required — click to make optional' : 'Optional — click to make required'}
                onClick={() => updateItem(idx, 'is_required', !item.is_required)}
                className={`text-xs px-2 py-1.5 rounded-lg border transition-colors shrink-0 ${
                  item.is_required
                    ? 'bg-teal-50 border-teal-200 text-teal-700 font-medium'
                    : 'bg-white border-gray-200 text-gray-400'
                }`}
              >
                Req
              </button>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                aria-label="Remove item"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <Button type="button" variant="ghost" onClick={addItem} className="text-teal-700 text-xs">
          <Plus size={12} className="inline mr-1 -mt-0.5" />
          Add Item
        </Button>
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
          {saving ? 'Saving…' : isNew ? 'Create Template' : 'Save Changes'}
        </Button>
      </div>
    </Card>
  )
}

// ─── Settings Page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [fdModules, setFdModules] = useState<string[]>(DEFAULT_FD_MODULES)
  const [fdSaving, setFdSaving] = useState(false)

  // Roles tab state
  const [roleFormOpen, setRoleFormOpen] = useState<'create' | string | null>(null)
  const [roleForm, setRoleForm] = useState<RoleFormValues>(EMPTY_ROLE_FORM)
  const [roleSaving, setRoleSaving] = useState(false)

  const { hotel, setHotel } = useHotelStore()
  const { isGM, role } = useRole()

  // Inspection template tab state
  const [templateFormOpen, setTemplateFormOpen] = useState<'create' | string | null>(null)
  const [templateForm, setTemplateForm] = useState<TemplateFormValues>(EMPTY_TEMPLATE_FORM)
  const [templateSaving, setTemplateSaving] = useState(false)

  // Fetch full hotel profile (store only has id/name/timezone/room_count)
  const { data: fullHotel } = useQuery({
    queryKey: ['hotel-full', hotel?.id],
    queryFn: () => hotelsApi.get(hotel!.id),
    enabled: !!hotel?.id,
    select: (res) => res.data,
  })

  // Fetch custom roles (GM-only)
  const { data: customRoles = [], refetch: refetchCustomRoles } = useQuery({
    queryKey: ['custom-roles', hotel?.id],
    queryFn: () => staffApi.listCustomRoles(),
    enabled: !!hotel?.id && isGM,
    select: (res) => res.data,
  })

  // Fetch inspection templates (GM + housekeeping_supervisor)
  const canManageTemplates = isGM || role === 'housekeeping_supervisor'
  const { data: inspectionTemplates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['inspection-templates', hotel?.id],
    queryFn: () => housekeepingApi.getInspectionTemplates(),
    enabled: !!hotel?.id && canManageTemplates,
    select: (res: any) => (res.data ?? []) as InspectionTemplate[],
  })

  const hydratedRef = useRef(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<HotelProfileFormValues>({
    resolver: zodResolver(hotelProfileSchema),
    defaultValues: {
      name: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      phone: '',
      timezone: 'America/Chicago',
      room_count: 50,
    },
  })

  // Hydrate front desk modules from API data
  useEffect(() => {
    if (fullHotel?.front_desk_modules) {
      setFdModules(fullHotel.front_desk_modules)
    }
  }, [fullHotel])

  // Populate form once on initial load — skip on background refetches to avoid
  // wiping user's in-progress edits.
  useEffect(() => {
    if (fullHotel && !hydratedRef.current) {
      reset({
        name: fullHotel.name ?? '',
        address: fullHotel.address ?? '',
        city: fullHotel.city ?? '',
        state: fullHotel.state ?? '',
        zip: fullHotel.zip ?? '',
        phone: fullHotel.phone ?? '',
        timezone: fullHotel.timezone ?? 'America/Chicago',
        room_count: fullHotel.room_count ?? 50,
      })
      hydratedRef.current = true
    }
  }, [fullHotel, reset])

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const onSubmit = useCallback(
    async (values: HotelProfileFormValues) => {
      if (!hotel?.id) return
      setSaving(true)
      try {
        const res = await hotelsApi.update(hotel.id, values)
        const updated = res.data
        setHotel({
          id: hotel.id,
          name: updated.name,
          timezone: updated.timezone,
          room_count: updated.room_count,
          logo_url: updated.logo_url,
        })
        reset(values) // clear dirty state
        setToast({ type: 'success', message: 'Hotel profile saved successfully.' })
      } catch (err: any) {
        setToast({ type: 'error', message: err.message || 'Failed to save. Please try again.' })
      } finally {
        setSaving(false)
      }
    },
    [hotel, setHotel, reset]
  )

  const saveFdModules = useCallback(async () => {
    if (!hotel?.id) return
    setFdSaving(true)
    try {
      const res = await hotelsApi.update(hotel.id, { front_desk_modules: fdModules })
      setHotel({ ...hotel, front_desk_modules: res.data.front_desk_modules ?? fdModules })
      setToast({ type: 'success', message: 'Front desk access saved.' })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save. Please try again.' })
    } finally {
      setFdSaving(false)
    }
  }, [hotel, fdModules, setHotel])

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
      setToast({ type: 'success', message: roleFormOpen === 'create' ? 'Role created.' : 'Role updated.' })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save role.' })
    } finally {
      setRoleSaving(false)
    }
  }, [hotel, roleFormOpen, roleForm, refetchCustomRoles])

  const deleteRole = useCallback(async (roleId: string) => {
    if (!hotel?.id) return
    try {
      await staffApi.deleteCustomRole(roleId)
      await refetchCustomRoles()
      setToast({ type: 'success', message: 'Role removed.' })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to delete role.' })
    }
  }, [hotel, refetchCustomRoles])

  const saveTemplate = useCallback(async () => {
    if (!hotel?.id) return
    setTemplateSaving(true)
    try {
      const payload = {
        name: templateForm.name.trim(),
        is_default: templateForm.is_default,
        items: templateForm.items
          .filter((item) => item.description.trim())
          .map((item, idx) => ({
            section: item.section,
            description: item.description.trim(),
            is_required: item.is_required,
            sort_order: idx,
          })),
      }
      if (templateFormOpen === 'create') {
        await housekeepingApi.createInspectionTemplate(payload)
      } else if (templateFormOpen) {
        await housekeepingApi.updateInspectionTemplate(templateFormOpen, payload)
      }
      setTemplateFormOpen(null)
      await refetchTemplates()
      setToast({ type: 'success', message: templateFormOpen === 'create' ? 'Template created.' : 'Template updated.' })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save template.' })
    } finally {
      setTemplateSaving(false)
    }
  }, [hotel, templateFormOpen, templateForm, refetchTemplates])

  const deleteTemplate = useCallback(async (templateId: string) => {
    if (!hotel?.id) return
    try {
      await housekeepingApi.deleteInspectionTemplate(templateId)
      await refetchTemplates()
      setToast({ type: 'success', message: 'Template removed.' })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to delete template.' })
    }
  }, [hotel, refetchTemplates])

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'general', label: 'General', icon: Building2 },
    { key: 'departments', label: 'Departments', icon: Layers },
    ...(isGM ? [{ key: 'front_desk' as Tab, label: 'Front Desk', icon: Sliders }] : []),
    ...(isGM ? [{ key: 'roles' as Tab, label: 'Roles', icon: ShieldCheck }] : []),
    ...(canManageTemplates ? [{ key: 'inspections' as Tab, label: 'Inspections', icon: ClipboardList }] : []),
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your hotel profile and configuration.</p>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
          role="alert"
        >
          <CheckCircle2
            size={16}
            className={toast.type === 'success' ? 'text-green-600' : 'text-red-600'}
          />
          {toast.message}
        </div>
      )}

      {/* Tabs */}
      <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain border-b border-gray-200 px-1 pb-1 sm:mx-0 sm:px-0">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            aria-current={activeTab === key ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
              activeTab === key
                ? 'border-amber-200 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card className="p-6 space-y-5">
            <h2 className="text-base font-semibold text-slate-900">Hotel Profile</h2>

            <FormField id="settings-hotel-name" label="Hotel Name" error={errors.name?.message}>
              <Input
                id="settings-hotel-name"
                {...register('name')}
                placeholder="Sunrise Inn & Suites"
                error={!!errors.name}
              />
            </FormField>

            <FormField id="settings-address" label="Address" error={errors.address?.message}>
              <Input
                id="settings-address"
                {...register('address')}
                placeholder="1234 Main Street"
                error={!!errors.address}
              />
            </FormField>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
              <div className="col-span-3">
                <FormField id="settings-city" label="City" error={errors.city?.message}>
                  <Input
                    id="settings-city"
                    {...register('city')}
                    placeholder="San Antonio"
                    error={!!errors.city}
                  />
                </FormField>
              </div>
              <div className="col-span-1 sm:col-span-1">
                <FormField id="settings-state" label="State" error={errors.state?.message}>
                  <Input
                    id="settings-state"
                    {...register('state')}
                    placeholder="TX"
                    maxLength={2}
                    error={!!errors.state}
                  />
                </FormField>
              </div>
              <div className="col-span-2">
                <FormField id="settings-zip" label="ZIP Code" error={errors.zip?.message}>
                  <Input
                    id="settings-zip"
                    {...register('zip')}
                    placeholder="78201"
                    error={!!errors.zip}
                  />
                </FormField>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField id="settings-phone" label="Phone" error={errors.phone?.message}>
                <Input
                  id="settings-phone"
                  {...register('phone')}
                  type="tel"
                  placeholder="+1 (210) 555-0100"
                  error={!!errors.phone}
                />
              </FormField>

              <FormField id="settings-room-count" label="Room Count" error={errors.room_count?.message}>
                <Input
                  id="settings-room-count"
                  {...register('room_count', { valueAsNumber: true })}
                  type="number"
                  min={1}
                  max={999}
                  placeholder="85"
                  error={!!errors.room_count}
                />
              </FormField>
            </div>

            <FormField id="settings-timezone" label="Timezone" error={errors.timezone?.message}>
              <select
                id="settings-timezone"
                {...register('timezone')}
                className={`w-full px-3 py-2 text-sm border rounded-lg bg-white text-stone-700 focus:outline-none focus:ring-2 focus:border-transparent transition-colors appearance-none cursor-pointer ${
                  errors.timezone
                    ? 'border-red-300 focus:ring-red-500'
                    : 'border-stone-200 hover:border-amber-200 focus:ring-amber-400'
                }`}
              >
                {US_TIMEZONES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                hotel &&
                reset({
                  name: (hotel as any).name ?? '',
                  address: (hotel as any).address ?? '',
                  city: (hotel as any).city ?? '',
                  state: (hotel as any).state ?? '',
                  zip: (hotel as any).zip ?? '',
                  phone: (hotel as any).phone ?? '',
                  timezone: hotel.timezone ?? 'America/Chicago',
                  room_count: hotel.room_count ?? 50,
                })
              }
              disabled={!isDirty || saving}
            >
              Discard
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!isDirty || saving}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      )}

      {/* Departments Tab */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
          <Card className="overflow-hidden p-0 divide-y divide-white/40">
            {DEPARTMENTS.map((dept) => (
              <div key={dept.name} className="flex items-center gap-4 px-6 py-4 hover:bg-amber-50/30 transition-colors">
                <div className={`w-3 h-3 rounded-full ${dept.color} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{dept.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{dept.description}</p>
                </div>
                <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                  Default
                </span>
              </div>
            ))}
          </Card>
          <p className="text-xs text-gray-400 px-1">
            Department customization is available on request. Contact support to add or rename departments.
          </p>
        </div>
      )}

      {/* Front Desk Tab */}
      {activeTab === 'front_desk' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Choose which modules front desk staff can access from the sidebar.
            Dashboard is always visible.
          </p>
          <Card className="overflow-hidden p-0 divide-y divide-stone-100">
            {FRONT_DESK_MODULES.map(({ key, label, description, icon: Icon }) => {
              const enabled = fdModules.includes(key)
              return (
                <div
                  key={key}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-amber-50/30 transition-colors"
                >
                  <Icon className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() =>
                      setFdModules(prev =>
                        enabled ? prev.filter(m => m !== key) : [...prev, key]
                      )
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                      enabled ? 'bg-amber-400' : 'bg-stone-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                        enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              )
            })}
          </Card>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              onClick={saveFdModules}
              disabled={fdSaving}
            >
              {fdSaving ? 'Saving…' : 'Save Access'}
            </Button>
          </div>
        </div>
      )}

      {/* Inspections Tab */}
      {activeTab === 'inspections' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-gray-500 flex-1">
              Define inspection checklists used when supervisors inspect cleaned rooms.
              The default template is pre-selected when starting an inspection.
            </p>
            {templateFormOpen !== 'create' && (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setTemplateForm({ ...EMPTY_TEMPLATE_FORM })
                  setTemplateFormOpen('create')
                }}
              >
                <Plus size={14} className="inline mr-1.5 -mt-0.5" />
                New Template
              </Button>
            )}
          </div>

          {templateFormOpen === 'create' && (
            <TemplateFormCard
              values={templateForm}
              onChange={setTemplateForm}
              onSave={saveTemplate}
              onCancel={() => setTemplateFormOpen(null)}
              saving={templateSaving}
              isNew
            />
          )}

          {inspectionTemplates.filter((t) => t.id !== null).length === 0 && templateFormOpen !== 'create' && (
            <Card className="p-8 text-center">
              <ClipboardList className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">No custom templates yet</p>
              <p className="text-xs text-gray-400 mt-1">
                Create a template to define your room inspection checklist.
              </p>
            </Card>
          )}

          <div className="space-y-3">
            {inspectionTemplates
              .filter((t) => t.id !== null)
              .map((tmpl) =>
                templateFormOpen === tmpl.id ? (
                  <TemplateFormCard
                    key={tmpl.id!}
                    values={templateForm}
                    onChange={setTemplateForm}
                    onSave={saveTemplate}
                    onCancel={() => setTemplateFormOpen(null)}
                    saving={templateSaving}
                  />
                ) : (
                  <TemplateCard
                    key={tmpl.id!}
                    template={tmpl}
                    onEdit={() => {
                      setTemplateForm({
                        name: tmpl.name,
                        is_default: tmpl.is_default,
                        items: tmpl.items.map((item) => ({
                          section: item.section,
                          description: item.description,
                          is_required: item.is_required,
                        })),
                      })
                      setTemplateFormOpen(tmpl.id!)
                    }}
                    onDelete={() => deleteTemplate(tmpl.id!)}
                  />
                )
              )}
          </div>
        </div>
      )}

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-gray-500 flex-1">
              Define named roles with custom module access for your team. Dashboard is always visible.
            </p>
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
            <Card className="p-8 text-center">
              <ShieldCheck className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">No custom roles yet</p>
              <p className="text-xs text-gray-400 mt-1">
                Create a role to define custom module access for your team.
              </p>
            </Card>
          )}

          <div className="space-y-3">
            {customRoles.map((cr) =>
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
              )
            )}
          </div>
        </div>
      )}

    </div>
  )
}
