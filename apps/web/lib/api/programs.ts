import { apiClient } from '@/lib/api/client'

export interface ProgramTemplate {
  id: string
  code: string
  program_area: 'engineering' | 'housekeeping'
  name: string
  name_es?: string
  version: number
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
}
