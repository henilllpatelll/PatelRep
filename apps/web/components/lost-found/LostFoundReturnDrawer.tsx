'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, Package, Truck, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import {
  lostFoundApi,
  type LostFoundCarrier,
  type LostFoundReturnMethod,
  type LostFoundShippingPaidBy,
} from '@/lib/api/lost_found'
import {
  formatCurrencyCents,
  formatLostFoundDateTime,
  invalidateLostFound,
  LOST_FOUND_CARRIER_LABEL,
  LOST_FOUND_RETURN_STATUS_LABEL,
  LOST_FOUND_RETURN_STATUS_TONE,
} from '@/lib/utils/lostFoundInventory'
import { CustodyTimeline } from '@/components/lost-found/CustodyTimeline'

const CARRIERS: LostFoundCarrier[] = ['fedex', 'ups', 'usps', 'dhl', 'local_courier', 'other']
const VERIFICATION_METHODS = ['Government photo ID', 'Matching identifying information', 'Signed acknowledgment', 'Authorized representative', 'Other']

type ReturnTab = 'details' | 'custody' | 'activity'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-0"><span className="text-xs text-ink3">{label}</span><span className="max-w-[65%] text-right text-sm text-ink">{children}</span></div>
}

function ActivityTab({ returnId }: { returnId: string }) {
  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['lost-found-return-events', returnId],
    queryFn: () => lostFoundApi.listReturnEvents(returnId),
    select: (response) => response.data,
  })
  if (isLoading) return <p className="py-6 text-sm text-ink3">Loading activity…</p>
  if (isError) return <Button variant="outline" size="sm" onClick={() => refetch()}>Retry activity</Button>
  if (!events.length) return <p className="py-6 text-sm text-ink3">No activity recorded yet.</p>
  return <ol className="space-y-4">{events.map((event) => <li key={event.id} className="border-l-2 border-line pl-3"><p className="text-sm font-semibold text-ink">{event.event_type.replaceAll('_', ' ')}</p><p className="text-xs text-ink3">{formatLostFoundDateTime(event.created_at)}</p>{event.note && <p className="mt-1 text-sm text-ink2">{event.note}</p>}</li>)}</ol>
}

export function LostFoundReturnDrawer({ returnId, onClose }: { returnId: string; onClose: () => void }) {
  const drawerRef = useRef<HTMLDivElement>(null!)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<ReturnTab>('details')
  const [method, setMethod] = useState<LostFoundReturnMethod | null>(null)
  const [pickupForm, setPickupForm] = useState({ recipient_name: '', pickup_location: '', pickup_notes: '', verification_method_required: VERIFICATION_METHODS[0] })
  const [completeForm, setCompleteForm] = useState({ recipient_name: '', verification_method: '', verification_notes: '', verified: false })
  const [showComplete, setShowComplete] = useState(false)
  const [shippingForm, setShippingForm] = useState({ recipient_name: '', address_line1: '', address_line2: '', city: '', region: '', postal_code: '', country: 'United States', shipping_paid_by: 'hotel' as LostFoundShippingPaidBy })
  const [shipForm, setShipForm] = useState({ carrier: 'fedex' as LostFoundCarrier, tracking_number: '', shipping_cost: '' })
  useModalFocusTrap(drawerRef, true, onClose)

  const query = useQuery({ queryKey: ['lost-found-return', returnId], queryFn: () => lostFoundApi.getReturn(returnId), select: (response) => response.data })
  const row = query.data

  const invalidate = () => invalidateLostFound(queryClient)

  const chooseMethod = useMutation({
    mutationFn: (next: LostFoundReturnMethod) => lostFoundApi.updateReturnMethod(returnId, { method: next }),
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast.error(error.message || 'Could not update return method'),
  })
  const savePickupDetails = useMutation({
    mutationFn: () => lostFoundApi.setPickupDetails(returnId, pickupForm),
    onSuccess: () => { invalidate(); toast.success('Pickup details saved') },
    onError: (error: Error) => toast.error(error.message || 'Could not save pickup details'),
  })
  const markReady = useMutation({
    mutationFn: () => lostFoundApi.markPickupReady(returnId),
    onSuccess: () => { invalidate(); toast.success('Marked ready for pickup') },
    onError: (error: Error) => toast.error(error.message || 'Could not mark this ready'),
  })
  const completePickup = useMutation({
    mutationFn: () => lostFoundApi.completePickup(returnId, completeForm),
    onSuccess: () => { invalidate(); setShowComplete(false); toast.success('Item released to guest') },
    onError: (error: Error) => toast.error(error.message || 'Could not complete pickup'),
  })
  const saveShippingDetails = useMutation({
    mutationFn: () => lostFoundApi.setShippingDetails(returnId, { ...shippingForm, address_line2: shippingForm.address_line2 || undefined }),
    onSuccess: () => { invalidate(); toast.success('Shipping details saved') },
    onError: (error: Error) => toast.error(error.message || 'Could not save shipping details'),
  })
  const markShipped = useMutation({
    mutationFn: () => lostFoundApi.markShipped(returnId, {
      carrier: shipForm.carrier,
      tracking_number: shipForm.tracking_number.trim() || undefined,
      shipping_cost_cents: shipForm.shipping_cost ? Math.round(parseFloat(shipForm.shipping_cost) * 100) : undefined,
    }),
    onSuccess: () => { invalidate(); toast.success('Marked shipped') },
    onError: (error: Error) => toast.error(error.message || 'Could not mark this shipped'),
  })
  const completeShipment = useMutation({
    mutationFn: () => lostFoundApi.completeShipment(returnId),
    onSuccess: () => { invalidate(); toast.success('Return completed') },
    onError: (error: Error) => toast.error(error.message || 'Could not complete this return'),
  })

  if (!row) {
    return createPortal(<div className="fixed inset-0 z-drawer" role="presentation"><div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={onClose} /><div className="absolute inset-y-0 right-0 flex w-full max-w-[480px] items-center justify-center border-l border-line bg-surface p-5 text-sm text-ink3">{query.isError ? 'Could not load this return.' : 'Loading return…'}</div></div>, document.body)
  }

  const itemLabel = row.lost_found_items?.description ?? 'Found item'
  const guestLabel = row.lost_found_claims?.guest_name ?? 'Guest'
  const claimCode = row.lost_found_claims?.claim_number ? `CL-${String(row.lost_found_claims.claim_number).padStart(4, '0')}` : ''
  const selectedMethod = method ?? row.method
  const methodLocked = row.status !== 'awaiting_details'

  const detailsPanel = (() => {
    if (row.status === 'completed') {
      return <div className="space-y-5">
        <div className="rounded-xl border border-ready-line bg-ready-soft p-4 text-center">
          <CheckCircle2 className="mx-auto text-ready" size={28} />
          <p className="mt-2 text-sm font-semibold text-ready">Returned to {row.method === 'shipping' ? (row.shipping_name ?? guestLabel) : (row.recipient_name ?? guestLabel)}</p>
        </div>
        <section className="rounded-xl border border-line bg-surface-2 px-4">
          <Row label="Method">{row.method === 'pickup' ? 'Hotel pickup' : row.method === 'shipping' ? `Shipping${row.carrier ? ` · ${LOST_FOUND_CARRIER_LABEL[row.carrier]}` : ''}` : 'Other'}</Row>
          <Row label="Released">{formatLostFoundDateTime(row.completed_at ?? row.shipped_at ?? row.picked_up_at)}</Row>
          {row.verification_method && <Row label="Verification">{row.verification_method}</Row>}
          {row.completed_by && <Row label="Released by">Staff</Row>}
        </section>
      </div>
    }

    if (row.status === 'shipped') {
      return <div className="space-y-5">
        <section className="rounded-xl border border-line bg-surface-2 px-4">
          <Row label="Guest">{guestLabel}</Row>
          <Row label="Carrier">{row.carrier ? LOST_FOUND_CARRIER_LABEL[row.carrier] : 'Not recorded'}</Row>
          <Row label="Tracking">
            {row.tracking_number ? <span className="inline-flex items-center gap-1.5">{row.tracking_number}<IconButton variant="ghost" size="sm" aria-label="Copy tracking number" onClick={() => navigator.clipboard.writeText(row.tracking_number!)}><Copy size={12} /></IconButton></span> : 'Not recorded'}
          </Row>
          <Row label="Shipped">{formatLostFoundDateTime(row.shipped_at)}</Row>
          <Row label="Shipping paid by">{row.shipping_paid_by ?? 'Not recorded'}</Row>
          <Row label="Status">Shipped{row.tracking_number ? ' · Tracking recorded' : ''}</Row>
        </section>
        <Button className="w-full" loading={completeShipment.isPending} onClick={() => completeShipment.mutate()}>Mark Complete</Button>
      </div>
    }

    if (row.status === 'ready_for_pickup') {
      if (showComplete) {
        return <form onSubmit={(event) => { event.preventDefault(); completePickup.mutate() }} className="space-y-3 rounded-xl border border-ready-line bg-ready-soft p-4">
          <p className="text-sm font-semibold text-ready">Complete Pickup</p>
          <label className="block text-xs font-medium text-ink2">Recipient name *<input required value={completeForm.recipient_name} onChange={(e) => setCompleteForm((f) => ({ ...f, recipient_name: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
          <label className="block text-xs font-medium text-ink2">Verification method *<select required value={completeForm.verification_method} onChange={(e) => setCompleteForm((f) => ({ ...f, verification_method: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><option value="">Choose a method</option>{VERIFICATION_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="block text-xs font-medium text-ink2">Verification notes *<textarea required value={completeForm.verification_notes} onChange={(e) => setCompleteForm((f) => ({ ...f, verification_notes: e.target.value }))} rows={2} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
          <label className="flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={completeForm.verified} onChange={(e) => setCompleteForm((f) => ({ ...f, verified: e.target.checked }))} /> I verified the recipient before releasing this item.</label>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setShowComplete(false)}>Cancel</Button><Button type="submit" className="flex-1" disabled={!completeForm.recipient_name.trim() || !completeForm.verification_method || !completeForm.verification_notes.trim() || !completeForm.verified} loading={completePickup.isPending}>Release Item</Button></div>
        </form>
      }
      return <div className="space-y-5">
        <section className="rounded-xl border border-line bg-surface-2 px-4">
          <Row label="Item">{itemLabel}</Row>
          <Row label="Guest">{guestLabel}</Row>
          <Row label="Pickup">{row.pickup_location}</Row>
          <Row label="Ready since">{formatLostFoundDateTime(row.pickup_ready_at)}</Row>
        </section>
        <Button className="w-full" onClick={() => { setCompleteForm({ recipient_name: row.recipient_name ?? '', verification_method: row.pickup_verification_method_required ?? '', verification_notes: '', verified: false }); setShowComplete(true) }}>Complete Pickup</Button>
      </div>
    }

    if (row.status === 'shipping_preparation') {
      return <div className="space-y-5">
        <section className="rounded-xl border border-line bg-surface-2 px-4">
          <Row label="Recipient">{row.shipping_name}</Row>
          <Row label="Address">{[row.shipping_address_line1, row.shipping_city, row.shipping_region, row.shipping_postal_code].filter(Boolean).join(', ')}</Row>
        </section>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-ink2">Carrier<select value={shipForm.carrier} onChange={(e) => setShipForm((f) => ({ ...f, carrier: e.target.value as LostFoundCarrier }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">{CARRIERS.map((c) => <option key={c} value={c}>{LOST_FOUND_CARRIER_LABEL[c]}</option>)}</select></label>
          <label className="text-xs font-medium text-ink2">Tracking number<input value={shipForm.tracking_number} onChange={(e) => setShipForm((f) => ({ ...f, tracking_number: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        </div>
        <label className="block text-xs font-medium text-ink2">Shipping cost<input value={shipForm.shipping_cost} onChange={(e) => setShipForm((f) => ({ ...f, shipping_cost: e.target.value }))} placeholder="$" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        <Button className="w-full" loading={markShipped.isPending} onClick={() => markShipped.mutate()}>Mark Shipped</Button>
      </div>
    }

    // awaiting_details — method selection + the method-specific form
    return <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface-2 px-4">
        <Row label="Item">{itemLabel}</Row>
        <Row label="Guest">{guestLabel}{claimCode ? ` · ${claimCode}` : ''}</Row>
      </section>
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Return Method</p>
        <div className="flex flex-col gap-2">
          {(['shipping', 'pickup', 'other'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink2">
              <input
                type="radio"
                name="return-method"
                checked={selectedMethod === value}
                disabled={methodLocked}
                onChange={() => { setMethod(value); chooseMethod.mutate(value) }}
              /> {value === 'shipping' ? 'Ship to Guest' : value === 'pickup' ? 'Pickup at Hotel' : 'Other'}
            </label>
          ))}
        </div>
      </section>
      {selectedMethod === 'pickup' && <form onSubmit={(event) => { event.preventDefault(); savePickupDetails.mutate() }} className="space-y-3 rounded-xl border border-line p-4">
        <p className="text-sm font-semibold text-ink">Pickup</p>
        <label className="block text-xs font-medium text-ink2">Recipient<input required value={pickupForm.recipient_name} onChange={(e) => setPickupForm((f) => ({ ...f, recipient_name: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        <label className="block text-xs font-medium text-ink2">Pickup location<select required value={pickupForm.pickup_location} onChange={(e) => setPickupForm((f) => ({ ...f, pickup_location: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><option value="">Choose location</option>{['Front Desk', 'Manager Office', 'Security', 'Housekeeping Office'].map((loc) => <option key={loc}>{loc}</option>)}</select></label>
        <label className="block text-xs font-medium text-ink2">Pickup notes<textarea value={pickupForm.pickup_notes} onChange={(e) => setPickupForm((f) => ({ ...f, pickup_notes: e.target.value }))} rows={2} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        <label className="block text-xs font-medium text-ink2">Verification method required at release<select required value={pickupForm.verification_method_required} onChange={(e) => setPickupForm((f) => ({ ...f, verification_method_required: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">{VERIFICATION_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <Button type="submit" className="w-full" disabled={!pickupForm.recipient_name.trim() || !pickupForm.pickup_location} loading={savePickupDetails.isPending}>Save & Continue</Button>
        <Button type="button" variant="outline" className="w-full" disabled={!row.recipient_name || !row.pickup_location} loading={markReady.isPending} onClick={() => markReady.mutate()}>Mark Ready for Pickup</Button>
      </form>}
      {selectedMethod === 'shipping' && <form onSubmit={(event) => { event.preventDefault(); saveShippingDetails.mutate() }} className="space-y-3 rounded-xl border border-line p-4">
        <p className="text-sm font-semibold text-ink">Ship to Guest</p>
        <label className="block text-xs font-medium text-ink2">Recipient<input required value={shippingForm.recipient_name} onChange={(e) => setShippingForm((f) => ({ ...f, recipient_name: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        <label className="block text-xs font-medium text-ink2">Address line 1<input required value={shippingForm.address_line1} onChange={(e) => setShippingForm((f) => ({ ...f, address_line1: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        <label className="block text-xs font-medium text-ink2">Address line 2<input value={shippingForm.address_line2} onChange={(e) => setShippingForm((f) => ({ ...f, address_line2: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-ink2">City<input required value={shippingForm.city} onChange={(e) => setShippingForm((f) => ({ ...f, city: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
          <label className="text-xs font-medium text-ink2">State/Region<input required value={shippingForm.region} onChange={(e) => setShippingForm((f) => ({ ...f, region: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
          <label className="text-xs font-medium text-ink2">Postal code<input required value={shippingForm.postal_code} onChange={(e) => setShippingForm((f) => ({ ...f, postal_code: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        </div>
        <label className="block text-xs font-medium text-ink2">Country<input required value={shippingForm.country} onChange={(e) => setShippingForm((f) => ({ ...f, country: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
        <div>
          <p className="text-xs font-medium text-ink2">Shipping paid by</p>
          <div className="mt-1 flex gap-3">{(['hotel', 'guest', 'other'] as const).map((who) => <label key={who} className="flex items-center gap-1.5 text-sm text-ink2 capitalize"><input type="radio" checked={shippingForm.shipping_paid_by === who} onChange={() => setShippingForm((f) => ({ ...f, shipping_paid_by: who }))} /> {who}</label>)}</div>
        </div>
        <Button type="submit" className="w-full" disabled={!shippingForm.recipient_name.trim() || !shippingForm.address_line1.trim() || !shippingForm.city.trim() || !shippingForm.region.trim() || !shippingForm.postal_code.trim()} loading={saveShippingDetails.isPending}>Save Shipping Details</Button>
      </form>}
    </div>
  })()

  return createPortal(
    <div className="fixed inset-0 z-drawer" role="presentation">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="return-drawer-title" tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-line bg-surface shadow-2xl outline-none">
        <header className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Return</p>
              <h2 id="return-drawer-title" className="mt-1 text-base font-semibold text-ink">{itemLabel}</h2>
              <p className="mt-1 text-xs text-ink3">{row.lost_found_items?.tag_identifier} · {guestLabel}{claimCode ? ` · ${claimCode}` : ''}</p>
            </div>
            <IconButton variant="ghost" size="sm" aria-label="Close return details" onClick={onClose}><X size={18} /></IconButton>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {row.method === 'shipping' ? <Truck size={14} className="text-ink3" /> : <Package size={14} className="text-ink3" />}
            <Pill tone={LOST_FOUND_RETURN_STATUS_TONE[row.status]} size="sm">{LOST_FOUND_RETURN_STATUS_LABEL[row.status]}</Pill>
            {row.shipping_cost_cents !== undefined && row.shipping_cost_cents !== null && <span className="text-xs text-ink3">{formatCurrencyCents(row.shipping_cost_cents)}</span>}
          </div>
        </header>
        <div role="tablist" aria-label="Return details" className="flex shrink-0 gap-1 border-b border-line px-3 pt-1">
          {(['details', 'custody', 'activity'] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-t-md px-3 py-2 text-sm font-medium capitalize transition-colors ${tab === key ? 'border-b-2 border-accent text-ink' : 'text-ink3 hover:text-ink2'}`}>{key === 'details' ? 'Return Details' : key}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'details' && detailsPanel}
          {tab === 'custody' && <CustodyTimeline itemId={row.item_id} />}
          {tab === 'activity' && <ActivityTab returnId={row.id} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}
