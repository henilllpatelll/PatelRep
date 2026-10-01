'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ShieldCheck } from 'lucide-react'
import { Pill } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { lostFoundApi, type LostFoundItem } from '@/lib/api/lost_found'
import { formatItemAge, formatLostFoundDate, itemFoundLocation } from '@/lib/utils/lostFoundInventory'
import { DispositionReviewDrawer } from '@/components/lost-found/DispositionReviewDrawer'
import { cn } from '@/lib/utils'

type Bucket = 'due_now' | 'due_soon' | 'completed'

function retentionLabel(item: LostFoundItem, now: Date): { text: string; overdue: boolean } {
  if (!item.retention_due_at) return { text: 'Not set', overdue: false }
  const due = new Date(item.retention_due_at)
  const days = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true }
  return { text: `${days}d left`, overdue: false }
}

export function DispositionWorkspace({ initialItemId, canApprove }: { initialItemId: string | null; canApprove: boolean }) {
  const [bucket, setBucket] = useState<Bucket>('due_now')
  const [search, setSearch] = useState('')
  const [reviewing, setReviewing] = useState<LostFoundItem | null>(null)
  const [openedInitial, setOpenedInitial] = useState(false)

  const summary = useQuery({ queryKey: ['lost-found-disposition-summary'], queryFn: lostFoundApi.dispositionSummary, select: (r) => r.data })
  const params = useMemo(() => ({ bucket, search: search.trim() || undefined, per_page: 100 }), [bucket, search])
  const queue = useQuery({ queryKey: ['lost-found-disposition', params], queryFn: () => lostFoundApi.listDisposition(params), select: (r) => r.data })

  if (initialItemId && !openedInitial && queue.data) {
    const match = queue.data.find((item) => item.id === initialItemId)
    if (match) { setReviewing(match); setOpenedInitial(true) }
  }

  const now = new Date()

  return <section aria-labelledby="disposition-heading">
    <div className="mb-4"><h2 id="disposition-heading" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Disposition Review</h2><p className="mt-1 text-sm text-ink3">Review items at or beyond their retention deadline.</p></div>
    <div className="mb-5 flex w-full divide-x divide-line overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface sm:w-fit">
      <div className="min-w-[130px] px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink3">Due now</p><p className="mt-1 font-display text-[30px] leading-none tabular-nums text-caution">{summary.data?.due_now ?? '–'}</p></div>
      <div className="min-w-[130px] px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink3">Due soon</p><p className="mt-1 font-display text-[30px] leading-none tabular-nums text-ink">{summary.data?.due_soon ?? '–'}</p></div>
      <div className="min-w-[130px] px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink3">Completed</p><p className="mt-1 font-display text-[30px] leading-none tabular-nums text-ink">{summary.data?.completed ?? '–'}</p></div>
    </div>
    <label className="relative mb-4 block max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, tag or location…" className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink" /></label>
    <div role="group" aria-label="Disposition buckets" className="mb-4 flex flex-wrap gap-1.5">
      {([['due_now', 'Due Now'], ['due_soon', 'Due Soon'], ['completed', 'Completed']] as const).map(([value, label]) => (
        <button key={value} type="button" aria-pressed={bucket === value} onClick={() => setBucket(value)} className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-medium', bucket === value ? 'border-accent-line bg-accent-soft text-accent' : 'border-line bg-surface text-ink3')}>{label}</button>
      ))}
    </div>
    {queue.isLoading ? <div className="rounded-xl border border-line p-8 text-sm text-ink3">Loading…</div>
      : queue.isError ? <StateBlock status="error" error={{ message: "Couldn't load the disposition queue", onRetry: () => queue.refetch() }} />
      : !queue.data?.length ? <StateBlock status="empty" empty={{ icon: <ShieldCheck size={20} />, title: bucket === 'completed' ? 'No completed dispositions in this period.' : 'Nothing needs disposition review', body: bucket === 'completed' ? '' : 'There are no items currently at or near their retention deadline.' }} />
      : <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-line bg-surface-2"><tr className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-ink3"><th className="px-4 py-3">Item</th><th className="px-3 py-3">Storage</th><th className="px-3 py-3">Found</th><th className="w-16 px-3 py-3">Age</th>{bucket === 'completed' ? <th className="px-4 py-3">Outcome</th> : <th className="px-4 py-3">Retention</th>}</tr></thead><tbody>
        {queue.data.map((item) => {
          const retention = retentionLabel(item, now)
          return <tr key={item.id} role="button" tabIndex={0} onClick={() => bucket !== 'completed' && setReviewing(item)} onKeyDown={(e) => { if (bucket !== 'completed' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setReviewing(item) } }} className={cn('border-b border-line last:border-0', bucket !== 'completed' && 'cursor-pointer hover:bg-surface-2')}>
            <td className="px-4 py-3"><p className="text-sm font-semibold text-ink">{item.description}</p><p className="font-mono text-xs text-ink3">{item.tag_identifier}</p></td>
            <td className="px-3 py-3 text-sm text-ink2">{item.storage_location || 'Not recorded'}</td>
            <td className="px-3 py-3 text-sm text-ink2">{itemFoundLocation(item)} · {formatLostFoundDate(item.found_at ?? item.created_at)}</td>
            <td className="px-3 py-3 font-mono text-xs text-ink3">{formatItemAge(item.found_at ?? item.created_at)}</td>
            <td className="px-4 py-3">{bucket === 'completed' ? <Pill tone={item.status === 'donated' ? 'ai' : 'neutral'} size="sm">{item.status === 'donated' ? 'Donated' : 'Discarded'}</Pill> : <Pill tone={retention.overdue ? 'alert' : 'caution'} size="sm">{retention.text}</Pill>}</td>
          </tr>
        })}
      </tbody></table></div>}
    {reviewing && canApprove && <DispositionReviewDrawer item={reviewing} onClose={() => { setReviewing(null); const url = new URL(window.location.href); url.searchParams.delete('item'); window.history.replaceState({}, '', url) }} onApproved={() => { setReviewing(null); const url = new URL(window.location.href); url.searchParams.delete('item'); window.history.replaceState({}, '', url) }} />}
  </section>
}
