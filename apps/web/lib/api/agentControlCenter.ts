import { apiClient } from '@/lib/api/client'

/** H6 AI Control Center API (apps/api/routers/agent_control_center.py). Every field is server-computed. */
const BASE = '/agent-control-center'

export type ControlCenterSection = 'overview' | 'agents' | 'approvals' | 'activity' | 'controls' | 'audit'

export interface ControlCenterSession {
  role: string
  sections: ControlCenterSection[]
  is_gm: boolean
  can: { pause_hotel: boolean; revoke_grants: boolean; approve: boolean; control_runs: boolean }
  notes: { approve: string | null }
}

export interface ControlCenterOverview {
  platform: {
    gateway_execution_enabled: boolean
    paid_model_calls_enabled: boolean
    customer_billing_mode: string
    paused: boolean
    cost_emergency_stop: boolean
    paused_agents: string[]
    paused_tools: string[]
    live_workers: number
  }
  hotel: { entitled: boolean; paused: boolean; paused_by_kind: 'human' | 'operator' | null; effective_grants: number }
  runs: { active: number; awaiting_approval: number; failed_24h: number; succeeded_24h: number }
  approvals: { pending: number; expiring_1h: number }
  refusals_24h: number
  as_of: string
  readiness: { execution_ready: boolean; blocked_by: string[]; paid_model_calls_enabled: boolean; customer_billing_mode: string }
}

export interface AgentTool {
  tool_id: string
  tool_version: number
  description: string
  access: 'read' | 'write'
  risk: string
  allowed_roles: string[]
  requires_approval: boolean
  grant?: { effective: boolean; max_level: number | null; expires_at: string | null; revoked_at: string | null; granted_at: string | null } | null
}

export interface AgentEntry {
  agent_id: string
  agent_version: number
  name: string
  product_family: string
  description: string
  capabilities: string[]
  autonomy_ceiling: number
  resource_types: string[]
  tools: AgentTool[]
  intents: Array<{ intent: string; intent_version: number; initiator_roles: string[]; proposes: { tool_id: string; tool_version: number } | null }>
  manifest_enabled: boolean
}

export interface Capability { approve: boolean; reject: boolean; withdraw: boolean; reason: string | null }

export interface ApprovalSummary {
  id: string
  run_id: string
  agent_id: string
  agent_version: number
  tool_id: string
  tool_version: number
  resource_type: string
  resource_id: string
  state: 'requested' | 'approved' | 'rejected' | 'expired' | 'revoked'
  initiated_by_user_id: string
  initiated_by_name: string | null
  decided_by_user_id: string | null
  decided_by_name: string | null
  decided_role: string | null
  decided_at: string | null
  decision_reason_code: string | null
  required_approver_roles: string[]
  expires_at: string
  consumed_at: string | null
  created_at: string
  can: Capability
}

export interface ApprovalDetail {
  approval: Omit<ApprovalSummary, 'can'>
  risk: string | null
  proposal: {
    tool_id: string
    tool_version: number
    agent_id: string
    agent_version: number
    action_digest: string
    arguments: Record<string, string | null>
    assignee_name: string | null
    expected_assignee_name: string | null
  }
  resource: {
    type: 'work_order' | 'room'
    id: string
    label: string | null
    title?: string | null
    status: string | null
    priority?: string | null
    room_number?: string | null
    assigned_to: string | null
    assigned_to_name: string | null
    updated_at: string | null
  } | null
  resource_changed_since_proposal: boolean | null
  handoff: { id: string; intent: string; intent_version: number; proposal_expires_at: string | null } | null
  assignee_evidence: string | null
  can: Capability
}

export interface RunSummary {
  id: string
  agent_id: string
  agent_version: number
  state: string
  principal_type: string
  initiated_by_user_id: string | null
  initiated_by_name: string | null
  trigger_type: string
  attempt_count: number
  last_error_code: string | null
  created_at: string
  completed_at: string | null
}

export interface RunDetail {
  run: RunSummary & { correlation_id: string | null; last_error_class: string | null; current_step_number: number | null; deadline_at: string | null }
  steps: Array<{ id: string; step_number: number; step_type: string; state: string; attempt_count: number; error_code: string | null }>
  events: Array<{ id: number; event_type: string; from_state: string | null; to_state: string | null; actor_kind: string; reason_code: string | null; created_at: string }>
  tool_events: Array<{ id: number; event_type: string; actor_kind: string; reason_code: string | null; created_at: string }>
  can: { cancel: boolean; pause: boolean; resume: boolean }
}

export interface GrantRow {
  id: string
  agent_id: string
  agent_version: number
  tool_id: string
  tool_version: number
  max_level: number
  max_risk: string
  effective: boolean
  granted_at: string
  granted_by_name: string | null
  expires_at: string | null
  revoked_at: string | null
  revoked_by_name: string | null
}

export interface ControlsView {
  platform: ControlCenterOverview['platform']
  hotel: ControlCenterOverview['hotel'] & { paused_by_name: string | null; can_unpause: boolean }
  grants: GrantRow[]
}

export interface AuditEvent {
  id: number
  scope: 'hotel' | 'platform'
  event_type: string
  actor_kind: 'human' | 'operator' | 'system'
  actor_user_id: string | null
  actor_name: string | null
  subject_type: string
  subject_ref: string | null
  reason_code: string | null
  detail: Record<string, unknown>
  created_at: string
}

type Paged<T> = { data: T[]; meta: { per_page: number; next_cursor?: string | null; next_before_id?: number | null } }
const q = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') search.set(k, String(v)) })
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const agentControlCenterApi = {
  session: () => apiClient.get(`${BASE}/session`) as Promise<{ data: ControlCenterSession }>,
  overview: () => apiClient.get(`${BASE}/overview`) as Promise<{ data: ControlCenterOverview }>,
  agents: () => apiClient.get(`${BASE}/agents`) as Promise<{ data: { agents: AgentEntry[] } }>,
  runs: (p: { state?: string | null; cursor?: string | null }) =>
    apiClient.get(`${BASE}/runs${q({ state: p.state, cursor: p.cursor, limit: 25 })}`) as Promise<Paged<RunSummary>>,
  run: (id: string) => apiClient.get(`${BASE}/runs/${encodeURIComponent(id)}`) as Promise<{ data: RunDetail }>,
  controlRun: (id: string, action: 'cancel' | 'pause' | 'resume') =>
    apiClient.post(`${BASE}/runs/${encodeURIComponent(id)}/${action}`) as Promise<{ data: { outcome: string; state: string } }>,
  approvals: (p: { view: string; cursor?: string | null }) =>
    apiClient.get(`${BASE}/approvals${q({ view: p.view, cursor: p.cursor, limit: 25 })}`) as Promise<Paged<ApprovalSummary>>,
  approval: (id: string) => apiClient.get(`${BASE}/approvals/${encodeURIComponent(id)}`) as Promise<{ data: ApprovalDetail }>,
  decide: (id: string, decision: 'approve' | 'reject' | 'withdraw', reasonCode?: string | null) =>
    apiClient.post(`${BASE}/approvals/${encodeURIComponent(id)}/${decision}`, { reason_code: reasonCode ?? null }) as
      Promise<{ data: { approval_id: string; state: string; run_state: string | null } }>,
  controls: () => apiClient.get(`${BASE}/controls`) as Promise<{ data: ControlsView }>,
  setHotelPause: (paused: boolean, reasonCode: string) =>
    apiClient.post(`${BASE}/controls/hotel-pause`, { paused, reason_code: reasonCode }) as Promise<{ data: { paused: boolean; changed: boolean } }>,
  revokeGrant: (g: Pick<GrantRow, 'agent_id' | 'agent_version' | 'tool_id' | 'tool_version'>) =>
    apiClient.post(`${BASE}/grants/revoke`, g) as Promise<{ data: { revoked: boolean } }>,
  audit: (p: { beforeId?: number | null; eventType?: string | null }) =>
    apiClient.get(`${BASE}/audit${q({ before_id: p.beforeId, event_type: p.eventType, limit: 50 })}`) as Promise<Paged<AuditEvent>>,
}
