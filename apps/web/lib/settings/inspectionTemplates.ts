/**
 * Pure logic for Settings > Inspections: the section-based template editor, duplicate and payload mapping.
 * The API stores a flat, ordered item list where each item names its section, so sections are a view
 * built here and flattened again on save. Unit-tested in inspectionTemplates.test.ts.
 */
import type { InspectionTemplate } from '@/lib/api/housekeeping'

export const SECTION_SUGGESTIONS = [
  'Bathroom', 'Sleeping Area', 'General', 'Amenities', 'Closet', 'Balcony', 'Kitchenette', 'Entrance',
] as const

export interface TemplateDraftItem {
  /** Local identity only. Never sent to the server. */
  key: string
  description: string
  is_required: boolean
  requires_photo_on_fail: boolean
}

export interface TemplateDraftSection {
  key: string
  title: string
  items: TemplateDraftItem[]
}

export interface TemplateDraft {
  name: string
  is_default: boolean
  sections: TemplateDraftSection[]
}

let counter = 0
function nextKey(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export function emptyTemplateDraft(): TemplateDraft {
  return { name: '', is_default: false, sections: [] }
}

export function newItem(): TemplateDraftItem {
  return { key: nextKey('item'), description: '', is_required: true, requires_photo_on_fail: false }
}

/** Groups the flat API items by section (first appearance wins) while keeping each section's item order. */
export function toTemplateDraft(template: Pick<InspectionTemplate, 'name' | 'is_default' | 'items'>): TemplateDraft {
  const sections: TemplateDraftSection[] = []
  const sorted = [...template.items].sort((a, b) => a.sort_order - b.sort_order)
  for (const item of sorted) {
    let section = sections.find((s) => s.title === item.section)
    if (!section) {
      section = { key: nextKey('section'), title: item.section, items: [] }
      sections.push(section)
    }
    section.items.push({
      key: nextKey('item'),
      description: item.description,
      is_required: item.is_required,
      requires_photo_on_fail: item.requires_photo_on_fail,
    })
  }
  return { name: template.name, is_default: template.is_default, sections }
}

export const COPY_SUFFIX = ' — Copy'

/** An editable copy: same structure and flags, "— Copy" name, and never the default. */
export function duplicateTemplateDraft(template: Pick<InspectionTemplate, 'name' | 'is_default' | 'items'>): TemplateDraft {
  return { ...toTemplateDraft(template), name: `${template.name}${COPY_SUFFIX}`, is_default: false }
}

export function countDraft(draft: TemplateDraft): { sections: number; items: number } {
  return { sections: draft.sections.length, items: draft.sections.reduce((n, s) => n + s.items.length, 0) }
}

export function templateStats(template: Pick<InspectionTemplate, 'items'>): { sections: number; items: number } {
  return { sections: new Set(template.items.map((i) => i.section)).size, items: template.items.length }
}

/** Display line such as "3 sections · 14 checks". */
export function describeStats(stats: { sections: number; items: number }): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return `${plural(stats.sections, 'section')} · ${plural(stats.items, 'check')}`
}

// ─── Editing ──────────────────────────────────────────────────────────────────

export function addSection(draft: TemplateDraft, title: string): TemplateDraft {
  const section: TemplateDraftSection = { key: nextKey('section'), title: title.trim(), items: [newItem()] }
  return { ...draft, sections: [...draft.sections, section] }
}

export function renameSection(draft: TemplateDraft, sectionKey: string, title: string): TemplateDraft {
  return { ...draft, sections: draft.sections.map((s) => (s.key === sectionKey ? { ...s, title } : s)) }
}

export function removeSection(draft: TemplateDraft, sectionKey: string): TemplateDraft {
  return { ...draft, sections: draft.sections.filter((s) => s.key !== sectionKey) }
}

function swap<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export function moveSection(draft: TemplateDraft, sectionKey: string, direction: 1 | -1): TemplateDraft {
  const from = draft.sections.findIndex((s) => s.key === sectionKey)
  return { ...draft, sections: swap(draft.sections, from, from + direction) }
}

export function addItem(draft: TemplateDraft, sectionKey: string): TemplateDraft {
  return { ...draft, sections: draft.sections.map((s) => (s.key === sectionKey ? { ...s, items: [...s.items, newItem()] } : s)) }
}

export function updateItem(draft: TemplateDraft, sectionKey: string, itemKey: string, patch: Partial<Omit<TemplateDraftItem, 'key'>>): TemplateDraft {
  return {
    ...draft,
    sections: draft.sections.map((s) => (s.key === sectionKey
      ? { ...s, items: s.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) }
      : s)),
  }
}

export function removeItem(draft: TemplateDraft, sectionKey: string, itemKey: string): TemplateDraft {
  return { ...draft, sections: draft.sections.map((s) => (s.key === sectionKey ? { ...s, items: s.items.filter((i) => i.key !== itemKey) } : s)) }
}

export function moveItem(draft: TemplateDraft, sectionKey: string, itemKey: string, direction: 1 | -1): TemplateDraft {
  return {
    ...draft,
    sections: draft.sections.map((s) => {
      if (s.key !== sectionKey) return s
      const from = s.items.findIndex((i) => i.key === itemKey)
      return { ...s, items: swap(s.items, from, from + direction) }
    }),
  }
}

// ─── Dirty / validation / payload ────────────────────────────────────────────

/** Structural comparison that ignores local keys. */
function normalized(draft: TemplateDraft) {
  return JSON.stringify({
    name: draft.name.trim(),
    is_default: draft.is_default,
    sections: draft.sections.map((s) => ({
      title: s.title.trim(),
      items: s.items.map((i) => [i.description.trim(), i.is_required, i.requires_photo_on_fail]),
    })),
  })
}

export function templateDraftChanged(a: TemplateDraft, b: TemplateDraft): boolean {
  return normalized(a) !== normalized(b)
}

export const TEMPLATE_NAME_MAX = 120
export const ITEM_DESCRIPTION_MAX = 300

export interface TemplateErrors {
  name?: string
  general?: string
  sections: Record<string, string>
  items: Record<string, string>
}

export function validateTemplateDraft(draft: TemplateDraft): { errors: TemplateErrors; valid: boolean } {
  const errors: TemplateErrors = { sections: {}, items: {} }
  const name = draft.name.trim()
  if (!name) errors.name = 'Give the template a name.'
  else if (name.length > TEMPLATE_NAME_MAX) errors.name = `Keep the name under ${TEMPLATE_NAME_MAX} characters.`

  const seen = new Map<string, string>()
  for (const section of draft.sections) {
    const title = section.title.trim()
    if (!title) errors.sections[section.key] = 'Name this section.'
    else if (seen.has(title.toLowerCase())) errors.sections[section.key] = 'Another section already uses this name.'
    else seen.set(title.toLowerCase(), section.key)
    if (section.items.length === 0) errors.sections[section.key] ??= 'Add at least one check, or remove this section.'
    for (const item of section.items) {
      const text = item.description.trim()
      if (!text) errors.items[item.key] = 'Describe what to check.'
      else if (text.length > ITEM_DESCRIPTION_MAX) errors.items[item.key] = `Keep it under ${ITEM_DESCRIPTION_MAX} characters.`
    }
  }
  if (draft.sections.length === 0) errors.general = 'Add at least one section with a check.'

  const valid = !errors.name && !errors.general && Object.keys(errors.sections).length === 0 && Object.keys(errors.items).length === 0
  return { errors, valid }
}

export interface TemplatePayload {
  name: string
  is_default: boolean
  items: { section: string; description: string; is_required: boolean; requires_photo_on_fail: boolean; sort_order: number }[]
}

/** Flattens sections back to the ordered item list the API expects. */
export function toTemplatePayload(draft: TemplateDraft): TemplatePayload {
  const items: TemplatePayload['items'] = []
  for (const section of draft.sections) {
    for (const item of section.items) {
      items.push({
        section: section.title.trim(),
        description: item.description.trim(),
        is_required: item.is_required,
        requires_photo_on_fail: item.requires_photo_on_fail,
        sort_order: items.length,
      })
    }
  }
  return { name: draft.name.trim(), is_default: draft.is_default, items }
}

/** Real templates only: the API can return a not-yet-persisted placeholder with a null id. */
export function persistedTemplates(templates: InspectionTemplate[]): (InspectionTemplate & { id: string })[] {
  return templates.filter((t): t is InspectionTemplate & { id: string } => t.id !== null)
}
