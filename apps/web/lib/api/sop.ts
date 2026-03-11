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

// Upload uses raw fetch because apiClient always JSON.stringify(body) and
// overwrites Content-Type, which breaks multipart/form-data boundaries.
async function uploadDocument(formData: FormData): Promise<{ data: SOPDocument; message: string }> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/v1'

  // Grab the token the same way apiClient does
  let token: string | null = null
  if (typeof window !== 'undefined') {
    const key =
      'sb-' +
      (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
        .replace('https://', '')
        .split('.')[0] +
      '-auth-token'
    const raw = localStorage.getItem(key)
    if (raw) {
      try {
        token = JSON.parse(raw)?.access_token ?? null
      } catch {
        token = null
      }
    }
  }

  const res = await fetch(`${API_URL}/sop/documents`, {
    method: 'POST',
    headers: {
      // No Content-Type — the browser sets the multipart boundary automatically
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || err.detail || 'Upload failed')
  }

  return res.json()
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
