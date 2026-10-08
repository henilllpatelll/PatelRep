/**
 * Pure logic for Settings > Service SLAs.
 *
 * Matching semantics (services/guest_recovery/contracts.py `resolve_sla_minutes`, used when a guest
 * request is created): a rule matches when each of its category / priority / guest-impact values is either
 * blank ("Any") or equal to the request's. The matching rule with the most values set wins; with no
 * matching rule the request gets a fixed 240 minutes. The chosen minutes are stored on the request when it
 * is created, so changing a rule only affects requests created afterwards.
 */
import type { SlaPolicy } from '@/lib/api/guest_requests'

export const DEFAULT_RESPONSE_MINUTES = 240
export const SLA_MINUTES_MIN = 1
export const SLA_MINUTES_MAX = 10080

export const CATEGORY_OPTIONS = [
  { value: 'service', label: 'Service' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'accessibility', label: 'Accessibility' },
  { value: 'other', label: 'Other' },
] as const
export const PRIORITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'urgent', label: 'Urgent' },
] as const
export const IMPACT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
] as const

type Category = NonNullable<SlaPolicy['category']>
type Priority = NonNullable<SlaPolicy['priority']>
type Impact = NonNullable<SlaPolicy['guest_impact']>

const label = (options: readonly { value: string; label: string }[], value: string | null) =>
  value === null ? 'Any' : options.find((o) => o.value === value)?.label ?? value
export const categoryLabel = (v: SlaPolicy['category']) => label(CATEGORY_OPTIONS, v)
export const priorityLabel = (v: SlaPolicy['priority']) => label(PRIORITY_OPTIONS, v)
export const impactLabel = (v: SlaPolicy['guest_impact']) => label(IMPACT_OPTIONS, v)

/** 90 → "1 hr 30 min", 1440 → "1 day", 45 → "45 min". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = Math.round(minutes % 60)
  const parts: string[] = []
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours) parts.push(`${hours} hr`)
  if (mins) parts.push(`${mins} min`)
  return parts.join(' ')
}

/** "Housekeeping · Urgent priority · Any guest impact" */
export function describeRule(rule: Pick<SlaPolicy, 'category' | 'priority' | 'guest_impact'>): string {
  return [
    rule.category ? categoryLabel(rule.category) : 'Any category',
    rule.priority ? `${priorityLabel(rule.priority)} priority` : 'Any priority',
    rule.guest_impact ? `${impactLabel(rule.guest_impact)} guest impact` : 'Any guest impact',
  ].join(' · ')
}

export const specificity = (rule: Pick<SlaPolicy, 'category' | 'priority' | 'guest_impact'>): number =>
  [rule.category, rule.priority, rule.guest_impact].filter((v) => v !== null).length

/** Most specific first (the order the backend resolves them in), then fastest target, then name. */
export function sortRules(rules: SlaPolicy[]): SlaPolicy[] {
  return [...rules].sort((a, b) => specificity(b) - specificity(a) || a.sla_minutes - b.sla_minutes || describeRule(a).localeCompare(describeRule(b)))
}

export interface RuleFilters { q: string; category: '' | Category; priority: '' | Priority; impact: '' | Impact }
export const EMPTY_RULE_FILTERS: RuleFilters = { q: '', category: '', priority: '', impact: '' }
export const hasRuleFilters = (f: RuleFilters) => !!(f.q.trim() || f.category || f.priority || f.impact)

/** A filter value also keeps "Any" rules visible, because they apply to that value too. */
export function filterRules(rules: SlaPolicy[], f: RuleFilters): SlaPolicy[] {
  const q = f.q.trim().toLowerCase()
  return rules.filter((rule) =>
    (!f.category || rule.category === null || rule.category === f.category)
    && (!f.priority || rule.priority === null || rule.priority === f.priority)
    && (!f.impact || rule.guest_impact === null || rule.guest_impact === f.impact)
    && (!q || `${describeRule(rule)} ${rule.sla_minutes} ${formatDuration(rule.sla_minutes)}`.toLowerCase().includes(q)))
}

// ─── Form ─────────────────────────────────────────────────────────────────────

export interface RuleForm {
  category: '' | Category
  priority: '' | Priority
  guest_impact: '' | Impact
  /** Kept as text so a half-typed value is never silently coerced. */
  minutes: string
}

export const EMPTY_RULE_FORM: RuleForm = { category: '', priority: '', guest_impact: '', minutes: '' }

export function ruleToForm(rule: SlaPolicy): RuleForm {
  return { category: rule.category ?? '', priority: rule.priority ?? '', guest_impact: rule.guest_impact ?? '', minutes: String(rule.sla_minutes) }
}

export function ruleFormChanged(a: RuleForm, b: RuleForm): boolean {
  return a.category !== b.category || a.priority !== b.priority || a.guest_impact !== b.guest_impact || a.minutes.trim() !== b.minutes.trim()
}

export interface RuleFormErrors { combination?: string; minutes?: string }

export function validateRuleForm(form: RuleForm, rules: SlaPolicy[], editingId?: string): RuleFormErrors {
  const errors: RuleFormErrors = {}
  const category = form.category || null
  const priority = form.priority || null
  const impact = form.guest_impact || null
  if (!category && !priority && !impact) errors.combination = 'Choose at least one of category, priority or guest impact.'
  else if (category === 'accessibility' && priority === 'normal') {
    errors.combination = 'Accessibility requests are always urgent, so a Normal-priority accessibility rule would never apply.'
  } else if (rules.some((r) => r.id !== editingId && r.category === category && r.priority === priority && r.guest_impact === impact)) {
    errors.combination = 'A rule for this exact combination already exists. Edit that rule instead.'
  }
  const raw = form.minutes.trim()
  const minutes = Number(raw)
  if (!raw) errors.minutes = 'Enter the response target in minutes.'
  else if (!Number.isInteger(minutes)) errors.minutes = 'Use a whole number of minutes.'
  else if (minutes < SLA_MINUTES_MIN || minutes > SLA_MINUTES_MAX) errors.minutes = `Use between ${SLA_MINUTES_MIN} and ${SLA_MINUTES_MAX.toLocaleString()} minutes (up to 7 days).`
  return errors
}

export function toRulePayload(form: RuleForm): { category: Category | null; priority: Priority | null; guest_impact: Impact | null; sla_minutes: number } {
  return {
    category: form.category || null,
    priority: form.priority || null,
    guest_impact: form.guest_impact || null,
    sla_minutes: Number(form.minutes.trim()),
  }
}
