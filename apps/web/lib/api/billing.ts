import { apiClient } from '@/lib/api/client'

export interface Subscription {
  stripe_customer_id?: string
  plan_status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused'
  trial_end?: string
  current_period_start?: string
  current_period_end?: string
  base_fee_cents?: number
  credits_included?: number
}

export interface CreditUsage {
  period?: string          // e.g. "2026-03"
  credits_included?: number
  credits_used?: number
  credits_remaining?: number
  overage_credits?: number
  overage_cost_cents?: number
  cap_cents?: number | null
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
}

export const billingApi = {
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
