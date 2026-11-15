import { apiClient } from '@/lib/api/client'

export interface Subscription {
  stripe_customer_id?: string
  /** Known values are listed for autocomplete; any other string must be shown as-is, never as "active". */
  plan_status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused' | (string & {})
  trial_end?: string
  current_period_start?: string
  current_period_end?: string
  base_fee_cents?: number
  credits_included?: number
}

export interface CreditUsage {
  period?: string          // e.g. "2026-03"
  period_start?: string    // current billing cycle, ISO date
  period_end?: string
  credits_included?: number
  credits_used?: number
  credits_remaining?: number
  overage_credits?: number
  overage_cost_cents?: number
  cap_cents?: number | null
  cap_remaining_cents?: number | null
  projected_month_end_cost_cents?: number | null
  approaching_cap?: boolean
  message?: string
}

export interface Invoice {
  id: string
  amount_due: number
  status: string
  created: number         // Unix timestamp
  hosted_invoice_url?: string
  period_start?: number
  period_end?: number
  currency?: string | null
  number?: string | null
  invoice_pdf?: string | null
}

/**
 * H4 AI usage breakdown. Credits and dollar amounts are DECIMAL STRINGS and integer cents computed by the server;
 * the browser formats them and never derives a charge itself.
 */
export type OverageState = 'off' | 'on' | 'needs_reconfirmation'

export interface AiUsage {
  customer_billing_mode: 'disabled' | 'enforced' | (string & {})
  period_start: string | null
  period_end: string | null
  included_credits: string
  credits_used: string
  legacy_credits_used: string
  agent_credits_used: string
  remaining_credits: string
  pending_reconciliation_credits: string
  in_flight_credits: string
  overage: {
    state: OverageState
    enabled: boolean
    version: number | null
    updated_at: string | null
    authorized_limit_credits: string | null
    max_exposure_usd: string | null
    accrued_credits: string
    accrued_usd: string
    remaining_credits: string
  }
  policy: {
    id: string
    version: number
    usd_per_credit: string
    terms_version: string
    monthly_overage_cap_usd: string
  } | null
  subscription_cap_cents: number | null
  estimate: {
    is_estimate: true
    base_fee_cents: number
    legacy_overage_cents: number
    agent_overage_cents: number
    total_cents: number
  }
}

export interface OverageQuote {
  limit_credits: number
  max_exposure_usd: string
  monthly_overage_cap_usd: string
  within_cap: boolean
  policy_id: string
  terms_version: string
  usd_per_credit: string
}

export interface OverageChange {
  state: 'on' | 'off'
  version: number | null
  authorized_limit_credits?: string | null
  max_exposure_usd?: string | null
  recorded_at: string | null
  already_off?: boolean
}

export type BillingActionStatus =
  | 'pending' | 'pending_invoice' | 'invoiced' | 'paid' | 'payment_failed' | 'void' | 'uncollectible'
  | 'nothing_to_bill' | 'under_review' | (string & {})

export interface BillingHistoryPeriod {
  period_start: string
  period_end: string
  is_finalized: boolean
  included_credits: string
  credits_used: string
  agent_credits_used: string
  legacy_credits_used: string
  agent_overage_credits: string
  agent_overage_cents: number
  adjustment_credits: string
  late_charge_credits: string
  pending_reconciliation_credits: string
  billing_actions: { id: string; status: BillingActionStatus; amount_cents: number; overage_credits: string; invoice_url: string | null }[]
}

export const billingApi = {
  getAiUsage: () =>
    apiClient.get('/billing/ai-usage') as Promise<{ data: AiUsage }>,

  quoteOverage: (limitCredits: number) =>
    apiClient.get(`/billing/overage/quote?limit_credits=${encodeURIComponent(String(limitCredits))}`) as Promise<{ data: OverageQuote }>,

  /** The server derives the hotel and the user from the session; the body carries only the GM's explicit choice. */
  authorizeOverage: (body: { limit_credits: number; policy_id: string; terms_version: string; acknowledged_max_exposure_usd: string }) =>
    apiClient.post('/billing/overage/authorize', { ...body, confirm: true }) as Promise<{ data: OverageChange }>,

  revokeOverage: () =>
    apiClient.post('/billing/overage/revoke', { confirm: true }) as Promise<{ data: OverageChange }>,

  getHistory: () =>
    apiClient.get('/billing/history') as Promise<{ data: BillingHistoryPeriod[] }>,

  getSubscription: () =>
    apiClient.get('/billing/subscription') as Promise<{ data: Subscription }>,

  getCredits: () =>
    apiClient.get('/billing/credits') as Promise<{ data: CreditUsage }>,

  createPortalSession: () =>
    apiClient.post('/billing/portal') as Promise<{ data: { url: string } }>,

  createCheckoutSession: () =>
    apiClient.post('/billing/checkout') as Promise<{ data: { url: string } }>,

  listInvoices: () =>
    apiClient.get('/billing/invoices') as Promise<{ data: Invoice[] }>,
}
