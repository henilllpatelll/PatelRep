import { apiClient } from '@/lib/api/client'

export type TrainingStatus = 'compliant' | 'due_soon' | 'overdue' | 'not_applicable'
export interface TrainingStatusRow { employee_id: string; employee_role: string; course_id: string; course_name: string; provider_name: string; assignment_id: string | null; due_date: string | null; status: TrainingStatus }
export interface EmergencyPlan { id: string; title: string; version_number: number; effective_date: string | null; acknowledged_at: string | null }
export interface ControlledIncident { id: string; incident_type: string; location: string; occurred_at: string; immediate_containment: string; details?: string; created_at: string; created_by?: string; controlled_incident_events?: IncidentEvent[] }
export interface IncidentEvent { id: string; event_type: string; detail: string; actor_role: string; occurred_at: string }
export interface TrainingCourse { id: string; provider_name: string; course_name: string; course_code: string | null; covered_roles: string[]; new_hire_deadline_days: number; recurrence_months: number; is_active: boolean }
export interface ChemicalItem { id: string; product_name: string; manufacturer: string | null; storage_location: string; sds_evidence_id: string | null; secondary_label_verified: boolean; ppe_requirements: string[]; sds_url?: string | null }
export interface SafetyProcedure { id: string; title: string; version_number: number; effective_date: string | null }
export interface SafetyInformation { chemicals: ChemicalItem[]; procedures: SafetyProcedure[] }
export interface EmergencyContact { id: string; contact_name: string; role_label: string; phone: string; alternate_phone: string | null; is_primary: boolean }
export interface EmergencyDrill { id: string; drill_type: string; occurred_at: string; location: string; notes: string | null; created_at?: string }

export interface CreateCoursePayload { provider_name: string; course_name: string; course_code?: string | null; covered_roles: string[]; new_hire_deadline_days: number; recurrence_months: number }
export interface CreateChemicalPayload { product_name: string; manufacturer?: string | null; storage_location: string; secondary_label_verified: boolean; ppe_requirements: string[] }
export interface CreateContactPayload { contact_name: string; role_label: string; phone: string; alternate_phone?: string | null; is_primary: boolean }
export interface CreateDrillPayload { drill_type: string; occurred_at: string; location: string; notes?: string | null }

export const safetyApi = {
  // Staff
  listTrainingStatus: (): Promise<{ data: TrainingStatusRow[] }> => apiClient.get('/safety/training/status'),
  completeTraining: (assignmentId: string): Promise<{ data: unknown }> => apiClient.post(`/safety/training/assignments/${assignmentId}/complete`, {}),
  listEmergencyPlans: (): Promise<{ data: EmergencyPlan[] }> => apiClient.get('/safety/emergency/plans'),
  createIncident: (payload: { incident_type: string; occurred_at: string; location: string; immediate_containment: string; details: string }): Promise<{ data: ControlledIncident }> => apiClient.post('/safety/incidents', payload),
  getSafetyInformation: (): Promise<{ data: SafetyInformation }> => apiClient.get('/safety/safety-information'),
  listEmergencyContacts: (): Promise<{ data: EmergencyContact[] }> => apiClient.get('/safety/emergency/contacts'),

  // Manager
  createCourse: (payload: CreateCoursePayload): Promise<{ data: TrainingCourse }> => apiClient.post('/safety/training/courses', payload),
  exportTrainingCsv: (): Promise<Blob> => apiClient.download('/safety/training/export'),
  listChemicals: (): Promise<{ data: ChemicalItem[] }> => apiClient.get('/safety/chemicals'),
  createChemical: (payload: CreateChemicalPayload): Promise<{ data: ChemicalItem }> => apiClient.post('/safety/chemicals', payload),
  createContact: (payload: CreateContactPayload): Promise<{ data: EmergencyContact }> => apiClient.post('/safety/emergency/contacts', payload),
  createDrill: (payload: CreateDrillPayload): Promise<{ data: EmergencyDrill }> => apiClient.post('/safety/emergency/drills', payload),
  listIncidents: (): Promise<{ data: ControlledIncident[] }> => apiClient.get('/safety/incidents'),
  getIncident: (id: string): Promise<{ data: ControlledIncident }> => apiClient.get(`/safety/incidents/${id}`),
  appendIncidentEvent: (id: string, payload: { event_type: string; detail: string }): Promise<{ data: IncidentEvent }> => apiClient.post(`/safety/incidents/${id}/events`, payload),
}
