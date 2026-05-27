'use client'

import { X, Plus, Pencil, Trash2 } from 'lucide-react'
import type { InspectionTemplate } from '@/lib/api/housekeeping'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Types & constants ────────────────────────────────────────────────────────

export interface TemplateItemForm {
  section: string
  description: string
  is_required: boolean
}

export interface TemplateFormValues {
  name: string
  is_default: boolean
  items: TemplateItemForm[]
}

export const INSPECTION_SECTIONS = [
  'Bathroom', 'Sleeping Area', 'General', 'Amenities',
  'Closet', 'Balcony', 'Kitchenette', 'Entrance',
]

export const EMPTY_TEMPLATE_FORM: TemplateFormValues = {
  name: '',
  is_default: false,
  items: [
    { section: 'Bathroom', description: '', is_required: true },
    { section: 'Sleeping Area', description: '', is_required: true },
    { section: 'General', description: '', is_required: true },
  ],
}

// ─── TemplateCard ─────────────────────────────────────────────────────────────

export function TemplateCard({
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
    {},
  )

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm font-semibold text-stone-900">{template.name}</span>
            {template.is_default && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700">
                Default
              </span>
            )}
            <span className="text-xs text-stone-400">
              {template.items.length} item{template.items.length !== 1 ? 's' : ''}
            </span>
          </div>
          {Object.entries(sectionGroups).slice(0, 2).map(([section, items]) => (
            <div key={section} className="flex items-baseline gap-1.5 mb-0.5">
              <span className="text-xs font-medium text-stone-500 w-24 shrink-0 truncate">
                {section}
              </span>
              <span className="text-xs text-stone-400 truncate">
                {items.map(i => i.description).join(' · ')}
              </span>
            </div>
          ))}
          {Object.keys(sectionGroups).length > 2 && (
            <p className="text-xs text-stone-400 mt-0.5">
              +{Object.keys(sectionGroups).length - 2} more section
              {Object.keys(sectionGroups).length > 3 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-stone-400 hover:text-[var(--caution)] hover:bg-[var(--caution-soft)] rounded-lg transition-colors"
            aria-label="Edit template"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-stone-400 hover:text-[var(--alert)] hover:bg-red-50 rounded-lg transition-colors"
            aria-label="Delete template"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  )
}

// ─── TemplateFormCard ─────────────────────────────────────────────────────────

export function TemplateFormCard({
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
    onChange({
      ...values,
      items: [...values.items, { section: 'General', description: '', is_required: true }],
    })

  const removeItem = (idx: number) =>
    onChange({ ...values, items: values.items.filter((_, i) => i !== idx) })

  const updateItem = (idx: number, field: keyof TemplateItemForm, value: string | boolean) =>
    onChange({
      ...values,
      items: values.items.map((item, i) => i === idx ? { ...item, [field]: value } : item),
    })

  return (
    <Card className="p-5 space-y-4 border-teal-200/60 bg-teal-50/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">
          {isNew ? 'New Template' : 'Edit Template'}
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

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700">Template Name</label>
        <input
          value={values.name}
          onChange={e => onChange({ ...values, name: e.target.value })}
          placeholder="e.g. Standard Room Inspection"
          className="w-full px-3 py-2 text-sm border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={values.is_default}
          onClick={() => onChange({ ...values, is_default: !values.is_default })}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
            values.is_default ? 'bg-teal-400' : 'bg-line'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface shadow transition-transform ${
              values.is_default ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className="text-sm text-stone-700">Set as default template</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-stone-700">Checklist Items</label>
          <span className="text-xs text-stone-400">
            {values.items.length} item{values.items.length !== 1 ? 's' : ''}
          </span>
        </div>

        {values.items.length === 0 && (
          <p className="text-xs text-stone-400 italic py-1">No items yet.</p>
        )}

        <div className="space-y-2">
          {values.items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={item.section}
                onChange={e => updateItem(idx, 'section', e.target.value)}
                className="text-xs border border-stone-200 rounded-lg px-2 py-1.5 bg-surface focus:outline-none focus:ring-1 focus:ring-teal-400/50 w-28 shrink-0"
              >
                {INSPECTION_SECTIONS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <input
                value={item.description}
                onChange={e => updateItem(idx, 'description', e.target.value)}
                placeholder="Item description"
                className="flex-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400/50 bg-surface min-w-0"
              />
              <button
                type="button"
                title={item.is_required ? 'Required — click to make optional' : 'Optional — click to make required'}
                onClick={() => updateItem(idx, 'is_required', !item.is_required)}
                className={`text-xs px-2 py-1.5 rounded-lg border transition-colors shrink-0 ${
                  item.is_required
                    ? 'bg-teal-50 border-teal-200 text-teal-700 font-medium'
                    : 'bg-surface border-stone-200 text-stone-400'
                }`}
              >
                Req
              </button>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="p-1.5 text-stone-400 hover:text-[var(--alert)] hover:bg-red-50 rounded-lg transition-colors shrink-0"
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
