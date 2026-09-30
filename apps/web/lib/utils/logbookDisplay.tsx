'use client'

import { Bed, Flag, ShieldAlert, User, Wrench } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { LogbookCategory, LogbookPriority, LogbookRelatedType, LogbookStatus } from '@/lib/api/logbook'

export const LOGBOOK_CATEGORY_VALUES: readonly LogbookCategory[] = ['guest', 'room', 'maintenance', 'safety', 'general']
export const LOGBOOK_PRIORITY_VALUES: readonly LogbookPriority[] = ['normal', 'important']
export const LOGBOOK_RELATED_TYPE_VALUES: readonly LogbookRelatedType[] = ['room', 'task', 'work_order', 'guest_request']

/** Human-readable pointer to another PatelRep record — resolved client-side from
 * whichever domain API owns that record (rooms/tasks/work-orders/guest requests),
 * never fetched through logbookApi itself (spec #29). */
export interface LogbookRelatedItem {
  type: LogbookRelatedType
  id: string
  title: string
  subtitle?: string
  status?: string
}

export function getCategoryOptions(t: TFunction): Array<{ value: LogbookCategory; label: string }> {
  return LOGBOOK_CATEGORY_VALUES.map((value) => ({ value, label: t(`logbook.categories.${value}`) }))
}

export function categoryLabel(t: TFunction, category: LogbookCategory): string {
  return t(`logbook.categories.${category}`)
}

export function categoryIcon(category: LogbookCategory, size = 13) {
  switch (category) {
    case 'guest': return <User size={size} className="shrink-0" aria-hidden="true" />
    case 'room': return <Bed size={size} className="shrink-0" aria-hidden="true" />
    case 'maintenance': return <Wrench size={size} className="shrink-0" aria-hidden="true" />
    case 'safety': return <ShieldAlert size={size} className="shrink-0" aria-hidden="true" />
    case 'general': return <Flag size={size} className="shrink-0" aria-hidden="true" />
  }
}

export function statusLabel(t: TFunction, status: LogbookStatus): string {
  return t(`logbook.statuses.${status}`)
}

export function statusTone(status: LogbookStatus): 'neutral' | 'caution' | 'ready' {
  switch (status) {
    case 'follow_up': return 'caution'
    case 'resolved': return 'ready'
    default: return 'neutral'
  }
}

export function priorityLabel(t: TFunction, priority: LogbookPriority): string {
  return t(`logbook.priorities.${priority}`)
}

export function relatedTypeLabel(t: TFunction, type: LogbookRelatedType): string {
  return t(`logbook.linkTypes.${type}`)
}
