/**
 * Data for the drawers and sub-views that the first hermetic fixtures did not cover (Phase 11): Lost & Found claims,
 * returns and disposition, out-of-order periods, and logbook entries. OPT-IN only (HERMETIC_RICH_DATA=1), same as the rest of
 * the rich data, so the Room-Board visual baseline (captured against the plain mock) is unchanged.
 * Fixed ids and fixed timestamps; nothing is derived from the clock.
 */
const T = '2019-12-30T15:00:00.000Z'
const STAFF_NAME = { preferred_name: 'Hermetic Housekeeper', full_name: 'Regression Fixture Housekeeper' }

export const LF_CAPABILITIES = {
  canViewInventory: true, canLogFoundItem: true, canEditFoundItem: true, canMoveFoundItem: true, canViewClaims: true, canCreateClaim: true,
  canEditClaim: true, canManageClaims: true, canReviewMatch: true, canConfirmMatch: true, canCancelClaim: true, canPrepareReturn: true,
  canReleaseItem: true, canShipItem: true, canApproveDisposition: true, canVoidRecord: true,
}

export const LF_CLAIMS = [
  { id: 'claim-1', claim_code: 'LFC-0001', claim_number: 1, guest_name: 'Dana Guest', guest_phone: '555-0101', guest_email: 'dana@guest.example', room_number: '214',
    stay_start: '2019-12-28', stay_end: '2019-12-30', description: 'Black leather wallet', category: 'wallets_cards', distinguishing_details: 'Initials D.G. inside',
    last_seen_at: '2019-12-30T09:00:00.000Z', notes: 'Guest called from the airport', status: 'open', created_at: T, rooms: { room_number: '214' } },
  { id: 'claim-2', claim_code: 'LFC-0002', claim_number: 2, guest_name: 'Lee Traveler', guest_email: 'lee@guest.example', description: 'Blue phone charger', category: 'electronics',
    status: 'matched', matched_item_id: 'lf-2', matched_at: T, created_at: T },
]
export const LF_RETURNS = [
  { id: 'ret-1', item_id: 'lf-2', claim_id: 'claim-2', method: 'pickup', status: 'ready_for_pickup', recipient_name: 'Lee Traveler', pickup_location: 'Front desk',
    pickup_verification_method_required: 'photo_id', pickup_ready_at: T, created_at: T, lost_found_items: { description: 'Blue phone charger', tag_identifier: 'LF-0002' },
    lost_found_claims: { claim_number: 2, guest_name: 'Lee Traveler' } },
  { id: 'ret-2', item_id: 'lf-1', claim_id: 'claim-1', method: 'shipping', status: 'shipping_preparation', recipient_name: 'Dana Guest', shipping_name: 'Dana Guest',
    shipping_address_line1: '12 Main St', shipping_city: 'Austin', shipping_region: 'TX', shipping_postal_code: '78701', shipping_country: 'US', created_at: T,
    lost_found_items: { description: 'Black leather wallet', tag_identifier: 'LF-0001' }, lost_found_claims: { claim_number: 1, guest_name: 'Dana Guest' } },
]
export const LF_EVENTS = [{ id: 'ev-1', event_type: 'created', actor_id: 'regression-fixture-staff-1', created_at: T, note: null }]

const OOO_ROOM = (n) => ({ room_number: n, floor: 1, room_types: { name: 'Standard', code: 'STD' } })
export const OOO = [
  { id: 'ooo-1', room_id: '00000000-0000-4000-8000-000000000106', status: 'ACTIVE', type: 'OUT_OF_ORDER', reason_code: 'hvac', reason_label: 'HVAC failure',
    details: 'Compressor not starting', expected_return_at: '2020-01-02T18:00:00.000Z', started_at: T, is_past_eta: false, rooms: OOO_ROOM('106'),
    work_orders: { id: 'wo-1', work_order_number: 1042, title: 'Replace compressor', priority: 'urgent', status: 'in_progress', assigned_to: null, created_at: T },
    room_unavailability_events: [{ id: 'oe-1', event_type: 'created', new_expected_return_at: '2020-01-02T18:00:00.000Z', note: null, actor_id: null, created_at: T }] },
  { id: 'ooo-2', room_id: '00000000-0000-4000-8000-000000000107', status: 'ACTIVE', type: 'OUT_OF_SERVICE', reason_code: 'deep_clean', reason_label: 'Deep clean',
    details: null, expected_return_at: '2019-12-31T12:00:00.000Z', started_at: T, is_past_eta: true, rooms: OOO_ROOM('107'), work_orders: null, room_unavailability_events: [] },
]
export const OOO_REASONS = [{ id: 'r1', code: 'hvac', label: 'HVAC failure' }, { id: 'r2', code: 'plumbing', label: 'Plumbing' }, { id: 'r3', code: 'deep_clean', label: 'Deep clean' }]

export const LOGBOOK = [
  { id: 'lb-1', department_id: 'dep-1', entry_date: '2020-01-01', content: 'Elevator B inspected, back in service after 20 minutes.', category: 'maintenance', status: 'follow_up', priority: 'important',
    is_ai_generated: false, author_id: 'regression-fixture-staff-1', created_at: T, user_profiles: STAFF_NAME, departments: { name: 'Engineering' }, comment_count: 1, read_count: 2, attachment_count: 0,
    requires_acknowledgment: true, acknowledgment_version: 1, acknowledgment: { required: true, total_required: 3, acknowledged_count: 1, current_user_required: true, current_user_acknowledged: false } },
  { id: 'lb-2', department_id: 'dep-2', entry_date: '2020-01-01', content: 'Guest in 305 asked for late checkout; front desk approved.', category: 'guest', status: 'informational', priority: 'normal',
    is_ai_generated: false, author_id: 'regression-fixture-staff-2', created_at: T, user_profiles: STAFF_NAME, departments: { name: 'Front Desk' }, comment_count: 0, read_count: 1, attachment_count: 0 },
]

export const INSPECTION_TEMPLATES = [{
  id: 'tmpl-1', name: 'Standard room', room_type_id: null, is_default: true, is_active: true,
  items: [
    { id: 'ti-1', section: 'Bathroom', description: 'Mirror and fixtures free of streaks', is_required: true, requires_photo_on_fail: true, sort_order: 1 },
    { id: 'ti-2', section: 'Bathroom', description: 'Towels and amenities restocked', is_required: true, requires_photo_on_fail: false, sort_order: 2 },
    { id: 'ti-3', section: 'Bedroom', description: 'Linens fresh, bed made to standard', is_required: true, requires_photo_on_fail: false, sort_order: 3 },
    { id: 'ti-4', section: 'Bedroom', description: 'Under-bed and nightstands clear', is_required: false, requires_photo_on_fail: false, sort_order: 4 },
  ],
}]

export const HK_SETTINGS = {
  default_target_credits: 16, credit_weights: { DEP: 1.5, FULL: 1, LIGHT: 0.5 }, capacity_overrides: {},
  assignment_preferences: {
    prioritize_guest_waiting: true, prioritize_rush: true, prioritize_earliest_arrival: false, balance_workload: true, minimize_reassignment: true,
    avoid_on_break: true, exclude_off_shift: true, exclude_unavailable: true, prefer_same_building: false, prefer_same_floor: true,
  },
}

export function workflowRoute(api) {
  if (api === '/housekeeping/inspections/templates') return { data: INSPECTION_TEMPLATES }
  if (/^\/hotels\/[^/]+\/housekeeping-settings$/.test(api)) return { data: HK_SETTINGS }
  if (api === '/lost-found/capabilities') return { data: LF_CAPABILITIES }
  if (api === '/lost-found/claims') return { data: LF_CLAIMS, meta: { page: 1, per_page: 50, total: LF_CLAIMS.length } }
  const claim = api.match(/^\/lost-found\/claims\/(claim-\d+)$/)
  if (claim) return { data: LF_CLAIMS.find((c) => c.id === claim[1]) }
  if (/^\/lost-found\/claims\/claim-\d+\/(events|matches)$/.test(api)) return { data: api.endsWith('events') ? LF_EVENTS : [] }
  if (api === '/lost-found/returns') return { data: LF_RETURNS, meta: { page: 1, per_page: 50 } }
  const ret = api.match(/^\/lost-found\/returns\/(ret-\d+)$/)
  if (ret) return { data: LF_RETURNS.find((r) => r.id === ret[1]) }
  if (/^\/lost-found\/returns\/ret-\d+\/events$/.test(api)) return { data: LF_EVENTS }
  if (api === '/lost-found/disposition') {
    return { data: [{ id: 'lf-2', description: 'Blue phone charger', storage_location: 'Shelf B', category: 'electronics', classification: 'standard', found_at: T,
      retention_due_at: '2020-01-02T10:00:00.000Z', status: 'unclaimed', created_at: T, tag_identifier: 'LF-0002' }], meta: { page: 1, per_page: 50 } }
  }
  if (/^\/lost-found\/lf-\d+\/(custody-events|matches)$/.test(api)) return { data: api.endsWith('matches') ? { possible_claims: [] } : [] }
  if (api === '/room-unavailability') return { data: OOO }
  if (api === '/room-unavailability/summary') return { data: { active: OOO.length, past_eta: 1 } }
  if (api === '/room-unavailability/reasons') return { data: OOO_REASONS }
  const ooo = api.match(/^\/room-unavailability\/(ooo-\d+)$/)
  if (ooo) return { data: OOO.find((p) => p.id === ooo[1]) }
  if (api === '/logbook/entries') return { data: LOGBOOK, meta: { page: 1, per_page: 50, total: LOGBOOK.length, has_more: false } }
  const lb = api.match(/^\/logbook\/entries\/(lb-\d+)$/)
  if (lb) return { data: LOGBOOK.find((e) => e.id === lb[1]) }
  if (/^\/logbook\/entries\/lb-\d+\/(comments|events|reads|attachments)$/.test(api)) return { data: [] }
  return null
}
