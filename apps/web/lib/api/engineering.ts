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
  completed_at?: string
  parts_used?: string
  labor_hours?: number
  labor_cost?: number
  parts_cost?: number
  total_cost?: number
  notes?: string
  snoozed_until?: string
  created_at: string
  updated_at: string
  // Joined
  rooms?: { room_number: string; floor?: number }
  assets?: Asset
  work_order_photos?: WorkOrderPhoto[]
  work_order_comments?: WorkOrderComment[]
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
  last_completed_at?: string
  next_due_at: string
  is_active: boolean
  // Joined
  assets?: { name: string; room_id?: string }
}

// ─── API client ───────────────────────────────────────────────────────────────

export const engineeringApi = {
  // ── Work Orders ──────────────────────────────────────────────────────────────

  listWorkOrders: (params?: {
    status?: string
    category?: string
    priority?: string
    assigned_to?: string
    room_id?: string
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
    assigned_to?: string
    guest_reported?: boolean
    mark_room_out_of_order?: boolean
  }) => apiClient.post('/work-orders', payload) as Promise<{ data: WorkOrder; room_marked_out_of_order?: boolean }>,

  getWorkOrder: (id: string) =>
    apiClient.get(`/work-orders/${id}`) as Promise<{ data: WorkOrder }>,

  updateWorkOrder: (id: string, payload: {
    priority?: string
    assigned_to?: string
    notes?: string
    title?: string
    description?: string
    category?: string
  }) => apiClient.patch(`/work-orders/${id}`, payload) as Promise<{ data: WorkOrder }>,

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

  completeWorkOrder: (id: string, payload: {
    notes?: string
    labor_hours?: number
    parts_used?: string
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
    expected_lifespan_years?: number
    replacement_cost?: number
  }) => apiClient.post('/assets', payload) as Promise<{ data: Asset }>,

  updateAsset: (id: string, payload: Partial<Asset>) =>
    apiClient.patch(`/assets/${id}`, payload) as Promise<{ data: Asset }>,

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
