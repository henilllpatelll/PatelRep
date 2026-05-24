import { apiClient } from '@/lib/api/client'

export interface SOPDocument {
  id: string
  title: string
  description: string | null
  category: string | null
  storage_path: string
  file_size_bytes: number
  page_count: number | null
  indexing_status: 'pending' | 'processing' | 'indexed' | 'failed'
  chunk_count: number | null
  indexed_at: string | null
  uploaded_by: string
  created_at: string
  updated_at?: string | null
}

export interface SOPSource {
  content: string
  similarity: number
  metadata: Record<string, unknown>
  document_id: string
}

export interface SuggestedTask {
  title: string
  task_type: 'housekeeping' | 'engineering' | 'guest_request' | 'general'
  priority: 'urgent' | 'normal' | 'low'
}

export interface SOPQueryResult {
  answer: string
  sources: SOPSource[]
  suggested_tasks: SuggestedTask[]
  prompt_tokens: number
  completion_tokens: number
}

async function uploadDocument(formData: FormData): Promise<{ data: SOPDocument; message: string }> {
  return apiClient.post('/sop/documents', formData)
}

export const sopApi = {
  listDocuments: (): Promise<{ data: SOPDocument[] }> =>
    apiClient.get('/sop/documents'),

  getDocument: (id: string): Promise<{ data: SOPDocument }> =>
    apiClient.get(`/sop/documents/${id}`),

  uploadDocument,

  deleteDocument: (id: string): Promise<{ message: string }> =>
    apiClient.delete(`/sop/documents/${id}`),

  query: (query: string): Promise<{ data: SOPQueryResult }> =>
    apiClient.post('/sop/query', { query }),
}
