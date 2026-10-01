'use client'
/* eslint-disable @next/next/no-img-element -- found-item photos are external storage URLs */

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Ban,
  CheckCircle2,
  Clock,
  ImageIcon,
  MapPin,
  MoreVertical,
  Package,
  Pencil,
  Tag,
  Truck,
  User,
  X,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import {
  isDispositionDue,
  lostFoundApi,
  type LostFoundClaimCapabilities,
  type LostFoundItem,
  type LostFoundItemMatchCandidate,
} from '@/lib/api/lost_found'
import {
  canDispositionItem,
  canMoveItem,
  canReleaseItem,
  formatItemAge,
  formatLostFoundDate,
  formatLostFoundDateTime,
  formatTimeUntil,
  invalidateLostFound,
  itemDerivedStatus,
  itemFinderName,
  itemFoundLocation,
  LOST_FOUND_DERIVED_STATUS_LABEL,
  LOST_FOUND_DERIVED_STATUS_TONE,
} from '@/lib/utils/lostFoundInventory'
import { CustodyTimeline } from '@/components/lost-found/CustodyTimeline'
import { DispositionReviewDrawer } from '@/components/lost-found/DispositionReviewDrawer'
import { VoidRecordDialog } from '@/components/lost-found/VoidRecordDialog'
import { LostFoundReturnDrawer } from '@/components/lost-found/LostFoundReturnDrawer'

type DrawerTab = 'details' | 'matches' | 'custody'

interface LostFoundItemDrawerProps {
  item: LostFoundItem
  capabilities: LostFoundClaimCapabilities
  onClose: () => void
  onItemUpdated: (item: LostFoundItem) => void
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{label}</p>
      {children}
    </section>
  )
}

function DetailRow({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <span className="flex items-center gap-1.5 text-xs text-ink3">{icon}{label}</span>
      <span className="max-w-[62%] text-right text-sm font-medium leading-snug text-ink">{children}</span>
    </div>
  )
}

function ItemMatchesPanel({ itemId }: { itemId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['lost-found-item-matches', itemId],
    queryFn: () => lostFoundApi.listItemMatches(itemId),
    select: (response) => response.data,
  })
  if (isLoading) return <p className="py-6 text-sm text-ink3">Loading possible guest claims…</p>
  if (isError) return <Button variant="outline" size="sm" onClick={() => refetch()}>Retry matches</Button>
  if (!data) return null
  return <div className="space-y-5">
    {data.confirmed_claim && <section className="rounded-xl border border-ready-line bg-ready-soft p-4"><p className="text-xs font-semibold uppercase tracking-[.08em] text-ready">Matched guest</p><p className="mt-2 text-sm font-semibold text-ink">{data.confirmed_claim.guest_name}</p><p className="mt-1 text-sm text-ink2">{data.confirmed_claim.claim_code}{data.confirmed_claim.rooms?.room_number || data.confirmed_claim.room_number ? ` · Room ${data.confirmed_claim.rooms?.room_number ?? data.confirmed_claim.room_number}` : ''}</p><p className="mt-2 text-xs text-ink3">Verified {formatLostFoundDateTime(data.confirmed_claim.matched_at)}</p><a href={`/lost-found?view=claims&claim=${data.confirmed_claim.id}`} className="mt-3 inline-block text-sm font-medium text-accent hover:underline">Open claim</a></section>}
    <section><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink3">Possible guest claims</p>{!data.possible_claims.length ? <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-sm text-ink3">No useful guest claim matches yet.</p> : <div className="mt-3 space-y-3">{data.possible_claims.map((candidate: LostFoundItemMatchCandidate) => <article key={candidate.claim.id} className="rounded-xl border border-line p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink">{candidate.claim.guest_name}</p><p className="mt-1 text-xs text-ink3">{candidate.claim.claim_code} · {candidate.claim.description}</p></div><Pill tone={candidate.score >= 70 ? 'ready' : 'info'} size="sm">{candidate.score}% possible match</Pill></div><a href={`/lost-found?view=claims&claim=${candidate.claim.id}`} className="mt-3 inline-block text-sm font-medium text-accent hover:underline">Review claim</a></article>)}</div>}</section>
  </div>
}

export function LostFoundItemDrawer({ item, capabilities, onClose, onItemUpdated }: LostFoundItemDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null!)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<DrawerTab>('details')
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [showRelease, setShowRelease] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [showDispositionReview, setShowDispositionReview] = useState(false)
  const [showVoidDialog, setShowVoidDialog] = useState(false)
  const [openReturnId, setOpenReturnId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    description: item.description,
    location_found: item.location_found ?? '',
    notes: item.notes ?? '',
  })
  const [releaseForm, setReleaseForm] = useState({ recipient_name: '', verification_method: '' })
  const [moveForm, setMoveForm] = useState({ area: '', shelf: '', note: '' })

  useModalFocusTrap(drawerRef, true, onClose)

  const canManage = capabilities.canEditFoundItem ?? false
  const derivedStatus = itemDerivedStatus(item)

  const returnsForItem = useQuery({
    queryKey: ['lost-found-item-return', item.id],
    queryFn: () => lostFoundApi.listReturns({ item_id: item.id, per_page: 5 }),
    select: (response) => response.data,
    enabled: Boolean(item.has_confirmed_match || item.has_active_return || derivedStatus === 'returned'),
  })
  const relevantReturn = returnsForItem.data?.[0] ?? null

  const invalidate = () => invalidateLostFound(queryClient)

  const updateMutation = useMutation({
    mutationFn: () => lostFoundApi.updateItem(item.id, {
      description: editForm.description.trim(),
      location_found: editForm.location_found.trim() || undefined,
      notes: editForm.notes.trim() || undefined,
    }),
    onSuccess: (response) => {
      const updated = { ...item, ...response.data }
      onItemUpdated(updated)
      setIsEditing(false)
      invalidate()
      toast.success('Item updated')
    },
    onError: (error: Error) => toast.error(error.message || 'Could not update item'),
  })

  const releaseMutation = useMutation({
    mutationFn: () => lostFoundApi.recordCustodyEvent(item.id, {
      event_type: 'released',
      recipient_name: releaseForm.recipient_name.trim(),
      verification_method: releaseForm.verification_method.trim(),
    }),
    onSuccess: () => {
      onItemUpdated({ ...item, status: 'claimed', derived_status: 'returned', claimed_by_name: releaseForm.recipient_name.trim() })
      setShowRelease(false)
      setReleaseForm({ recipient_name: '', verification_method: '' })
      invalidate()
      toast.success('Item released')
    },
    onError: (error: Error) => toast.error(error.message || 'Could not release item'),
  })

  const moveMutation = useMutation({
    mutationFn: () => lostFoundApi.recordCustodyEvent(item.id, {
      event_type: 'moved',
      storage_location: moveForm.shelf.trim() ? `${moveForm.area} · ${moveForm.shelf.trim()}` : moveForm.area,
      note: moveForm.note.trim() || undefined,
    }),
    onSuccess: () => {
      const storage_location = moveForm.shelf.trim() ? `${moveForm.area} · ${moveForm.shelf.trim()}` : moveForm.area
      onItemUpdated({ ...item, storage_location })
      setShowMove(false); setMoveForm({ area: '', shelf: '', note: '' }); invalidate(); toast.success('Item moved')
    },
    onError: (error: Error) => toast.error(error.message || 'Could not record this move'),
  })

  const prepareReturn = useMutation({
    mutationFn: () => lostFoundApi.prepareReturn(item.id),
    onSuccess: ({ data }) => { invalidate(); setOpenReturnId(data.id); toast.success('Return started') },
    onError: (error: Error) => toast.error(error.message || 'Could not start a return for this item'),
  })

  const isDue = isDispositionDue(item)
  const canRelease = canReleaseItem(item, canManage)
  const canDisposition = canDispositionItem(item, capabilities.canApproveDisposition ?? false)
  const canMove = canMoveItem(item, canManage)
  const canPrepareReturn = (capabilities.canPrepareReturn ?? false) && item.has_confirmed_match && !item.has_active_return && derivedStatus === 'matched'
  const detailsTabId = `lost-found-details-${item.id}`
  const matchesTabId = `lost-found-matches-${item.id}`
  const custodyTabId = `lost-found-custody-${item.id}`

  const drawer = (
    <div className="fixed inset-0 z-drawer" role="presentation">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`lost-found-title-${item.id}`}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col border-l border-line bg-surface shadow-2xl outline-none"
      >
        <header className="shrink-0 border-b border-line px-5 py-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 id={`lost-found-title-${item.id}`} className="truncate text-base font-semibold leading-snug text-ink">{item.description}</h2>
              {item.tag_identifier && <p className="mt-1 font-mono text-xs text-ink3">{item.tag_identifier}</p>}
            </div>
            <div className="relative flex shrink-0 gap-0.5">
              {(canManage || capabilities.canVoidRecord) && (
                <IconButton variant="ghost" size="sm" aria-label="More item actions" onClick={() => setMenuOpen((open) => !open)}>
                  <MoreVertical size={18} />
                </IconButton>
              )}
              <IconButton variant="ghost" size="sm" aria-label="Close item details" onClick={onClose}><X size={18} /></IconButton>
              {menuOpen && (
                <div className="absolute right-9 top-9 z-10 w-44 rounded-lg border border-line bg-surface py-1 shadow-pop">
                  {canManage && <button type="button" onClick={() => { setMenuOpen(false); setTab('details'); setIsEditing(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink2 hover:bg-surface-2"><Pencil size={14} /> Edit item</button>}
                  {capabilities.canVoidRecord && (derivedStatus === 'held' || derivedStatus === 'due_for_disposition') && <button type="button" onClick={() => { setMenuOpen(false); setShowVoidDialog(true) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-alert hover:bg-alert-soft"><Ban size={14} /> Void Record</button>}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone={LOST_FOUND_DERIVED_STATUS_TONE[derivedStatus]} size="sm">{LOST_FOUND_DERIVED_STATUS_LABEL[derivedStatus]}</Pill>
            <Pill tone={isDue ? 'caution' : 'neutral'} size="sm">{formatItemAge(item.created_at)} old</Pill>
          </div>
        </header>

        <div role="tablist" aria-label="Lost and found item details" className="flex shrink-0 gap-1 border-b border-line px-3 pt-1">
          {([['details', 'Details', detailsTabId], ['matches', 'Matches', matchesTabId], ['custody', 'Custody', custodyTabId]] as const).map(([key, label, panelId]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} aria-controls={panelId} onClick={() => setTab(key)} className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${tab === key ? 'border-b-2 border-accent text-ink' : 'text-ink3 hover:text-ink2'}`}>{label}</button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'details' && (
            <div id={detailsTabId} role="tabpanel" aria-label="Details" className="space-y-6">
              {isEditing ? (
                <form onSubmit={(event) => { event.preventDefault(); updateMutation.mutate() }} className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
                  <p className="text-sm font-semibold text-ink">Edit item</p>
                  <label className="block text-xs font-medium text-ink2">Description<textarea required value={editForm.description} onChange={(event) => setEditForm((form) => ({ ...form, description: event.target.value }))} rows={3} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/30" /></label>
                  <label className="block text-xs font-medium text-ink2">Found location<input value={editForm.location_found} onChange={(event) => setEditForm((form) => ({ ...form, location_found: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/30" /></label>
                  <label className="block text-xs font-medium text-ink2">Notes<textarea value={editForm.notes} onChange={(event) => setEditForm((form) => ({ ...form, notes: event.target.value }))} rows={3} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/30" /></label>
                  <div className="flex gap-2"><Button type="submit" size="sm" loading={updateMutation.isPending} disabled={!editForm.description.trim()}>Save changes</Button><Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)}>Cancel</Button></div>
                </form>
              ) : (
                <>
                  <DetailSection label="Photo">
                    {item.photo_url ? <a href={item.photo_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line"><img src={item.photo_url} alt={`Photo of ${item.description}`} className="h-52 w-full object-cover" /></a> : <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-line bg-surface-2 text-ink3"><ImageIcon size={22} /><span className="ml-2 text-sm">No photo recorded</span></div>}
                  </DetailSection>
                  <DetailSection label="Item"><div className="rounded-xl border border-line bg-surface-2 px-4"><DetailRow label="Description">{item.description}</DetailRow><DetailRow icon={<Tag size={13} />} label="Tag">{item.tag_identifier || 'Not recorded'}</DetailRow><DetailRow label="Status"><Pill tone={LOST_FOUND_DERIVED_STATUS_TONE[derivedStatus]} size="sm">{LOST_FOUND_DERIVED_STATUS_LABEL[derivedStatus]}</Pill></DetailRow></div></DetailSection>
                  <DetailSection label="Found"><div className="rounded-xl border border-line bg-surface-2 px-4"><DetailRow icon={<MapPin size={13} />} label="Location">{itemFoundLocation(item)}</DetailRow><DetailRow icon={<Clock size={13} />} label="Logged">{formatLostFoundDateTime(item.created_at)}</DetailRow><DetailRow icon={<User size={13} />} label="Found by">{itemFinderName(item)}</DetailRow></div></DetailSection>
                  <DetailSection label="Storage"><div className="rounded-xl border border-line bg-surface-2 px-4"><DetailRow icon={<Archive size={13} />} label="Location">{item.storage_location || 'Not recorded'}</DetailRow></div></DetailSection>
                  {(derivedStatus === 'held' || derivedStatus === 'due_for_disposition') && <DetailSection label="Retention"><div className="rounded-xl border border-line bg-surface-2 px-4"><DetailRow label="Property retention deadline">{formatLostFoundDate(item.retention_due_at)}</DetailRow><DetailRow label="State">{isDue ? <span className="text-caution">Due for disposition</span> : item.retention_due_at ? formatTimeUntil(item.retention_due_at) : 'Not set'}</DetailRow></div></DetailSection>}
                  {item.notes && <DetailSection label="Notes"><p className="rounded-xl border border-line bg-surface-2 p-4 text-sm leading-relaxed text-ink2">{item.notes}</p></DetailSection>}

                  {(item.has_confirmed_match || item.has_active_return || derivedStatus === 'returned') && (
                    <DetailSection label="Return">
                      <div className="rounded-xl border border-line bg-surface-2 p-4">
                        {relevantReturn ? (
                          <>
                            <p className="flex items-center gap-1.5 text-sm font-medium text-ink">{relevantReturn.method === 'shipping' ? <Truck size={14} /> : <Package size={14} />}{relevantReturn.method === 'shipping' ? 'Shipping' : relevantReturn.method === 'pickup' ? 'Pickup' : 'Other'} · {relevantReturn.status.replaceAll('_', ' ')}</p>
                            <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpenReturnId(relevantReturn.id)}>{derivedStatus === 'returned' ? 'View Return' : 'Open Return'}</Button>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-ink2">No return started yet.</p>
                            {canPrepareReturn && <Button size="sm" className="mt-3" loading={prepareReturn.isPending} onClick={() => prepareReturn.mutate()}>Prepare Return</Button>}
                          </>
                        )}
                      </div>
                    </DetailSection>
                  )}

                  {derivedStatus === 'voided' && <DetailSection label="Void"><div className="rounded-xl border border-alert-line bg-alert-soft px-4"><DetailRow label="Voided">{formatLostFoundDateTime(item.voided_at)}</DetailRow><DetailRow label="Reason">{item.void_reason || 'Not recorded'}</DetailRow></div></DetailSection>}
                </>
              )}

              {showMove && (
                <form onSubmit={(event) => { event.preventDefault(); moveMutation.mutate() }} className="rounded-xl border border-line bg-surface-2 p-4 space-y-3" role="dialog" aria-label="Move item">
                  <p className="text-sm font-semibold text-ink">Move item</p><p className="text-xs text-ink3">Current location: {item.storage_location || 'Not recorded'}</p>
                  <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-ink2">Storage area<select required value={moveForm.area} onChange={(event) => setMoveForm((form) => ({ ...form, area: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><option value="">Choose storage</option>{['Lost & Found Room', 'Front Desk', 'Front Desk — Temporary', 'Manager Office', 'Security', 'Safe', 'Housekeeping Office', 'Other'].map((area) => <option key={area}>{area}</option>)}</select></label><label className="text-xs font-medium text-ink2">Shelf / bin<input value={moveForm.shelf} onChange={(event) => setMoveForm((form) => ({ ...form, shelf: event.target.value }))} placeholder="e.g. Safe #2" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label></div>
                  <label className="block text-xs font-medium text-ink2">Reason / note<textarea value={moveForm.note} onChange={(event) => setMoveForm((form) => ({ ...form, note: event.target.value }))} rows={2} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label><p className="text-xs text-ink3">This movement will be added to custody history.</p><div className="flex gap-2"><Button type="submit" size="sm" loading={moveMutation.isPending} disabled={!moveForm.area}>Record move</Button><Button type="button" variant="outline" size="sm" onClick={() => setShowMove(false)}>Cancel</Button></div>
                </form>
              )}
              {showRelease && (
                <form onSubmit={(event) => { event.preventDefault(); releaseMutation.mutate() }} className="rounded-xl border border-ready-line bg-ready-soft p-4 space-y-3">
                  <p className="text-sm font-semibold text-ready">Release item</p><p className="text-xs text-ink3">Record who received the item and how their identity was verified.</p>
                  <label className="block text-xs font-medium text-ink2">Recipient name<input required value={releaseForm.recipient_name} onChange={(event) => setReleaseForm((form) => ({ ...form, recipient_name: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ready/30" /></label>
                  <label className="block text-xs font-medium text-ink2">Verification method<input required value={releaseForm.verification_method} onChange={(event) => setReleaseForm((form) => ({ ...form, verification_method: event.target.value }))} placeholder="e.g. photo ID" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ready/30" /></label>
                  <div className="flex gap-2"><Button type="submit" size="sm" loading={releaseMutation.isPending} disabled={!releaseForm.recipient_name.trim() || !releaseForm.verification_method.trim()}><CheckCircle2 size={14} /> Confirm release</Button><Button type="button" variant="outline" size="sm" onClick={() => setShowRelease(false)}>Cancel</Button></div>
                </form>
              )}
            </div>
          )}
          {tab === 'matches' && <div id={matchesTabId} role="tabpanel" aria-label="Matches"><ItemMatchesPanel itemId={item.id} /></div>}
          {tab === 'custody' && <div id={custodyTabId} role="tabpanel" aria-label="Custody"><CustodyTimeline itemId={item.id} voidInfo={item} /></div>}
        </div>

        {(canMove || canRelease || canDisposition) && !isEditing && !showRelease && !showMove && (
          <footer className="flex shrink-0 gap-2 border-t border-line bg-surface px-5 py-3">
            {canMove && <Button variant="outline" className="flex-1" onClick={() => { setTab('details'); setShowMove(true) }}>Move item</Button>}
            {canRelease && <Button className="flex-1" onClick={() => { setTab('details'); setShowRelease(true) }}><CheckCircle2 size={15} /> Release item</Button>}
            {canDisposition && <Button variant={isDue ? 'primary' : 'outline'} className="flex-1" onClick={() => { setTab('details'); setShowDispositionReview(true) }}>Disposition</Button>}
          </footer>
        )}
      </div>
    </div>
  )

  return <>
    {createPortal(drawer, document.body)}
    {showDispositionReview && <DispositionReviewDrawer item={item} onClose={() => setShowDispositionReview(false)} onApproved={(updated) => { onItemUpdated(updated); setShowDispositionReview(false); invalidate() }} />}
    {showVoidDialog && <VoidRecordDialog item={item} onClose={() => setShowVoidDialog(false)} onVoided={(updated) => { onItemUpdated(updated); setShowVoidDialog(false); invalidate() }} />}
    {openReturnId && <LostFoundReturnDrawer returnId={openReturnId} onClose={() => { setOpenReturnId(null); invalidate() }} />}
  </>
}
