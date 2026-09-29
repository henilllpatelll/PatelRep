import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_TASK_FILTER_STATE,
  createSavedView,
  decodeTaskFiltersFromParams,
  deleteSavedView,
  encodeAssigneeFilter,
  encodeTaskFiltersToParams,
  getDefaultSavedView,
  parseSavedViewsJson,
  renameSavedView,
  resolveAssigneeFilter,
  setDefaultSavedView,
  upsertSavedView,
  type SavedTaskView,
  type TaskFilterState,
} from './taskViews'

test('decoding an empty URL falls back to every default, including view/mode/priority/type', () => {
  const state = decodeTaskFiltersFromParams(new URLSearchParams())
  assert.deepEqual(state, DEFAULT_TASK_FILTER_STATE)
})

test('a malformed/unrecognized param value never crashes and falls back to the default instead', () => {
  const params = new URLSearchParams('view=bogus&mode=grid&priority=critical&type=engineering')
  const state = decodeTaskFiltersFromParams(params)
  assert.equal(state.view, 'active')
  assert.equal(state.boardMode, 'board')
  assert.equal(state.priority, '')
  assert.equal(state.sourceType, '')
})

test('encode/decode round-trips every filter field', () => {
  const state: TaskFilterState = {
    view: 'history', boardMode: 'table', search: 'towels', priority: 'urgent',
    sourceType: 'guest_request', assignee: '__me__', department: 'housekeeping',
    overdueOnly: true, verifyOnly: true,
  }
  const params = encodeTaskFiltersToParams(state, new URLSearchParams())
  assert.deepEqual(decodeTaskFiltersFromParams(params), state)
})

test('encoding back to defaults removes the params instead of writing empty/zero values', () => {
  const params = encodeTaskFiltersToParams(DEFAULT_TASK_FILTER_STATE, new URLSearchParams('view=history&overdue=1'))
  assert.equal(params.toString(), '')
})

test('encoding preserves unrelated existing params such as focus and a pre-existing type filter it does not own', () => {
  const params = encodeTaskFiltersToParams(
    { ...DEFAULT_TASK_FILTER_STATE, priority: 'urgent' },
    new URLSearchParams('focus=gr-123'),
  )
  assert.equal(params.get('focus'), 'gr-123')
  assert.equal(params.get('priority'), 'urgent')
})

test('the "__me__" sentinel resolves to whichever user currently applies it, not a frozen id', () => {
  assert.equal(resolveAssigneeFilter('__me__', 'user-A'), 'user-A')
  assert.equal(resolveAssigneeFilter('__me__', 'user-B'), 'user-B')
  assert.equal(resolveAssigneeFilter('__unassigned__', 'user-A'), '__unassigned__')
  assert.equal(resolveAssigneeFilter('specific-id', 'user-A'), 'specific-id')
})

test('encoding the live "Mine" quick filter (assigneeId === currentUserId) saves as the portable sentinel', () => {
  assert.equal(encodeAssigneeFilter('user-A', 'user-A'), '__me__')
  assert.equal(encodeAssigneeFilter('__unassigned__', 'user-A'), '__unassigned__')
  assert.equal(encodeAssigneeFilter('some-other-id', 'user-A'), 'some-other-id')
})

function view(overrides: Partial<SavedTaskView> = {}): SavedTaskView {
  return createSavedView(overrides.name ?? 'My Open Tasks', DEFAULT_TASK_FILTER_STATE, overrides.id ?? 'view-1', '2026-09-29T00:00:00Z')
}

test('upsertSavedView adds a new view, then replaces it in place on a second save with the same id', () => {
  const first = upsertSavedView([], view())
  assert.equal(first.length, 1)
  const renamed = { ...first[0], name: 'Renamed' }
  const second = upsertSavedView(first, renamed)
  assert.equal(second.length, 1)
  assert.equal(second[0].name, 'Renamed')
})

test('deleteSavedView removes exactly the matching id', () => {
  const views = [view({ id: 'a' }), view({ id: 'b' })]
  assert.deepEqual(deleteSavedView(views, 'a').map((v) => v.id), ['b'])
})

test('renameSavedView trims and ignores an empty/whitespace-only name', () => {
  const views = [view({ id: 'a', name: 'Old' })]
  assert.equal(renameSavedView(views, 'a', '  New Name  ')[0].name, 'New Name')
  assert.equal(renameSavedView(views, 'a', '   ')[0].name, 'Old')
})

test('setDefaultSavedView keeps exactly one default at a time', () => {
  const views = [view({ id: 'a' }), view({ id: 'b' })]
  const withDefault = setDefaultSavedView(views, 'a')
  assert.equal(getDefaultSavedView(withDefault)?.id, 'a')
  const switched = setDefaultSavedView(withDefault, 'b')
  assert.equal(getDefaultSavedView(switched)?.id, 'b')
  assert.equal(switched.find((v) => v.id === 'a')?.isDefault, false)
})

test('setDefaultSavedView(views, null) clears the default entirely', () => {
  const views = setDefaultSavedView([view({ id: 'a' })], 'a')
  assert.equal(getDefaultSavedView(setDefaultSavedView(views, null)), undefined)
})

test('parseSavedViewsJson never throws on corrupted localStorage content', () => {
  assert.deepEqual(parseSavedViewsJson(null), [])
  assert.deepEqual(parseSavedViewsJson('not json'), [])
  assert.deepEqual(parseSavedViewsJson('{"not":"an array"}'), [])
  assert.deepEqual(parseSavedViewsJson('[{"missing":"shape"}]'), [])
  assert.equal(parseSavedViewsJson(JSON.stringify([view()])).length, 1)
})

test('saved views with stale or malformed filters fall back safely instead of applying arbitrary values', () => {
  const raw = JSON.stringify([{
    id: 'stale-view',
    name: 'Old filters',
    filters: { view: 'unknown', boardMode: 'grid', priority: 'critical', sourceType: 'other', search: 99 },
  }])
  const [parsed] = parseSavedViewsJson(raw)
  assert.deepEqual(parsed.filters, DEFAULT_TASK_FILTER_STATE)
})
