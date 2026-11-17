'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi, type AuditEvent } from '@/lib/api/agentControlCenter'
import { AUDIT_FILTERS, eventLabel } from '@/lib/aiControlCenter/model'
import { useHotelStore } from '@/stores/hotelStore'
import { TonePill, errorText, when } from './shared'

function who(e: AuditEvent): string {
  if (e.actor_kind === 'human') return e.actor_name || 'Staff member'
  return e.actor_kind === 'operator' ? 'PatelRep support' : 'System'
}

/** Immutable governance journal (metadata only). Platform rows never show operator identities. */
export function AuditSection() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const query = useInfiniteQuery({
    queryKey: ['ai-control-center', 'audit', type, hotelId],
    queryFn: ({ pageParam }) => agentControlCenterApi.audit({ beforeId: pageParam, eventType: type || null }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.meta.next_before_id ?? null,
    retry: false,
  })
  const needle = search.trim().toLowerCase()
  const rows = (query.data?.pages.flatMap((p) => p.data) ?? []).filter((e) => !needle ||
    [eventLabel(e.event_type), who(e), e.reason_code ?? '', e.subject_ref ?? ''].join(' ').toLowerCase().includes(needle))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-[12rem] flex-col gap-1 text-sm text-ink-2">
          Event
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="min-h-[40px] rounded-[var(--r-md)] border border-line bg-surface px-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            <option value="">All events</option>
            {AUDIT_FILTERS.map((t) => <option key={t} value={t}>{eventLabel(t)}</option>)}
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm text-ink-2">
          Search loaded events
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person, reason or item"
            className="min-h-[40px] rounded-[var(--r-md)] border border-line bg-surface px-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" />
        </label>
      </div>
      {query.isPending ? <SettingsLoading label="Loading audit history…" />
        : query.isError ? <SettingsError message={errorText(query.error, 'We couldn’t load audit history.')} onRetry={() => query.refetch()} />
        : rows.length === 0 ? <SettingsEmpty icon={<ScrollText size={28} aria-hidden="true" />} title="No matching events" />
        : (
          <SettingsCard className="p-0">
            <ul className="divide-y divide-line" aria-label="Audit events">
              {rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{eventLabel(e.event_type)}</span>
                    <span className="block text-xs text-ink-3">
                      {who(e)} · {when(e.created_at)}{e.reason_code ? ` · ${e.reason_code.replace(/_/g, ' ')}` : ''}
                      {e.subject_ref ? ` · ${e.subject_ref}` : ''}
                    </span>
                  </span>
                  <TonePill tone={e.event_type === 'security_refusal' ? 'warn' : 'neutral'}>{e.scope === 'platform' ? 'All hotels' : 'This hotel'}</TonePill>
                </li>
              ))}
            </ul>
          </SettingsCard>
        )}
      {query.hasNextPage && <Button variant="outline" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>Load older</Button>}
    </div>
  )
}
