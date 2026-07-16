import { apiClient } from '@/lib/api/client'

export type EvidenceExceptionState = 'missing' | 'overdue' | 'expired' | 'failed' | 'deferred' | 'unacknowledged'
export interface EvidenceException { state: EvidenceExceptionState; kind: 'document' | 'acknowledgement' | 'evidence'; reference_id: string; label: string }
export interface PropertyApplicability { facilities: string[]; services: string[]; brand_requirements: string[] }

export const evidenceApi = {
  listExceptions: (): Promise<{ data: EvidenceException[] }> => apiClient.get('/evidence/exceptions'),
  getApplicability: (): Promise<{ data: PropertyApplicability }> => apiClient.get('/evidence/applicability'),
}
