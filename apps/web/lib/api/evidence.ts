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

export interface DocumentAcknowledgement {
  id: string
  document_id: string
  assigned_to: string
  assigned_by: string | null
  due_date: string
  competency_required: boolean
  competency_status: 'not_required' | 'pending' | 'observed' | 'passed' | 'failed'
  competency_method: 'observed' | 'quiz' | null
  competency_notes: string | null
  competency_evaluated_at: string | null
  acknowledged_at: string | null
  assignment_type: 'initial' | 'retraining'
  controlled_documents?: Pick<ControlledDocument, 'title' | 'version_number' | 'approval_state'>
}

export interface DocumentAcknowledgementInput {
  assigned_to: string
  due_date: string
  competency_required: boolean
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

export type EvidenceType = 'file' | 'photo' | 'measurement' | 'checklist_result' | 'signature' | 'attestation' | 'external_certificate'
export type RelatedEvidenceEntityType = 'staff' | 'task' | 'asset' | 'room' | 'inspection' | 'incident' | 'sop'

export interface EvidenceRecord {
  id: string
  label: string
  evidence_type: EvidenceType
  document_id: string | null
  assignment_id: string | null
  related_entity_type: RelatedEvidenceEntityType | null
  related_entity_id: string | null
  measurement_value: string | null
  result: 'passed' | 'failed' | 'deferred' | null
  storage_path: string | null
  file_name: string | null
  file_content_type: string | null
  collected_by: string | null
  collected_at: string | null
  created_at: string
}

export interface EvidenceRecordInput {
  label: string
  evidence_type: EvidenceType
  document_id?: string
  assignment_id?: string
  related_entity_type?: RelatedEvidenceEntityType
  related_entity_id?: string
  measurement_value?: string
  result?: 'passed' | 'failed' | 'deferred'
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
  assignDocument: (documentId: string, payload: DocumentAcknowledgementInput): Promise<{ data: DocumentAcknowledgement }> => apiClient.post(`/evidence/documents/${documentId}/assignments`, payload),
  listDocumentAssignments: (documentId: string): Promise<{ data: DocumentAcknowledgement[] }> => apiClient.get(`/evidence/documents/${documentId}/assignments`),
  listMyAcknowledgements: (): Promise<{ data: DocumentAcknowledgement[] }> => apiClient.get('/evidence/my-acknowledgements'),
  acknowledgeDocument: (assignmentId: string): Promise<{ data: DocumentAcknowledgement }> => apiClient.post(`/evidence/acknowledgements/${assignmentId}/acknowledge`),
  evaluateCompetency: (assignmentId: string, payload: { assessment_method: 'observed' | 'quiz'; outcome: 'passed' | 'failed'; notes?: string }): Promise<{ data: DocumentAcknowledgement }> => apiClient.post(`/evidence/acknowledgements/${assignmentId}/competency`, payload),
  listRecords: (): Promise<{ data: EvidenceRecord[] }> => apiClient.get('/evidence/records'),
  getRecord: (recordId: string): Promise<{ data: EvidenceRecord }> => apiClient.get(`/evidence/records/${recordId}`),
  createRecord: (payload: EvidenceRecordInput): Promise<{ data: EvidenceRecord }> => apiClient.post('/evidence/records', payload),
  uploadRecordFile: (recordId: string, file: File): Promise<{ data: EvidenceRecord }> => {
    const payload = new FormData()
    payload.append('file', file)
    return apiClient.post(`/evidence/records/${recordId}/file`, payload)
  },
  getRecordFileUrl: (recordId: string): Promise<{ data: { url: string; expires_in_seconds: number } }> => apiClient.get(`/evidence/records/${recordId}/file-url`),
}
