import { apiClient } from '@/lib/api/client'

export type TrainingStatus = 'compliant' | 'due_soon' | 'overdue' | 'not_applicable'
export interface TrainingStatusRow { employee_id: string; employee_role: string; course_id: string; course_name: string; provider_name: string; assignment_id: string | null; due_date: string | null; status: TrainingStatus }
export interface EmergencyPlan { id: string; title: string; version_number: number; effective_date: string | null; acknowledged_at: string | null }
export interface ControlledIncident { id: string; incident_type: string; location: string; occurred_at: string; immediate_containment: string; created_at: string }

export const safetyApi = {
  listTrainingStatus: (): Promise<{ data: TrainingStatusRow[] }> => apiClient.get('/safety/training/status'),
  completeTraining: (assignmentId: string): Promise<{ data: unknown }> => apiClient.post(`/safety/training/assignments/${assignmentId}/complete`, {}),
  listEmergencyPlans: (): Promise<{ data: EmergencyPlan[] }> => apiClient.get('/safety/emergency/plans'),
  createIncident: (payload: { incident_type: string; occurred_at: string; location: string; immediate_containment: string; details: string }): Promise<{ data: ControlledIncident }> => apiClient.post('/safety/incidents', payload),
}
