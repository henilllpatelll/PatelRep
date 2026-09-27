import { apiClient } from '@/lib/api/client'

// ─── Work Order types ─────────────────────────────────────────────────────────

export interface WorkOrderComment {
  id: string
  work_order_id: string
  user_id: string
  comment: string
  is_system: boolean
  created_at: string
}

export interface WorkOrderPhoto {
  id: string
  work_order_id: string
  storage_path: string
  photo_type: 'before' | 'after' | 'progress'
  caption?: string
  created_at: string
  photo_url?: string
}

export interface Asset {
  id: string
  name: string
  asset_tag?: string
  category_id: string
  room_id?: string
  location_text?: string
  manufacturer?: string
  model?: string
  serial_number?: string
  purchase_date?: string
  warranty_expires?: string
  installation_date?: string
  expected_lifespan_years?: number
  replacement_cost?: number
  notes?: string
  is_active: boolean
  failure_risk_score: number
  failure_risk_updated_at?: string
  zone?: string
  created_at: string
  updated_at: string
  // Joined
  asset_categories?: { name: string; code: string }
  rooms?: { room_number: string }
  active_downtime?: AssetDowntimePeriod | null
  condition_status?: MeterStatus | null
}

export interface AssetDowntimePeriod {
  id: string
  asset_id: string
  work_order_id?: string | null
  started_at: string
  restored_at?: string | null
  downtime_minutes?: number | null
  /** Server-derived elapsed duration; never persist a client-calculated value. */
  elapsed_minutes?: number | null
  downtime_type: 'planned' | 'unplanned'
  impact_level: 'degraded' | 'out_of_service'
  reason_code?: string | null
  notes?: string | null
  created_at?: string
  updated_at?: string
  work_orders?: Pick<WorkOrder, 'work_order_number' | 'title'> | null
}

export interface AssetReliabilitySummary {
  tracking_started_at?: string | null
  active_downtime?: AssetDowntimePeriod | null
  downtime_12mo_minutes: number
  planned_downtime_12mo_minutes: number
  unplanned_downtime_12mo_minutes: number
  failure_count_12mo: number
  mttr_minutes?: number | null
  mtbf_minutes?: number | null
  repeat_failure_count: number
  repeat_failure_rate?: number | null
  reopen_count: number
  reopen_rate?: number | null
  first_time_fix_eligible: number
  first_time_fix_successes: number
  first_time_fix_rate?: number | null
}

export type MeterType = 'temperature' | 'pressure' | 'voltage' | 'current' | 'runtime_hours' | 'cycle_count' | 'ph' | 'chlorine' | 'humidity' | 'flow' | 'energy' | 'water' | 'custom'
export type MeterStatus = 'normal' | 'warning' | 'critical' | 'stale' | 'no_readings'

export interface EngineeringMeter {
  id: string
  asset_id?: string | null
  location_text?: string | null
  name: string
  meter_type: MeterType
  unit: string
  warning_low?: number | null
  warning_high?: number | null
  critical_low?: number | null
  critical_high?: number | null
  stale_after_hours?: number | null
  source_type: 'manual' | 'pm' | 'iot'
  critical_action: 'none' | 'create_work_order'
  notes?: string | null
  is_active: boolean
  latest_reading?: MeterReading | null
  current_status?: MeterStatus
}

export interface MeterReading {
  id: string
  meter_id: string
  value: number
  recorded_at: string
  source: 'manual' | 'pm' | 'iot'
  status_at_recording: 'normal' | 'warning' | 'critical'
  notes?: string | null
  work_order_id?: string | null
  work_order?: { id: string; work_order_number?: number } | null
}

export interface AssetConditionSummary {
  total_meters: number
  normal_count: number
  warning_count: number
  critical_count: number
  stale_count: number
  no_readings_count: number
  meters: EngineeringMeter[]
}

export interface WorkOrder {
  id: string
  work_order_number: number
  title: string
  description?: string
  original_nl_input?: string
  category: 'plumbing' | 'electrical' | 'hvac' | 'furniture' | 'appliance' | 'structural' | 'safety' | 'doors_locks' | 'painting' | 'general'
  priority: WorkOrderPriority
  status: WorkOrderStatus
  room_id?: string
  location_text?: string
  asset_id?: string
  assigned_to?: string
  created_by: string
  is_ai_created: boolean
  is_pm_generated: boolean
  guest_reported: boolean
  sla_minutes: number
  due_at?: string
  started_at?: string
  acknowledged_at?: string
  arrived_at?: string
  completed_at?: string
  parts_used?: string
  labor_hours?: number
  labor_cost?: number
  parts_cost?: number
  vendor_cost?: number
  total_cost?: number
  notes?: string
  problem_code_id?: string
  cause_code_id?: string
  resolution_code_id?: string
  problem_other_text?: string
  cause_other_text?: string
  resolution_other_text?: string
  verification_result?: 'passed' | 'failed' | 'follow_up_required'
  verification_notes?: string
  verified_at?: string
  verified_by?: string
  snoozed_until?: string
  created_at: string
  updated_at: string
  // Joined
  rooms?: { room_number: string; floor?: number }
  assets?: Asset
  work_order_photos?: WorkOrderPhoto[]
  work_order_comments?: WorkOrderComment[]
  problem_code?: RepairCode
  cause_code?: RepairCode
  resolution_code?: RepairCode
}

export type VendorTrade = 'hvac' | 'plumbing' | 'electrical' | 'elevator' | 'fire_life_safety' | 'pool' | 'roofing' | 'locksmith_doors' | 'appliance' | 'laundry_equipment' | 'refrigeration' | 'general_contractor' | 'landscaping' | 'pest_control' | 'other'

export interface EngineeringVendor {
  id: string
  name: string
  trades: VendorTrade[]
  contact_name?: string
  phone?: string
  email?: string
  emergency_phone?: string
  offers_24h_service: boolean
  insurance_expires_at?: string
  notes?: string
  is_active: boolean
  performance?: { jobs: number; spend: number; average_acceptance_minutes?: number | null; average_arrival_minutes?: number | null; average_service_minutes?: number | null; emergency_jobs: number }
}

export interface VendorEngagement {
  id: string
  vendor_id: string
  work_order_id: string
  status: 'requested' | 'accepted' | 'en_route' | 'on_site' | 'completed' | 'cancelled'
  service_type: 'standard' | 'emergency'
  requested_at: string
  accepted_at?: string
  expected_arrival_at?: string
  arrived_at?: string
  completed_at?: string
  quote_amount?: number
  invoice_amount?: number
  reference_number?: string
  notes?: string
  engineering_vendors?: EngineeringVendor
}

export interface EngineeringInsights {
  period: { start: string; end: string }
  work_orders: { created: number; completed: number; median_response_minutes: number | null; median_arrival_minutes: number | null; median_resolution_minutes: number | null; median_active_labor_minutes: number | null; response_coverage: { tracked: number; eligible: number }; arrival_coverage: { tracked: number; eligible: number }; resolution_coverage: { tracked: number; eligible: number }; first_time_fix: { passed: number; eligible: number; percentage: number | null } }
  rooms: { affected: number; downtime_minutes: number; median_downtime_minutes: number | null; past_eta: number; median_post_repair_turnaround_minutes: number | null; reasons: Array<{ label: string; count: number }> }
  assets: { failures: number; unplanned_downtime_minutes: number; assets_down_now: number; attention: Array<{ asset_id: string; name: string; failures: number; downtime_minutes: number; currently_down: boolean }> }
  preventive: { completed: number; overdue: number; compliance_percentage: number | null; due: number }
  condition: { critical_readings: number; warning_readings: number; corrective_work_orders: number }
  costs: { labor: number; parts: number; vendors: number; total: number; coverage: { tracked: number; eligible: number } }
  vendors: { jobs: number; spend: number; median_response_minutes: number | null; median_arrival_minutes: number | null; median_service_minutes: number | null; awaiting: number; top: Array<{ vendor_id: string; name: string; jobs: number; spend: number }> }
}

export interface RepairCode {
  id: string
  code_type: 'problem' | 'cause' | 'resolution'
  code: string
  label: string
  engineering_category?: string | null
  asset_category_id?: string | null
  sort_order: number
}

export interface WorkOrderTimingEvent {
  id: string
  event_type: 'acknowledged' | 'assigned' | 'arrived' | 'work_started' | 'work_paused' | 'work_resumed' | 'work_completed' | 'reopened'
  occurred_at: string
  actor_user_id?: string
  staff_user_id?: string
}

export interface WorkOrderLaborSession {
  id: string
  staff_user_id: string
  started_at: string
  ended_at?: string
  duration_minutes?: number
  hourly_rate_snapshot?: number
  labor_cost?: number
}

export interface WorkOrderChecklistItem {
  id: string
  work_order_id: string
  label: string
  estimated_minutes?: number
  is_done: boolean
  done_by?: string
  done_at?: string
  sort_order: number
}

export interface WorkOrderPartTransaction {
  id: string
  part_id: string
  location_id: string
  transaction_type: 'add' | 'remove' | 'count' | 'transfer'
  quantity_delta: number
  resulting_quantity: number
  work_order_id: string | null
  user_id: string
  note: string | null
  created_at: string
  // Joined
  engineering_parts?: { name: string; unit: string; sku: string | null }
  engineering_part_locations?: { name: string }
}

export interface DuplicateSignalCandidate {
  work_order_id: string
  work_order_number: number
  title: string
  room_number?: string
  created_at: string
}

export interface DuplicateSignal {
  candidate_wo_id: string
  candidate_wo_number: number
  confidence: number
  window_days: number
  same_zone: boolean
  signals: DuplicateSignalCandidate[]
}

export type WorkOrderPriority = 'emergency' | 'urgent' | 'normal' | 'low'
export type WorkOrderStatus = 'open' | 'escalated' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'

export type WorkOrderSortBy = 'created_at' | 'due_at' | 'priority'

/** GM/engineering command-center KPIs. `cost_this_month` is null for non-GM roles. */
export interface WorkOrderStats {
  open: number
  escalated: number
  in_progress: number
  on_hold: number
  overdue: number
  unassigned: number
  urgent: number
  completed_today: number
  avg_resolution_minutes: number | null
  cost_this_month: number | null
}

export interface TransitionWorkOrderPayload {
  status: WorkOrderStatus
  reason_code?:
    | 'awaiting_parts'
    | 'awaiting_vendor'
    | 'schedule_deferral'
    | 'safety_review'
    | 'duplicate'
    | 'no_longer_needed'
    | 'reopened_after_failure'
    | 'reopened_on_request'
    | 'manager_override'
  reason_note?: string
  override?: boolean
  source?: 'web' | 'mobile' | 'api' | 'automation'
}

export interface FailurePrediction {
  id: string
  asset_id: string
  risk_score: number
  predicted_failure_window?: string
  failure_indicators?: string[]
  estimated_repair_cost?: number
  estimated_replace_cost?: number
  recommendation: string
  ai_reasoning?: string
  generated_at: string
  is_acknowledged: boolean
  acknowledged_at?: string
  // Joined
  assets?: Asset & { asset_categories?: { name: string } }
}

export interface RecurringIssue {
  key: string
  asset_id: string | null
  asset_name: string | null
  room_id: string | null
  room_number: string | null
  category: string | null
  wo_count: number
  window_days: number
  first_wo_at: string
  last_wo_at: string
  work_order_ids: string[]
}

export type BatchAcknowledgePredictionResult =
  | { prediction_id: string; action: 'acknowledged' }
  | { prediction_id: string; action: 'not_found' }
  | { prediction_id: string; action: 'error'; status: number; detail: string }

export interface PMSchedule {
  id: string
  asset_id: string
  name: string
  description?: string
  interval_type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'custom'
  interval_days?: number
  estimated_minutes: number
  assigned_to_role?: string
  recurrence_basis?: 'scheduled_date' | 'completion_date'
  last_completed_at?: string
  next_due_at: string
  is_active: boolean
  // Joined
  assets?: { name: string; room_id?: string }
}

// ─── API client ───────────────────────────────────────────────────────────────

export const engineeringApi = {
  listVendors: (params?: { q?: string; trade?: VendorTrade; active_only?: boolean }) => apiClient.get('/engineering/vendors', { params }) as Promise<{ data: EngineeringVendor[] }>,
  getVendor: (id: string) => apiClient.get(`/engineering/vendors/${id}`) as Promise<{ data: EngineeringVendor & { engagements: VendorEngagement[] } }>,
  createVendor: (payload: Omit<EngineeringVendor, 'id' | 'is_active' | 'performance'>) => apiClient.post('/engineering/vendors', payload) as Promise<{ data: EngineeringVendor }>,
  updateVendor: (id: string, payload: Partial<Omit<EngineeringVendor, 'id' | 'performance'>>) => apiClient.patch(`/engineering/vendors/${id}`, payload) as Promise<{ data: EngineeringVendor }>,
  listVendorEngagements: (workOrderId: string) => apiClient.get(`/engineering/vendors/work-orders/${workOrderId}/engagements`) as Promise<{ data: VendorEngagement[] }>,
  contactVendor: (workOrderId: string, payload: { vendor_id: string; service_type?: 'standard' | 'emergency'; expected_arrival_at?: string; quote_amount?: number; reference_number?: string; notes?: string; mark_work_order_waiting?: boolean }) => apiClient.post(`/engineering/vendors/work-orders/${workOrderId}/engagements`, payload) as Promise<{ data: VendorEngagement }>,
  updateVendorEngagement: (id: string, payload: Partial<Pick<VendorEngagement, 'status' | 'expected_arrival_at' | 'quote_amount' | 'invoice_amount' | 'reference_number' | 'notes'>>) => apiClient.patch(`/engineering/vendors/engagements/${id}`, payload) as Promise<{ data: VendorEngagement }>,
  getEngineeringInsights: (params?: { range?: '7d' | '30d' | '90d' | 'ytd' | 'custom'; start?: string; end?: string }) => apiClient.get('/engineering/insights', { params }) as Promise<{ data: EngineeringInsights }>,

  // ── Work Orders ──────────────────────────────────────────────────────────────

  listWorkOrders: (params?: {
    status?: string
    category?: string
    priority?: string
    assigned_to?: string
    room_id?: string
    asset_id?: string
    problem_code_id?: string
    cause_code_id?: string
    resolution_code_id?: string
    q?: string
    sort_by?: WorkOrderSortBy
    sort_dir?: 'asc' | 'desc'
    overdue?: boolean
    unassigned?: boolean
    archived?: boolean
    page?: number
    per_page?: number
  }) =>
    apiClient.get('/work-orders', { params }) as Promise<{
      data: WorkOrder[]
      meta: { page: number; per_page: number }
    }>,

  getWorkOrderStats: () =>
    apiClient.get('/work-orders/stats') as Promise<{ data: WorkOrderStats }>,

  createWorkOrder: (payload: {
    title?: string
    nl_input?: string
    description?: string
    category: string
    priority?: string
    room_id?: string
    location_text?: string
    asset_id?: string
    asset_impact?: 'operating' | 'degraded' | 'out_of_service'
    assigned_to?: string
    problem_code_id?: string
    problem_other_text?: string
    repeat_of_work_order_id?: string
    guest_reported?: boolean
    mark_room_out_of_order?: boolean
    room_unavailability?: { room_id: string; type: 'OUT_OF_ORDER' | 'OUT_OF_SERVICE'; reason_code: string; reason_label: string; expected_return_at: string; details?: string }
  }) => apiClient.post('/work-orders', payload) as Promise<{ data: WorkOrder; room_marked_out_of_order?: boolean }>,

  getWorkOrder: (id: string) =>
    apiClient.get(`/work-orders/${id}`) as Promise<{ data: WorkOrder }>,

  getRepairCodes: (params?: {
    type?: RepairCode['code_type']
    category?: string
    asset_category_id?: string
  }) => apiClient.get('/work-orders/repair-codes', { params }) as Promise<{ data: RepairCode[] }>,

  getRepeatSuggestion: (assetId: string, problemCodeId: string) =>
    apiClient.get('/work-orders/repeat-suggestion', { params: { asset_id: assetId, problem_code_id: problemCodeId } }) as Promise<{ data: WorkOrder | null }>,

  updateWorkOrder: (id: string, payload: {
    priority?: string
    assigned_to?: string
    notes?: string
    title?: string
    description?: string
    category?: string
  }) => apiClient.patch(`/work-orders/${id}`, payload) as Promise<{ data: WorkOrder }>,

  updateWorkOrderDiagnosis: (id: string, payload: {
    problem_code_id?: string
    cause_code_id?: string
    problem_other_text?: string
    cause_other_text?: string
  }) => apiClient.patch(`/work-orders/${id}/diagnosis`, payload) as Promise<{ data: WorkOrder }>,

  transitionWorkOrder: (id: string, payload: TransitionWorkOrderPayload) =>
    apiClient.post(`/work-orders/${id}/transition`, {
      ...payload,
      source: payload.source ?? 'web',
    }) as Promise<{ data: WorkOrder }>,

  deleteWorkOrder: (id: string) =>
    apiClient.delete(`/work-orders/${id}`),

  bulkArchiveWorkOrders: (payload: { work_order_ids: string[] }) =>
    apiClient.post('/work-orders/bulk-archive', payload) as Promise<{
      data: { archived_count: number }
    }>,

  bulkArchiveWorkOrdersByAge: (payload: { older_than_days: number }) =>
    apiClient.post('/work-orders/bulk-archive-by-age', payload) as Promise<{
      data: { archived_count: number }
    }>,

  bulkUnarchiveWorkOrders: (payload: { work_order_ids: string[] }) =>
    apiClient.post('/work-orders/bulk-unarchive', payload) as Promise<{
      data: { unarchived_count: number }
    }>,

  claimWorkOrder: (id: string) =>
    apiClient.post(`/work-orders/${id}/claim`) as Promise<{ data: WorkOrder }>,

  acknowledgeWorkOrder: (id: string) => apiClient.post(`/work-orders/${id}/acknowledge`),
  arriveAtWorkOrder: (id: string) => apiClient.post(`/work-orders/${id}/arrive`),
  startWorkOrderLabor: (id: string) => apiClient.post(`/work-orders/${id}/labor/start`),
  pauseWorkOrderLabor: (id: string) => apiClient.post(`/work-orders/${id}/labor/pause`),
  getWorkOrderEvents: (id: string) => apiClient.get(`/work-orders/${id}/events`) as Promise<{ data: WorkOrderTimingEvent[] }>,
  getWorkOrderLabor: (id: string) => apiClient.get(`/work-orders/${id}/labor`) as Promise<{ data: WorkOrderLaborSession[] }>,

  completeWorkOrder: (id: string, payload: {
    notes?: string
    labor_hours?: number
    parts_used?: string
    problem_code_id?: string
    cause_code_id?: string
    resolution_code_id?: string
    problem_other_text?: string
    cause_other_text?: string
    resolution_other_text?: string
    verification_result?: 'passed' | 'failed' | 'follow_up_required'
    verification_notes?: string
    asset_restoration?: 'keep_unavailable' | 'restore' | null
    // Structured spare-parts consumption (migration 102) -- decrements
    // engineering_part_stock and logs an engineering_part_transactions row
    // per item, distinct from the free-text parts_used field above.
    parts_consumed?: Array<{ part_id: string; location_id: string; quantity: number }>
  }) => apiClient.post(`/work-orders/${id}/complete`, payload) as Promise<{ data: WorkOrder }>,

  addComment: (id: string, comment: string) =>
    apiClient.post(`/work-orders/${id}/comments`, { comment }) as Promise<{ data: WorkOrderComment }>,

  uploadWorkOrderPhoto: (
    id: string,
    file: File,
    photoType: 'before' | 'after' | 'progress',
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('photo_type', photoType)
    return apiClient.post(`/work-orders/${id}/photos`, form) as Promise<{ data: WorkOrderPhoto }>
  },

  snoozeWorkOrder: (id: string, hours = 1) =>
    apiClient.post(`/work-orders/${id}/snooze`, { hours }) as Promise<{ data: WorkOrder }>,

  mergeWorkOrder: (id: string, targetWoId: string) =>
    apiClient.post(`/work-orders/${id}/merge`, { target_wo_id: targetWoId }) as Promise<{ data: WorkOrder }>,

  getDuplicateSignal: (id: string) =>
    apiClient.get(`/work-orders/${id}/duplicate-signal`) as Promise<{ data: DuplicateSignal | null }>,

  // ── Work Order Checklist (migration 110) ────────────────────────────────────

  listChecklistItems: (woId: string) =>
    apiClient.get(`/work-orders/${woId}/checklist`) as Promise<{ data: WorkOrderChecklistItem[] }>,

  addChecklistItem: (woId: string, payload: { label: string; estimated_minutes?: number }) =>
    apiClient.post(`/work-orders/${woId}/checklist`, payload) as Promise<{ data: WorkOrderChecklistItem }>,

  toggleChecklistItem: (woId: string, itemId: string, isDone: boolean) =>
    apiClient.patch(`/work-orders/${woId}/checklist/${itemId}`, { is_done: isDone }) as Promise<{
      data: WorkOrderChecklistItem
    }>,

  // ── Work Order Parts (migration 102 transactions, filtered by WO) ──────────────

  listWorkOrderParts: (woId: string) =>
    apiClient.get(`/work-orders/${woId}/parts`) as Promise<{ data: WorkOrderPartTransaction[] }>,

  // ── Assets ───────────────────────────────────────────────────────────────────

  listAssets: (params?: { risk_score_min?: number }) =>
    apiClient.get('/assets', { params }) as Promise<{ data: Asset[] }>,

  getAsset: (id: string) =>
    apiClient.get(`/assets/${id}`) as Promise<{ data: Asset }>,

  createAsset: (payload: {
    name: string
    category_id: string
    room_id?: string
    location_text?: string
    manufacturer?: string
    model?: string
    serial_number?: string
    purchase_date?: string
    installation_date?: string
    warranty_expires?: string
    asset_tag?: string
    notes?: string
    expected_lifespan_years?: number
    replacement_cost?: number
  }) => apiClient.post('/assets', payload) as Promise<{ data: Asset }>,

  updateAsset: (id: string, payload: Partial<Asset>) =>
    apiClient.patch(`/assets/${id}`, payload) as Promise<{ data: Asset }>,

  listAssetDowntime: (id: string) =>
    apiClient.get(`/assets/${id}/downtime`) as Promise<{ data: AssetDowntimePeriod[] }>,

  startAssetDowntime: (id: string, payload: {
    downtime_type?: AssetDowntimePeriod['downtime_type']
    impact_level?: AssetDowntimePeriod['impact_level']
    work_order_id?: string
    reason_code?: string
    notes?: string
  }) => apiClient.post(`/assets/${id}/downtime`, payload) as Promise<{
    data: { created: boolean; period: AssetDowntimePeriod }
  }>,

  restoreAssetDowntime: (assetId: string, downtimeId: string, notes?: string) =>
    apiClient.post(`/assets/${assetId}/downtime/${downtimeId}/restore`, { notes }) as Promise<{
      data: { restored: boolean; period: AssetDowntimePeriod }
    }>,

  getAssetReliability: (id: string) =>
    apiClient.get(`/assets/${id}/reliability`) as Promise<{ data: AssetReliabilitySummary }>,

  listAssetMeters: (assetId: string) =>
    apiClient.get(`/assets/${assetId}/meters`) as Promise<{ data: EngineeringMeter[] }>,
  getAssetConditionSummary: (assetId: string) =>
    apiClient.get(`/assets/${assetId}/condition-summary`) as Promise<{ data: AssetConditionSummary }>,
  createAssetMeter: (assetId: string, payload: {
    name: string; meter_type: MeterType; unit: string; location_text?: string
    warning_low?: number; warning_high?: number; critical_low?: number; critical_high?: number
    stale_after_hours?: number; source_type?: 'manual' | 'pm' | 'iot'
    critical_action?: 'none' | 'create_work_order'; notes?: string
  }) => apiClient.post(`/assets/${assetId}/meters`, payload) as Promise<{ data: EngineeringMeter }>,
  updateMeter: (meterId: string, payload: Partial<Pick<EngineeringMeter, 'name' | 'unit' | 'location_text' | 'warning_low' | 'warning_high' | 'critical_low' | 'critical_high' | 'stale_after_hours' | 'critical_action' | 'notes' | 'is_active'>>) =>
    apiClient.patch(`/assets/meters/${meterId}`, payload) as Promise<{ data: EngineeringMeter }>,
  listMeterReadings: (meterId: string, params?: { start?: string; end?: string; limit?: number }) =>
    apiClient.get(`/assets/meters/${meterId}/readings`, { params }) as Promise<{ data: MeterReading[] }>,
  recordMeterReading: (meterId: string, payload: { value: number; recorded_at?: string; notes?: string }) =>
    apiClient.post(`/assets/meters/${meterId}/readings`, payload) as Promise<{ data: MeterReading }>,

  // ── Failure Predictions ───────────────────────────────────────────────────────

  getFailurePredictions: () =>
    apiClient.get('/assets/failure-predictions') as Promise<{ data: FailurePrediction[] }>,

  acknowledgeFailurePrediction: (predictionId: string) =>
    apiClient.post(`/assets/failure-predictions/${predictionId}/acknowledge`) as Promise<{
      data: FailurePrediction
    }>,

  batchAcknowledgeFailurePredictions: (predictionIds: string[]) =>
    apiClient.post('/assets/failure-predictions/batch-acknowledge', {
      prediction_ids: predictionIds,
    }) as Promise<{
      data: {
        results: BatchAcknowledgePredictionResult[]
        succeeded: number
        failed: number
      }
    }>,

  // ── PM Schedules ──────────────────────────────────────────────────────────────

  listPMSchedules: () =>
    apiClient.get('/assets/pm-schedules') as Promise<{ data: PMSchedule[] }>,

  createPMSchedule: (payload: {
    asset_id: string
    name: string
    description?: string
    interval_type: string
    interval_days?: number
    estimated_minutes?: number
    next_due_at: string
    recurrence_basis?: 'scheduled_date' | 'completion_date'
  }) => apiClient.post('/assets/pm-schedules', payload) as Promise<{ data: PMSchedule }>,

  // ── PM Schedule management ────────────────────────────────────────────────────
  // Full completion capture (checklist results, verifier, evidence, parts, defects)
  // now lives in programsApi.completePM (lib/api/programs.ts) — see PMCompletionModal.

  updatePMSchedule: (scheduleId: string, payload: {
    name?: string
    description?: string
    interval_type?: string
    interval_days?: number
    estimated_minutes?: number
    next_due_at?: string
    is_active?: boolean
  }) => apiClient.patch(`/assets/pm-schedules/${scheduleId}`, payload) as Promise<{ data: PMSchedule }>,

  deactivatePMSchedule: (scheduleId: string) =>
    apiClient.delete(`/assets/pm-schedules/${scheduleId}`) as Promise<{ data: PMSchedule }>,

  // ── Asset categories ──────────────────────────────────────────────────────────

  listAssetCategories: () =>
    apiClient.get('/assets/categories') as Promise<{ data: { id: string; name: string; code: string; default_pm_interval_days?: number }[] }>,

  createAssetCategory: (payload: { name: string; code: string; default_pm_interval_days?: number }) =>
    apiClient.post('/assets/categories', payload) as Promise<{ data: { id: string; name: string; code: string } }>,

  // ── Failure predictions (extended) ───────────────────────────────────────────

  getFailurePredictionHistory: (params?: { acknowledged?: boolean; risk_min?: number }) =>
    apiClient.get('/assets/failure-predictions/history', { params }) as Promise<{ data: FailurePrediction[] }>,

  createWorkOrderFromPrediction: (predictionId: string) =>
    apiClient.post(`/assets/failure-predictions/${predictionId}/create-work-order`) as Promise<{ data: WorkOrder }>,

  runAssetPrediction: (assetId: string) =>
    apiClient.post(`/assets/${assetId}/run-prediction`) as Promise<{ data: FailurePrediction }>,

  getRecurringIssues: () =>
    apiClient.get('/assets/recurring-issues') as Promise<{ data: RecurringIssue[] }>,
}
