'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  CreditCard,
  TrendingUp,
  CheckCircle,
  ExternalLink,
  Receipt,
  Zap,
} from 'lucide-react'
import { format } from 'date-fns'
import { billingApi, Subscription, CreditUsage, Invoice } from '@/lib/api/billing'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(dateStr: string): string {
  return format(new Date(dateStr), 'MMM d, yyyy')
}

function formatUnixDate(ts: number): string {
  return format(new Date(ts * 1000), 'MMM d, yyyy')
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  Subscription['plan_status'],
  { label: string; className: string }
> = {
  trialing:  { label: 'Trial',     className: 'bg-blue-100 text-blue-700' },
  active:    { label: 'Active',    className: 'bg-green-100 text-green-700' },
  past_due:  { label: 'Past Due',  className: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-500' },
  paused:    { label: 'Paused',    className: 'bg-orange-100 text-orange-700' },
}

function StatusBadge({ status }: { status: Subscription['plan_status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}
    >
      {cfg.label}
    </span>
  )
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'paid'   ? 'bg-green-100 text-green-700' :
    status === 'open'   ? 'bg-yellow-100 text-yellow-700' :
    status === 'void'   ? 'bg-gray-100 text-gray-500' :
                          'bg-red-100 text-red-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ─── Credit bar color ──────────────────────────────────────────────────────────

function creditBarColor(pct: number): string {
  if (pct > 95) return 'bg-red-500'
  if (pct > 80) return 'bg-orange-500'
  return 'bg-blue-500'
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bg-white/[0.65] border border-white/90 backdrop-blur-md rounded-2xl p-6 animate-pulse">
      <div className="h-5 bg-indigo-100/60 rounded w-1/3 mb-4" />
      <div className="border-t border-white/60 mb-4" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`h-4 bg-indigo-100/50 rounded mb-3 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsBillingPage() {
  const { isGM } = useRole()
  const [portalError, setPortalError] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => billingApi.getSubscription(),
    select: (res) => res.data as Subscription,
    enabled: isGM,
  })

  const { data: creditData, isLoading: creditLoading } = useQuery({
    queryKey: ['billing-credits'],
    queryFn: () => billingApi.getCredits(),
    select: (res) => res.data as CreditUsage,
    enabled: isGM,
  })

  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => billingApi.listInvoices(),
    select: (res) => res.data as Invoice[],
    enabled: isGM,
  })

  const portalMutation = useMutation({
    mutationFn: () => billingApi.createPortalSession(),
    onSuccess: (res) => {
      window.location.href = res.data.url
    },
    onError: (err: Error) => {
      setPortalError(err.message || 'Failed to open billing portal.')
    },
  })

  const checkoutMutation = useMutation({
    mutationFn: () => billingApi.createCheckoutSession(),
    onSuccess: (res) => {
      window.location.href = res.data.url
    },
    onError: (err: Error) => {
      setCheckoutError(err.message || 'Failed to start checkout.')
    },
  })

  // Non-GM guard
  if (!isGM) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Billing is only accessible to hotel GMs.</p>
      </div>
    )
  }

  // Credit percentage
  const creditPct =
    creditData && creditData.credits_included > 0
      ? Math.round((creditData.credits_used / creditData.credits_included) * 100)
      : 0

  // Period display (e.g. "2026-03" → "March 2026")
  const periodLabel = creditData
    ? format(new Date(`${creditData.period}-01`), 'MMMM yyyy')
    : ''

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Billing &amp; Usage</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your subscription and monitor AI credit consumption
        </p>
      </div>

      {/* ── Trial Upgrade CTA ── */}
      {subData?.plan_status === 'trialing' && (
        <Card className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-indigo-800">You're on a free trial</p>
              <p className="text-sm text-indigo-600 mt-0.5">
                Upgrade to keep full access after your trial ends.
                {subData.trial_end && (
                  <> Trial ends <strong>{formatDate(subData.trial_end)}</strong>.</>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {checkoutError && (
              <p className="text-xs text-red-600">{checkoutError}</p>
            )}
            <Button
              variant="primary"
              onClick={() => { setCheckoutError(null); checkoutMutation.mutate() }}
              disabled={checkoutMutation.isPending}
              className="whitespace-nowrap"
            >
              {checkoutMutation.isPending ? 'Redirecting…' : 'Upgrade Plan'}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* ── Section 1: Subscription Status ── */}
      {subLoading ? (
        <SkeletonCard rows={5} />
      ) : (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-slate-900">Current Plan</h2>
          </div>
          <hr className="border-white/60 mb-4" />

          <div className="space-y-3 text-sm">
            {/* Plan name + status */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-gray-500">Plan</span>
                <span className="ml-2 font-medium text-gray-900">PatelRep Pro</span>
              </div>
              {subData && <StatusBadge status={subData.plan_status} />}
            </div>

            {/* Base fee */}
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Base fee</span>
              <span className="font-medium text-gray-900">
                {subData ? `${formatCents(subData.base_fee_cents)}/month` : '$99/month'}
              </span>
            </div>

            {/* Billing period */}
            {subData?.current_period_start && subData?.current_period_end && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Billing period</span>
                <span className="font-medium text-gray-900">
                  {formatDate(subData.current_period_start)} – {formatDate(subData.current_period_end)}
                </span>
              </div>
            )}

            {/* Trial end — only when trialing */}
            {subData?.plan_status === 'trialing' && subData.trial_end && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Trial ends</span>
                <span className="font-medium text-blue-700">
                  {formatDate(subData.trial_end)}
                </span>
              </div>
            )}
          </div>

          {/* Manage Billing CTA */}
          <div className="mt-5 flex flex-col gap-1.5 items-start">
            {portalError && (
              <p className="text-xs text-red-600">{portalError}</p>
            )}
            <Button
              variant="primary"
              onClick={() => { setPortalError(null); portalMutation.mutate() }}
              disabled={portalMutation.isPending}
            >
              {portalMutation.isPending ? 'Opening portal…' : 'Manage Billing'}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* ── Section 2: AI Credit Usage ── */}
      {creditLoading ? (
        <SkeletonCard rows={5} />
      ) : creditData ? (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-slate-900">
              AI Credit Usage
              {periodLabel && (
                <span className="ml-2 text-gray-400 font-normal">— {periodLabel}</span>
              )}
            </h2>
          </div>
          <hr className="border-white/60 mb-4" />

          {/* Usage summary line */}
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              <span className="text-lg font-bold text-gray-900">
                {creditData.credits_used.toLocaleString()}
              </span>{' '}
              /{' '}
              <span className="font-semibold">{creditData.credits_included.toLocaleString()}</span>{' '}
              credits used
            </p>
            <span
              className={`text-sm font-semibold ${
                creditPct > 95
                  ? 'text-red-600'
                  : creditPct > 80
                  ? 'text-orange-600'
                  : 'text-blue-600'
              }`}
            >
              {creditPct}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden mb-4">
            <div
              className={`h-full rounded-full transition-all duration-500 ${creditBarColor(creditPct)}`}
              style={{ width: `${Math.min(creditPct, 100)}%` }}
            />
          </div>

          {/* Detail rows */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Credits remaining</span>
              <span className="font-medium text-gray-900">
                {creditData.credits_remaining.toLocaleString()}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">Overage credits</span>
              <span className="font-medium text-gray-900">
                {creditData.overage_credits.toLocaleString()}
              </span>
            </div>

            <div className="flex justify-between col-span-2 sm:col-span-1">
              <span className="text-gray-500">Overage cost</span>
              <span
                className={`font-medium ${
                  creditData.overage_cost_cents > 0 ? 'text-orange-600' : 'text-gray-900'
                }`}
              >
                {formatCents(creditData.overage_cost_cents)}
              </span>
            </div>

            {creditData.cap_cents != null && (
              <div className="flex justify-between col-span-2 sm:col-span-1">
                <span className="text-gray-500">Monthly cap</span>
                <span className="font-medium text-gray-900">
                  {formatCents(creditData.cap_cents)}
                </span>
              </div>
            )}
          </div>

          {/* Pricing footnote */}
          <p className="mt-4 text-xs text-gray-400">
            Pricing: $99/mo base + $0.02/credit overage
          </p>
        </Card>
      ) : null}

      {/* ── Section 3: Invoices ── */}
      {invoicesLoading ? (
        <SkeletonCard rows={4} />
      ) : invoicesData && invoicesData.length > 0 ? (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-slate-900">Recent Invoices</h2>
          </div>
          <hr className="border-white/60 mb-4" />

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide bg-indigo-50/60">
                  <th className="pb-2 pr-4 pt-2 pl-2">Date</th>
                  <th className="pb-2 pr-4 pt-2">Period</th>
                  <th className="pb-2 pr-4 pt-2">Amount</th>
                  <th className="pb-2 pr-4 pt-2">Status</th>
                  <th className="pb-2 pt-2">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/40">
                {invoicesData.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-2.5 pr-4 text-gray-700">
                      {formatUnixDate(inv.created)}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500">
                      {inv.period_start && inv.period_end
                        ? `${formatUnixDate(inv.period_start)} – ${formatUnixDate(inv.period_end)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-gray-900">
                      {formatCents(inv.amount_due)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td className="py-2.5">
                      {inv.hosted_invoice_url ? (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          View
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* ── Section 4: Pricing Details (static) ── */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="h-5 w-5 text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-900">Pricing Details</h2>
        </div>
        <hr className="border-white/60 mb-4" />

        <ul className="space-y-2.5 text-sm">
          {[
            { label: 'Base plan',           value: '$99/month' },
            { label: 'AI credits included', value: '5,000/month' },
            { label: 'Overage rate',        value: '$0.02/credit' },
            { label: 'Overage cap',         value: '$2.50/room/month' },
            { label: 'Cancel anytime',      value: null },
          ].map(({ label, value }) => (
            <li key={label} className="flex items-center gap-2 text-gray-700">
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
              <span className="text-gray-600">{label}</span>
              {value && (
                <>
                  <span className="text-gray-300 mx-1">·</span>
                  <span className="font-medium text-gray-900">{value}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
