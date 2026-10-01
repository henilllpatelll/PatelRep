'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Package, Search, Truck } from 'lucide-react'
import { Pill } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { lostFoundApi, type LostFoundReturnMethod, type LostFoundReturnStatus } from '@/lib/api/lost_found'
import {
  formatLostFoundDate,
  LOST_FOUND_CARRIER_LABEL,
  LOST_FOUND_RETURN_STATUS_LABEL,
  LOST_FOUND_RETURN_STATUS_TONE,
} from '@/lib/utils/lostFoundInventory'
import { LostFoundReturnDrawer } from '@/components/lost-found/LostFoundReturnDrawer'
import { cn } from '@/lib/utils'

const STATUS_TABS: Array<{ label: string; value: LostFoundReturnStatus | 'all' }> = [
  { label: 'Awaiting Return', value: 'awaiting_details' },
  { label: 'Pickup', value: 'ready_for_pickup' },
  { label: 'Shipping', value: 'shipping_preparation' },
  { label: 'Completed', value: 'completed' },
  { label: 'All', value: 'all' },
]

function Kpi({ label, value }: { label: string; value?: number }) {
  return <div className="min-w-[150px] px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink3">{label}</p><p className="mt-1 font-display text-[30px] leading-none tabular-nums text-ink">{value ?? '–'}</p></div>
}

export function ReturnsWorkspace({ initialReturnId }: { initialReturnId: string | null }) {
  const [status, setStatus] = useState<LostFoundReturnStatus | 'all'>('all')
  const [method, setMethod] = useState<LostFoundReturnMethod | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(initialReturnId)

  const summary = useQuery({ queryKey: ['lost-found-returns-summary'], queryFn: lostFoundApi.returnsSummary, select: (r) => r.data })
  const params = useMemo(() => ({ status: status === 'all' ? undefined : status, method: method === 'all' ? undefined : method, search: search.trim() || undefined, per_page: 100 }), [status, method, search])
  const returns = useQuery({ queryKey: ['lost-found-returns', params], queryFn: () => lostFoundApi.listReturns(params), select: (r) => r.data })

  return <section aria-labelledby="returns-heading">
    <div className="mb-4"><h2 id="returns-heading" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Returns</h2><p className="mt-1 text-sm text-ink3">Confirmed matches moving through pickup or shipping.</p></div>
    <div className="mb-5 flex w-full divide-x divide-line overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface sm:w-fit">
      <Kpi label="Awaiting return" value={summary.data?.awaiting_return} />
      <Kpi label="Ready for pickup" value={summary.data?.ready_for_pickup} />
      <Kpi label="Shipping" value={summary.data?.shipping} />
      <Kpi label="Completed this month" value={summary.data?.completed_this_month} />
    </div>
    <label className="relative mb-4 block max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guest, claim, item or tracking…" className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink" /></label>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Return status filters" className="flex flex-wrap gap-1.5">{STATUS_TABS.map((t) => <button key={t.value} type="button" aria-pressed={status === t.value} onClick={() => setStatus(t.value)} className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-medium', status === t.value ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-ink3')}>{t.label}</button>)}</div>
      <select value={method} onChange={(e) => setMethod(e.target.value as LostFoundReturnMethod | 'all')} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2"><option value="all">All methods</option><option value="pickup">Pickup</option><option value="shipping">Shipping</option><option value="other">Other</option></select>
    </div>
    {returns.isLoading ? <div className="rounded-xl border border-line p-8 text-sm text-ink3">Loading returns…</div>
      : returns.isError ? <StateBlock status="error" error={{ message: "Couldn't load returns", onRetry: () => returns.refetch() }} />
      : !returns.data?.length ? <StateBlock status="empty" empty={{ icon: <Package size={20} />, title: 'No returns in progress', body: 'Confirmed item matches will appear here when they’re ready to be returned.' }} />
      : <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-line bg-surface-2"><tr className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-ink3"><th className="px-4 py-3">Item</th><th className="px-3 py-3">Guest</th><th className="px-3 py-3">Method</th><th className="px-3 py-3">Status</th><th className="px-4 py-3">Updated</th></tr></thead><tbody>
        {returns.data.map((row) => <tr key={row.id} role="button" tabIndex={0} onClick={() => setSelected(row.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(row.id) } }} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
          <td className="px-4 py-3"><p className="text-sm font-semibold text-ink">{row.lost_found_items?.description ?? 'Found item'}</p><p className="font-mono text-xs text-ink3">{row.lost_found_items?.tag_identifier}</p></td>
          <td className="px-3 py-3"><p className="text-sm text-ink">{row.lost_found_claims?.guest_name}</p><p className="font-mono text-xs text-ink3">{row.lost_found_claims?.claim_number ? `CL-${String(row.lost_found_claims.claim_number).padStart(4, '0')}` : ''}</p></td>
          <td className="px-3 py-3 text-sm text-ink2"><span className="inline-flex items-center gap-1.5">{row.method === 'shipping' ? <Truck size={13} /> : <Package size={13} />}{row.method === 'shipping' && row.carrier ? LOST_FOUND_CARRIER_LABEL[row.carrier] : row.method}</span></td>
          <td className="px-3 py-3"><Pill tone={LOST_FOUND_RETURN_STATUS_TONE[row.status]} size="sm">{LOST_FOUND_RETURN_STATUS_LABEL[row.status]}</Pill></td>
          <td className="px-4 py-3 text-sm text-ink3">{formatLostFoundDate(row.updated_at ?? row.created_at)}</td>
        </tr>)}
      </tbody></table></div>}
    {selected && <LostFoundReturnDrawer returnId={selected} onClose={() => { setSelected(null); const url = new URL(window.location.href); url.searchParams.delete('return'); window.history.replaceState({}, '', url) }} />}
  </section>
}
