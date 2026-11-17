import type { Capability, ControlCenterOverview, ControlCenterSection } from '@/lib/api/agentControlCenter'

/** Pure view logic for the AI Control Center (unit-tested; no React, no fetching). Everything shown as "on",
 *  "allowed" or "ready" comes from the backend; nothing here infers an enabled state. */

export const SECTION_LABELS: Record<ControlCenterSection, string> = {
  overview: 'Overview',
  agents: 'Agents',
  approvals: 'Approvals',
  activity: 'Activity',
  controls: 'Controls',
  audit: 'Audit',
}

export const SECTION_ORDER: ControlCenterSection[] = ['overview', 'agents', 'approvals', 'activity', 'controls', 'audit']

/** Sections to render, in order: exactly those the backend session allows. Unknown names are ignored. */
export function visibleSections(allowed: readonly string[] | null | undefined): ControlCenterSection[] {
  const set = new Set(allowed ?? [])
  return SECTION_ORDER.filter((s) => set.has(s))
}

/** The section to open: the requested one if allowed, else the first allowed one, else null. */
export function resolveSection(requested: string | null, allowed: ControlCenterSection[]): ControlCenterSection | null {
  if (requested && (allowed as string[]).includes(requested)) return requested as ControlCenterSection
  return allowed[0] ?? null
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

const BLOCK_LABELS: Record<string, string> = {
  platform_paused: 'PatelRep has paused all agents',
  cost_emergency_stop: 'AI cost emergency stop is on',
  hotel_paused: 'Agents are paused for this hotel',
  not_entitled: 'AI agents are not part of this hotel’s plan',
  gateway_execution_disabled: 'Agent actions are switched off platform-wide',
  approve_gate_closed: 'This environment does not run agent actions',
  no_live_worker: 'No agent worker is running',
  no_effective_grants: 'No agent has permission to act in this hotel',
}

export function blockLabel(code: string): string {
  return BLOCK_LABELS[code] ?? code.replace(/_/g, ' ')
}

export function readinessSummary(overview: ControlCenterOverview): { tone: Tone; title: string; detail: string } {
  if (overview.readiness.execution_ready) {
    return { tone: 'good', title: 'Agents can act after human approval', detail: 'Every approval still needs a different, current manager.' }
  }
  const first = overview.readiness.blocked_by[0]
  const stop = overview.platform.cost_emergency_stop || overview.platform.paused || overview.hotel.paused
  return {
    tone: stop ? 'bad' : 'neutral',
    title: 'Agents cannot act right now',
    detail: first ? `${blockLabel(first)}${overview.readiness.blocked_by.length > 1 ? ` (+${overview.readiness.blocked_by.length - 1} more)` : ''}.` : '',
  }
}

const RUN_STATE: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'neutral' },
  retry_wait: { label: 'Retrying', tone: 'warn' },
  paused: { label: 'Paused', tone: 'warn' },
  cancel_requested: { label: 'Cancelling', tone: 'warn' },
  awaiting_approval: { label: 'Waiting for approval', tone: 'warn' },
  succeeded: { label: 'Completed', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  dead_letter: { label: 'Failed (needs attention)', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export function runState(state: string): { label: string; tone: Tone } {
  return RUN_STATE[state] ?? { label: state, tone: 'neutral' }
}

const APPROVAL_STATE: Record<string, { label: string; tone: Tone }> = {
  requested: { label: 'Needs review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Withdrawn', tone: 'neutral' },
}

export function approvalState(state: string, consumedAt?: string | null): { label: string; tone: Tone } {
  if (state === 'approved' && consumedAt) return { label: 'Approved · carried out', tone: 'good' }
  return APPROVAL_STATE[state] ?? { label: state, tone: 'neutral' }
}

const REFUSALS: Record<string, string> = {
  not_pending: 'Someone already decided this request. The list has been refreshed.',
  approval_expired: 'This request expired before a decision. The agent will not act on it.',
  self_approval_forbidden: 'You submitted this request, so a different manager must review it.',
  approver_not_authorized: 'Your current role cannot approve this kind of action.',
  gateway_disabled: 'Agent actions are switched off here, so approving is not available.',
  not_authorized: 'Your current role cannot do this.',
  stale_role: 'Your role changed since you signed in. Sign out and back in to continue.',
  inactive_member: 'Your account is no longer active for this hotel.',
  ambiguous_membership: 'Your account has more than one active role here. Ask the GM to fix it.',
  operator_pause_locked: 'PatelRep support placed this pause. Contact support to lift it.',
  not_found: 'This item no longer exists or is not part of your hotel.',
  tool_not_allowed: 'That permission is not one PatelRep reviewed.',
  schema_unavailable: 'The AI Control Center is being updated. Try again shortly.',
}

export function refusalMessage(code: string | null | undefined, fallback = 'That didn’t work. Please try again.'): string {
  return (code && REFUSALS[code]) || fallback
}

/** Which decision buttons to show: only what the backend said this person may do now. */
export function decisionButtons(can: Capability | null | undefined): Array<'approve' | 'reject' | 'withdraw'> {
  if (!can) return []
  return (['approve', 'reject', 'withdraw'] as const).filter((k) => can[k])
}

/** Why no approve button is shown (null when it is shown or nothing needs explaining). */
export function approveUnavailableReason(can: Capability | null | undefined): string | null {
  if (!can || can.approve || !can.reason) return null
  if (can.reason === 'not_pending') return null
  return refusalMessage(can.reason)
}

export function timeLeft(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 'expired'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min left`
}

const ARG_LABELS: Record<string, string> = {
  assignee_user_id: 'Assign to',
  expected_assigned_to: 'Currently assigned to',
  assignment_date: 'For date',
  note: 'Note to staff',
}

export function argumentLabel(key: string): string {
  return ARG_LABELS[key] ?? key.replace(/_/g, ' ')
}

const TOOL_LABELS: Record<string, string> = {
  'engineering.work_orders.assign': 'Assign a work order',
  'housekeeping.room_assignments.assign': 'Assign a room',
  'engineering.work_orders.lookup': 'Look up a work order',
  'engineering.work_orders.assignment_candidates': 'List engineers who could take a work order',
  'housekeeping.rooms.status_lookup': 'Look up a room’s status',
  'housekeeping.rooms.readiness_lookup': 'Check a room’s readiness',
  'housekeeping.room_assignments.candidates': 'List housekeepers who could take a room',
}

export function toolLabel(toolId: string): string {
  return TOOL_LABELS[toolId] ?? toolId
}

const EVENT_LABELS: Record<string, string> = {
  runtime_control_changed: 'Pause changed',
  tool_grant_changed: 'Agent permission changed',
  execution_enablement_changed: 'Platform agent actions switched',
  tool_control_changed: 'Tool paused or resumed',
  model_enablement_changed: 'Paid AI calls switched',
  customer_billing_controls_changed: 'AI billing mode changed',
  worker_credential_issued: 'Agent worker credential issued',
  worker_credential_revoked: 'Agent worker credential revoked',
  security_refusal: 'Request refused',
}

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, ' ')
}

export const AUDIT_FILTERS = Object.keys(EVENT_LABELS)
