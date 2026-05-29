import { apiClient } from '@/lib/api/client'

export type FeedbackCategory = 'bug' | 'confusing' | 'missing_feature' | 'too_slow' | 'other'
export type FeedbackSeverity = 'blocking' | 'annoying' | 'idea'

export interface CreateFeedbackPayload {
  category?: FeedbackCategory
  severity?: FeedbackSeverity
  message: string
  page_url?: string
  pathname?: string
  user_agent?: string
  browser_language?: string
  viewport_width?: number
  viewport_height?: number
  client_context?: Record<string, unknown>
}

export interface FeedbackSubmission extends Omit<CreateFeedbackPayload, 'category' | 'severity'> {
  id: string
  tenant_id: string
  user_id: string
  user_role: string
  category: FeedbackCategory
  severity: FeedbackSeverity
  status: 'open' | 'reviewing' | 'closed'
  notification_status: 'pending' | 'sent' | 'failed' | 'not_configured'
  created_at: string
}

export const feedbackApi = {
  submit: (payload: CreateFeedbackPayload) =>
    apiClient.post('/feedback', payload) as Promise<{ data: FeedbackSubmission }>,
  list: () => apiClient.get('/feedback') as Promise<{ data: FeedbackSubmission[] }>,
}
