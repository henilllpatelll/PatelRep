import { apiClient } from '@/lib/api/client'

export type EvidenceExceptionState = 'missing' | 'overdue' | 'expired' | 'failed' | 'deferred' | 'unacknowledged'
export interface EvidenceException { state: EvidenceExceptionState; kind: 'document' | 'acknowledgement' | 'evidence'; reference_id: string; label: string }
export interface PropertyApplicability { facilities: string[]; services: string[]; brand_requirements: string[] }

export const PROPERTY_APPLICABILITY_OPTIONS: Record<keyof PropertyApplicability, readonly string[]> = {
  facilities: ['pool', 'spa', 'elevator', 'boiler', 'cooling_tower'],
  services: ['breakfast'],
  brand_requirements: ['brand_standard', 'brand_safety', 'brand_training'],
}

export const evidenceApi = {
  listExceptions: (): Promise<{ data: EvidenceException[] }> => apiClient.get('/evidence/exceptions'),
  getApplicability: (): Promise<{ data: PropertyApplicability }> => apiClient.get('/evidence/applicability'),
  updateApplicability: (payload: PropertyApplicability): Promise<{ data: PropertyApplicability }> => apiClient.put('/evidence/applicability', payload),
}
