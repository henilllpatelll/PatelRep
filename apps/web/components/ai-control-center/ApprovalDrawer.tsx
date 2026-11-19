'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { agentControlCenterApi, type ApprovalDetail } from '@/lib/api/agentControlCenter'
import {
  approvalState, approveUnavailableReason, argumentLabel, decisionButtons, timeLeft, toolLabel,
} from '@/lib/aiControlCenter/model'
import { Banner, Facts, TonePill, errorText, when } from './shared'

type Decision = 'approve' | 'reject' | 'withdraw'
const LABEL: Record<Decision, string> = { approve: 'Approve', reject: 'Reject', withdraw: 'Withdraw request' }

function personValue(detail: ApprovalDetail, key: string, value: string | null): string {
  if (!value) return key === 'expected_assigned_to' ? 'Nobody (unassigned)' : '—'
  if (key === 'assignee_user_id') return detail.proposal.assignee_name || 'Staff member'
  if (key === 'expected_assigned_to') return detail.proposal.expected_assignee_name || 'Staff member'
  return value
}

export function ApprovalDrawer({ approvalId, onClose }: { approvalId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const inFlight = useRef(false)
  const [confirm, setConfirm] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['ai-control-center', 'approval', approvalId],
    queryFn: () => agentControlCenterApi.approval(approvalId),
    select: (res) => res.data,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: (decision: Decision) => agentControlCenterApi.decide(approvalId, decision),
    onMutate: () => setError(null),
    onSettled: () => {
      inFlight.current = false
      // Always refresh: on success to show the new state, on a race (already decided / expired) to show the truth.
      qc.invalidateQueries({ queryKey: ['ai-control-center'] })
    },
    onSuccess: (res, decision) => {
      setConfirm(null)
      setDone(decision === 'approve' ? 'Approved. The agent will carry out exactly this change.'
        : decision === 'reject' ? 'Rejected. Nothing will change.' : 'Request withdrawn. Nothing will change.')
      void res
    },
    onError: (err) => { setConfirm(null); setError(errorText(err, 'We couldn’t record that decision.')) },
  })
  const decide = (decision: Decision) => {
    if (inFlight.current) return
    inFlight.current = true
    mutation.mutate(decision)
  }

  const d = query.data
  const buttons = d && !done ? decisionButtons(d.can) : []
  const why = d && !done ? approveUnavailableReason(d.can) : null

  return (
    <SettingsDrawer title="Review agent proposal" description={d ? toolLabel(d.approval.tool_id) : undefined} onClose={onClose} width="lg"
      footer={buttons.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2 px-4 py-3 sm:px-5">
          {buttons.map((b) => (
            <Button key={b} variant={b === 'approve' ? 'primary' : b === 'reject' ? 'destructive' : 'ghost'}
              disabled={mutation.isPending} onClick={() => setConfirm(b)}>{LABEL[b]}</Button>
          ))}
        </div>
      ) : undefined}>
      {query.isPending ? <SettingsLoading label="Loading proposal…" />
        : query.isError || !d ? <SettingsError message={errorText(query.error, 'We couldn’t load this proposal.')} onRetry={() => query.refetch()} />
        : (
          <div className="space-y-5">
            {done && <Banner tone="info">{done}</Banner>}
            {error && <Banner>{error}</Banner>}
            {why && <Banner tone="caution">{why}</Banner>}
            {d.resource_changed_since_proposal && (
              <Banner tone="caution">This {d.resource?.type === 'room' ? 'room' : 'work order'} changed after the agent
                proposed this. If you approve, the change is still checked again and is refused if it no longer fits.</Banner>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <TonePill tone={approvalState(d.approval.state, d.approval.consumed_at).tone}>
                {approvalState(d.approval.state, d.approval.consumed_at).label}</TonePill>
              {d.risk && <TonePill tone={d.risk === 'high' ? 'bad' : 'warn'}>{d.risk} risk</TonePill>}
              {d.approval.state === 'requested' && <span className="text-xs text-ink-3">{timeLeft(d.approval.expires_at, new Date())}</span>}
            </div>
            <section aria-labelledby="acc-proposal" className="space-y-2">
              <h3 id="acc-proposal" className="text-sm font-semibold text-ink">Exactly what would change</h3>
              <Facts rows={[
                { label: 'Action', value: toolLabel(d.proposal.tool_id), hint: `${d.proposal.tool_id} v${d.proposal.tool_version}` },
                ...Object.entries(d.proposal.arguments).map(([k, v]) => ({
                  label: argumentLabel(k), value: personValue(d, k, v),
                  hint: k === 'assignee_user_id' && d.assignee_evidence === 'active_role_member_shift_unverified'
                    ? 'Has an active role here. Whether they are on shift now was not checked.' : undefined,
                })),
              ]} />
            </section>
            {d.resource && (
              <section aria-labelledby="acc-resource" className="space-y-2">
                <h3 id="acc-resource" className="text-sm font-semibold text-ink">Affected {d.resource.type === 'room' ? 'room' : 'work order'} (now)</h3>
                <Facts rows={[
                  { label: d.resource.type === 'room' ? 'Room' : 'Work order', value: d.resource.label || '—' },
                  ...(d.resource.title ? [{ label: 'Title', value: d.resource.title }] : []),
                  { label: 'Status', value: d.resource.status || '—' },
                  ...(d.resource.priority ? [{ label: 'Priority', value: d.resource.priority }] : []),
                  { label: 'Assigned to', value: d.resource.assigned_to_name || (d.resource.assigned_to ? 'Staff member' : 'Nobody') },
                  { label: 'Last updated', value: when(d.resource.updated_at) },
                ]} />
              </section>
            )}
            <section aria-labelledby="acc-who" className="space-y-2">
              <h3 id="acc-who" className="text-sm font-semibold text-ink">Who and when</h3>
              <Facts rows={[
                { label: 'Requested by', value: d.approval.initiated_by_name || 'Staff member', hint: 'Through a PatelRep agent recommendation' },
                { label: 'Agent', value: `${d.proposal.agent_id} v${d.proposal.agent_version}` },
                { label: 'Requested', value: when(d.approval.created_at) },
                { label: 'Expires', value: when(d.approval.expires_at) },
                { label: 'Who may decide', value: d.approval.required_approver_roles.join(', ').replace(/_/g, ' ') },
                ...(d.approval.decided_at ? [{ label: 'Decided by', value: `${d.approval.decided_by_name || 'Manager'} · ${when(d.approval.decided_at)}` }] : []),
              ]} />
              <p className="text-xs text-ink-3">Proposal fingerprint <code className="break-all">{d.proposal.action_digest}</code>. An
                approval applies only to this exact proposal and can be used once.</p>
            </section>
          </div>
        )}
      {confirm && d && (
        <SettingsConfirmDialog
          title={confirm === 'approve' ? 'Approve this change?' : confirm === 'reject' ? 'Reject this proposal?' : 'Withdraw your request?'}
          body={<p>{confirm === 'approve'
            ? `${toolLabel(d.proposal.tool_id)}${d.proposal.assignee_name ? ` → ${d.proposal.assignee_name}` : ''}. The agent will make this one change, after checking again that nothing changed.`
            : 'Nothing will change, and the agent will not act on this proposal.'}</p>}
          confirmLabel={LABEL[confirm]}
          tone={confirm === 'approve' ? 'primary' : 'destructive'}
          busy={mutation.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => decide(confirm)}
        />
      )}
    </SettingsDrawer>
  )
}
