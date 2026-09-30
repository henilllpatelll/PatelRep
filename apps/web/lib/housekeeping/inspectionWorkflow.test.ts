import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveInspectionResult,
  requiredFailedPhotoItems,
  requiredUnansweredItems,
  selectInspectionTemplate,
} from './inspectionWorkflow'

const items = [
  { id: 'bed', section: 'Bedroom', description: 'Bed', is_required: true, requires_photo_on_fail: false, sort_order: 1 },
  { id: 'mirror', section: 'Bathroom', description: 'Mirror', is_required: true, requires_photo_on_fail: true, sort_order: 2 },
  { id: 'art', section: 'Bedroom', description: 'Artwork', is_required: false, requires_photo_on_fail: false, sort_order: 3 },
]

test('selects room-type template before default and standard fallback', () => {
  const templates = [
    { id: 'default', name: 'Default', room_type_id: null, is_default: true, is_active: true, items },
    { id: 'suite', name: 'Suite', room_type_id: 'suite-id', is_default: false, is_active: true, items },
  ]
  assert.equal(selectInspectionTemplate(templates, 'suite-id')?.id, 'suite')
  assert.equal(selectInspectionTemplate(templates, 'other')?.id, 'default')
})

test('requires answers only for required checklist items', () => {
  assert.deepEqual(requiredUnansweredItems(items, { bed: 'pass' }).map((item) => item.id), ['mirror'])
  assert.deepEqual(requiredUnansweredItems(items, { bed: 'pass', mirror: 'na' }), [])
})

test('derives the result from failures without treating N/A as pass', () => {
  assert.equal(deriveInspectionResult(items, { bed: 'pass', mirror: 'na' }), 'passed')
  assert.equal(deriveInspectionResult(items, { bed: 'pass', mirror: 'fail' }), 'failed')
})

test('requires evidence only for failed items configured to require it', () => {
  assert.deepEqual(requiredFailedPhotoItems(items, { bed: 'pass', mirror: 'fail' }, new Set()).map((item) => item.id), ['mirror'])
  assert.deepEqual(requiredFailedPhotoItems(items, { bed: 'pass', mirror: 'fail' }, new Set(['mirror'])), [])
})
