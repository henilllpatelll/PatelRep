import { apiClient } from '@/lib/api/client'

export type EvidenceExceptionState = 'missing' | 'overdue' | 'expired' | 'failed' | 'deferred' | 'unacknowledged'
export interface EvidenceException { state: EvidenceExceptionState; kind: 'document' | 'acknowledgement' | 'evidence'; reference_id: string; label: string }
export interface PropertyApplicability { facilities: string[]; services: string[]; brand_requirements: string[] }
export type ControlledDocumentType = 'sop' | 'policy' | 'training' | 'safety' | 'certificate'
export type ControlledDocumentState = 'draft' | 'approved' | 'superseded' | 'archived'
export type RetentionClass = 'operational_3_years' | 'safety_7_years' | 'brand_7_years'
export type DocumentLifecycleReason = 'approval' | 'supersession' | 'correction' | 'override' | 'deferral'

export interface ControlledDocument {
  id: string
  title: string
  document_type: ControlledDocumentType
  version_number: number
  approval_state: ControlledDocumentState
  owner_id: string | null
  approver_id: string | null
  approved_at: string | null
  effective_date: string | null
  review_date: string | null
  expiration_date: string | null
  applicability: string[]
  retention_class: RetentionClass
  source_sop_document_id: string | null
  supersedes_id: string | null
}

export interface ControlledDocumentInput {
  title: string
  document_type: ControlledDocumentType
  owner_id?: string
  effective_date?: string
  review_date?: string
  expiration_date?: string
  applicability?: string[]
  retention_class: RetentionClass
  source_sop_document_id?: string
}

export interface OperationalAuditEvent {
  id: string
  action: string
  actor_id: string | null
  actor_role: string
  reason_code: string | null
  reason_note: string | null
  created_at: string
  old_state: Record<string, unknown>
  new_state: Record<string, unknown>
}

export const PROPERTY_APPLICABILITY_OPTIONS: Record<keyof PropertyApplicability, readonly string[]> = {
  facilities: ['pool', 'spa', 'elevator', 'boiler', 'cooling_tower'],
  services: ['breakfast'],
  brand_requirements: ['brand_standard', 'brand_safety', 'brand_training'],
}

export const evidenceApi = {
  listExceptions: (): Promise<{ data: EvidenceException[] }> => apiClient.get('/evidence/exceptions'),
  getApplicability: (): Promise<{ data: PropertyApplicability }> => apiClient.get('/evidence/applicability'),
  updateApplicability: (payload: PropertyApplicability): Promise<{ data: PropertyApplicability }> => apiClient.put('/evidence/applicability', payload),
  listDocuments: (): Promise<{ data: ControlledDocument[] }> => apiClient.get('/evidence/documents'),
  getDocument: (documentId: string): Promise<{ data: ControlledDocument }> => apiClient.get(`/evidence/documents/${documentId}`),
  getDocumentHistory: (documentId: string): Promise<{ data: OperationalAuditEvent[] }> => apiClient.get(`/evidence/documents/${documentId}/history`),
  createDocument: (payload: ControlledDocumentInput): Promise<{ data: ControlledDocument }> => apiClient.post('/evidence/documents', payload),
  approveDocument: (documentId: string, payload: { reason_code?: DocumentLifecycleReason; reason_note?: string } = {}): Promise<{ data: ControlledDocument }> => apiClient.post(`/evidence/documents/${documentId}/approve`, payload),
  supersedeDocument: (documentId: string, payload: { reason_code?: DocumentLifecycleReason; reason_note?: string } = {}): Promise<{ data: ControlledDocument }> => apiClient.post(`/evidence/documents/${documentId}/supersede`, payload),
}
