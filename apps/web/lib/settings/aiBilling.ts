import type { AiUsage, BillingActionStatus, OverageState } from '@/lib/api/billing'
import type { StatusTone } from './billing'

/**
 * Display helpers for the H4 AI usage / overage / history sections. Pure functions, no charge arithmetic:
 * every credit and dollar figure arrives from the server already calculated (decimal strings, integer cents);
 * these only format them and choose honest labels.
 */

/** Formats a server decimal string of credits (e.g. "4950.2500") for display. Non-numeric input shows a dash. */
export function formatCreditText(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

/** Formats a server decimal string of US dollars ("20.00") for display without re-rounding it. */
export function formatUsdText(value: string | null | undefined): string {
  if (!value || !/^-?\d+(\.\d+)?$/.test(value.trim())) return '—'
  const [whole, frac = ''] = value.trim().replace(/^-/, '').split('.')
  const cents = (frac + '00').slice(0, 2)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${value.trim().startsWith('-') ? '-' : ''}$${grouped}.${cents}`
}

export function isPositiveCredits(value: string | null | undefined): boolean {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

export interface OverageStateMeta { label: string; tone: StatusTone; description: string }

export function overageStateMeta(state: OverageState | string | null | undefined): OverageStateMeta {
  switch (state) {
    case 'on':
      return { label: 'On', tone: 'info', description: 'AI agents may use credits beyond your included allowance, up to the limit you authorized.' }
    case 'needs_reconfirmation':
      return { label: 'Paused — confirm new terms', tone: 'caution', description: 'Your AI pricing terms changed, so overage is paused until you review and confirm again.' }
    default:
      return { label: 'Off', tone: 'neutral', description: 'AI agents stop at your included credits. Nothing beyond your allowance is billed.' }
  }
}

/** Never shows anything as paid unless Stripe confirmed payment. Unknown states are "under review", not success. */
export function billingActionMeta(status: BillingActionStatus | null | undefined): { label: string; tone: StatusTone } {
  switch (status) {
    case 'paid': return { label: 'Paid', tone: 'ready' }
    case 'invoiced': return { label: 'Invoiced', tone: 'info' }
    case 'pending_invoice': return { label: 'On next invoice', tone: 'neutral' }
    case 'pending': return { label: 'Pending', tone: 'neutral' }
    case 'payment_failed': return { label: 'Payment failed', tone: 'alert' }
    case 'uncollectible': return { label: 'Uncollectible', tone: 'alert' }
    case 'void': return { label: 'Voided', tone: 'neutral' }
    case 'nothing_to_bill': return { label: 'Nothing to bill', tone: 'neutral' }
    default: return { label: 'Under review', tone: 'caution' }
  }
}

export interface UsageRow { label: string; value: string; hint?: string }

export function aiUsageRows(usage: AiUsage): UsageRow[] {
  const rows: UsageRow[] = [
    { label: 'Included credits', value: formatCreditText(usage.included_credits) },
    { label: 'Used by AI features', value: formatCreditText(usage.legacy_credits_used) },
    { label: 'Used by AI agents', value: formatCreditText(usage.agent_credits_used) },
    { label: 'Total used', value: formatCreditText(usage.credits_used) },
    { label: 'Remaining allowance', value: formatCreditText(usage.remaining_credits) },
  ]
  if (isPositiveCredits(usage.pending_reconciliation_credits)) {
    rows.push({
      label: 'Awaiting confirmation',
      value: formatCreditText(usage.pending_reconciliation_credits),
      hint: 'Agent work whose provider cost is still being confirmed. It is not charged unless it is confirmed.',
    })
  }
  return rows
}

/** A whole number of credits in range, or a validation message for the limit field. */
export function validateLimitInput(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const text = raw.trim()
  if (!text) return { ok: false, message: 'Enter a credit limit.' }
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Use a whole number of credits, with no decimals or symbols.' }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false, message: 'The limit must be greater than zero.' }
  if (value > 10_000_000) return { ok: false, message: 'That limit is too large.' }
  return { ok: true, value }
}

export function periodLabel(start: string | null | undefined): string {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${start}T00:00:00Z`))
}
