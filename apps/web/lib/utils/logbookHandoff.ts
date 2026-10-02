import type { LogbookCategory, LogbookPriority, LogbookRelatedType } from '@/lib/api/logbook'

// ── Follow-up "Due" preset math ──────────────────────────────────────────────
// Mirrors taskCreation.ts's computeInternalDueAt/endOfShiftDate shape so the two
// due-date pickers behave consistently across Tasks and Logbook.

export type FollowUpDuePreset = 'end_of_shift' | '1h' | '2h' | 'tomorrow' | 'custom'
const FOLLOW_UP_PRESET_MINUTES: Partial<Record<FollowUpDuePreset, number>> = { '1h': 60, '2h': 120, tomorrow: 24 * 60 }

/** Returns undefined when a preset can't be computed (e.g. end_of_shift with no
 * real shift data) — never fabricate a time. */
export function computeFollowUpDueAt(
  preset: FollowUpDuePreset,
  options: { now?: Date; endOfShiftAt?: Date | null; customIso?: string } = {},
): string | undefined {
  const now = options.now ?? new Date()
  if (preset === 'end_of_shift') return options.endOfShiftAt ? options.endOfShiftAt.toISOString() : undefined
  if (preset === 'custom') return options.customIso || undefined
  const minutes = FOLLOW_UP_PRESET_MINUTES[preset]
  return minutes ? new Date(now.getTime() + minutes * 60_000).toISOString() : undefined
}

// ── Temporary note ("hide after") ────────────────────────────────────────────
// Maps the simplified Add Handoff presets onto the existing expires_hours contract.

export type TemporaryNotePreset = '1h' | '4h' | '8h' | 'custom'
const TEMPORARY_NOTE_PRESET_HOURS: Record<Exclude<TemporaryNotePreset, 'custom'>, number> = { '1h': 1, '4h': 4, '8h': 8 }

export function temporaryNoteHours(preset: TemporaryNotePreset, customHours?: number): number | undefined {
  if (preset === 'custom') return customHours && customHours > 0 ? customHours : undefined
  return TEMPORARY_NOTE_PRESET_HOURS[preset]
}

/** Canonical navigation targets for records preserved in a shift-handoff
 * snapshot. These intentionally route into existing workspaces, rather than
 * introducing another nested record drawer. */
export function shiftHandoffSourceHref(type: LogbookRelatedType | 'part', id: string): string {
  if (type === 'task') return `/tasks?focus=${encodeURIComponent(id)}`
  if (type === 'guest_request') return `/tasks?type=guest_request&focus=${encodeURIComponent(id)}`
  if (type === 'work_order') return `/engineering?tab=work-orders&focus=${encodeURIComponent(id)}`
  if (type === 'part') return `/engineering?tab=parts&focus=${encodeURIComponent(id)}`
  return '/housekeeping'
}

// ── Payload builder ───────────────────────────────────────────────────────────

export interface AddHandoffValues {
  departmentId: string
  content: string
  category: LogbookCategory
  priority: LogbookPriority
  needsFollowUp: boolean
  followUpAt?: string
  assignedTo?: string
  relatedType?: LogbookRelatedType
  relatedId?: string
  temporaryNoteEnabled: boolean
  expiresHours?: number
  requiresAcknowledgment?: boolean
  acknowledgmentTargetIds?: string[]
}

/** The create action is ready only when every required hidden/visible field is valid. */
export function isAddHandoffReady(
  values: Pick<AddHandoffValues, 'departmentId' | 'content' | 'priority' | 'requiresAcknowledgment' | 'acknowledgmentTargetIds'>,
): boolean {
  if (!values.content.trim() || !values.departmentId) return false
  if (!values.requiresAcknowledgment) return true
  return values.priority === 'important' && Boolean(values.acknowledgmentTargetIds?.length)
}

/** Builds the clean structured create payload — status is always derived from
 * needsFollowUp rather than sent as a separate UI concept (spec #14), and
 * follow-up ownership/due are only ever sent alongside status=follow_up. */
export function buildAddHandoffPayload(values: AddHandoffValues) {
  const needsFollowUp = values.needsFollowUp
  return {
    department_id: values.departmentId,
    content: values.content.trim(),
    category: values.category,
    priority: values.priority,
    status: (needsFollowUp ? 'follow_up' : 'informational') as 'follow_up' | 'informational',
    follow_up_at: needsFollowUp ? values.followUpAt : undefined,
    assigned_to: needsFollowUp ? (values.assignedTo || undefined) : undefined,
    related_type: values.relatedType,
    related_id: values.relatedType ? values.relatedId : undefined,
    expires_hours: values.temporaryNoteEnabled ? values.expiresHours : undefined,
    requires_acknowledgment: values.requiresAcknowledgment || undefined,
    acknowledgment_target_ids: values.requiresAcknowledgment ? values.acknowledgmentTargetIds : undefined,
  }
}
