/**
 * Pure helpers for the Billing & Usage screen.
 *
 * Nothing here knows a price, a plan name or a credit allowance: every figure comes from the billing
 * API (which mirrors Stripe / the credit ledger). When the API doesn't supply a value the helpers return
 * null so the UI shows a neutral dash instead of inventing one.
 */
import type { CreditUsage, Invoice, Subscription } from '@/lib/api/billing'

/** The slice of a React Query result the billing cards read (keeps them independent of the error type). */
export interface QueryLike<T> {
  data: T | undefined
  /** True until the first result arrives, including while the query is waiting to be enabled. */
  isPending: boolean
  isError: boolean
  refetch: () => unknown
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export type StatusTone = 'ready' | 'info' | 'caution' | 'alert' | 'neutral'

export interface SubscriptionStatusMeta {
  label: string
  tone: StatusTone
  /** Needs the GM's attention (payment problem or no access). */
  attention: boolean
}

const KNOWN_STATUS: Record<string, SubscriptionStatusMeta> = {
  active: { label: 'Active', tone: 'ready', attention: false },
  trialing: { label: 'Trial', tone: 'info', attention: false },
  past_due: { label: 'Past due', tone: 'alert', attention: true },
  unpaid: { label: 'Unpaid', tone: 'alert', attention: true },
  incomplete: { label: 'Incomplete', tone: 'caution', attention: true },
  incomplete_expired: { label: 'Expired', tone: 'alert', attention: true },
  cancelled: { label: 'Canceled', tone: 'neutral', attention: true },
  canceled: { label: 'Canceled', tone: 'neutral', attention: true },
  paused: { label: 'Paused', tone: 'caution', attention: true },
}

/** Unknown values are shown as written, in a caution tone — never relabelled "Active". */
export function subscriptionStatusMeta(status: string | null | undefined): SubscriptionStatusMeta {
  const key = (status ?? '').trim().toLowerCase()
  if (!key) return { label: 'Unknown', tone: 'caution', attention: true }
  return KNOWN_STATUS[key] ?? {
    label: key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    tone: 'caution',
    attention: true,
  }
}

export function isTrialExpired(sub: Pick<Subscription, 'plan_status' | 'trial_end'>, now: number = Date.now()): boolean {
  if (sub.plan_status !== 'trialing' || !sub.trial_end) return false
  const end = new Date(sub.trial_end).getTime()
  return !Number.isNaN(end) && end < now
}

export type SubscriptionNotice =
  | { kind: 'trial'; title: string; body: string; action: 'checkout' }
  | { kind: 'trial_expired'; title: string; body: string; action: 'checkout' }
  | { kind: 'payment'; title: string; body: string; action: 'portal' }
  | { kind: 'inactive'; title: string; body: string; action: 'portal' }
  | null

/** The one banner worth showing for this subscription, with the existing action that resolves it. */
export function subscriptionNotice(sub: Subscription, now: number = Date.now()): SubscriptionNotice {
  if (isTrialExpired(sub, now)) {
    return {
      kind: 'trial_expired',
      title: 'Your trial has ended',
      body: 'Upgrade to restore full access to PatelRep.',
      action: 'checkout',
    }
  }
  switch (sub.plan_status) {
    case 'trialing':
      return {
        kind: 'trial',
        title: 'You’re on a free trial',
        body: 'Upgrade before the trial ends to keep full access.',
        action: 'checkout',
      }
    case 'past_due':
    case 'unpaid':
      return {
        kind: 'payment',
        title: 'Your last payment didn’t go through',
        body: 'Update your payment method in Stripe to avoid a service interruption.',
        action: 'portal',
      }
    case 'incomplete':
      return {
        kind: 'payment',
        title: 'Your subscription isn’t finished setting up',
        body: 'Stripe is still waiting on a payment or confirmation. Open billing to complete it.',
        action: 'portal',
      }
    case 'cancelled':
    case 'canceled':
      return {
        kind: 'inactive',
        title: 'This subscription has been canceled',
        body: 'Open billing to review your account and invoices.',
        action: 'portal',
      }
    case 'paused':
      return {
        kind: 'inactive',
        title: 'This subscription is paused',
        body: 'Open billing to review your account.',
        action: 'portal',
      }
    default:
      return null
  }
}

export interface SubscriptionRow { label: string; value: string }

/** Rows for the Subscription card — only values the API actually returned. */
export function subscriptionRows(sub: Subscription, now: number = Date.now()): SubscriptionRow[] {
  // Status itself is the pill beside the card heading; these rows are the supporting detail.
  const rows: SubscriptionRow[] = []

  if (typeof sub.base_fee_cents === 'number' && Number.isFinite(sub.base_fee_cents)) {
    rows.push({ label: 'Monthly base fee', value: formatMoney(sub.base_fee_cents, 'usd') })
  }
  const trialEnd = formatDay(sub.trial_end)
  const periodEnd = formatDay(sub.current_period_end)
  const periodStart = formatDay(sub.current_period_start)
  if (sub.plan_status === 'trialing' && trialEnd) {
    rows.push({ label: isTrialExpired(sub, now) ? 'Trial ended' : 'Trial ends', value: trialEnd })
  }
  if (periodEnd) {
    rows.push({ label: sub.plan_status === 'active' ? 'Next billing date' : 'Current period ends', value: periodEnd })
  }
  if (periodStart && periodEnd) rows.push({ label: 'Billing period', value: `${periodStart} – ${periodEnd}` })
  return rows
}

// ─── Credits ──────────────────────────────────────────────────────────────────

export type CreditView =
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'metered' | 'no_allowance'
      used: number
      included: number
      remaining: number
      overage: number
      /** 0–100 for the bar; `percentLabel` is the unclamped number for the text. */
      barPercent: number
      percentLabel: number
      overAllowance: boolean
      cycle: string | null
      overageCostCents: number | null
      capCents: number | null
      capRemainingCents: number | null
      projectedCents: number | null
      approachingCap: boolean
    }

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Current-cycle credit figures. `credits_used` / `credits_included` come from this cycle's ledger row,
 * so they are never mixed with lifetime totals. Remaining is clamped at zero (the server does the same);
 * going past the allowance is shown as overage rather than as a negative balance.
 */
export function buildCreditView(data: CreditUsage | null | undefined): CreditView {
  if (!data) return { kind: 'unavailable', reason: 'Credit usage isn’t available right now.' }
  const used = finite(data.credits_used)
  const included = finite(data.credits_included)
  if (used === null || included === null || used < 0 || included < 0) {
    return { kind: 'unavailable', reason: data.message || 'No usage has been recorded for the current billing cycle yet.' }
  }
  const remaining = Math.max(0, finite(data.credits_remaining) ?? included - used)
  const overage = Math.max(0, finite(data.overage_credits) ?? used - included)
  const percentLabel = included > 0 ? Math.round((used / included) * 100) : 0
  return {
    kind: included > 0 ? 'metered' : 'no_allowance',
    used,
    included,
    remaining,
    overage,
    barPercent: Math.min(100, Math.max(0, percentLabel)),
    percentLabel,
    overAllowance: used > included,
    cycle: describeCycle(data),
    overageCostCents: finite(data.overage_cost_cents),
    capCents: finite(data.cap_cents),
    capRemainingCents: finite(data.cap_remaining_cents),
    projectedCents: finite(data.projected_month_end_cost_cents),
    approachingCap: data.approaching_cap === true,
  }
}

export function describeCycle(data: Pick<CreditUsage, 'period' | 'period_start' | 'period_end'>): string | null {
  const start = formatDay(data.period_start)
  const end = formatDay(data.period_end)
  if (start && end) return `${start} – ${end}`
  if (data.period && /^\d{4}-\d{2}$/.test(data.period)) {
    const label = formatMonth(`${data.period}-01`)
    if (label) return label
  }
  return null
}

export function creditBarTone(percent: number): 'ready' | 'caution' | 'alert' {
  if (percent > 95) return 'alert'
  if (percent > 80) return 'caution'
  return 'ready'
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export type InvoiceStatusMeta = { label: string; tone: StatusTone }

export function invoiceStatusMeta(status: string | null | undefined): InvoiceStatusMeta {
  switch ((status ?? '').toLowerCase()) {
    case 'paid': return { label: 'Paid', tone: 'ready' }
    case 'open': return { label: 'Open', tone: 'caution' }
    case 'draft': return { label: 'Draft', tone: 'neutral' }
    case 'void': return { label: 'Void', tone: 'neutral' }
    case 'uncollectible': return { label: 'Uncollectible', tone: 'alert' }
    default: {
      const text = (status ?? '').replace(/[_-]+/g, ' ').trim()
      return { label: text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown', tone: 'caution' }
    }
  }
}

/** `amount` is in the currency's minor unit (cents). Falls back to a plain number if the currency code is bad. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
  const code = (currency || 'usd').toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount / 100)
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`
  }
}

export function formatUnixDay(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(ts * 1000))
}

export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  // Date-only values (YYYY-MM-DD) are calendar days: format in UTC so they don't slip a day west of UTC.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', ...(dateOnly ? { timeZone: 'UTC' } : {}) }).format(date)
}

function formatMonth(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}

// ─── External navigation ──────────────────────────────────────────────────────

/**
 * Only follow server-provided links that are https and on stripe.com (billing.stripe.com portal,
 * checkout.stripe.com, invoice.stripe.com, pay.stripe.com). Anything else is treated as unavailable
 * rather than navigated to.
 */
export function safeStripeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (url.hostname !== 'stripe.com' && !url.hostname.endsWith('.stripe.com')) return null
    return url.toString()
  } catch {
    return null
  }
}

export interface InvoiceRow {
  id: string
  date: string
  number: string | null
  period: string | null
  amount: string
  status: InvoiceStatusMeta
  viewUrl: string | null
  pdfUrl: string | null
}

export function buildInvoiceRows(invoices: Invoice[] | null | undefined): InvoiceRow[] {
  return (invoices ?? []).map((inv) => ({
    id: inv.id,
    date: formatUnixDay(inv.created),
    number: inv.number || null,
    period: inv.period_start && inv.period_end && inv.period_end > inv.period_start
      ? `${formatUnixDay(inv.period_start)} – ${formatUnixDay(inv.period_end)}`
      : null,
    amount: formatMoney(inv.amount_due, inv.currency),
    status: invoiceStatusMeta(inv.status),
    viewUrl: safeStripeUrl(inv.hosted_invoice_url),
    pdfUrl: safeStripeUrl(inv.invoice_pdf),
  }))
}
