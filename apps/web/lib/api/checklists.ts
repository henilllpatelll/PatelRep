import { apiClient } from '@/lib/api/client'

export interface ChecklistItemInput {
  section: string
  label: string
  is_required: boolean
}

export interface ChecklistItem extends ChecklistItemInput {
  id: string
  sort_order: number
}

export interface ChecklistTemplate {
  id: string
  clean_type: 'DEP' | 'FULL' | 'LIGHT' | 'DEFAULT'
  name: string
  is_active: boolean
  items: ChecklistItem[]
}

export const CLEAN_TYPE_NAMES: Record<string, string> = {
  DEP: 'Departure Clean',
  FULL: 'Full Linen Change',
  LIGHT: 'Light Service',
  DEFAULT: 'Standard Clean',
}

export const checklistsApi = {
  list: () =>
    apiClient.get('/housekeeping/checklists'),

  update: (cleanType: string, payload: { name?: string; items: ChecklistItemInput[] }) =>
    apiClient.put(`/housekeeping/checklists/${cleanType}`, payload),

  reset: (cleanType: string) =>
    apiClient.post(`/housekeeping/checklists/${cleanType}/reset`, {}),
}
