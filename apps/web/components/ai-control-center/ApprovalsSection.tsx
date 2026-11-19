'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi } from '@/lib/api/agentControlCenter'
import { approvalState, timeLeft, toolLabel } from '@/lib/aiControlCenter/model'
import { useHotelStore } from '@/stores/hotelStore'
import { ApprovalDrawer } from './ApprovalDrawer'
import { TonePill, errorText, when } from './shared'

const VIEWS = [
  { id: 'needs_my_review', label: 'Needs my review', empty: 'Nothing is waiting for your review.' },
  { id: 'submitted_by_me', label: 'Submitted by me', empty: 'You haven’t submitted any agent proposals.' },
  { id: 'history', label: 'History', empty: 'No decided proposals yet.' },
] as const

export function ApprovalsSection() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('needs_my_review')
  const [open, setOpen] = useState<string | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['ai-control-center', 'approvals', view, hotelId],
    queryFn: ({ pageParam }) => agentControlCenterApi.approvals({ view, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? null,
    refetchInterval: 30_000,
    retry: false,
  })
  const rows = query.data?.pages.flatMap((p) => p.data) ?? []
  const current = VIEWS.find((v) => v.id === view)!

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Approval view" className="inline-flex flex-wrap gap-1 rounded-[var(--r-md)] border border-line bg-surface-2 p-1">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}
            className={`min-h-[40px] rounded-[var(--r-sm)] px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${view === v.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>
            {v.label}
          </button>
        ))}
      </div>
      {query.isPending ? <SettingsLoading label="Loading approvals…" />
        : query.isError ? <SettingsError message={errorText(query.error, 'We couldn’t load approvals.')} onRetry={() => query.refetch()} />
        : rows.length === 0 ? <SettingsEmpty icon={<Inbox size={28} aria-hidden="true" />} title={current.empty} />
        : (
          <SettingsCard className="p-0">
            <ul className="divide-y divide-line" aria-label={current.label}>
              {rows.map((a) => {
                const state = approvalState(a.state, a.consumed_at)
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => setOpen(a.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{toolLabel(a.tool_id)}</span>
                        <span className="block text-xs text-ink-3">
                          Requested by {a.initiated_by_name || 'staff member'} · {when(a.created_at)}
                          {a.decided_by_name ? ` · decided by ${a.decided_by_name}` : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {a.state === 'requested' && <span className="text-xs text-ink-3">{timeLeft(a.expires_at, new Date())}</span>}
                        <TonePill tone={state.tone}>{state.label}</TonePill>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </SettingsCard>
        )}
      {query.hasNextPage && (
        <Button variant="outline" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>Load more</Button>
      )}
      {open && <ApprovalDrawer approvalId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
