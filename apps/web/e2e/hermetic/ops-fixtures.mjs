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

/** Returns a response body, or null when the path is not one of these routes. */
export function opsRoute(api) {
  if (api === '/tasks/workspace') {
    return { data: { active: { tasks: ACTIVE_TASKS, guest_requests: GUEST_REQUESTS }, history: { tasks: HISTORY_TASKS, guest_requests: [] } }, meta: { history_page: 1, history_per_page: 25 } }
  }
  if (api === '/programs/overview') return { data: PROGRAMS }
  if (api === '/engineering/insights') return { data: ENGINEERING_INSIGHTS }
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
