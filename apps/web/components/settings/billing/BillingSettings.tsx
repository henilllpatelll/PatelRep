'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, ExternalLink, Receipt, Zap } from 'lucide-react'
import { billingApi, type Subscription } from '@/lib/api/billing'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsDetailList } from '@/components/settings/workspace/SettingsDetailList'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsStatusPill } from '@/components/settings/workspace/SettingsStatusPill'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { useRole } from '@/lib/hooks/useRole'
import { errorMessage, errorStatus } from '@/lib/settings/apiErrors'
import { safeStripeUrl, subscriptionNotice, subscriptionRows, subscriptionStatusMeta, isTrialExpired } from '@/lib/settings/billing'
import { useHotelStore } from '@/stores/hotelStore'
import { CreditUsageCard } from './CreditUsageCard'
import { InvoicesCard } from './InvoicesCard'

const QUERY = { staleTime: 5 * 60_000, refetchInterval: false as const, retry: (n: number, err: unknown) => errorStatus(err) !== 404 && n < 1 }

/**
 * Both flows ask the server to create the Stripe session and only follow an https stripe.com link it returns.
 * No Stripe URL, key or price is built in the browser.
 */
function useStripeRedirect(
  kind: 'portal' | 'checkout',
  { setActionError, setRedirecting }: { setActionError: (message: string | null) => void; setRedirecting: (value: boolean) => void },
) {
  // `isPending` is published a tick after mutate(); this ref makes a fast double-click create only one session.
  const inFlight = useRef(false)
  const mutation = useMutation({
    mutationFn: () => (kind === 'portal' ? billingApi.createPortalSession() : billingApi.createCheckoutSession()),
    onMutate: () => setActionError(null),
    onSettled: () => { inFlight.current = false },
    onSuccess: (res) => {
      const url = safeStripeUrl(res.data?.url)
      if (!url) {
        setActionError('Billing returned a link we couldn’t verify, so it wasn’t opened. Please try again.')
        return
      }
      setRedirecting(true)
      window.location.assign(url)
    },
    onError: (err) => setActionError(errorMessage(err, kind === 'portal' ? 'We couldn’t open the billing portal.' : 'We couldn’t start checkout.')),
  })
  const start = () => {
    if (inFlight.current) return
    inFlight.current = true
    mutation.mutate()
  }
  return { start, isPending: mutation.isPending }
}

export function BillingSettings() {
  const { isGM, role } = useRole()
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const enabled = isGM && !!hotelId

  const [actionError, setActionError] = useState<string | null>(null)
  // Stays true after a successful redirect request so a second click can't open a second Stripe session.
  const [redirecting, setRedirecting] = useState(false)
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => { if (event.persisted) setRedirecting(false) }
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  const subscription = useQuery({
    queryKey: ['billing-subscription', hotelId],
    queryFn: () => billingApi.getSubscription(),
    select: (res) => res.data as Subscription,
    enabled,
    ...QUERY,
  })
  const credits = useQuery({
    queryKey: ['billing-credits', hotelId],
    queryFn: () => billingApi.getCredits(),
    select: (res) => res.data,
    enabled,
    ...QUERY,
  })
  const invoices = useQuery({
    queryKey: ['billing-invoices', hotelId],
    queryFn: () => billingApi.listInvoices(),
    select: (res) => res.data ?? [],
    enabled,
    ...QUERY,
  })

  const redirect = { setActionError, setRedirecting }
  const portal = useStripeRedirect('portal', redirect)
  const checkout = useStripeRedirect('checkout', redirect)
  const redirectBusy = portal.isPending || checkout.isPending || redirecting

  if (!role) return <SettingsLoading />
  if (!isGM) return <p role="alert" className="text-sm text-ink-3">Billing can only be managed by hotel GMs.</p>

  const sub = subscription.data
  const noSubscription = subscription.isError && errorStatus(subscription.error) === 404
  const notice = sub ? subscriptionNotice(sub) : null
  const status = sub ? subscriptionStatusMeta(sub.plan_status) : null
  const statusLabel = sub && isTrialExpired(sub) ? 'Trial ended' : status?.label

  return (
    <div className="space-y-5">
      <SettingsSectionHeader level={1} title="Billing & Usage" description="Manage your subscription, invoices, and AI credit usage." />

      {notice && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-lg)] border p-4 ${
            notice.kind === 'payment' ? 'border-[var(--alert-line)] bg-[var(--alert-soft)]'
              : notice.kind === 'trial' ? 'border-[var(--info-line)] bg-[var(--info-soft)]'
              : 'border-[var(--caution-line)] bg-[var(--caution-soft)]'
          }`}
        >
          <div className="flex min-w-0 items-start gap-3">
            {notice.kind === 'payment' ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--alert)]" aria-hidden="true" /> : <Zap size={18} className="mt-0.5 shrink-0 text-ink-2" aria-hidden="true" />}
            <div>
              <p className="text-sm font-semibold text-ink">{notice.title}</p>
              <p className="mt-0.5 text-[13px] text-ink-2">{notice.body}</p>
            </div>
          </div>
          {notice.action === 'checkout' ? (
            <Button onClick={() => checkout.start()} loading={checkout.isPending} disabled={redirectBusy && !checkout.isPending}>Upgrade plan <ExternalLink size={14} aria-hidden="true" /></Button>
          ) : (
            <Button variant={notice.kind === 'payment' ? 'primary' : 'outline'} onClick={() => portal.start()} loading={portal.isPending} disabled={redirectBusy && !portal.isPending}>
              {notice.kind === 'payment' ? 'Update payment method' : 'Manage billing'} <ExternalLink size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      {actionError && <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{actionError}</p>}

      <SettingsCard aria-labelledby="billing-subscription-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="billing-subscription-heading" className="flex items-center gap-2 text-base font-semibold text-ink"><CreditCard size={16} className="text-ink-3" aria-hidden="true" /> Subscription</h2>
          {status && statusLabel && <SettingsStatusPill tone={status.tone}>{statusLabel}</SettingsStatusPill>}
        </div>

        {subscription.isPending ? (
          <SettingsLoading label="Loading subscription…" />
        ) : noSubscription ? (
          <SettingsEmpty icon={<CreditCard size={20} />} title="No subscription yet" body="No subscription is on file for this property. Billing details will appear here once one is set up." />
        ) : subscription.isError ? (
          <SettingsError message="We couldn’t load your subscription. This is a loading problem, not a payment problem." onRetry={() => subscription.refetch()} />
        ) : sub ? (
          <>
            <SettingsDetailList columns={2} items={subscriptionRows(sub)} />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => portal.start()} loading={portal.isPending} disabled={redirectBusy && !portal.isPending}>
                Manage Billing <ExternalLink size={14} aria-hidden="true" />
              </Button>
              <p className="text-xs text-ink-3">Plan pricing, payment method and cancellation are managed securely in Stripe.</p>
            </div>
          </>
        ) : null}
      </SettingsCard>

      <CreditUsageCard query={credits} />

      <SettingsCard aria-labelledby="billing-invoices-heading" className="space-y-4">
        <h2 id="billing-invoices-heading" className="flex items-center gap-2 text-base font-semibold text-ink"><Receipt size={16} className="text-ink-3" aria-hidden="true" /> Invoices</h2>
        <InvoicesCard query={invoices} />
      </SettingsCard>
    </div>
  )
}
