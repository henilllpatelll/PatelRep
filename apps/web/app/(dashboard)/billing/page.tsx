'use client'

import { useQuery } from '@tanstack/react-query'
import { CreditCard, TrendingUp, CheckCircle, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { billingApi, Subscription, CreditUsage } from '@/lib/api/billing'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numberOrDefault(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function formatNumber(value: unknown): string {
  return numberOrDefault(value).toLocaleString()
}

function formatCents(cents: unknown): string {
  return `$${(numberOrDefault(cents) / 100).toFixed(2)}`
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return ''
  return format(new Date(dateStr), 'MMM d, yyyy')
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

// ─── Credit bar color ──────────────────────────────────────────────────────────

function creditBarColor(pct: number): string {
  if (pct > 95) return 'bg-red-500'
  if (pct > 80) return 'bg-orange-500'
  return 'bg-amber-400'
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
      <div className="border-t border-gray-100 mb-4" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`h-4 bg-gray-200 rounded mb-3 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { isGM, role } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)

  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => billingApi.getSubscription(),
    select: (res) => res.data as Subscription,
    enabled: isGM,
    refetchInterval: false,
    staleTime: 5 * 60_000,
  })

  const { data: creditData, isLoading: creditLoading } = useQuery({
    queryKey: ['billing-credits'],
    queryFn: () => billingApi.getCredits(),
    select: (res) => res.data as CreditUsage,
    enabled: isGM,
    refetchInterval: false,
    staleTime: 5 * 60_000,
  })

  // Auth loading guard — wait for role to be available before checking access
  if (isAuthLoading || !role) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-amber-500" />
      </div>
    )
  }

  // Non-GM guard
  if (!isGM) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Billing is only accessible to hotel GMs.</p>
      </div>
    )
  }

  // Credit percentage
  const creditsIncluded = numberOrDefault(creditData?.credits_included)
  const creditsUsed = numberOrDefault(creditData?.credits_used)
  const creditsRemaining = numberOrDefault(creditData?.credits_remaining)
  const overageCredits = numberOrDefault(creditData?.overage_credits)
  const overageCostCents = numberOrDefault(creditData?.overage_cost_cents)

  const creditPct =
    creditsIncluded > 0
      ? Math.round((creditsUsed / creditsIncluded) * 100)
      : 0

  // Period display — use period field (e.g. "2026-05") formatted as "May 2026", fall back to "Current Period"
  const periodLabel = (() => {
    const raw = (creditData as any)?.period_start ?? creditData?.period
    if (!raw) return 'Current Period'
    try {
      const d = raw.length === 7 ? new Date(`${raw}-01`) : new Date(raw)
      return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    } catch { return 'Current Period' }
  })()

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing &amp; Usage</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your subscription and monitor AI credit consumption
        </p>
      </div>

      {/* ── Section 1: Subscription Status ── */}
      {subLoading ? (
        <SkeletonCard rows={5} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="h-5 w-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">Current Plan</h2>
          </div>
          <hr className="border-gray-100 mb-4" />

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
                {subData ? `${formatCents(subData.base_fee_cents ?? 9900)}/month` : '$99/month'}
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

          {/* Manage Subscription CTA — coming soon */}
          <div className="mt-5">
            <button
              disabled
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                         bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
            >
              Manage Subscription
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="ml-1 text-xs font-normal text-gray-400">(Coming soon)</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Section 2: AI Credit Usage ── */}
      {creditLoading ? (
        <SkeletonCard rows={5} />
      ) : creditData ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-5 w-5 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">
              AI Credit Usage
              {periodLabel && (
                <span className="ml-2 text-gray-400 font-normal">— {periodLabel}</span>
              )}
            </h2>
          </div>
          <hr className="border-gray-100 mb-4" />

          {/* Usage summary line */}
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              <span className="text-lg font-bold text-gray-900">
                {formatNumber(creditsUsed)}
              </span>{' '}
              /{' '}
              <span className="font-semibold">{formatNumber(creditsIncluded)}</span>{' '}
              credits used
            </p>
            <span
              className={`text-sm font-semibold ${
                creditPct > 95
                  ? 'text-red-600'
                  : creditPct > 80
                  ? 'text-orange-600'
                  : 'text-amber-600'
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
                {formatNumber(creditsRemaining)}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-500">Overage credits</span>
              <span className="font-medium text-gray-900">
                {formatNumber(overageCredits)}
              </span>
            </div>

            <div className="flex justify-between col-span-2 sm:col-span-1">
              <span className="text-gray-500">Overage cost</span>
              <span
                className={`font-medium ${
                  overageCostCents > 0 ? 'text-orange-600' : 'text-gray-900'
                }`}
              >
                {formatCents(overageCostCents)}
              </span>
            </div>
          </div>

          {/* Pricing footnote */}
          <p className="mt-4 text-xs text-gray-400">
            Pricing: $99/mo base + $0.02/credit overage
          </p>
        </div>
      ) : null}

      {/* ── Section 3: Pricing Details (static) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="h-5 w-5 text-gray-400" />
          <h2 className="text-base font-semibold text-gray-900">Pricing Details</h2>
        </div>
        <hr className="border-gray-100 mb-4" />

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
      </div>
    </div>
  )
}
