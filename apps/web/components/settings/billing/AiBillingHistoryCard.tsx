'use client'

import { ExternalLink, History } from 'lucide-react'
import type { BillingHistoryPeriod } from '@/lib/api/billing'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsStatusPill } from '@/components/settings/workspace/SettingsStatusPill'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { billingActionMeta, formatCreditText, isPositiveCredits, periodLabel } from '@/lib/settings/aiBilling'
import { formatMoney, safeStripeUrl, type QueryLike } from '@/lib/settings/billing'

/**
 * Period-by-period AI credits and agent overage billing. A billing action links out only when Stripe has an actual
 * invoice for it (a pending invoice item has no invoice yet), and nothing is shown as paid unless Stripe confirmed it.
 */
export function AiBillingHistoryCard({ query }: { query: QueryLike<BillingHistoryPeriod[]> }) {
  const periods = query.data ?? []
  return (
    <SettingsCard aria-labelledby="billing-ai-history-heading" className="space-y-4">
      <h2 id="billing-ai-history-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
        <History size={16} className="text-ink-3" aria-hidden="true" /> AI billing history
      </h2>
      {query.isPending ? (
        <SettingsLoading label="Loading billing history…" />
      ) : query.isError ? (
        <SettingsError message="We couldn’t load AI billing history right now." onRetry={() => query.refetch()} />
      ) : periods.length === 0 ? (
        <SettingsEmpty icon={<History size={20} />} title="No billing periods yet" body="AI credit usage will appear here by billing cycle." />
      ) : (
        <ul className="divide-y divide-line">
          {periods.map((p) => (
            <li key={p.period_start} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{periodLabel(p.period_start)}</h3>
                <span className="text-xs text-ink-3">{p.is_finalized ? 'Closed' : 'In progress'}</span>
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
                <Item label="Credits used" value={`${formatCreditText(p.credits_used)} of ${formatCreditText(p.included_credits)}`} />
                <Item label="AI features" value={formatCreditText(p.legacy_credits_used)} />
                <Item label="AI agents" value={formatCreditText(p.agent_credits_used)} />
                <Item label="Agent overage" value={`${formatCreditText(p.agent_overage_credits)} (${formatMoney(p.agent_overage_cents, 'usd')})`} />
                {Number(p.adjustment_credits) < 0 && <Item label="Credits returned" value={formatCreditText(p.adjustment_credits.replace('-', ''))} />}
                {isPositiveCredits(p.pending_reconciliation_credits) && <Item label="Awaiting confirmation" value={`${formatCreditText(p.pending_reconciliation_credits)} (not charged)`} />}
              </dl>
              {p.billing_actions.length > 0 && (
                <ul className="mt-2 space-y-1.5" aria-label={`Billing actions for ${periodLabel(p.period_start)}`}>
                  {p.billing_actions.map((a) => {
                    const meta = billingActionMeta(a.status)
                    const url = safeStripeUrl(a.invoice_url)
                    return (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <SettingsStatusPill tone={meta.tone}>{meta.label}</SettingsStatusPill>
                        <span className="tabular-nums text-ink-2">{formatMoney(a.amount_cents, 'usd')} agent overage</span>
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                            View invoice <ExternalLink size={12} aria-hidden="true" /><span className="sr-only">(opens Stripe in a new tab)</span>
                          </a>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="tabular-nums text-ink-2">{value}</dd>
    </div>
  )
}
