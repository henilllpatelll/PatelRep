/**
 * Deterministic fixtures for the /v1/reports/* endpoints, shaped exactly like apps/web/lib/reports/types.ts.
 *
 * Why this exists: the hermetic mock used to answer every unknown route with `{ data: [] }`. For
 * /reports/capabilities that is an ARRAY, so `capabilities.views` was undefined and the Reports shell threw
 * ("Cannot read properties of undefined") straight into the route error boundary. That was a fixture
 * data-shape gap, not an application defect: the real API always returns the object. These fixtures give
 * every Reports view representative, clearly synthetic data (no clock-derived values) so the screens can be
 * rendered, screenshotted and interacted with without credentials.
 */

const PERIOD = { start: '2019-12-05', end: '2020-01-01', timezone: 'America/Chicago', days: 28 }
const PREVIOUS = { start: '2019-11-07', end: '2019-12-04', timezone: 'America/Chicago', days: 28 }

function kpi(key, label, unit, value, extra = {}) {
  const previous = extra.previous ?? null
  const change = previous === null || value === null ? null : Math.round((value - previous) * 10) / 10
  return {
    key, label, unit, value, availability: value === null ? 'not_enough_data' : 'available', scope: extra.scope ?? 'period',
    comparison: previous === null || value === null ? null : { previous, change, change_kind: unit === 'percent' ? 'percentage_points' : 'percent', direction: extra.direction ?? 'favorable' },
    previous, change, change_kind: previous === null ? null : unit === 'percent' ? 'percentage_points' : 'percent',
    direction: previous === null ? null : extra.direction ?? 'favorable',
    eligible: extra.eligible ?? null, numerator: extra.numerator ?? null, sample_size: extra.sample_size ?? 40, low_sample: extra.low_sample ?? false,
    note: null, secondary: null,
  }
}

function trend(metric, label, unit, values) {
  const points = values.map((value, index) => ({
    bucket: `2019-12-${String(5 + index * 7).padStart(2, '0')}`, start: `2019-12-${String(5 + index * 7).padStart(2, '0')}`,
    end: `2019-12-${String(11 + index * 7).padStart(2, '0')}`, value, sample_size: 30 + index,
  }))
  const total = Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
  return {
    metric, label, unit, definition_key: metric, granularity: 'week', period: PERIOD, points, total,
    comparison: { period: PREVIOUS, points: points.map((p) => ({ ...p, value: Math.max(0, p.value - 3) })), total: Math.max(0, total - 3) },
  }
}

const GUEST_KPIS = [
  kpi('guest_sla', 'Guest SLA compliance', 'percent', 91.4, { previous: 88.2, eligible: 70, numerator: 64 }),
  kpi('guest_ack_time', 'Average acknowledgement', 'minutes', 6.2, { previous: 7.5 }),
  kpi('guest_requests_total', 'Guest requests', null, 74, { previous: 68, direction: 'neutral' }),
  kpi('guest_verified_resolution', 'Verified resolution', 'percent', 82.5, { previous: 79, eligible: 66, numerator: 54 }),
]
const MAINTENANCE_KPIS = [
  kpi('maintenance_sla', 'Maintenance SLA compliance', 'percent', 86.1, { previous: 84.0, eligible: 36, numerator: 31 }),
  kpi('maintenance_response', 'Average response', 'minutes', 38, { previous: 44 }),
  kpi('maintenance_completion', 'Work orders completed', null, 52, { previous: 47, direction: 'neutral' }),
  kpi('maintenance_repair', 'Average repair time', 'hours', 3.4, { previous: 3.9 }),
]
const HOUSEKEEPING_KPIS = [
  kpi('hk_avg_clean', 'Average clean time', 'minutes', 29.5, { previous: 31, direction: 'favorable' }),
  kpi('hk_inspection_pass', 'Inspection pass rate', 'percent', 93.2, { previous: 90.4, eligible: 88, numerator: 82 }),
  kpi('hk_rooms_cleaned', 'Rooms cleaned', null, 1190, { previous: 1104, direction: 'neutral' }),
  kpi('hk_labor_hours', 'Labor hours', 'hours', 612.5, { previous: 640 }),
]

const SLA_TREND = trend('guest_sla', 'Guest SLA compliance', 'percent', [87, 89, 92, 91])
const WO_TREND = trend('wo_completed', 'Work orders completed', null, [11, 13, 14, 14])

const OVERVIEW = {
  view: 'overview', period: PERIOD, comparison_period: PREVIOUS,
  kpis: [GUEST_KPIS[0], MAINTENANCE_KPIS[0], HOUSEKEEPING_KPIS[1], HOUSEKEEPING_KPIS[0], MAINTENANCE_KPIS[2], GUEST_KPIS[2]],
  needs_attention: [
    { key: 'overdue_work_orders', severity: 'critical', title: 'Overdue work orders', detail: '3 work orders are past due, 1 is urgent.', count: 3, department: 'engineering',
      target: { type: 'records', kind: 'work_orders', filter: 'overdue' } },
    { key: 'guest_near_deadline', severity: 'high', title: 'Guest requests near their deadline', detail: '2 requests will breach SLA within 15 minutes.', count: 2, department: 'guest_services',
      target: { type: 'view', view: 'guest-experience' } },
    { key: 'pm_deferred', severity: 'medium', title: 'Deferred preventive maintenance', detail: '1 PM schedule has been deferred twice.', count: 1, department: 'engineering', target: null },
  ],
  trends: { guest_sla: SLA_TREND, wo_completed: WO_TREND },
  departments: [
    { department: 'housekeeping', measures: [HOUSEKEEPING_KPIS[0], HOUSEKEEPING_KPIS[1]] },
    { department: 'engineering', measures: [MAINTENANCE_KPIS[0], MAINTENANCE_KPIS[1]] },
  ],
  daily_brief: { scope: 'live', as_of_date: '2020-01-01', tasks_completed_today: 41, open_work_orders: 9, room_status: { CLEAN: 38, DIRTY: 22, INSPECTED: 14, OCCUPIED: 61 } },
}

const GUEST = {
  view: 'guest-experience', period: PERIOD, comparison_period: PREVIOUS, kpis: GUEST_KPIS,
  categories: [{ key: 'housekeeping', count: 31, share_pct: 41.9 }, { key: 'engineering', count: 22, share_pct: 29.7 }, { key: 'front_desk', count: 21, share_pct: 28.4 }],
  needs_review: {
    counts: { breached: 1, near_deadline: 1, unverified_resolution: 1 }, total: 3,
    rows: [
      { id: 'gr-1', request_number: 1041, room: '214', category: 'Towels', summary: 'Extra towels requested', created_at: '2019-12-31T18:10:00Z', department: 'housekeeping', sla_state: 'breached', status: 'open' },
      { id: 'gr-2', request_number: 1042, room: '305', category: 'Noise', summary: 'Noise from the room above', created_at: '2019-12-31T19:02:00Z', department: 'front_desk', sla_state: 'near_deadline', status: 'in_progress' },
      { id: 'gr-3', request_number: 1039, room: '118', category: 'Temperature', summary: 'Room too warm', created_at: '2019-12-30T21:30:00Z', department: 'engineering', sla_state: 'unverified_resolution', status: 'resolved' },
    ],
  },
  departments: [
    { department: 'housekeeping', label: 'Housekeeping', total_requests: 31, sla_eligible: 29, sla_compliance_pct: 93.1, avg_acknowledgement_minutes: 5.1, low_sample: false },
    { department: 'engineering', label: 'Engineering', total_requests: 22, sla_eligible: 20, sla_compliance_pct: 85.0, avg_acknowledgement_minutes: 8.4, low_sample: false },
    { department: 'front_desk', label: 'Front Desk', total_requests: 21, sla_eligible: 21, sla_compliance_pct: 95.2, avg_acknowledgement_minutes: 4.7, low_sample: false },
  ],
}

const ROOM_TYPES = [
  { room_type_id: 'rt-1', code: 'STD', name: 'Standard', sessions: 640, avg_minutes: 28.4, baseline_minutes: 30, variance_minutes: -1.6, variance_pct: -5.3 },
  { room_type_id: 'rt-2', code: 'KNG', name: 'King Suite', sessions: 410, avg_minutes: 36.1, baseline_minutes: 35, variance_minutes: 1.1, variance_pct: 3.1 },
  { room_type_id: 'rt-3', code: 'DLX', name: 'Deluxe', sessions: 140, avg_minutes: 41.0, baseline_minutes: 40, variance_minutes: 1, variance_pct: 2.5, low_sample: true },
]
const HOUSEKEEPING = {
  view: 'housekeeping', period: PERIOD, comparison_period: PREVIOUS, kpis: HOUSEKEEPING_KPIS, room_types: ROOM_TYPES,
  inspection_quality: {
    total: 88, passed: 82, failed: 4, conditional: 2, shares: { passed: 93.2, failed: 4.5, conditional: 2.3 },
    top_failed_items: [{ template_item_id: 'ti-1', section: 'Bathroom', description: 'Mirror streaks', fail_count: 3 }],
    failed_by_section: [{ section: 'Bathroom', fail_count: 3 }, { section: 'Bedroom', fail_count: 1 }],
    repeat_defects: [{ template_item_id: 'ti-1', fail_count: 3, section: 'Bathroom', description: 'Mirror streaks' }],
  },
  staffing_outlook: {
    availability: 'available', horizon: '7 days', basis: 'Occupancy forecast and average clean time',
    days: [
      { date: '2020-01-02', projected_rooms: 96, projected_labor_hours: 48, required_housekeepers: 7, scheduled_housekeepers: 7, staffing_gap: 0 },
      { date: '2020-01-03', projected_rooms: 112, projected_labor_hours: 56, required_housekeepers: 8, scheduled_housekeepers: 6, staffing_gap: 2 },
    ],
  },
}

const PM = { active_schedules: 24, completed_schedules: 20, compliance_pct: 83.3, deferred_schedules: 2, repeated_deferral_count: 1,
  top_deferrals: [{ pm_schedule_id: 'pm-1', name: 'Boiler inspection', asset_id: 'asset-1', deferral_count: 2, deferred_until: '2020-01-10', reason: 'Parts on order' }] }
const MAINTENANCE = {
  view: 'maintenance', period: PERIOD, comparison_period: PREVIOUS, kpis: MAINTENANCE_KPIS,
  totals: { total_work_orders: 58, completed: 52, labor_hours: 141.5 },
  active_breaches: { scope: 'live', overdue_count: 3, urgent_overdue_count: 1, open_work_orders: 9, oldest: { id: 'wo-9', title: 'Replace thermostat', due_at: '2019-12-29T15:00:00Z', room: '305' } },
  by_category: [{ key: 'plumbing', count: 18, share_pct: 31 }, { key: 'hvac', count: 14, share_pct: 24.1 }, { key: 'electrical', count: 12, share_pct: 20.7 }],
  by_priority: [{ key: 'urgent', count: 6, share_pct: 10.3 }, { key: 'high', count: 15, share_pct: 25.9 }, { key: 'normal', count: 37, share_pct: 63.8 }],
  repeat_failures: [{ kind: 'room', id: 'room-305', label: 'Room 305', failure_count: 3, categories: [{ key: 'hvac', count: 3, share_pct: 100 }], most_recent_at: '2019-12-29T15:00:00Z' }],
  preventive_maintenance: PM,
  downtime: { total_hours: 64, rooms_affected: 4, rooms: [{ room_id: 'room-305', room: '305', downtime_hours: 30 }], return_to_service: { availability: 'not_enough_data', reason: 'Not enough completed repairs' },
    revenue_exposure: { configured: false, estimate_cents: null, is_estimate: true } },
}

const STAFF_ROWS = [
  { user_id: 'u-1', name: 'Hermetic Housekeeper', role: 'housekeeper', department: 'housekeeping', tasks_completed: 96, tasks_total: 101, wo_completed: 0, wo_total: 0, sla_eligible: 40, sla_met: 38, sla_compliance_pct: 95, total_labor_hours: 150.5, labor_tracked_count: 90, open_assignments: 4, low_sample: false },
  { user_id: 'u-2', name: 'Hermetic Engineer', role: 'engineer', department: 'engineering', tasks_completed: 12, tasks_total: 14, wo_completed: 31, wo_total: 36, sla_eligible: 30, sla_met: 25, sla_compliance_pct: 83.3, total_labor_hours: 88, labor_tracked_count: 28, open_assignments: 5, low_sample: false },
  { user_id: 'u-3', name: 'Hermetic New Hire', role: 'housekeeper', department: 'housekeeping', tasks_completed: 5, tasks_total: 6, wo_completed: 0, wo_total: 0, sla_eligible: 3, sla_met: 3, sla_compliance_pct: 100, total_labor_hours: null, labor_tracked_count: 0, open_assignments: 1, low_sample: true },
]
const TEAM = { view: 'team', period: PERIOD, comparison_period: PREVIOUS, kpis: [kpi('team_tasks_completed', 'Tasks completed', null, 113, { previous: 104, direction: 'neutral' })],
  staff: STAFF_ROWS, meta: { page: 1, per_page: 25, total: STAFF_ROWS.length }, roles: ['housekeeper', 'engineer'], notes: ['Staff with fewer than 10 eligible items are marked low sample.'] }

const MANAGEMENT = {
  view: 'management', period: PERIOD, comparison_period: PREVIOUS,
  time_labor: { kpis: [HOUSEKEEPING_KPIS[0], HOUSEKEEPING_KPIS[3]], by_room_type: ROOM_TYPES, trend: trend('hk_avg_clean', 'Average clean time', 'minutes', [31, 30, 29, 29.5]), forecast_labor_hours: [{ date: '2020-01-02', projected_labor_hours: 48 }] },
  quality_risk: { kpis: [HOUSEKEEPING_KPIS[1]], repeat_room_failures: [{ room_id: 'room-305', room: '305', failure_count: 3 }], repeat_asset_failures: [{ asset_id: 'asset-1', failure_count: 2 }], training_readiness: { acknowledged_pct: 88, overdue_assignments: 4 } },
  guest_response: { kpis: [GUEST_KPIS[0], GUEST_KPIS[1]] },
  maintenance_pm: { preventive_maintenance: PM, high_downtime_rooms: [{ room_id: 'room-305', room: '305', downtime_hours: 30 }] },
  downtime_exposure: { total_downtime_hours: 64, rooms_affected: 4, estimate_cents: null, adr_configured: false, is_estimate: true, caveat: 'Set your average daily rate to see an estimate.' },
  staffing_forecast: HOUSEKEEPING.staffing_outlook,
  ai_usage: { total_credits_used: 0, total_interactions: 0, breakdown_by_type: {}, truncated: false },
}

const VIEWS = { overview: OVERVIEW, 'guest-experience': GUEST, housekeeping: HOUSEKEEPING, maintenance: MAINTENANCE, team: TEAM, management: MANAGEMENT }

const DEFINITIONS = Object.fromEntries(
  [...GUEST_KPIS, ...MAINTENANCE_KPIS, ...HOUSEKEEPING_KPIS].map((k) => [k.key, {
    label: k.label, unit: k.unit ?? 'count', higher_is_better: null, scope: 'period', definition: `${k.label} for the selected period (synthetic fixture).`,
    numerator: 'Items meeting the target', denominator: 'Eligible items', cohort: 'All items in the period', exclusions: 'None in this fixture', source: 'Hermetic fixture',
  }]),
)

const SCHEDULE = {
  id: 'sched-1', name: 'Monday GM summary', report_type: 'overview', frequency: 'weekly', day_of_week: 1, day_of_month: null, local_time: '07:00', timezone: 'America/Chicago',
  reporting_window: 'last_7_days', output_format: 'pdf', enabled: true, department: null, include_definitions: true, recipients: [{ user_id: 'u-1', name: 'Hermetic GM' }],
  next_run_at: '2020-01-06T13:00:00Z', last_run_at: '2019-12-30T13:00:00Z', last_delivery: { status: 'sent', scheduled_occurrence: '2019-12-30T13:00:00Z', completed_at: '2019-12-30T13:00:05Z' },
  description: 'Every Monday at 7:00 AM Central', created_by: 'u-1',
}

/** Returns a `{ data }` body for a Reports GET, or null when the path is not a Reports route. */
export function reportsRoute(api, query) {
  if (!api.startsWith('/reports/')) return null
  if (api === '/reports/capabilities') {
    return { data: { role: 'gm', views: Object.keys(VIEWS), departments: ['housekeeping', 'engineering', 'guest_services', 'front_desk'], can_export: true,
      schedulable_views: ['overview', 'guest-experience', 'housekeeping', 'maintenance', 'team'], financial_access: true } }
  }
  if (api === '/reports/definitions') return { data: DEFINITIONS }
  if (api.startsWith('/reports/views/')) {
    const body = VIEWS[api.slice('/reports/views/'.length)]
    return body ? { data: body } : { data: null }
  }
  if (api === '/reports/trends') {
    const metric = query.get('metric') ?? 'guest_sla'
    return { data: metric === 'wo_completed' ? WO_TREND : { ...SLA_TREND, metric } }
  }
  if (api === '/reports/segments') {
    return { data: { metric: query.get('metric') ?? 'guest_sla', dimension: query.get('dimension') ?? 'category', dimensions: ['category', 'department'],
      segments: [{ segment: 'housekeeping', value: 93.1, sample_size: 29, previous: 90, previous_sample_size: 27, low_sample: false }, { segment: 'engineering', value: 85, sample_size: 20, previous: 84, previous_sample_size: 19, low_sample: false }] } }
  }
  if (api === '/reports/records') {
    return { data: { kind: query.get('kind') ?? 'work_orders', filter: query.get('filter') ?? 'all', period: PERIOD, rows: [], meta: { page: 1, per_page: 25, total: 0 }, truncated: false, scope: 'period' } }
  }
  if (api === '/reports/delivery-status') return { data: { configured: true, missing: [], blocked_reason: null, required_env: [] } }
  if (api === '/reports/schedules') return { data: [SCHEDULE] }
  if (api === '/reports/schedules/recipients') return { data: [{ user_id: 'u-1', name: 'Hermetic GM', role: 'gm', department: null }] }
  if (/^\/reports\/schedules\/[^/]+\/deliveries$/.test(api)) return { data: [] }
  return { data: [] }
}
