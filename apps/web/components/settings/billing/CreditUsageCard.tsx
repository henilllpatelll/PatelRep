'use client'

import { AlertTriangle, TrendingUp } from 'lucide-react'
import type { CreditUsage } from '@/lib/api/billing'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsDetailList, type DetailItem } from '@/components/settings/workspace/SettingsDetailList'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { type QueryLike, buildCreditView, creditBarTone, formatCredits, formatMoney } from '@/lib/settings/billing'
import { cn } from '@/lib/utils'

const BAR: Record<'ready' | 'caution' | 'alert', string> = {
  ready: 'bg-[var(--ready)]',
  caution: 'bg-[var(--caution)]',
  alert: 'bg-[var(--alert)]',
}

/**
 * Current-cycle AI credit usage, straight from the credit ledger the API reports for this billing cycle.
 * Allowance, spend cap and charges are whatever the API returns — nothing is inferred from the plan name
 * or hardcoded — and anything the API didn't return is simply not shown.
 */
export function CreditUsageCard({ query }: { query: QueryLike<CreditUsage> }) {
  const view = buildCreditView(query.data)

  return (
    <SettingsCard aria-labelledby="billing-credits-heading" className="space-y-4">
      <h2 id="billing-credits-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
        <TrendingUp size={16} className="text-ink-3" aria-hidden="true" /> AI credit usage
      </h2>

      {query.isPending ? (
        <SettingsLoading label="Loading credit usage…" />
      ) : query.isError ? (
        <SettingsError message="We couldn’t load AI credit usage right now." onRetry={() => query.refetch()} />
      ) : view.kind === 'unavailable' ? (
        <p className="text-sm text-ink-3">{view.reason}</p>
      ) : (
        <>
          <div>
            <p className="text-sm text-ink-2">
              <span className="text-2xl font-semibold tabular-nums text-ink">{formatCredits(view.used)}</span>
              {view.kind === 'metered'
                ? <> / {formatCredits(view.included)} credits used this billing cycle</>
                : <> credits used this billing cycle</>}
            </p>

            {view.kind === 'metered' ? (
              <>
                <div
                  role="progressbar"
                  aria-label="AI credits used this billing cycle"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={view.barPercent}
                  aria-valuetext={`${view.percentLabel}% of included credits used`}
                  className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
                >
                  <div className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', BAR[creditBarTone(view.percentLabel)])} style={{ width: `${view.barPercent}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-[13px] text-ink-2">
                  <span>{view.percentLabel}% used</span>
                  <span>{view.overAllowance ? `${formatCredits(view.overage)} over the included credits` : `${formatCredits(view.remaining)} remaining`}</span>
                </div>
              </>
            ) : (
              <p className="mt-1 text-[13px] text-ink-3">No included credit allowance is recorded for this cycle.</p>
            )}
          </div>

          <SettingsDetailList columns={2} items={detailItems(view)} />

          {view.approachingCap && (
            <p role="status" className="flex items-start gap-2 rounded-[var(--r-md)] border border-[var(--caution-line)] bg-[var(--caution-soft)] px-3 py-2 text-[13px] text-ink-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--caution)]" aria-hidden="true" />
              <span>
                You’re approaching your monthly AI spend cap.
                {view.capRemainingCents !== null && <> {formatMoney(view.capRemainingCents, 'usd')} remains before it.</>}
              </span>
            </p>
          )}
        </>
      )}
    </SettingsCard>
  )
}

function detailItems(view: Exclude<ReturnType<typeof buildCreditView>, { kind: 'unavailable' }>): DetailItem[] {
  const items: DetailItem[] = [{ label: 'Billing cycle', value: view.cycle ?? '—' }]
  if (view.overage > 0 || (view.overageCostCents ?? 0) > 0) {
    items.push({ label: 'Overage credits', value: formatCredits(view.overage) })
    if (view.overageCostCents !== null) items.push({ label: 'Overage charges', value: formatMoney(view.overageCostCents, 'usd') })
  }
  if (view.capCents !== null) items.push({ label: 'Monthly spend cap', value: formatMoney(view.capCents, 'usd') })
  if (view.projectedCents !== null) items.push({ label: 'Projected month-end charges', value: formatMoney(view.projectedCents, 'usd') })
  return items
}
