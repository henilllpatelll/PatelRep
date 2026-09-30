import assert from 'node:assert/strict'
import test from 'node:test'

import { excerptForLogbookSearch, parseLogbookSearchParams, splitSearchHighlight } from './logbookSearch'

test('normalizes unsafe Logbook URL filters and keeps only active constraints', () => {
  const filters = parseLogbookSearchParams(new URLSearchParams(
    'q=plumbing&date_from=2026-09-01&date_to=2026-09-30&category=maintenance&status=banana&priority=important&related_type=room&page=3&author=not-a-uuid',
  ))

  assert.equal(filters.q, 'plumbing')
  assert.equal(filters.date_from, '2026-09-01')
  assert.equal(filters.category, 'maintenance')
  assert.equal(filters.status, undefined)
  assert.equal(filters.priority, 'important')
  assert.equal(filters.related_type, 'room')
  assert.equal(filters.page, 3)
  assert.equal(filters.author_id, undefined)
})

test('rejects reversed and malformed date ranges without breaking search mode', () => {
  const filters = parseLogbookSearchParams(new URLSearchParams('q=boiler&date_from=2026-09-30&date_to=2026-09-01'))
  assert.equal(filters.date_from, undefined)
  assert.equal(filters.date_to, undefined)
})

test('highlights matching text as safe text segments and starts excerpts near the match', () => {
  assert.deepEqual(splitSearchHighlight('Room 412 has a plumbing leak', 'plumb'), [
    { text: 'Room 412 has a ' },
    { text: 'plumb', match: true },
    { text: 'ing leak' },
  ])
  assert.match(excerptForLogbookSearch('A very long note '.repeat(30) + 'about a boiler issue', 'boiler'), /boiler issue/)
})
