'use client'

import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { lostFoundApi, type LostFoundCustodyEvent, type LostFoundItem } from '@/lib/api/lost_found'
import { formatLostFoundDateTime, LOST_FOUND_STATUS_LABEL } from '@/lib/utils/lostFoundInventory'

const CUSTODY_EVENT_LABEL: Record<LostFoundCustodyEvent['event_type'], string> = {
  intake: 'Logged & stored',
  moved: 'Moved',
  released: 'Released',
  disposition: 'Disposition approved',
}

/** Shared across the Item Detail Drawer and the Return Detail Drawer's Custody/Activity
 * tabs (D-21/D-51) so physical-custody history is defined exactly once. */
export function CustodyTimeline({ itemId, voidInfo }: { itemId: string; voidInfo?: Pick<LostFoundItem, 'voided_at' | 'void_reason'> }) {
  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['lost-found-custody', itemId],
    queryFn: () => lostFoundApi.listCustodyEvents(itemId),
    select: (response) => response.data,
  })

  if (isLoading) return <p className="py-6 text-sm text-ink3">Loading custody history…</p>
  if (isError) return <Button variant="outline" size="sm" onClick={() => refetch()}>Retry custody history</Button>

  const items = [...events]
  const rows: Array<{ key: string; label: string; at: string; body?: React.ReactNode }> = items.map((event) => ({
    key: event.id,
    label: CUSTODY_EVENT_LABEL[event.event_type],
    at: event.created_at,
    body: (
      <>
        {event.previous_storage_location && event.storage_location ? <p className="mt-1 text-sm text-ink2">{event.previous_storage_location} → {event.storage_location}</p> : event.storage_location && <p className="mt-1 text-sm text-ink2">Storage: {event.storage_location}</p>}
        {event.recipient_name && <p className="mt-1 text-sm text-ink2">Recipient: {event.recipient_name}</p>}
        {event.verification_method && <p className="mt-1 text-sm text-ink2">Verified by: {event.verification_method}</p>}
        {event.disposition && <p className="mt-1 text-sm text-ink2">Disposition: {LOST_FOUND_STATUS_LABEL[event.disposition]}</p>}
        {event.note && <p className="mt-1 text-sm italic text-ink3">{event.note}</p>}
      </>
    ),
  }))
  if (voidInfo?.voided_at) {
    rows.push({ key: 'voided', label: 'Voided', at: voidInfo.voided_at, body: voidInfo.void_reason && <p className="mt-1 text-sm italic text-ink3">{voidInfo.void_reason}</p> })
  }

  if (rows.length === 0) return <p className="py-6 text-sm text-ink3">No custody events recorded.</p>

  return (
    <ol className="space-y-0">
      {rows.map((row, index) => (
        <li key={row.key} className="relative flex gap-3 pb-5 last:pb-0">
          {index < rows.length - 1 && <span className="absolute left-[5px] top-3 h-[calc(100%-2px)] w-px bg-line" aria-hidden="true" />}
          <span className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-surface bg-accent" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{row.label}</p>
            <p className="mt-0.5 text-xs text-ink3">{formatLostFoundDateTime(row.at)}</p>
            {row.body}
          </div>
        </li>
      ))}
    </ol>
  )
}
