'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ImageIcon, Package, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { PageHeader } from '@/components/shared/PageHeader'
import { StateBlock } from '@/components/ui/StateBlock'
import { LogFoundItemDrawer } from '@/components/lost-found/LogFoundItemDrawer'
import { LostFoundItemDrawer } from '@/components/lost-found/LostFoundItemDrawer'
import { GuestClaimDrawer } from '@/components/lost-found/GuestClaimDrawer'
import { GuestClaimsWorkspace } from '@/components/lost-found/GuestClaimsWorkspace'
import { ReturnsWorkspace } from '@/components/lost-found/ReturnsWorkspace'
import { DispositionWorkspace } from '@/components/lost-found/DispositionWorkspace'
import { isDispositionDue, lostFoundApi, type LostFoundCategory, type LostFoundClaimCapabilities, type LostFoundItem, type LostFoundStatus } from '@/lib/api/lost_found'
import { formatItemAge, formatLostFoundDate, invalidateLostFound, itemDerivedStatus, itemFinderName, itemFoundLocation, LOST_FOUND_DERIVED_STATUS_LABEL, LOST_FOUND_DERIVED_STATUS_TONE } from '@/lib/utils/lostFoundInventory'
import { cn } from '@/lib/utils'

const DEFAULT_CAPABILITIES: LostFoundClaimCapabilities = {
  canViewClaims: false, canCreateClaim: false, canEditClaim: false,
  canReviewMatch: false, canConfirmMatch: false, canCancelClaim: false,
}

const STATUS_FILTERS: Array<{ label: string; value: LostFoundStatus | 'all' }> = [
  { label: 'Held', value: 'unclaimed' }, { label: 'Returned', value: 'claimed' }, { label: 'Donated', value: 'donated' }, { label: 'Discarded', value: 'discarded' }, { label: 'All', value: 'all' },
]
const CATEGORIES: Array<{ label: string; value: LostFoundCategory | 'all' }> = [
  { label: 'All categories', value: 'all' }, { label: 'Electronics', value: 'electronics' }, { label: 'Clothing', value: 'clothing' }, { label: 'Jewelry', value: 'jewelry' }, { label: 'Bags & luggage', value: 'bags_luggage' }, { label: 'Keys', value: 'keys' }, { label: 'Wallets & cards', value: 'wallets_cards' }, { label: 'Documents', value: 'documents' }, { label: 'Medical', value: 'medical' }, { label: 'Other', value: 'other' },
]

function Thumbnail({ item }: { item: LostFoundItem }) {
  return item.photo_url ? <img src={item.photo_url} alt={`Photo of ${item.description}`} className="h-9 w-9 rounded-lg border border-line object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink3"><ImageIcon size={16} /></span>
}

export default function LostFoundPage() {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const capabilityQuery = useQuery({ queryKey: ['lost-found-capabilities'], queryFn: lostFoundApi.getCapabilities, select: (response) => response.data })
  const canManage = capabilityQuery.data?.canLogFoundItem ?? capabilityQuery.data?.canCreateClaim ?? false
  const capabilities = capabilityQuery.data ?? DEFAULT_CAPABILITIES
  const initialView = searchParams.get('view')
  const [workspace, setWorkspace] = useState<'inventory' | 'claims' | 'returns' | 'disposition'>(
    initialView === 'claims' || initialView === 'returns' || initialView === 'disposition' ? initialView : 'inventory',
  )
  const [status, setStatus] = useState<LostFoundStatus | 'all'>('unclaimed')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState<LostFoundCategory | 'all'>('all')
  const [storage, setStorage] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dispositionDueOnly, setDispositionDueOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showIntake, setShowIntake] = useState(false)
  const [showClaimDrawer, setShowClaimDrawer] = useState(false)
  const [selectedItem, setSelectedItem] = useState<LostFoundItem | null>(null)
  const deepLinkId = searchParams.get('item')
  const deepLinkClaimId = searchParams.get('claim')
  const deepLinkReturnId = searchParams.get('return')

  useEffect(() => { const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => window.clearTimeout(timeout) }, [search])
  const params = useMemo(() => ({ per_page: 100, status: status === 'all' ? undefined : status, search: debouncedSearch || undefined, category: category === 'all' ? undefined : category, storage: storage || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, disposition_due: dispositionDueOnly || undefined }), [status, debouncedSearch, category, storage, dateFrom, dateTo, dispositionDueOnly])
  const inventoryQuery = useQuery({ queryKey: ['lost-found', 'inventory', params], queryFn: () => lostFoundApi.listItems(params), select: (response) => response.data, refetchInterval: 60_000 })
  const summaryQuery = useQuery({ queryKey: ['lost-found', 'summary'], queryFn: () => lostFoundApi.listItems({ per_page: 100 }), select: (response) => response.data, refetchInterval: 60_000 })
  const claimsSummaryQuery = useQuery({ queryKey: ['lost-found-claims-summary'], queryFn: lostFoundApi.claimSummary, select: (response) => response.data, enabled: capabilities.canViewClaims })
  const returnsSummaryQuery = useQuery({ queryKey: ['lost-found-returns-summary'], queryFn: lostFoundApi.returnsSummary, select: (response) => response.data })
  const dispositionSummaryQuery = useQuery({ queryKey: ['lost-found-disposition-summary'], queryFn: lostFoundApi.dispositionSummary, select: (response) => response.data })
  const deepLinkQuery = useQuery({ queryKey: ['lost-found', 'item', deepLinkId], queryFn: () => lostFoundApi.getItem(deepLinkId!), enabled: Boolean(deepLinkId), retry: false })
  const deepLinkClaimQuery = useQuery({ queryKey: ['lost-found-claim', deepLinkClaimId], queryFn: () => lostFoundApi.getClaim(deepLinkClaimId!), enabled: Boolean(deepLinkClaimId) && workspace === 'claims', retry: false })
  useEffect(() => { if (deepLinkQuery.data?.data) setSelectedItem(deepLinkQuery.data.data) }, [deepLinkQuery.data])

  const items = inventoryQuery.data ?? []
  const summary = summaryQuery.data ?? []
  const held = summary.filter((item) => item.status === 'unclaimed').length
  const due = summary.filter((item) => isDispositionDue(item)).length
  const filtersActive = Boolean(category !== 'all' || storage || dateFrom || dateTo || dispositionDueOnly)
  const invalidate = () => invalidateLostFound(queryClient)
  const clear = () => { setStatus('unclaimed'); setSearch(''); setDebouncedSearch(''); setCategory('all'); setStorage(''); setDateFrom(''); setDateTo(''); setDispositionDueOnly(false); setFiltersOpen(false) }
  const closeItem = () => { setSelectedItem(null); if (deepLinkId) { const url = new URL(window.location.href); url.searchParams.delete('item'); window.history.replaceState({}, '', url) } }

  const switchWorkspace = (next: 'inventory' | 'claims' | 'returns' | 'disposition') => { setWorkspace(next); const url = new URL(window.location.href); url.searchParams.set('view', next); window.history.replaceState({}, '', url) }
  const returnsSummary = returnsSummaryQuery.data
  const tabCounts: Record<'inventory' | 'claims' | 'returns' | 'disposition', number | undefined> = {
    inventory: held,
    claims: capabilities.canViewClaims ? claimsSummaryQuery.data?.open : undefined,
    returns: returnsSummary ? returnsSummary.awaiting_return + returnsSummary.ready_for_pickup + returnsSummary.shipping : undefined,
    disposition: dispositionSummaryQuery.data?.due_now,
  }
  return <div className="space-y-6">
    <PageHeader eyebrow="Operations" title="Lost & Found" subtitle="Track, match, store and return guest property" actions={canManage && <div className="flex gap-2"><Button variant="outline" onClick={() => setShowClaimDrawer(true)}><Plus size={16} /> Guest Claim</Button><Button variant="primary" onClick={() => setShowIntake(true)}><Plus size={16} /> Log Found Item</Button></div>} />
    <nav aria-label="Lost and found workspace" className="flex gap-1 border-b border-line">
      {([['inventory', 'Inventory'], ['claims', 'Guest Claims'], ['returns', 'Returns'], ['disposition', 'Disposition']] as const).map(([value, label]) => (
        <button key={value} type="button" aria-current={workspace === value ? 'page' : undefined} onClick={() => switchWorkspace(value)} className={cn('px-3 py-2 text-sm font-medium', workspace === value ? 'border-b-2 border-accent text-ink' : 'text-ink3')}>{label}{tabCounts[value] !== undefined && <span className="ml-1.5 text-ink3">{tabCounts[value]}</span>}</button>
      ))}
    </nav>
    {workspace === 'inventory' && <>
    <section aria-label="Lost and found summary" className="flex w-full divide-x divide-line overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface sm:w-fit"><div className="min-w-[154px] px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Items held</p><p className="mt-1 font-display text-[30px] leading-none tabular-nums text-ink">{held}</p></div><div className="min-w-[190px] px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Due for disposition</p><p className={cn('mt-1 font-display text-[30px] leading-none tabular-nums', due ? 'text-caution' : 'text-ink')}>{due}</p></div></section>
    <section aria-labelledby="inventory-heading"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="inventory-heading" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Inventory</h2><div className="flex w-full flex-wrap gap-2 sm:w-auto"><label className="relative flex-1 sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items, tags, or storage…" aria-label="Search items, tags, or storage" className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/30" /></label><div className="relative"><Button variant="outline" size="sm" aria-expanded={filtersOpen} aria-controls="lost-found-filters" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={15} /> Filters{filtersActive && ' · Active'}</Button>{filtersOpen && <div id="lost-found-filters" className="absolute right-0 z-20 mt-2 w-[300px] rounded-xl border border-line bg-surface p-4 shadow-pop"><p className="text-sm font-semibold text-ink">Filters</p><label className="mt-3 block text-xs font-medium text-ink2">Category<select value={category} onChange={(event) => setCategory(event.target.value as LostFoundCategory | 'all')} className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink">{CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="mt-3 block text-xs font-medium text-ink2">Storage contains<input value={storage} onChange={(event) => setStorage(event.target.value)} placeholder="e.g. Safe" className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink" /></label><label className="mt-3 block text-xs font-medium text-ink2">Found from<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink" /></label><label className="mt-3 block text-xs font-medium text-ink2">Found through<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink" /></label><label className="mt-3 flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={dispositionDueOnly} onChange={(event) => setDispositionDueOnly(event.target.checked)} /> Due for disposition</label>{filtersActive && <button type="button" className="mt-3 text-xs font-medium text-accent hover:underline" onClick={clear}>Clear filters</button>}</div>}</div></div></div><div role="group" aria-label="Status filters" className="mb-4 flex flex-wrap gap-1.5">{STATUS_FILTERS.map((filter) => <button key={filter.value} type="button" aria-pressed={status === filter.value} onClick={() => setStatus(filter.value)} className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30', status === filter.value ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-ink3 hover:bg-surface-2')}>{filter.label}</button>)}</div>
      {inventoryQuery.isLoading || summaryQuery.isLoading ? <div className="rounded-[var(--r-lg)] border border-line bg-surface p-8 text-sm text-ink3">Loading inventory…</div> : inventoryQuery.isError || summaryQuery.isError ? <StateBlock status="error" error={{ message: "Couldn't load lost & found items", onRetry: () => { void inventoryQuery.refetch(); void summaryQuery.refetch() } }} /> : items.length === 0 ? <StateBlock status="empty" empty={{ icon: <Package size={20} />, title: summary.length === 0 ? 'No items currently held' : 'No matching items', body: summary.length === 0 ? 'Found items logged by staff will appear here.' : 'No items match the current search and filters.', action: summary.length === 0 && canManage ? <Button size="sm" onClick={() => setShowIntake(true)}><Plus size={14} /> Log Found Item</Button> : <Button variant="outline" size="sm" onClick={clear}>Clear filters</Button>, className: 'border border-line rounded-[var(--r-lg)] bg-surface py-16' }} /> : <div className="overflow-x-auto rounded-[var(--r-lg)] border border-line bg-surface"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-line bg-surface-2"><tr className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3"><th className="w-14 px-4 py-3">Photo</th><th className="px-3 py-3">Item</th><th className="px-3 py-3">Found</th><th className="px-3 py-3">Stored</th><th className="w-16 px-3 py-3">Age</th><th className="w-28 px-4 py-3">Status</th></tr></thead><tbody>{items.map((item) => { return <tr key={item.id} tabIndex={0} role="button" aria-label={`Open ${item.description}`} onClick={() => setSelectedItem(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedItem(item) } }} className="cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"><td className="px-4 py-3"><Thumbnail item={item} /></td><td className="px-3 py-3"><p className="max-w-[240px] truncate text-sm font-semibold text-ink">{item.description}</p><p className="mt-0.5 text-xs text-ink3">{[item.tag_identifier, item.category?.replace('_', ' ')].filter(Boolean).join(' · ')}</p></td><td className="px-3 py-3"><p className="text-sm text-ink2">{itemFoundLocation(item)}</p><p className="mt-0.5 text-xs text-ink3">{formatLostFoundDate(item.found_at ?? item.created_at)} · {itemFinderName(item)}</p></td><td className="px-3 py-3 text-sm text-ink2">{item.storage_location || 'Not recorded'}</td><td className="px-3 py-3 font-mono text-xs text-ink3">{formatItemAge(item.found_at ?? item.created_at)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1"><Pill tone={LOST_FOUND_DERIVED_STATUS_TONE[itemDerivedStatus(item)]} size="sm">{LOST_FOUND_DERIVED_STATUS_LABEL[itemDerivedStatus(item)]}</Pill>{item.classification === 'high_value' && <Pill tone="caution" size="sm">High value</Pill>}{item.classification === 'sensitive' && <Pill tone="alert" size="sm">Sensitive</Pill>}</div></td></tr> })}</tbody></table></div>}
    </section>
    </>}
    {workspace === 'claims' && <GuestClaimsWorkspace capabilities={capabilities} initialClaim={deepLinkClaimQuery.data?.data ?? null} onNewClaim={() => setShowClaimDrawer(true)} />}
    {workspace === 'returns' && <ReturnsWorkspace initialReturnId={deepLinkReturnId} />}
    {workspace === 'disposition' && <DispositionWorkspace initialItemId={deepLinkId} canApprove={capabilities.canApproveDisposition ?? false} />}
    <LogFoundItemDrawer isOpen={showIntake} onClose={() => setShowIntake(false)} onCreated={(item) => { setShowIntake(false); invalidate(); setSelectedItem(item) }} />
    <GuestClaimDrawer isOpen={showClaimDrawer} onClose={() => setShowClaimDrawer(false)} onCreated={() => { setShowClaimDrawer(false); invalidate(); switchWorkspace('claims') }} />
    {selectedItem && workspace === 'inventory' && <LostFoundItemDrawer key={selectedItem.id} item={selectedItem} capabilities={capabilities} onClose={closeItem} onItemUpdated={setSelectedItem} />}
  </div>
}
