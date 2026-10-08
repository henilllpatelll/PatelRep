import assert from 'node:assert/strict'
import test from 'node:test'
import type { InspectionTemplate } from '../api/housekeeping'
import {
  addItem, addSection, countDraft, describeStats, duplicateTemplateDraft, emptyTemplateDraft, moveItem, moveSection,
  persistedTemplates, removeItem, removeSection, renameSection, templateDraftChanged, templateStats, toTemplateDraft,
  toTemplatePayload, updateItem, validateTemplateDraft,
} from './inspectionTemplates'

const template: InspectionTemplate = {
  id: 't1', name: 'Standard', room_type_id: null, is_default: true, is_active: true,
  items: [
    { id: 'i3', section: 'Sleeping Area', description: 'Inspect bedding', is_required: true, requires_photo_on_fail: false, sort_order: 2 },
    { id: 'i1', section: 'Bathroom', description: 'Sanitize toilet', is_required: true, requires_photo_on_fail: false, sort_order: 0 },
    { id: 'i2', section: 'Bathroom', description: 'Inspect shower', is_required: false, requires_photo_on_fail: true, sort_order: 1 },
  ],
}

const flags = (draft: ReturnType<typeof toTemplateDraft>) =>
  toTemplatePayload(draft).items.map(({ section, description, is_required, requires_photo_on_fail }) => [section, description, is_required, requires_photo_on_fail])

test('flat items become ordered sections', () => {
  const draft = toTemplateDraft(template)
  assert.deepEqual(draft.sections.map((s) => [s.title, s.items.map((i) => i.description)]), [
    ['Bathroom', ['Sanitize toilet', 'Inspect shower']],
    ['Sleeping Area', ['Inspect bedding']],
  ])
  assert.deepEqual(draft.sections[0].items.map((i) => [i.is_required, i.requires_photo_on_fail]), [[true, false], [false, true]])
  assert.deepEqual(countDraft(draft), { sections: 2, items: 3 })
})

test('payload flattens back in order with sequential sort_order and no local keys', () => {
  const payload = toTemplatePayload(toTemplateDraft(template))
  assert.deepEqual(payload.items.map((i) => [i.section, i.description, i.sort_order]), [
    ['Bathroom', 'Sanitize toilet', 0], ['Bathroom', 'Inspect shower', 1], ['Sleeping Area', 'Inspect bedding', 2],
  ])
  assert.ok(payload.items.every((i) => !('key' in i)))
  assert.equal(payload.items[1].requires_photo_on_fail, true)
  assert.equal(payload.items[1].is_required, false)
})

test('duplicate keeps structure and flags, renames, is never default and does not touch the source', () => {
  const before = JSON.stringify(template)
  const copy = duplicateTemplateDraft(template)
  assert.equal(copy.name, 'Standard — Copy')
  assert.equal(copy.is_default, false)
  assert.deepEqual(flags(copy), flags(toTemplateDraft(template)))
  assert.equal(JSON.stringify(template), before)
  const keys = new Set([...toTemplateDraft(template).sections.flatMap((s) => s.items.map((i) => i.key)), ...copy.sections.flatMap((s) => s.items.map((i) => i.key))])
  assert.equal(keys.size, 6, 'copy gets its own local identities')
})

test('stats are derived from real items', () => {
  assert.deepEqual(templateStats(template), { sections: 2, items: 3 })
  assert.equal(describeStats({ sections: 2, items: 3 }), '2 sections · 3 checks')
  assert.equal(describeStats({ sections: 1, items: 1 }), '1 section · 1 check')
  assert.deepEqual(templateStats({ items: [] }), { sections: 0, items: 0 })
})

test('section and item editing', () => {
  let draft = addSection(emptyTemplateDraft(), '  Balcony ')
  assert.equal(draft.sections[0].title, 'Balcony')
  assert.equal(draft.sections[0].items.length, 1)
  const sKey = draft.sections[0].key
  draft = renameSection(draft, sKey, 'Terrace')
  draft = addItem(draft, sKey)
  assert.equal(draft.sections[0].items.length, 2)
  const [a, b] = draft.sections[0].items
  draft = updateItem(draft, sKey, a.key, { description: 'Sweep', requires_photo_on_fail: true })
  draft = moveItem(draft, sKey, b.key, -1)
  assert.deepEqual(draft.sections[0].items.map((i) => i.key), [b.key, a.key])
  draft = moveItem(draft, sKey, b.key, -1) // already first: unchanged
  assert.deepEqual(draft.sections[0].items.map((i) => i.key), [b.key, a.key])
  draft = removeItem(draft, sKey, b.key)
  assert.deepEqual(draft.sections[0].items.map((i) => i.description), ['Sweep'])
  draft = addSection(draft, 'Closet')
  draft = moveSection(draft, draft.sections[1].key, -1)
  assert.deepEqual(draft.sections.map((s) => s.title), ['Closet', 'Terrace'])
  draft = removeSection(draft, draft.sections[0].key)
  assert.deepEqual(draft.sections.map((s) => s.title), ['Terrace'])
})

test('dirty detection ignores local keys and trims whitespace', () => {
  const a = toTemplateDraft(template)
  const b = toTemplateDraft(template)
  assert.equal(templateDraftChanged(a, b), false)
  assert.equal(templateDraftChanged(a, { ...b, name: ' Standard ' }), false)
  assert.equal(templateDraftChanged(a, { ...b, name: 'Other' }), true)
  assert.equal(templateDraftChanged(a, { ...b, is_default: false }), true)
  const flipped = updateItem(b, b.sections[0].key, b.sections[0].items[0].key, { requires_photo_on_fail: true })
  assert.equal(templateDraftChanged(a, flipped), true)
})

test('validation: name, sections, items', () => {
  assert.equal(validateTemplateDraft(toTemplateDraft(template)).valid, true)
  const empty = validateTemplateDraft(emptyTemplateDraft())
  assert.equal(empty.valid, false)
  assert.ok(empty.errors.name && empty.errors.general)

  let draft = addSection({ ...emptyTemplateDraft(), name: 'X' }, 'Bathroom')
  const r1 = validateTemplateDraft(draft)
  assert.equal(r1.valid, false)
  assert.equal(Object.keys(r1.errors.items).length, 1, 'blank check is reported, not silently dropped')

  draft = addSection(draft, 'bathroom')
  const r2 = validateTemplateDraft(draft)
  assert.ok(r2.errors.sections[draft.sections[1].key], 'duplicate section names (case-insensitive)')

  const noItems = { ...draft, sections: [{ ...draft.sections[0], items: [] }] }
  assert.ok(validateTemplateDraft(noItems).errors.sections[noItems.sections[0].key])
  assert.ok(validateTemplateDraft({ ...toTemplateDraft(template), name: 'n'.repeat(121) }).errors.name)
})

test('placeholder templates without an id are not listed', () => {
  const list = persistedTemplates([template, { ...template, id: null, name: 'placeholder' }])
  assert.deepEqual(list.map((t) => t.id), ['t1'])
})
