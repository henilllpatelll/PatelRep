'use client'

import { useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi } from '@/lib/api/agentControlCenter'
import { runState } from '@/lib/aiControlCenter/model'
import { useHotelStore } from '@/stores/hotelStore'
import { Banner, Facts, TonePill, errorText, when } from './shared'

const FILTERS = [
  { id: '', label: 'All' }, { id: 'awaiting_approval', label: 'Waiting for approval' }, { id: 'running', label: 'Running' },
  { id: 'paused', label: 'Paused' }, { id: 'failed', label: 'Failed' }, { id: 'dead_letter', label: 'Needs attention' },
  { id: 'succeeded', label: 'Completed' },
]

export function ActivitySection() {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const [state, setState] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['ai-control-center', 'runs', state, hotelId],
    queryFn: ({ pageParam }) => agentControlCenterApi.runs({ state: state || null, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? null,
    refetchInterval: 30_000,
    retry: false,
  })
  const rows = query.data?.pages.flatMap((p) => p.data) ?? []
  return (
    <div className="space-y-4">
      <label className="flex max-w-xs flex-col gap-1 text-sm text-ink-2">
        Show
        <select value={state} onChange={(e) => setState(e.target.value)}
          className="min-h-[40px] rounded-[var(--r-md)] border border-line bg-surface px-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      {query.isPending ? <SettingsLoading label="Loading activity…" />
        : query.isError ? <SettingsError message={errorText(query.error, 'We couldn’t load agent activity.')} onRetry={() => query.refetch()} />
        : rows.length === 0 ? <SettingsEmpty icon={<Activity size={28} aria-hidden="true" />} title="No agent activity" body="Runs appear here once someone asks an agent for help." />
        : (
          <SettingsCard className="p-0">
            <ul className="divide-y divide-line" aria-label="Agent runs">
              {rows.map((r) => {
                const s = runState(r.state)
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpen(r.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{r.agent_id} v{r.agent_version}</span>
                        <span className="block text-xs text-ink-3">
                          {r.initiated_by_name ? `Asked by ${r.initiated_by_name}` : r.principal_type === 'system' ? 'Scheduled' : 'Staff member'} · {when(r.created_at)}
                          {r.last_error_code ? ` · ${r.last_error_code.replace(/_/g, ' ')}` : ''}
                        </span>
                      </span>
                      <TonePill tone={s.tone}>{s.label}</TonePill>
                    </button>
                  </li>
                )
              })}
            </ul>
          </SettingsCard>
        )}
      {query.hasNextPage && <Button variant="outline" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>Load more</Button>}
      {open && <RunDrawer runId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

type Action = 'cancel' | 'pause' | 'resume'

function RunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const inFlight = useRef(false)
  const [confirm, setConfirm] = useState<Action | null>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null)
  const query = useQuery({
    queryKey: ['ai-control-center', 'run', runId],
    queryFn: () => agentControlCenterApi.run(runId),
    select: (res) => res.data,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: (action: Action) => agentControlCenterApi.controlRun(runId, action),
    onSettled: () => { inFlight.current = false; setConfirm(null); qc.invalidateQueries({ queryKey: ['ai-control-center'] }) },
    onSuccess: (res) => setMessage({ tone: 'info', text: `Done. The run is now ${runState(res.data.state).label.toLowerCase()}.` }),
    onError: (err) => setMessage({ tone: 'alert', text: errorText(err, 'We couldn’t change this run.') }),
  })
  const act = (action: Action) => { if (!inFlight.current) { inFlight.current = true; mutation.mutate(action) } }
  const d = query.data
  const actions = d ? (['pause', 'resume', 'cancel'] as const).filter((a) => d.can[a]) : []
  return (
    <SettingsDrawer title="Agent run" onClose={onClose} width="lg"
      footer={actions.length ? (
        <div className="flex flex-wrap justify-end gap-2 px-4 py-3 sm:px-5">
          {actions.map((a) => <Button key={a} variant={a === 'cancel' ? 'destructive' : 'outline'} disabled={mutation.isPending}
            onClick={() => setConfirm(a)}>{a === 'cancel' ? 'Cancel run' : a === 'pause' ? 'Pause' : 'Resume'}</Button>)}
        </div>) : undefined}>
      {query.isPending ? <SettingsLoading label="Loading run…" />
        : query.isError || !d ? <SettingsError message={errorText(query.error, 'We couldn’t load this run.')} onRetry={() => query.refetch()} />
        : (
          <div className="space-y-5">
            {message && <Banner tone={message.tone}>{message.text}</Banner>}
            <Facts rows={[
              { label: 'Status', value: <TonePill tone={runState(d.run.state).tone}>{runState(d.run.state).label}</TonePill> },
              { label: 'Agent', value: `${d.run.agent_id} v${d.run.agent_version}` },
              { label: 'Asked by', value: d.run.initiated_by_name || (d.run.principal_type === 'system' ? 'Scheduled' : 'Staff member') },
              { label: 'Started', value: when(d.run.created_at) },
              { label: 'Finished', value: when(d.run.completed_at) },
              { label: 'Attempts', value: String(d.run.attempt_count) },
              ...(d.run.last_error_code ? [{ label: 'Last problem', value: d.run.last_error_code.replace(/_/g, ' ') }] : []),
            ]} />
            <section aria-labelledby="acc-run-events" className="space-y-2">
              <h3 id="acc-run-events" className="text-sm font-semibold text-ink">What happened</h3>
              <ol className="space-y-1.5 text-sm">
                {[...d.events.map((e) => ({ ...e, kind: 'run' })), ...d.tool_events.map((e) => ({ ...e, kind: 'tool', from_state: null, to_state: null }))]
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((e) => (
                    <li key={`${e.kind}-${e.id}`} className="flex flex-wrap justify-between gap-2 border-b border-line pb-1.5">
                      <span className="text-ink">{e.event_type.replace(/_/g, ' ')}{e.reason_code ? ` · ${e.reason_code.replace(/_/g, ' ')}` : ''}</span>
                      <span className="text-xs text-ink-3">{e.actor_kind} · {when(e.created_at)}</span>
                    </li>
                  ))}
              </ol>
            </section>
          </div>
        )}
      {confirm && (
        <SettingsConfirmDialog title={confirm === 'cancel' ? 'Cancel this run?' : confirm === 'pause' ? 'Pause this run?' : 'Resume this run?'}
          body={<p>{confirm === 'cancel' ? 'The agent stops at its next safe point and makes no further changes.'
            : confirm === 'pause' ? 'The agent stops at its next safe point until a GM resumes it.'
            : 'The run goes back in the queue. It still needs every safety switch and approval.'}</p>}
          confirmLabel={confirm === 'cancel' ? 'Cancel run' : confirm === 'pause' ? 'Pause' : 'Resume'}
          tone={confirm === 'cancel' ? 'destructive' : 'primary'} busy={mutation.isPending}
          onCancel={() => setConfirm(null)} onConfirm={() => act(confirm)} />
      )}
    </SettingsDrawer>
  )
}
