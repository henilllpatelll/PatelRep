import type { InspectionTemplate, InspectionTemplateItem } from '@/lib/api/housekeeping'

export type InspectionAnswer = 'pass' | 'fail' | 'na'
export type InspectionAnswers = Record<string, InspectionAnswer | undefined>

export function selectInspectionTemplate(
  templates: InspectionTemplate[],
  roomTypeId?: string | null,
): InspectionTemplate | undefined {
  return templates.find((template) => template.room_type_id === roomTypeId && template.items.length > 0)
    ?? templates.find((template) => template.is_default && template.items.length > 0)
    ?? templates.find((template) => template.name === 'Standard Room Inspection' && template.items.length > 0)
}

export function requiredUnansweredItems(items: InspectionTemplateItem[], answers: InspectionAnswers) {
  return items.filter((item) => item.is_required && item.id && !answers[item.id])
}

export function deriveInspectionResult(items: InspectionTemplateItem[], answers: InspectionAnswers): 'passed' | 'failed' {
  return items.some((item) => item.id && answers[item.id] === 'fail') ? 'failed' : 'passed'
}

export function requiredFailedPhotoItems(
  items: InspectionTemplateItem[],
  answers: InspectionAnswers,
  uploadedItemIds: Set<string>,
) {
  return items.filter((item) => item.id && item.requires_photo_on_fail && answers[item.id] === 'fail' && !uploadedItemIds.has(item.id))
}
