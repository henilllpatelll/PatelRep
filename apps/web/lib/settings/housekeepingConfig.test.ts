import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChecklistTemplate } from '../api/checklists'
import {
  addDraftItem, applyOverride, ASSIGNMENT_GROUPS, ASSIGNMENT_KEYS, assignmentDirty, buildOverrideRows, CLEAN_TYPES,
  draftsEqual, filterOverrideRows, formatCredits, groupChecklist, moveDraftItem, parseCredit, parseHousekeepingTab,
  removeDraftItem, reorderDraftItems, toChecklistPayload, toDraftItems, toWorkloadDraft, toWorkloadPayload,
  updateDraftItem, validateChecklistItem, validateWorkload, workloadDirty,
} from './housekeepingConfig'

type Items = ChecklistTemplate['items']
const items: Items = [
  { id: 'b', section: 'Bathroom', label: 'Scrub tub', is_required: true, sort_order: 2 },
  { id: 'a', section: 'Bedroom', label: 'Make bed', is_required: true, sort_order: 1 },
  { id: 'c', section: 'Bathroom', label: 'Restock', is_required: false, sort_order: 3 },
]

test('clean type identifiers are unchanged', () => {
  assert.deepEqual([...CLEAN_TYPES], ['DEP', 'FULL', 'LIGHT', 'DEFAULT'])
})

test('tab parsing falls back to cleaning', () => {
  assert.equal(parseHousekeepingTab('workload'), 'workload')
  assert.equal(parseHousekeepingTab('nope'), 'cleaning')
  assert.equal(parseHousekeepingTab(null), 'cleaning')
})

test('draft items load in saved sort order', () => {
  assert.deepEqual(toDraftItems(items).map((i) => i.key), ['a', 'b', 'c'])
  assert.deepEqual(toDraftItems(undefined), [])
})

test('new items join the end of their section; new sections go last', () => {
  const base = toDraftItems(items) // Bedroom, Bathroom, Bathroom
  const withBedroom = addDraftItem(base, { section: 'Bedroom', label: 'Pillows', is_required: false })
  assert.deepEqual(withBedroom.map((i) => i.label), ['Make bed', 'Pillows', 'Scrub tub', 'Restock'])
  const withNew = addDraftItem(base, { section: 'Closet', label: 'Hangers', is_required: true })
  assert.equal(withNew[withNew.length - 1].label, 'Hangers')
  assert.ok(withNew[withNew.length - 1].key.startsWith('new-'))
})

test('editing keeps position; changing section regroups; unknown key is a no-op', () => {
  const base = toDraftItems(items)
  const edited = updateDraftItem(base, 'b', { section: 'Bathroom', label: 'Scrub tub well', is_required: false })
  assert.deepEqual(edited.map((i) => i.label), ['Make bed', 'Scrub tub well', 'Restock'])
  assert.equal(edited[1].is_required, false)
  const moved = updateDraftItem(base, 'a', { section: 'Bathroom', label: 'Make bed', is_required: true })
  assert.deepEqual(moved.map((i) => i.key), ['b', 'c', 'a'])
  assert.equal(updateDraftItem(base, 'zzz', { section: 'x', label: 'y', is_required: true }), base)
})

test('remove, move and reorder', () => {
  const base = toDraftItems(items)
  assert.deepEqual(removeDraftItem(base, 'b').map((i) => i.key), ['a', 'c'])
  assert.deepEqual(moveDraftItem(base, 'c', -1).map((i) => i.key), ['a', 'c', 'b'])
  assert.equal(moveDraftItem(base, 'a', -1), base)
  assert.equal(moveDraftItem(base, 'c', 1), base)
  assert.deepEqual(reorderDraftItems(base, 0, 2).map((i) => i.key), ['b', 'c', 'a'])
  assert.equal(reorderDraftItems(base, 1, 1), base)
  assert.equal(reorderDraftItems(base, 0, 9), base)
})

test('grouping uses consecutive runs and reflects the saved order', () => {
  const groups = groupChecklist(toDraftItems(items))
  assert.deepEqual(groups.map((g) => [g.section, g.items.map((x) => x.index)]), [['Bedroom', [0]], ['Bathroom', [1, 2]]])
})

test('save payload keeps order and trims labels; drafts compare structurally', () => {
  const base = toDraftItems(items)
  const edited = updateDraftItem(base, 'a', { section: 'Bedroom', label: '  Make bed  ', is_required: true })
  assert.deepEqual(toChecklistPayload(edited)[0], { section: 'Bedroom', label: 'Make bed', is_required: true })
  assert.equal(draftsEqual(base, toDraftItems(items)), true)
  assert.equal(draftsEqual(base, edited), false)
  assert.equal(draftsEqual(base, moveDraftItem(base, 'c', -1)), false)
})

test('checklist item validation', () => {
  assert.deepEqual(validateChecklistItem({ section: 'Bedroom', label: 'ok' }), {})
  assert.ok(validateChecklistItem({ section: 'Bedroom', label: '   ' }).label)
  assert.ok(validateChecklistItem({ section: '', label: 'ok' }).section)
  assert.ok(validateChecklistItem({ section: 'Bedroom', label: 'x'.repeat(201) }).label)
})

test('credit parsing mirrors backend limits', () => {
  assert.deepEqual(parseCredit('16', 'target'), { ok: true, value: 16 })
  assert.equal(parseCredit('0', 'target').ok, false)
  assert.equal(parseCredit('100.5', 'target').ok, false)
  assert.equal(parseCredit('', 'target').ok, false)
  assert.equal(parseCredit('abc', 'target').ok, false)
  assert.equal(parseCredit('-1', 'weight').ok, false)
  assert.deepEqual(parseCredit('0', 'weight'), { ok: true, value: 0 })
  assert.deepEqual(parseCredit('10', 'weight'), { ok: true, value: 10 })
  assert.equal(parseCredit('10.25', 'weight').ok, false)
  assert.equal(parseCredit('0', 'override').ok, false)
  assert.deepEqual(parseCredit(' 18.5 ', 'override'), { ok: true, value: 18.5 })
  assert.equal(parseCredit('Infinity', 'override').ok, false)
})

const saved = { default_target_credits: 16, credit_weights: { DEP: 3, FULL: 2, LIGHT: 1 } }

test('workload draft round-trips the saved values and detects edits', () => {
  const draft = toWorkloadDraft(saved)
  assert.equal(workloadDirty(draft, saved), false)
  assert.equal(workloadDirty({ ...draft, default_target_credits: '17' }, saved), true)
  assert.equal(workloadDirty({ ...draft, credit_weights: { ...draft.credit_weights, LIGHT: '1.5' } }, saved), true)
  assert.deepEqual(toWorkloadPayload(draft), saved)
  assert.deepEqual(Object.keys(toWorkloadPayload(draft)).sort(), ['credit_weights', 'default_target_credits'])
})

test('workload validation reports each bad field', () => {
  const draft = toWorkloadDraft(saved)
  assert.equal(validateWorkload(draft).valid, true)
  const bad = validateWorkload({ default_target_credits: '-2', credit_weights: { DEP: '', FULL: '2', LIGHT: '11' } })
  assert.equal(bad.valid, false)
  assert.ok(bad.errors.target)
  assert.deepEqual(Object.keys(bad.errors.weights).sort(), ['DEP', 'LIGHT'])
})

test('credits are formatted for display', () => {
  assert.equal(formatCredits(16), '16.0')
  assert.equal(formatCredits(18.5), '18.5')
})

test('override rows distinguish defaults from overrides, sort and filter', () => {
  const rows = buildOverrideRows(
    [{ user_id: 'u2', full_name: 'Sarah Lee' }, { user_id: 'u1', full_name: 'Maria Lopez' }, { user_id: 'u3', full_name: 'Jane Smith' }],
    { u3: 18, gone: 5 },
  )
  assert.deepEqual(rows.map((r) => [r.name, r.override]), [['Jane Smith', 18], ['Maria Lopez', null], ['Sarah Lee', null]])
  assert.deepEqual(filterOverrideRows(rows, ' mar ').map((r) => r.name), ['Maria Lopez'])
  assert.equal(filterOverrideRows(rows, '').length, 3)
})

test('applyOverride sets, clears, drops default-equal values and leaves others alone', () => {
  const base = { u1: 20, u2: 12 }
  assert.deepEqual(applyOverride(base, 'u3', 18, 16), { u1: 20, u2: 12, u3: 18 })
  assert.deepEqual(applyOverride(base, 'u1', null, 16), { u2: 12 })
  assert.deepEqual(applyOverride(base, 'u1', 16, 16), { u2: 12 })
  assert.deepEqual(applyOverride(base, 'u1', 22, 16), { u1: 22, u2: 12 })
  assert.deepEqual(base, { u1: 20, u2: 12 }, 'input is not mutated')
})

test('assignment groups cover exactly the ten backend keys, once each', () => {
  assert.equal(ASSIGNMENT_KEYS.length, 10)
  assert.equal(new Set(ASSIGNMENT_KEYS).size, 10)
  assert.deepEqual(ASSIGNMENT_GROUPS.map((g) => g.id), ['priority', 'workload', 'availability', 'location'])
  const all = Object.fromEntries(ASSIGNMENT_KEYS.map((k) => [k, true])) as unknown as Parameters<typeof assignmentDirty>[0]
  assert.equal(assignmentDirty(all, { ...all }), false)
  assert.equal(assignmentDirty({ ...all, prefer_same_floor: false }, all), true)
})
