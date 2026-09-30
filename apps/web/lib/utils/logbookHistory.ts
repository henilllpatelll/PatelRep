import type { TFunction } from 'i18next'
import type { LogbookEntryEvent } from '@/lib/api/logbook'

/** Formats one operational-history event into a human-readable sentence for the
 * drawer's History tab. Only field NAMES are ever available in metadata (never
 * before/after values — spec #12), so edited events describe what changed, not
 * to what. */
export function formatHistoryEvent(t: TFunction, event: LogbookEntryEvent, shiftNameById: Record<string, string>): string {
  const actor = event.actor_name ?? t('logbook.acknowledgedFallback')

  switch (event.event_type) {
    case 'created':
      return event.actor_name ? t('logbook.historyEvents.created', { actor }) : t('logbook.historyEvents.createdFallback')
    case 'edited': {
      const fields = Array.isArray(event.metadata?.fields) ? (event.metadata.fields as string[]) : []
      if (fields.length === 0) return t('logbook.historyEvents.editedGeneric', { actor })
      const labels = fields.map((field) => t(`logbook.fields.${field}`, { defaultValue: field })).join(', ')
      return t('logbook.historyEvents.editedFields', { actor, fields: labels })
    }
    case 'carried_forward': {
      const destinationShiftId = typeof event.metadata?.destination_shift_id === 'string' ? event.metadata.destination_shift_id : undefined
      const shift = (destinationShiftId && shiftNameById[destinationShiftId]) || t('logbook.shift')
      return t('logbook.historyEvents.carriedForward', { actor, shift })
    }
    case 'resolved':
      return t('logbook.historyEvents.resolved', { actor })
    case 'archived':
      return t('logbook.historyEvents.archived', { actor })
    case 'reopened':
      return t('logbook.historyEvents.reopened', { actor })
    default:
      return actor
  }
}
