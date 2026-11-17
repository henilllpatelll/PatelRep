'use client'

import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsEmpty, SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi } from '@/lib/api/agentControlCenter'
import { toolLabel } from '@/lib/aiControlCenter/model'
import { useHotelStore } from '@/stores/hotelStore'
import { TonePill, errorText } from './shared'

const AUTONOMY = ['Off', 'Observe only', 'Acts only with human approval', 'Bounded autonomy', 'Coordinated autonomy']

export function AgentsSection({ isGm }: { isGm: boolean }) {
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const query = useQuery({
    queryKey: ['ai-control-center', 'agents', hotelId],
    queryFn: () => agentControlCenterApi.agents(),
    select: (res) => res.data.agents,
    staleTime: 60_000,
    retry: false,
  })
  if (query.isPending) return <SettingsLoading label="Loading agents…" />
  if (query.isError) return <SettingsError message={errorText(query.error, 'We couldn’t load the agent directory.')} onRetry={() => query.refetch()} />
  if (!query.data?.length) return <SettingsEmpty icon={<Bot size={28} aria-hidden="true" />} title="No reviewed agents" />
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">Every agent PatelRep has reviewed, at its exact version. An agent can only use the
        tools listed under it, and only within your hotel.</p>
      {query.data.map((agent) => (
        <SettingsCard key={`${agent.agent_id}@${agent.agent_version}`} aria-label={`${agent.name} version ${agent.agent_version}`} className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">{agent.name} <span className="text-sm font-normal text-ink-3">v{agent.agent_version}</span></h2>
              <p className="text-xs text-ink-3"><code>{agent.agent_id}</code></p>
            </div>
            <TonePill tone="neutral">{AUTONOMY[agent.autonomy_ceiling] ?? `Level ${agent.autonomy_ceiling}`}</TonePill>
          </div>
          <p className="text-sm text-ink-2">{agent.description}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <caption className="sr-only">Tools {agent.name} may use</caption>
              <thead className="text-[11px] uppercase tracking-wider text-ink-3">
                <tr><th scope="col" className="py-1.5 pr-3 font-semibold">Tool</th><th scope="col" className="py-1.5 pr-3 font-semibold">Kind</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Risk</th>{isGm && <th scope="col" className="py-1.5 font-semibold">Permission here</th>}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {agent.tools.map((tool) => (
                  <tr key={`${tool.tool_id}@${tool.tool_version}`}>
                    <td className="py-2 pr-3"><span className="text-ink">{toolLabel(tool.tool_id)}</span>
                      <span className="block text-xs text-ink-3"><code>{tool.tool_id}</code> v{tool.tool_version}</span></td>
                    <td className="py-2 pr-3 text-ink-2">{tool.access === 'write' ? 'Change (needs approval)' : 'Read only'}</td>
                    <td className="py-2 pr-3"><TonePill tone={tool.risk === 'high' || tool.risk === 'critical' ? 'bad' : tool.risk === 'medium' ? 'warn' : 'neutral'}>{tool.risk}</TonePill></td>
                    {isGm && (
                      <td className="py-2">
                        {tool.grant?.effective
                          ? <TonePill tone="good">Granted</TonePill>
                          : <TonePill tone="neutral">{tool.grant?.revoked_at ? 'Revoked' : 'Not granted'}</TonePill>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {agent.intents.length > 0 && (
            <p className="text-xs text-ink-3">Can be asked to: {agent.intents.map((i) => `${i.intent} v${i.intent_version}`).join(', ')}</p>
          )}
        </SettingsCard>
      ))}
    </div>
  )
}
