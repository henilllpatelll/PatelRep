'use client'

import { Trash2 } from 'lucide-react'
import type { SlaPolicy } from '@/lib/api/guest_requests'
import { Card } from '@/components/ui/Card'
import { Button, IconButton } from '@/components/ui/Button'

// ─── Types & constants ────────────────────────────────────────────────────────

export interface SlaPolicyFormValues {
  category: '' | 'service' | 'housekeeping' | 'maintenance' | 'accessibility' | 'other'
  priority: '' | 'normal' | 'urgent'
  guest_impact: '' | 'low' | 'standard' | 'high'
  sla_minutes: number
}

export const EMPTY_SLA_POLICY_FORM: SlaPolicyFormValues = {
  category: '',
  priority: '',
  guest_impact: '',
  sla_minutes: 240,
}

const CATEGORY_LABELS: Record<string, string> = {
  service: 'Service',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  accessibility: 'Accessibility',
  other: 'Other',
}

const PRIORITY_LABELS: Record<string, string> = {
  normal: 'Normal',
  urgent: 'Urgent',
}

const GUEST_IMPACT_LABELS: Record<string, string> = {
  low: 'Low',
  standard: 'Standard',
  high: 'High',
}

// ─── SlaPolicyCard ────────────────────────────────────────────────────────────

export function SlaPolicyCard({
  policy,
  canManage,
  onDelete,
}: {
  policy: SlaPolicy
  canManage: boolean
  onDelete: () => void
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3 px-2 py-1 rounded-full border border-line bg-surface-2">
            Category: {policy.category ? CATEGORY_LABELS[policy.category] : 'Any'}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3 px-2 py-1 rounded-full border border-line bg-surface-2">
            Priority: {policy.priority ? PRIORITY_LABELS[policy.priority] : 'Any'}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3 px-2 py-1 rounded-full border border-line bg-surface-2">
            Impact: {policy.guest_impact ? GUEST_IMPACT_LABELS[policy.guest_impact] : 'Any'}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-[20px] font-semibold text-ink">{policy.sla_minutes}</span>
            <span className="text-[14px] text-ink3">min</span>
          </div>
          {canManage && (
            <IconButton
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-stone-400 hover:text-[var(--alert)] hover:bg-red-50"
              aria-label="Delete SLA rule"
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </div>
    </Card>
  )
}

// ─── SlaPolicyFormCard ────────────────────────────────────────────────────────

export function SlaPolicyFormCard({
  values,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  values: SlaPolicyFormValues
  onChange: (v: SlaPolicyFormValues) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const allWildcard = !values.category && !values.priority && !values.guest_impact

  return (
    <Card className="p-5 space-y-4 border-teal-200/60 bg-teal-50/20">
      <h3 className="text-[20px] font-semibold text-ink">New SLA Rule</h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
            Category
          </label>
          <select
            value={values.category}
            onChange={e => onChange({ ...values, category: e.target.value as SlaPolicyFormValues['category'] })}
            className="w-full px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
          >
            <option value="">Any</option>
            {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
            Priority
          </label>
          <select
            value={values.priority}
            onChange={e => onChange({ ...values, priority: e.target.value as SlaPolicyFormValues['priority'] })}
            className="w-full px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
          >
            <option value="">Any</option>
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
            Guest Impact
          </label>
          <select
            value={values.guest_impact}
            onChange={e => onChange({ ...values, guest_impact: e.target.value as SlaPolicyFormValues['guest_impact'] })}
            className="w-full px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
          >
            <option value="">Any</option>
            {Object.entries(GUEST_IMPACT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
          SLA Minutes
        </label>
        <input
          type="number"
          min={1}
          max={10080}
          value={values.sla_minutes}
          onChange={e => onChange({ ...values, sla_minutes: parseInt(e.target.value, 10) || 1 })}
          className="w-32 px-3 py-2 text-[14px] font-mono border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
        />
        <p className="text-[11px] text-ink3">
          Minutes allowed to acknowledge and resolve a matching request. Default is 240.
        </p>
      </div>

      {allWildcard && (
        <p className="text-[12px] text-[var(--alert)]">
          Choose at least one of category, priority, or guest impact.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={onSave}
          disabled={saving || allWildcard}
        >
          {saving ? 'Saving…' : 'Save Rule'}
        </Button>
      </div>
    </Card>
  )
}
