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

export interface ProgramOverview {
  templates: ProgramTemplate[]
  deep_clean_schedules: Array<{ id: string; next_due_on: string; rooms?: { room_number: string }; public_areas?: { name: string } }>
  supply_pars: SupplyPar[]
  supply_alerts: Array<{ name: string; on_hand: number; par_level: number; shortage: number }>
  inspection_sampling_rules: Array<{ id: string; sample_percent: number; experience_band: string; risk_level: string }>
  stayover_rule: { linen_change_frequency_days: number; opt_out_allowed: boolean } | null
  dnd_welfare_policy: { threshold_hours: number; escalation_roles: string[]; escalation_instructions?: string } | null
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
