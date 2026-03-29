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
  category: 'plumbing' | 'electrical' | 'hvac' | 'furniture' | 'appliance' | 'structural' | 'safety' | 'general'
  priority: 'urgent' | 'normal' | 'low'
  status: 'open' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'
  room_id?: string
  location_text?: string
  asset_id?: string
  assigned_to?: string
  created_by: string
  is_ai_created: boolean
  is_pm_generated: boolean
  sla_minutes: number
  due_at?: string
  started_at?: string
  completed_at?: string
  parts_used?: string
  labor_hours?: number
  notes?: string
  created_at: string
  updated_at: string
  // Joined
  rooms?: { room_number: string; floor?: number }
  assets?: Asset
  work_order_photos?: WorkOrderPhoto[]
  work_order_comments?: WorkOrderComment[]
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
    page?: number
    per_page?: number
  }) =>
    apiClient.get('/work-orders', { params }) as Promise<{
      data: WorkOrder[]
      meta: { page: number; per_page: number }
    }>,

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
  }) => apiClient.post('/work-orders', payload) as Promise<{ data: WorkOrder }>,

  getWorkOrder: (id: string) =>
    apiClient.get(`/work-orders/${id}`) as Promise<{ data: WorkOrder }>,

  updateWorkOrder: (id: string, payload: {
    status?: string
    priority?: string
    assigned_to?: string
    notes?: string
    title?: string
    description?: string
    category?: string
  }) => apiClient.patch(`/work-orders/${id}`, payload) as Promise<{ data: WorkOrder }>,

  deleteWorkOrder: (id: string) =>
    apiClient.delete(`/work-orders/${id}`),

  claimWorkOrder: (id: string) =>
    apiClient.post(`/work-orders/${id}/claim`) as Promise<{ data: WorkOrder }>,

  completeWorkOrder: (id: string, payload: {
    notes?: string
    labor_hours?: number
    parts_used?: string
  }) => apiClient.post(`/work-orders/${id}/complete`, payload) as Promise<{ data: WorkOrder }>,

  addComment: (id: string, comment: string) =>
    apiClient.post(`/work-orders/${id}/comments`, { comment }) as Promise<{ data: WorkOrderComment }>,

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

  completePMSchedule: (scheduleId: string) =>
    apiClient.post(`/assets/pm-schedules/${scheduleId}/complete`) as Promise<{ data: PMSchedule }>,

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
}
