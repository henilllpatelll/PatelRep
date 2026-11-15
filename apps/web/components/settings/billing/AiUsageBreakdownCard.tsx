'use client'

import { Bot, Info } from 'lucide-react'
import type { AiUsage } from '@/lib/api/billing'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { aiUsageRows, periodLabel } from '@/lib/settings/aiBilling'
import { formatMoney, type QueryLike } from '@/lib/settings/billing'

/**
 * Where this cycle's AI credits went (classic AI features vs. AI agents) and an estimate of the next bill.
 * Every figure is server-calculated; credits awaiting provider confirmation are listed separately and are never
 * presented as charged.
 */
export function AiUsageBreakdownCard({ query }: { query: QueryLike<AiUsage> }) {
  const usage = query.data
  return (
    <SettingsCard aria-labelledby="billing-ai-usage-heading" className="space-y-4">
      <h2 id="billing-ai-usage-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
        <Bot size={16} className="text-ink-3" aria-hidden="true" /> AI usage breakdown
        {usage?.period_start && <span className="text-sm font-normal text-ink-3">· {periodLabel(usage.period_start)}</span>}
      </h2>

      {query.isPending ? (
        <SettingsLoading label="Loading AI usage…" />
      ) : query.isError || !usage ? (
        <SettingsError message="We couldn’t load the AI usage breakdown right now." onRetry={() => query.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {aiUsageRows(usage).map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{row.label}</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-ink">{row.value}</dd>
                {row.hint && <p className="mt-0.5 text-xs text-ink-3">{row.hint}</p>}
              </div>
            ))}
          </dl>

          <section aria-labelledby="billing-estimate-heading" className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
            <h3 id="billing-estimate-heading" className="text-[13px] font-semibold text-ink">
              Estimated next bill <span className="font-normal text-ink-3">(estimate, not an invoice)</span>
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
              <EstimateItem label="Base plan" cents={usage.estimate.base_fee_cents} />
              <EstimateItem label="AI feature overage" cents={usage.estimate.legacy_overage_cents} />
              <EstimateItem label="AI agent overage" cents={usage.estimate.agent_overage_cents} />
              <EstimateItem label="Estimated total" cents={usage.estimate.total_cents} strong />
            </dl>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-3">
              <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              Your invoice from Stripe is the final amount. Usage still awaiting confirmation is not included.
            </p>
          </section>
        </>
      )}
    </SettingsCard>
  )
}

function EstimateItem({ label, cents, strong = false }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums text-ink' : 'tabular-nums text-ink-2'}>{formatMoney(cents, 'usd')}</dd>
    </div>
  )
}
