import { apiClient } from '@/lib/api/client'

export interface ActivityActor {
  id: string | null
  name: string
  /** The role recorded at the time of the action (never the person's current role). */
  role: string | null
  role_label: string | null
}

export interface ActivityChange {
  field: string
  label: string
  /** Absent when the value was not recorded (it is never guessed). */
  before?: unknown
  after?: unknown
  added?: unknown[]
  removed?: unknown[]
  changed_keys?: string[]
}

export interface ActivityEvent {
  id: string
  action: string
  title: string
  category: string | null
  category_label: string | null
  /** Recorded UTC instant. */
  occurred_at: string
  actor: ActivityActor
  resource: { type: string; type_label: string; id: string; name: string | null }
  source: string | null
  has_details: boolean
  /** Only on the detail response; null when the event carries no change summary. */
  changes?: ActivityChange[] | null
}

export interface ActivityListMeta {
  limit: number
  has_more: boolean
  next_cursor: string | null
  date_from: string
  date_to: string
  timezone: string
}

export interface ActivityQuery {
  q?: string
  category?: string
  actor_id?: string
  resource_type?: string
  date_from?: string
  date_to?: string
}

export interface ActivityCategory { id: string; label: string }
export interface ActivityActorOption { id: string; name: string }

function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const activityApi = {
  list: (query: ActivityQuery, cursor?: string | null, limit = 25) =>
    apiClient.get(`/settings/activity${qs({ ...query, cursor, limit })}`) as Promise<{ data: ActivityEvent[]; meta: ActivityListMeta }>,

  get: (id: string) =>
    apiClient.get(`/settings/activity/${encodeURIComponent(id)}`) as Promise<{ data: ActivityEvent; meta: { timezone: string } }>,

  categories: () =>
    apiClient.get('/settings/activity/categories') as Promise<{ data: ActivityCategory[]; meta: { resource_types: ActivityCategory[] } }>,

  actors: () => apiClient.get('/settings/activity/actors') as Promise<{ data: ActivityActorOption[] }>,

  /** Bounded CSV of the same filtered, redacted results the screen shows (server-enforced). */
  exportCsv: (query: ActivityQuery): Promise<Blob> => apiClient.download(`/settings/activity/export${qs({ ...query })}`),
}
