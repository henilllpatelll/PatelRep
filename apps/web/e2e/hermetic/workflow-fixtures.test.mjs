import assert from 'node:assert/strict'
import test from 'node:test'
import { workflowRoute, LF_CLAIMS, LF_RETURNS, OOO, LOGBOOK, INSPECTION_TEMPLATES, HK_SETTINGS } from './workflow-fixtures.mjs'

const iso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.includes('T')

test('claim timestamps are ISO instants (the claim drawer formats last_seen_at as a date and threw on free text)', () => {
  for (const claim of LF_CLAIMS) {
    assert.ok(iso(claim.created_at))
    if (claim.last_seen_at) assert.ok(iso(claim.last_seen_at), `${claim.id}.last_seen_at`)
    for (const key of ['stay_start', 'stay_end']) if (claim[key]) assert.match(claim[key], /^\d{4}-\d{2}-\d{2}$/, 'stay dates are date-only')
  }
})

test('returns, out-of-order periods and logbook entries carry the fields the screens dereference', () => {
  for (const row of LF_RETURNS) assert.ok(row.lost_found_items?.description && row.lost_found_claims?.guest_name)
  for (const period of OOO) assert.ok(period.rooms?.room_number && period.reason_label && Array.isArray(period.room_unavailability_events))
  for (const entry of LOGBOOK) assert.ok(entry.departments?.name && entry.user_profiles && typeof entry.is_ai_generated === 'boolean')
  assert.ok(INSPECTION_TEMPLATES[0].items.length >= 3 && INSPECTION_TEMPLATES[0].items.some((item) => item.requires_photo_on_fail))
  assert.equal(typeof HK_SETTINGS.credit_weights.DEP, 'number', 'toWorkloadDraft reads credit_weights.DEP')
})

test('routes: list, detail and unknown paths', () => {
  assert.equal(workflowRoute('/lost-found/claims').data.length, LF_CLAIMS.length)
  assert.equal(workflowRoute('/lost-found/claims/claim-1').data.id, 'claim-1')
  assert.equal(workflowRoute('/room-unavailability/summary').data.active, OOO.length)
  assert.equal(workflowRoute('/hotels/h1/housekeeping-settings').data, HK_SETTINGS)
  assert.equal(workflowRoute('/nothing/here'), null)
})
