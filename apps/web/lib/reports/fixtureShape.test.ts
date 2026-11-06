import assert from 'node:assert/strict'
import test from 'node:test'
import { route } from '../../e2e/hermetic/mock-backend.mjs'
import { REPORT_VIEWS } from './filters'

/** Regression for the "/reports renders only its error boundary under hermetic fixtures" finding:
 *  the mock answered /reports/capabilities with an array (`{data: []}`), so `capabilities.views` was undefined. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (path: string, q = ''): any => route({ method: 'GET', path: `/v1${path}`, query: new URLSearchParams(q), body: null, email: 'gm@hermetic.invalid' })

test('capabilities is an object whose views cover every report tab (not an array)', () => {
  const body = get('/reports/capabilities').json.data
  assert.equal(Array.isArray(body), false)
  assert.deepEqual([...body.views].sort(), [...REPORT_VIEWS].sort())
  assert.ok(Array.isArray(body.departments) && body.departments.length > 0)
})

test('every view returns the envelope its component dereferences', () => {
  for (const view of REPORT_VIEWS) {
    const data = get(`/reports/views/${view}`).json.data
    assert.equal(data.view, view)
    assert.ok(data.period?.start && data.period?.end, `${view}: period`)
    if (view === 'management') {
      for (const key of ['time_labor', 'quality_risk', 'guest_response', 'maintenance_pm', 'downtime_exposure', 'staffing_forecast', 'ai_usage']) {
        assert.ok(data[key], `management.${key}`)
      }
    } else {
      assert.ok(Array.isArray(data.kpis) && data.kpis.length > 0, `${view}: kpis`)
    }
  }
})

test('overview carries exceptions, trends keyed by metric, departments and a live daily brief', () => {
  const data = get('/reports/views/overview').json.data
  assert.ok(data.needs_attention.length >= 2)
  for (const [metric, series] of Object.entries<any>(data.trends)) {
    assert.equal(series.metric, metric)
    assert.ok(series.points.length > 1 && series.comparison.points.length === series.points.length)
  }
  assert.ok(data.departments.every((d: any) => Array.isArray(d.measures)))
  assert.equal(data.daily_brief.scope, 'live')
})

test('KPI fixtures never present missing data as zero', () => {
  const data = get('/reports/views/housekeeping').json.data
  for (const k of data.kpis) assert.ok(k.value === null ? k.availability !== 'available' : k.availability === 'available')
})

test('definitions, schedules and delivery status are well formed', () => {
  assert.ok(Object.keys(get('/reports/definitions').json.data).length >= 8)
  assert.equal(get('/reports/schedules').json.data[0].frequency, 'weekly')
  assert.equal(get('/reports/delivery-status').json.data.configured, true)
})

test('tasks workspace, programs and safety fixtures are object-shaped (these pages threw on the generic `[]` fallback)', () => {
  const ws = get('/tasks/workspace').json.data
  assert.ok(Array.isArray(ws.active.tasks) && ws.active.tasks.length >= 3)
  assert.ok(Array.isArray(ws.active.guest_requests) && ws.active.guest_requests.length >= 1)
  assert.ok(Array.isArray(ws.history.tasks))
  const programs = get('/programs/overview').json.data
  for (const key of ['templates', 'deep_clean_schedules', 'public_areas', 'supply_pars', 'supply_alerts', 'inspection_sampling_rules']) assert.ok(Array.isArray(programs[key]), key)
  assert.ok(Array.isArray(get('/programs/inspection-sample').json.data.rooms))
  const quality = get('/programs/inspection-quality').json.data
  for (const key of ['by_result', 'by_item', 'by_room_type', 'by_employee']) assert.ok(Array.isArray(quality[key]), key)
  const info = get('/safety/safety-information').json.data
  assert.ok(Array.isArray(info.chemicals) && Array.isArray(info.procedures))
})
