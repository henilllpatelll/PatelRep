'use client'

import { useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { billingApi, type AiUsage, type OverageChange, type OverageQuote } from '@/lib/api/billing'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsDetailList } from '@/components/settings/workspace/SettingsDetailList'
import { SettingsField, SettingsTextInput, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { SettingsStatusPill } from '@/components/settings/workspace/SettingsStatusPill'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { errorMessage } from '@/lib/settings/apiErrors'
import { formatCreditText, formatUsdText, overageStateMeta, validateLimitInput } from '@/lib/settings/aiBilling'
import { formatDay, type QueryLike } from '@/lib/settings/billing'

/**
 * Opt-in AI agent overage. OFF unless this hotel's GM explicitly authorizes a limit and confirms the maximum charge.
 * The maximum charge shown in the confirmation comes from the server (GET /billing/overage/quote) and is sent back
 * for the server to verify; the browser never calculates money. Opting out stops new overage immediately; usage
 * already incurred stays billable, which the dialog says plainly.
 */
export function OverageControlsCard({ query, hotelId }: { query: QueryLike<AiUsage>; hotelId: string | undefined }) {
  const queryClient = useQueryClient()
  const inputId = useId()
  const usage = query.data
  const [editing, setEditing] = useState(false)
  const [limitText, setLimitText] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [quote, setQuote] = useState<OverageQuote | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<OverageChange | null>(null)
  const inFlight = useRef(false)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['billing-ai-usage', hotelId] })
    queryClient.invalidateQueries({ queryKey: ['billing-credits', hotelId] })
  }

  const quoteMutation = useMutation({
    mutationFn: (limit: number) => billingApi.quoteOverage(limit),
    onSuccess: (res) => {
      const q = res.data
      if (!q.within_cap) {
        setFieldError(`That limit would allow up to ${formatUsdText(q.max_exposure_usd)}, above your monthly AI overage cap of ${formatUsdText(q.monthly_overage_cap_usd)}.`)
        return
      }
      setDialogError(null)
      setQuote(q)
    },
    onError: (err) => setFieldError(errorMessage(err, 'We couldn’t check that limit. Please try again.')),
  })

  const authorize = useMutation({
    mutationFn: (q: OverageQuote) => billingApi.authorizeOverage({
      limit_credits: q.limit_credits, policy_id: q.policy_id, terms_version: q.terms_version,
      acknowledged_max_exposure_usd: q.max_exposure_usd,
    }),
    onSettled: () => { inFlight.current = false },
    onSuccess: (res) => { setReceipt(res.data); setQuote(null); setEditing(false); setLimitText(''); refresh() },
    onError: (err) => setDialogError(errorMessage(err, 'We couldn’t turn on AI overage. Nothing was changed.')),
  })

  const revoke = useMutation({
    mutationFn: () => billingApi.revokeOverage(),
    onSettled: () => { inFlight.current = false },
    onSuccess: (res) => { setReceipt(res.data); setConfirmOff(false); refresh() },
    onError: (err) => setDialogError(errorMessage(err, 'We couldn’t turn off AI overage. Please try again.')),
  })

  const review = () => {
    const parsed = validateLimitInput(limitText)
    if (!parsed.ok) { setFieldError(parsed.message); return }
    setFieldError(undefined)
    quoteMutation.mutate(parsed.value)
  }
  const once = (fn: () => void) => { if (inFlight.current) return; inFlight.current = true; fn() }

  const meta = overageStateMeta(usage?.overage.state)
  const policy = usage?.policy

  return (
    <SettingsCard aria-labelledby="billing-overage-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="billing-overage-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
          <ShieldCheck size={16} className="text-ink-3" aria-hidden="true" /> AI agent overage
        </h2>
        {usage && <SettingsStatusPill tone={meta.tone}>{meta.label}</SettingsStatusPill>}
      </div>

      {query.isPending ? (
        <SettingsLoading label="Loading overage settings…" />
      ) : query.isError || !usage ? (
        <SettingsError message="We couldn’t load AI overage settings right now." onRetry={() => query.refetch()} />
      ) : !policy ? (
        <p className="text-sm text-ink-3">AI agent overage isn’t available for your hotel yet. Agents can only use your included credits.</p>
      ) : (
        <>
          <p className="text-sm text-ink-2">{meta.description}</p>
          <SettingsDetailList columns={2} items={[
            { label: 'Authorized limit', value: usage.overage.enabled ? `${formatCreditText(usage.overage.authorized_limit_credits)} credits` : 'None' },
            { label: 'Maximum overage charge', value: usage.overage.enabled ? formatUsdText(usage.overage.max_exposure_usd) : '$0.00' },
            { label: 'Overage used this cycle', value: `${formatCreditText(usage.overage.accrued_credits)} credits (${formatUsdText(usage.overage.accrued_usd)})` },
            { label: 'Monthly AI overage cap', value: formatUsdText(policy.monthly_overage_cap_usd) },
          ]} />
          <p className="text-xs text-ink-3">
            Overage is billed at {formatUsdText(policy.usd_per_credit)} per credit on your next Stripe invoice. The monthly cap is the
            most AI agent overage your hotel can be billed in one billing cycle. It doesn’t include your plan fee or what PatelRep pays its AI providers.
          </p>

          {receipt && (
            <p role="status" className="flex items-start gap-2 rounded-[var(--r-md)] border border-[var(--ready-line)] bg-[var(--ready-soft)] px-3 py-2 text-[13px] text-ink-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--ready)]" aria-hidden="true" />
              <span>
                {receipt.state === 'on'
                  ? `AI overage turned on with a limit of ${formatCreditText(receipt.authorized_limit_credits)} credits (up to ${formatUsdText(receipt.max_exposure_usd)}).`
                  : receipt.already_off ? 'AI overage was already off.' : 'AI overage turned off. New agent work stops at your included credits.'}
                {receipt.recorded_at && <> Recorded {formatDay(receipt.recorded_at)} in your billing history{receipt.version ? ` (change #${receipt.version})` : ''}.</>}
              </span>
            </p>
          )}

          {editing ? (
            <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); review() }}>
              <SettingsField id={inputId} label="Overage limit (credits per billing cycle)" hint="A whole number. You’ll see the maximum charge before anything changes." error={fieldError} required>
                <SettingsTextInput
                  {...controlA11y(inputId, { error: fieldError, hint: true, required: true })}
                  inputMode="numeric" autoComplete="off" value={limitText}
                  onChange={(e) => { setLimitText(e.target.value); setFieldError(undefined) }}
                  className="max-w-xs"
                />
              </SettingsField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={quoteMutation.isPending}>Review limit</Button>
                <Button type="button" variant="ghost" onClick={() => { setEditing(false); setFieldError(undefined); setLimitText('') }}>Cancel</Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setReceipt(null); setEditing(true) }}>
                {usage.overage.state === 'off' ? 'Turn on overage' : usage.overage.state === 'needs_reconfirmation' ? 'Review new terms' : 'Change limit'}
              </Button>
              {usage.overage.state !== 'off' && (
                <Button variant="outline" onClick={() => { setReceipt(null); setDialogError(null); setConfirmOff(true) }}>Turn off overage</Button>
              )}
            </div>
          )}
        </>
      )}

      {quote && (
        <SettingsConfirmDialog
          title="Authorize AI agent overage?"
          confirmLabel={`Authorize up to ${formatUsdText(quote.max_exposure_usd)}`}
          busy={authorize.isPending}
          error={dialogError}
          onCancel={() => { if (!authorize.isPending) setQuote(null) }}
          onConfirm={() => once(() => authorize.mutate(quote))}
          body={<>
            <p>AI agents may use up to <strong>{formatCreditText(String(quote.limit_credits))} credits</strong> beyond your included allowance each billing cycle.</p>
            <p>That’s at most <strong>{formatUsdText(quote.max_exposure_usd)}</strong> per cycle at {formatUsdText(quote.usd_per_credit)} per credit, added to your next Stripe invoice. Agent work stops when the limit is reached.</p>
            <p>You can turn this off at any time. Overage already used stays billable.</p>
          </>}
        />
      )}
      {confirmOff && (
        <SettingsConfirmDialog
          title="Turn off AI agent overage?"
          confirmLabel="Turn off overage"
          tone="destructive"
          busy={revoke.isPending}
          error={dialogError}
          onCancel={() => { if (!revoke.isPending) setConfirmOff(false) }}
          onConfirm={() => once(() => revoke.mutate())}
          body={<>
            <p>New AI agent work will stop at your included credits right away.</p>
            <p>Overage already used this cycle ({formatUsdText(usage?.overage.accrued_usd)}) stays billable.</p>
          </>}
        />
      )}
    </SettingsCard>
  )
}
