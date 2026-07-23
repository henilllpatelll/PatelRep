import { apiClient } from '@/lib/api/client'
import { evidenceApi, type EvidenceType, type RelatedEvidenceEntityType } from '@/lib/api/evidence'

export interface ProgramTemplateChecklistItem {
  key?: string
  label: string
  requires_evidence: boolean
}

export interface ProgramTemplate {
  id: string
  code: string
  program_area: 'engineering' | 'housekeeping'
  name: string
  name_es?: string
  version: number
  // pm_checklist_templates.items JSONB shape (04-04): {checklist: [...], default_frequency_days: N}
  items?: { checklist: ProgramTemplateChecklistItem[]; default_frequency_days?: number | null } | null
}

// ─── PM completion (04-05) ────────────────────────────────────────────────────
// Mirrors apps/api/models/requests.py CompletePMProgramRequest / PMChecklistResultItem.
// photos / certificate_attachments / item.evidence are always `evidence_records.id`
// UUID strings — created via uploadEvidence() below, never a raw storage URL (D-06).

export interface PMChecklistItemInput {
  key?: string
  label: string
  result: 'passed' | 'failed' | 'not_applicable'
  requires_evidence: boolean
  evidence: string[]
  note?: string
}

export interface PMPart {
  name: string
  qty?: number
  cost?: number
}

export interface PMDefect {
  description: string
  severity?: string
}

export interface PMCompletionPayload {
  checklist_template_id?: string
  checklist_version?: number
  verifier_id?: string
  measurements?: Record<string, unknown>
  meter_readings?: Record<string, unknown>
  photos?: string[]
  labor_minutes?: number
  parts_used?: PMPart[]
  defects?: PMDefect[]
  vendor_name?: string
  certificate_attachments?: string[]
  notes?: string
  items: PMChecklistItemInput[]
}

export interface PMCompletionItemRecord extends PMChecklistItemInput {
  id?: string
  completion_id?: string
}

export interface PMCompletionRecord {
  id: string
  pm_schedule_id: string
  tenant_id?: string
  completed_by?: string
  verifier_id?: string | null
  checklist_template_id?: string | null
  checklist_version?: number | null
  measurements?: Record<string, unknown>
  meter_readings?: Record<string, unknown>
  photos?: string[]
  labor_minutes?: number
  parts_used?: PMPart[]
  defects?: PMDefect[]
  vendor_name?: string | null
  certificate_attachments?: string[]
  notes?: string | null
  completed_at?: string
  items?: PMCompletionItemRecord[]
}

export interface PMDeferralPayload {
  reason: string
  deferred_until: string
  approved_by: string
}

export interface PMDeferralRecord {
  id: string
  pm_schedule_id: string
  reason: string
  requested_by: string
  approved_by: string
  deferred_until: string
}

export interface SupplyPar {
  id: string
  supply_type: 'linen' | 'chemical' | 'amenity'
  name: string
  on_hand: number
  par_level: number
  unit: string
}

// ─── Housekeeping program depth (04-07 / HK-01, HK-04, HK-05, HK-06, G12) ──────

export interface PublicArea {
  id: string
  name: string
  location_detail?: string | null
  is_active?: boolean
}

export interface DeepCleanSchedule {
  id: string
  target_type: 'room' | 'public_area'
  room_id?: string | null
  public_area_id?: string | null
  checklist_template_id?: string | null
  interval_days: number
  next_due_on: string
  is_active?: boolean
  rooms?: { room_number: string } | null
  public_areas?: { name: string } | null
}

export interface DeepCleanOccurrence {
  id: string
  schedule_id: string
  assigned_to?: string
  completed_by?: string
  completed_at?: string
  checklist_results?: Array<Record<string, unknown>>
  notes?: string | null
}

export interface InspectionSamplingRule {
  id: string
  room_type_id?: string | null
  experience_band: 'new_hire' | 'standard' | 'trusted'
  risk_level: 'standard' | 'high'
  sample_percent: number
  room_types?: { name: string; code: string } | null
}

export interface InspectionSampleRoom {
  room_id: string
  room_type_id?: string | null
  experience_band: string
  risk_level: string
}

export interface InspectionSampleResponse {
  rooms: InspectionSampleRoom[]
  sample_size: number
}

export interface InspectionQualityDimension {
  key: string
  count: number
  pass_rate?: number
  fail_rate?: number
}

export interface InspectionQualityResponse {
  by_result: Array<{ key: string; count: number }>
  by_item: InspectionQualityDimension[]
  by_room_type: InspectionQualityDimension[]
  by_employee: InspectionQualityDimension[]
  sample_size: number
}

export interface CreatePublicAreaPayload {
  name: string
  location_detail?: string
}

export interface CreateDeepCleanSchedulePayload {
  target_type: 'room' | 'public_area'
  room_id?: string
  public_area_id?: string
  checklist_template_id?: string
  interval_days: number
  next_due_on: string
}

export interface CompleteDeepCleanPayload {
  checklist_results?: Array<Record<string, unknown>>
  notes?: string
}

export interface UpsertSamplingRulePayload {
  room_type_id?: string
  experience_band?: 'new_hire' | 'standard' | 'trusted'
  risk_level?: 'standard' | 'high'
  sample_percent: number
}

export interface ProgramOverview {
  templates: ProgramTemplate[]
  deep_clean_schedules: DeepCleanSchedule[]
  public_areas: PublicArea[]
  supply_pars: SupplyPar[]
  supply_alerts: Array<{ name: string; on_hand: number; par_level: number; shortage: number }>
  inspection_sampling_rules: InspectionSamplingRule[]
  stayover_rule: { linen_change_frequency_days: number; opt_out_allowed: boolean } | null
  dnd_welfare_policy: { threshold_hours: number; escalation_roles: string[]; escalation_instructions?: string | null } | null
}

export const programsApi = {
  overview: () => apiClient.get('/programs/overview') as Promise<{ data: ProgramOverview }>,
  initializeTemplates: () => apiClient.post('/programs/templates/initialize') as Promise<{ data: { created: number } }>,
  updateDndPolicy: (payload: { threshold_hours: number; escalation_roles: string[]; escalation_instructions?: string }) =>
    apiClient.put('/programs/dnd-welfare-policy', payload),
  updateStayoverRule: (payload: { linen_change_frequency_days: number; opt_out_allowed: boolean }) =>
    apiClient.put('/programs/stayover-rule', payload),
  upsertSupplyPar: (payload: { supply_type: 'linen' | 'chemical' | 'amenity'; name: string; on_hand: number; par_level: number; unit: string }) =>
    apiClient.post('/programs/supply-pars', payload),

  // ── Housekeeping program depth (04-07) ────────────────────────────────────────
  listDeepCleanSchedules: () => apiClient.get('/programs/deep-clean-schedules') as Promise<{ data: DeepCleanSchedule[] }>,
  createDeepCleanSchedule: (payload: CreateDeepCleanSchedulePayload) =>
    apiClient.post('/programs/deep-clean-schedules', payload) as Promise<{ data: DeepCleanSchedule }>,
  completeDeepClean: (id: string, payload: CompleteDeepCleanPayload) =>
    apiClient.post(`/programs/deep-clean-schedules/${id}/complete`, payload) as Promise<{ data: DeepCleanOccurrence }>,
  listPublicAreas: () => apiClient.get('/programs/public-areas') as Promise<{ data: PublicArea[] }>,
  createPublicArea: (payload: CreatePublicAreaPayload) =>
    apiClient.post('/programs/public-areas', payload) as Promise<{ data: PublicArea }>,
  inspectionSample: () => apiClient.get('/programs/inspection-sample') as Promise<{ data: InspectionSampleResponse }>,
  inspectionQuality: () => apiClient.get('/programs/inspection-quality') as Promise<{ data: InspectionQualityResponse }>,
  upsertSamplingRule: (payload: UpsertSamplingRulePayload) =>
    apiClient.post('/programs/inspection-sampling-rules', payload) as Promise<{ data: InspectionSamplingRule }>,

  // ── PM completion (04-05) ─────────────────────────────────────────────────────
  // Full defensible completion record — replaces the old canned-attestation stub.
  completePM: (scheduleId: string, payload: PMCompletionPayload) =>
    apiClient.post(`/assets/pm-schedules/${scheduleId}/complete`, payload) as Promise<{ data: PMCompletionRecord }>,

  getPMCompletion: (scheduleId: string, completionId: string) =>
    apiClient.get(`/assets/pm-schedules/${scheduleId}/completions/${completionId}`) as Promise<{ data: PMCompletionRecord }>,

  deferPM: (scheduleId: string, payload: PMDeferralPayload) =>
    apiClient.post(`/programs/pm-schedules/${scheduleId}/deferrals`, payload) as Promise<{ data: PMDeferralRecord }>,

  // Creates an evidence_record then uploads the file to it, returning the
  // evidence_record id — the only thing the PM-completion payload ever references
  // (never a raw storage URL, D-06). Reuses evidenceApi rather than duplicating
  // the create-record + upload-file flow already built for the evidence platform.
  uploadEvidence: async (
    file: File,
    opts: { related_entity_type: RelatedEvidenceEntityType; related_entity_id: string; evidence_type: EvidenceType; label: string },
  ): Promise<string> => {
    const created = await evidenceApi.createRecord({
      label: opts.label,
      evidence_type: opts.evidence_type,
      related_entity_type: opts.related_entity_type,
      related_entity_id: opts.related_entity_id,
    })
    await evidenceApi.uploadRecordFile(created.data.id, file)
    return created.data.id
  },
}
