'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi, type ControlCenterSection } from '@/lib/api/agentControlCenter'
import { blockLabel, readinessSummary } from '@/lib/aiControlCenter/model'
import { useHotelStore } from '@/stores/hotelStore'
import { Banner, Count, OnOff, TonePill, errorText, when } from './shared'

export function OverviewSection({ onOpen }: { onOpen: (section: ControlCenterSection) => void }) {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const query = useQuery({
    queryKey: ['ai-control-center', 'overview', hotelId],
    queryFn: () => agentControlCenterApi.overview(),
    select: (res) => res.data,
    refetchInterval: 30_000,
    retry: false,
  })
  if (query.isPending) return <SettingsLoading label="Loading agent status…" />
  if (query.isError || !query.data) {
    return <SettingsError message={errorText(query.error, 'We couldn’t load agent status.')} onRetry={() => query.refetch()} />
  }
  const o = query.data
  const summary = readinessSummary(o)
  return (
    <div className="space-y-5">
      <SettingsCard aria-labelledby="acc-readiness" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="acc-readiness" className="text-base font-semibold text-ink">{summary.title}</h2>
          <TonePill tone={summary.tone}>{o.readiness.execution_ready ? 'Ready with approval' : 'Not acting'}</TonePill>
        </div>
        {summary.detail && <p className="text-sm text-ink-2">{summary.detail}</p>}
        {o.readiness.blocked_by.length > 1 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {o.readiness.blocked_by.map((code) => <li key={code}>{blockLabel(code)}</li>)}
          </ul>
        )}
        <p className="text-xs text-ink-3">Status as of {when(o.as_of)}. Agents never approve their own work, and every
          write needs a different, current manager.</p>
      </SettingsCard>

      {(o.platform.cost_emergency_stop || o.platform.paused || o.hotel.paused) && (
        <Banner tone="caution">
          {o.hotel.paused ? 'Agents are paused for this hotel. ' : ''}
          {o.platform.paused ? 'PatelRep has paused agents for every hotel. ' : ''}
          {o.platform.cost_emergency_stop ? 'The AI cost emergency stop is on.' : ''}
        </Banner>
      )}

      <section aria-labelledby="acc-counts" className="space-y-3">
        <h2 id="acc-counts" className="text-sm font-semibold text-ink">Today</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Count label="Waiting for approval" value={o.approvals.pending} tone={o.approvals.pending ? 'warn' : 'neutral'} />
          <Count label="Expiring within 1 h" value={o.approvals.expiring_1h} tone={o.approvals.expiring_1h ? 'warn' : 'neutral'} />
          <Count label="Active runs" value={o.runs.active} />
          <Count label="Failed (24 h)" value={o.runs.failed_24h} tone={o.runs.failed_24h ? 'bad' : 'neutral'} />
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" className="font-medium text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
            onClick={() => onOpen('approvals')}>Review approvals</button>
          <button type="button" className="font-medium text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
            onClick={() => onOpen('activity')}>See activity</button>
        </div>
      </section>

      <SettingsCard aria-labelledby="acc-switches" className="space-y-3">
        <h2 id="acc-switches" className="text-base font-semibold text-ink">Safety switches</h2>
        <p className="text-sm text-ink-3">Read-only. These are set by PatelRep; the hotel pause is under Controls.</p>
        <dl className="divide-y divide-line text-sm">
          {[
            ['AI agents on this hotel’s plan', <OnOff key="e" on={o.hotel.entitled} onLabel="Included" offLabel="Not included" />],
            ['Agent actions (platform)', <OnOff key="g" on={o.platform.gateway_execution_enabled} />],
            ['Paid AI model calls (platform)', <OnOff key="p" on={o.platform.paid_model_calls_enabled} />],
            ['AI agent billing', <TonePill key="b" tone="neutral">{o.platform.customer_billing_mode === 'enforced' ? 'Charging' : 'Not charging'}</TonePill>],
            ['Hotel pause', <OnOff key="h" on={o.hotel.paused} onLabel="Paused" offLabel="Not paused" danger />],
            ['Agent workers running', <span key="w" className="tabular-nums">{o.platform.live_workers}</span>],
            ['Agents with permission to act', <span key="n" className="tabular-nums">{o.hotel.effective_grants}</span>],
            ['Refused requests (24 h)', <span key="r" className="tabular-nums">{o.refusals_24h}</span>],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-center justify-between gap-3 py-2">
              <dt className="text-ink-2">{label}</dt><dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-ink-3">AI usage and charges: <Link className="text-[var(--accent)] hover:underline" href="/settings/billing">Billing &amp; Usage</Link>.</p>
      </SettingsCard>
    </div>
  )
}
