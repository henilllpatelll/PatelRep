'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi, type GrantRow } from '@/lib/api/agentControlCenter'
import { toolLabel } from '@/lib/aiControlCenter/model'
import { useHotelStore } from '@/stores/hotelStore'
import { Banner, OnOff, TonePill, errorText, when } from './shared'

/** GM controls. Everything here only RESTRICTS agents: pause/unpause this hotel (a PatelRep pause stays locked) and
 *  revoke a permission. There is no control that turns agents, paid calls or billing on. */
export function ControlsSection() {
  const qc = useQueryClient()
  const hotelId = useHotelStore((s) => s.hotel?.id)
  const inFlight = useRef(false)
  const [pending, setPending] = useState<null | { kind: 'pause' } | { kind: 'unpause' } | { kind: 'revoke'; grant: GrantRow }>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null)
  const query = useQuery({
    queryKey: ['ai-control-center', 'controls', hotelId],
    queryFn: () => agentControlCenterApi.controls(),
    select: (res) => res.data,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: async (p: NonNullable<typeof pending>) => {
      if (p.kind === 'revoke') return agentControlCenterApi.revokeGrant(p.grant)
      return agentControlCenterApi.setHotelPause(p.kind === 'pause', p.kind === 'pause' ? 'gm_paused_from_control_center' : 'gm_resumed_from_control_center')
    },
    onSettled: () => { inFlight.current = false; setPending(null); qc.invalidateQueries({ queryKey: ['ai-control-center'] }) },
    onSuccess: (_res, p) => setMessage({ tone: 'info', text: p.kind === 'revoke' ? 'Permission revoked. The agent can no longer use that tool here.'
      : p.kind === 'pause' ? 'Agents are paused for this hotel. Work in progress stops at its next safe point.' : 'The hotel pause is lifted.' }),
    onError: (err) => setMessage({ tone: 'alert', text: errorText(err, 'We couldn’t change that control.') }),
  })
  const run = () => { if (pending && !inFlight.current) { inFlight.current = true; mutation.mutate(pending) } }

  if (query.isPending) return <SettingsLoading label="Loading controls…" />
  if (query.isError || !query.data) return <SettingsError message={errorText(query.error, 'We couldn’t load controls.')} onRetry={() => query.refetch()} />
  const { hotel, platform, grants } = query.data
  const effective = grants.filter((g) => g.effective)
  return (
    <div className="space-y-5">
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      <SettingsCard aria-labelledby="acc-pause" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="acc-pause" className="text-base font-semibold text-ink">Pause agents for this hotel</h2>
          <OnOff on={hotel.paused} onLabel="Paused" offLabel="Not paused" danger />
        </div>
        <p className="text-sm text-ink-2">Stops every agent in your hotel from starting or continuing work. Staff can keep
          working exactly as before.</p>
        {hotel.paused && (
          <p className="text-sm text-ink-3">{hotel.paused_by_kind === 'operator' ? 'Paused by PatelRep support.' : `Paused by ${hotel.paused_by_name || 'a GM'}.`}</p>
        )}
        <div>
          {!hotel.paused && <Button variant="destructive" onClick={() => setPending({ kind: 'pause' })}>Pause agents</Button>}
          {hotel.paused && hotel.can_unpause && <Button variant="outline" onClick={() => setPending({ kind: 'unpause' })}>Lift pause</Button>}
          {hotel.paused && !hotel.can_unpause && <p className="text-sm text-ink-3">Only PatelRep support can lift this pause.</p>}
        </div>
      </SettingsCard>

      <SettingsCard aria-labelledby="acc-perms" className="space-y-3">
        <h2 id="acc-perms" className="text-base font-semibold text-ink">Agent permissions in this hotel</h2>
        <p className="text-sm text-ink-3">{effective.length} active. Revoking takes effect for every new request immediately.</p>
        {grants.length === 0 ? <p className="text-sm text-ink-2">No agent has been given any permission here.</p> : (
          <ul className="divide-y divide-line">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{toolLabel(g.tool_id)} <span className="text-ink-3">· {g.agent_id} v{g.agent_version}</span></span>
                  <span className="block text-xs text-ink-3">
                    {g.effective ? `Granted ${when(g.granted_at)}${g.granted_by_name ? ` by ${g.granted_by_name}` : ''}`
                      : g.revoked_at ? `Revoked ${when(g.revoked_at)}${g.revoked_by_name ? ` by ${g.revoked_by_name}` : ''}` : 'Expired'}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <TonePill tone={g.effective ? 'good' : 'neutral'}>{g.effective ? 'Active' : 'Inactive'}</TonePill>
                  {g.effective && <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'revoke', grant: g })}
                    aria-label={`Revoke ${toolLabel(g.tool_id)} for ${g.agent_id}`}>Revoke</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard aria-labelledby="acc-safety" className="space-y-2">
        <h2 id="acc-safety" className="text-base font-semibold text-ink">PatelRep safety switches</h2>
        <p className="text-sm text-ink-3">Read-only. Set by PatelRep, never from this page.</p>
        <ul className="space-y-1.5 text-sm text-ink-2">
          <li className="flex justify-between gap-2">Agent actions <OnOff on={platform.gateway_execution_enabled} /></li>
          <li className="flex justify-between gap-2">Paid AI calls <OnOff on={platform.paid_model_calls_enabled} /></li>
          <li className="flex justify-between gap-2">All-hotel pause <OnOff on={platform.paused} onLabel="Paused" offLabel="Not paused" danger /></li>
          <li className="flex justify-between gap-2">Cost emergency stop <OnOff on={platform.cost_emergency_stop} danger /></li>
        </ul>
      </SettingsCard>

      {pending && (
        <SettingsConfirmDialog
          title={pending.kind === 'pause' ? 'Pause all agents in this hotel?' : pending.kind === 'unpause' ? 'Lift the hotel pause?' : 'Revoke this permission?'}
          body={<p>{pending.kind === 'pause' ? 'No agent will start or continue work here until a GM lifts the pause.'
            : pending.kind === 'unpause' ? 'Agents may work again, still only with every other safety switch and a manager’s approval.'
            : `${toolLabel(pending.grant.tool_id)} for ${pending.grant.agent_id} v${pending.grant.agent_version}. Re-granting needs PatelRep.`}</p>}
          confirmLabel={pending.kind === 'pause' ? 'Pause agents' : pending.kind === 'unpause' ? 'Lift pause' : 'Revoke'}
          tone={pending.kind === 'unpause' ? 'primary' : 'destructive'} busy={mutation.isPending}
          onCancel={() => setPending(null)} onConfirm={run} />
      )}
    </div>
  )
}
