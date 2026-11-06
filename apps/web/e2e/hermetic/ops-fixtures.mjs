/**
 * Deterministic fixtures for Tasks, Programs and Safety (hermetic mock backend).
 *
 * Same reason as reports-fixtures.mjs: these pages dereference object-shaped payloads, and the mock's generic
 * `{ data: [] }` fallback made them throw into the route error boundary (`reading 'tasks'`, `reading 'length'`).
 * That is a fixture gap, not an app defect. Data is clearly synthetic; timestamps are fixed.
 */

const T0 = '2020-01-01T12:00:00.000Z'
const USER = '00000000-0000-4000-8000-0000000000a1'

const task = (n, over) => ({
  id: `task-${n}`, title: `Task ${n}`, task_type: 'general', priority: 'normal', status: 'open', created_by: USER, is_ai_created: false,
  sla_minutes: 60, due_at: '2020-01-01T18:00:00.000Z', created_at: T0, updated_at: T0, ...over,
})

const ACTIVE_TASKS = [
  task(1, { title: 'Restock 3rd floor linen closet', task_type: 'housekeeping', priority: 'urgent', location_text: 'Floor 3', user_profiles: { full_name: 'Hermetic Housekeeper' }, assigned_to: 'u-1' }),
  task(2, { title: 'Check ice machine on 2', task_type: 'engineering', status: 'in_progress', started_at: T0, location_text: 'Floor 2', assigned_to: 'u-2', user_profiles: { full_name: 'Hermetic Engineer' } }),
  task(3, { title: 'Replace lobby planter', priority: 'low', task_type: 'general' }),
]
const HISTORY_TASKS = [task(9, { title: 'Deep clean pool restroom', task_type: 'housekeeping', status: 'completed', completed_at: '2019-12-31T20:00:00.000Z' })]
const GUEST_REQUESTS = [{
  id: 'gr-1', request_number: 1041, title: 'Extra towels', description: 'Two bath towels please', room_id: 'room-214', guest_name: 'Taylor Guest', status: 'open', priority: 'urgent',
  category: 'housekeeping', guest_impact: 'standard', sla_minutes: 30, due_at: '2020-01-01T12:30:00.000Z', created_by: USER, created_at: T0, rooms: { room_number: '214' }, work_orders: [],
}]

const PROGRAMS = {
  templates: [], deep_clean_schedules: [], public_areas: [], supply_pars: [], supply_alerts: [{ name: 'Bath towels', on_hand: 40, par_level: 120, shortage: 80 }],
  inspection_sampling_rules: [], stayover_rule: { linen_change_frequency_days: 3, opt_out_allowed: true },
  dnd_welfare_policy: { threshold_hours: 24, escalation_roles: ['housekeeping_supervisor'], escalation_instructions: 'Knock twice, then call the room.' },
}

const SAFETY_INFO = {
  chemicals: [{ id: 'chem-1', product_name: 'Neutral floor cleaner', manufacturer: 'Hermetic Supply Co.', storage_location: 'Laundry chemical closet', secondary_label_verified: true, ppe_requirements: ['Gloves', 'Eye protection'] }],
  procedures: [{ id: 'proc-1', title: 'Blood spill cleanup', body: 'Wear gloves, isolate the area, use the biohazard kit.', category: 'biohazard' }],
}
const CONTACTS = [{ id: 'ec-1', contact_name: 'Front Desk', role_label: 'On duty', phone: '555-0100', alternate_phone: null, is_primary: true }]

const asset = (n, over) => ({ id: `asset-${n}`, name: `Asset ${n}`, category_id: 'cat-1', is_active: true, failure_risk_score: 20, created_at: T0, updated_at: T0, asset_categories: { name: 'HVAC', code: 'HVAC' }, ...over })
const ASSETS = [
  asset(1, { name: 'Boiler 1', asset_tag: 'BLR-001', location_text: 'Mechanical room', manufacturer: 'Hermetic Heat', model: 'HB-400', failure_risk_score: 82, active_downtime: { id: 'dt-1', asset_id: 'asset-1', started_at: T0, downtime_type: 'unplanned', impact_level: 'out_of_service', elapsed_minutes: 540 } }),
  asset(2, { name: 'Ice machine, floor 2', asset_tag: 'ICE-002', location_text: 'Floor 2 alcove', asset_categories: { name: 'Appliance', code: 'APP' }, failure_risk_score: 55, warranty_expires: '2021-06-01' }),
  asset(3, { name: 'Room 214 PTAC', asset_tag: 'PTAC-214', room_id: 'room-214', rooms: { room_number: '214' }, failure_risk_score: 31 }),
  asset(4, { name: 'Lobby elevator', asset_tag: 'ELV-001', location_text: 'Lobby', asset_categories: { name: 'Elevator', code: 'ELV' }, failure_risk_score: 12 }),
]
const wo = (n, over) => ({ id: `wo-${n}`, work_order_number: 100 + n, title: `Work order ${n}`, category: 'general', priority: 'normal', status: 'open', created_by: USER, is_ai_created: false, is_pm_generated: false, guest_reported: false,
  sla_minutes: 240, due_at: '2020-01-01T18:00:00.000Z', created_at: T0, updated_at: T0, ...over })
const WORK_ORDERS = [
  wo(1, { title: 'Boiler not heating', category: 'hvac', priority: 'emergency', status: 'in_progress', asset_id: 'asset-1', assets: ASSETS[0], location_text: 'Mechanical room', assigned_to: 'regression-fixture-staff-2' }),
  wo(2, { title: 'Room 214 A/C not cooling', category: 'hvac', priority: 'urgent', room_id: 'room-214', rooms: { room_number: '214', floor: 2 }, guest_reported: true }),
  wo(3, { title: 'Leaking faucet', category: 'plumbing', priority: 'normal', room_id: 'room-305', rooms: { room_number: '305', floor: 3 }, status: 'on_hold' }),
  wo(4, { title: 'Replace lobby bulbs', category: 'electrical', priority: 'low', status: 'completed', completed_at: '2020-01-01T10:00:00.000Z' }),
]
const PM = [
  { id: 'pm-1', asset_id: 'asset-1', name: 'Boiler inspection', interval_type: 'quarterly', estimated_minutes: 90, last_completed_at: '2019-09-20T12:00:00.000Z', next_due_at: '2019-12-20T12:00:00.000Z', is_active: true, assets: { name: 'Boiler 1' } },
  { id: 'pm-2', asset_id: 'asset-2', name: 'Ice machine sanitize', interval_type: 'monthly', estimated_minutes: 45, next_due_at: '2020-01-10T12:00:00.000Z', is_active: true, assets: { name: 'Ice machine, floor 2' } },
  { id: 'pm-3', asset_id: 'asset-4', name: 'Elevator state inspection', interval_type: 'annual', estimated_minutes: 120, next_due_at: '2020-03-01T12:00:00.000Z', is_active: true, assets: { name: 'Lobby elevator' } },
]
const VENDORS = [
  { id: 'v-1', name: 'Hermetic HVAC Co.', trades: ['hvac'], contact_name: 'Pat Vendor', phone: '555-0140', email: 'dispatch@hvac.example', emergency_phone: '555-0141', offers_24h_service: true, insurance_expires_at: '2021-01-01', is_active: true, performance: { jobs: 4, spend: 4200, average_acceptance_minutes: 20, average_arrival_minutes: 180 } },
  { id: 'v-2', name: 'Hermetic Plumbing', trades: ['plumbing'], contact_name: 'Sam Vendor', phone: '555-0150', offers_24h_service: false, is_active: true, performance: { jobs: 2, spend: 800 } },
]

const LF_ITEMS = [
  { id: 'lf-1', description: 'Black leather wallet', location_found: 'Room 214', storage_location: 'Shelf A', category: 'wallet', classification: 'standard', found_at: '2019-12-30T15:00:00.000Z', retention_due_at: '2020-03-30T15:00:00.000Z', status: 'unclaimed', found_by: USER, created_at: '2019-12-30T15:00:00.000Z', tag_identifier: 'LF-0001', room_id: 'room-214' },
  { id: 'lf-2', description: 'Blue phone charger', location_found: 'Lobby', storage_location: 'Shelf B', category: 'electronics', classification: 'standard', found_at: '2019-12-28T10:00:00.000Z', retention_due_at: '2020-01-02T10:00:00.000Z', status: 'unclaimed', found_by: USER, created_at: '2019-12-28T10:00:00.000Z', tag_identifier: 'LF-0002' },
]

/** Returns a response body, or null when the path is not one of these routes. */
/** Data-rich fixtures (assets, work orders, PM, vendors, lost & found items) are OPT-IN. The Room-Board visual baseline is captured
 *  against the plain mock, and the board derives attention from work orders, so serving them by default changed its pixels. */
const RICH_ONLY = [/^\/assets(\/|$)/, /^\/work-orders(\/|$)/, /^\/engineering\/vendors$/, /^\/lost-found$/, /^\/lost-found\/lf-\d+$/]

export function opsRoute(api, query = new URLSearchParams()) {
  if (process.env.HERMETIC_RICH_DATA !== '1' && RICH_ONLY.some((pattern) => pattern.test(api))) return null
  if (api === '/tasks/workspace') {
    return { data: { active: { tasks: ACTIVE_TASKS, guest_requests: GUEST_REQUESTS }, history: { tasks: HISTORY_TASKS, guest_requests: [] } }, meta: { history_page: 1, history_per_page: 25 } }
  }
  if (api === '/programs/overview') return { data: PROGRAMS }
  if (api === '/assets') return { data: ASSETS }
  const assetDetail = api.match(/^\/assets\/(asset-\d+)$/)
  if (assetDetail) return { data: ASSETS.find((item) => item.id === assetDetail[1]) }
  if (api === '/assets/pm-schedules') return { data: PM }
  if (api === '/work-orders') {
    // Behave like the real list endpoint: honour the filters the page sends, so the same order is never returned twice.
    const wanted = (query.get('status') ?? '').split(',').filter(Boolean)
    const archived = query.get('archived') === 'true'
    let rows = WORK_ORDERS.filter((row) => (wanted.length ? wanted.includes(row.status) : true))
    if (archived) rows = []
    if (query.get('overdue') === 'true') rows = rows.filter((row) => row.status !== 'completed')
    if (query.get('unassigned') === 'true') rows = rows.filter((row) => !row.assigned_to && row.status !== 'completed')
    return { data: rows, meta: { page: 1, per_page: 50 } }
  }
  const woDetail = api.match(/^\/work-orders\/(wo-\d+)$/)
  if (woDetail) {
    const row = WORK_ORDERS.find((item) => item.id === woDetail[1])
    return { data: { ...row, work_order_photos: [], work_order_comments: [], timing_events: [], labor_sessions: [] } }
  }
  if (/^\/work-orders\/wo-\d+\/duplicate-signals?$/.test(api)) return { data: { signals: [] } }
  if (api === '/work-orders/stats') return { data: { open: 3, overdue: 3, unassigned: 2, on_hold: 1, in_progress: 1, completed_today: 1 } }
  if (api === '/engineering/vendors') return { data: VENDORS }
  if (api === '/engineering/insights') return { data: ENGINEERING_INSIGHTS }
  if (api === '/lost-found') return { data: LF_ITEMS, meta: { page: 1, per_page: 100, total: LF_ITEMS.length } }
  const lfItem = api.match(/^\/lost-found\/(lf-\d+)$/)
  if (lfItem) return { data: LF_ITEMS.find((item) => item.id === lfItem[1]) }
  if (api === '/lost-found/claims/summary') return { data: { open: 2, matched: 1, possible_matches: 3 } }
  if (api === '/lost-found/returns/summary') return { data: { awaiting_return: 2, ready_for_pickup: 1, shipping: 0, completed_this_month: 5 } }
  if (api === '/lost-found/disposition/summary') return { data: { due_now: 1, due_soon: 2, completed: 4 } }
  if (api === '/programs/inspection-sample') {
    return { data: { sample_size: 2, rooms: [
      { room_id: '00000000-0000-4000-8000-000000000101', room_type_id: 'rt-1', experience_band: 'new', risk_level: 'high' },
      { room_id: '00000000-0000-4000-8000-000000000103', room_type_id: 'rt-1', experience_band: 'experienced', risk_level: 'low' },
    ] } }
  }
  if (api === '/programs/inspection-quality') {
    return { data: { sample_size: 40, by_result: [{ key: 'passed', count: 36 }, { key: 'failed', count: 4 }],
      by_item: [{ key: 'Mirror streaks', count: 3, fail_rate: 7.5 }], by_room_type: [{ key: 'Standard', count: 40, pass_rate: 90 }], by_employee: [{ key: 'Hermetic Housekeeper', count: 24, pass_rate: 95 }] } }
  }
  if (api === '/safety/safety-information') return { data: SAFETY_INFO }
  if (api === '/safety/emergency/contacts') return { data: CONTACTS }
  return null
}

const COV = (tracked, eligible) => ({ tracked, eligible })
export const ENGINEERING_INSIGHTS = {
  period: { start: '2019-12-05', end: '2020-01-01' },
  work_orders: {
    created: 58, completed: 52, median_response_minutes: 38, median_arrival_minutes: 14, median_resolution_minutes: 205, median_active_labor_minutes: 96,
    response_coverage: COV(54, 58), arrival_coverage: COV(40, 58), resolution_coverage: COV(52, 52), first_time_fix: { passed: 44, eligible: 52, percentage: 84.6 },
  },
  rooms: { affected: 4, downtime_minutes: 3840, median_downtime_minutes: 780, past_eta: 1, median_post_repair_turnaround_minutes: 55, reasons: [{ label: 'HVAC', count: 2 }, { label: 'Plumbing', count: 2 }] },
  assets: { failures: 5, unplanned_downtime_minutes: 1260, assets_down_now: 1, attention: [{ asset_id: 'asset-1', name: 'Boiler 1', failures: 3, downtime_minutes: 900, currently_down: true }] },
  preventive: { completed: 20, overdue: 2, compliance_percentage: 83.3, due: 4 },
  condition: { critical_readings: 1, warning_readings: 6, corrective_work_orders: 2 },
  costs: { labor: 14150, parts: 8200, vendors: 5400, total: 27750, coverage: COV(40, 58) },
  vendors: { jobs: 6, spend: 5400, median_response_minutes: 95, median_arrival_minutes: 180, median_service_minutes: 140, awaiting: 1, top: [{ vendor_id: 'v-1', name: 'Hermetic HVAC Co.', jobs: 4, spend: 4200 }] },
}
